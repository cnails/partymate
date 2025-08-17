import { Telegraf, Scenes, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { gamesList } from '../keyboards.js';

const planWeight: Record<string, number> = { BASIC: 0, STANDARD: 1, PRO: 2 };

export const registerSearch = (bot: Telegraf, stage: Scenes.Stage) => {
  const askGame = async (ctx: any) => {
    const rows = gamesList.map((g) => [Markup.button.callback(g, `search_game:${g}`)]);
    await ctx.reply(
      `Укажите игру после команды, например:\n/search CS2\nили выберите из списка ниже.\n\nДоступно: ${gamesList.join(', ')}`,
      Markup.inlineKeyboard(rows),
    );
  };

  const showResults = async (ctx: any, page = 1, mode: 'reply' | 'edit' = 'reply') => {
    const sr = (ctx.session as any).searchResults as { game: string; profiles: any[]; page: number } | undefined;
    if (!sr) return;
    const { game, profiles } = sr;
    const perPage = 10;
    const totalPages = Math.ceil(profiles.length / perPage);
    const pageProfiles = profiles.slice((page - 1) * perPage, page * perPage);

    const rows = pageProfiles.map((p) => {
      const labels: string[] = [];
      if (p.isBoosted && p.boostUntil && new Date(p.boostUntil).getTime() > Date.now()) labels.push('🚀');
      if (p.plan && p.plan !== 'BASIC') labels.push(p.plan === 'PRO' ? '🏆' : '⭐️');
      const rating = p.rating ? p.rating.toFixed(1) : '0.0';
      const about = p.about
        ? p.about.slice(0, 50) + (p.about.length > 50 ? '…' : '')
        : '';
      const title = `${labels.join(' ')} ${p.user.username ? '@' + p.user.username : 'ID ' + p.userId} — ${p.pricePerHour}₽/ч — ⭐ ${rating}${about ? ' — ' + about : ''}`.trim();
      return [Markup.button.callback(title, `view_pf:${p.id}`)];
    });

    if (totalPages > 1) {
      const nav: any[] = [];
      if (page > 1) nav.push(Markup.button.callback('Предыдущая', `search_page:${page - 1}`));
      if (page < totalPages) nav.push(Markup.button.callback('Следующая', `search_page:${page + 1}`));
      rows.push(nav);
    }

    const text = `Найдено ${profiles.length} анкет по игре ${game} (страница ${page} из ${totalPages}):`;
    if (mode === 'edit') await ctx.editMessageText(text, Markup.inlineKeyboard(rows));
    else await ctx.reply(text, Markup.inlineKeyboard(rows));
    sr.page = page;
  };

  const runSearch = async (ctx: any, game: string) => {
    const raw = await prisma.performerProfile.findMany({
      where: { status: 'ACTIVE', games: { has: game } },
      take: 30,
      orderBy: [{ boostUntil: 'desc' }, { rating: 'desc' }, { createdAt: 'desc' }],
      include: { user: true },
    });

    // Домешаем вес плана вручную и сократим до 30
    const profiles = raw
      .map((p) => ({
        p,
        boostKey: p.boostUntil ? new Date(p.boostUntil).getTime() : 0,
        planKey: planWeight[(p.plan as any) || 'BASIC'] || 0,
        rating: p.rating || 0,
      }))
      .sort((a, b) => {
        if (b.boostKey !== a.boostKey) return b.boostKey - a.boostKey;
        if (b.planKey !== a.planKey) return b.planKey - a.planKey;
        if (b.rating !== a.rating) return b.rating - a.rating;
        return (b.p.createdAt as any) - (a.p.createdAt as any);
      })
      .slice(0, 30)
      .map((x) => x.p);

    if (!profiles.length) {
      await ctx.reply(
        'Пока нет анкет по этой игре. Попробуйте позже или другую игру.',
        Markup.inlineKeyboard([[Markup.button.callback('🔁 Изменить игру', 'search_change_game')]]),
      );
      return;
    }

    (ctx.session as any).searchResults = { game, profiles, page: 1 };
    await showResults(ctx, 1, 'reply');
  };

  bot.command('search', async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '/search';
    const arg = text.split(' ').slice(1).join(' ').trim();
    const game = gamesList.find((g) => g.toLowerCase() === arg.toLowerCase());
    if (!arg || !game) {
      await askGame(ctx);
      return;
    }
    await runSearch(ctx, game);
  });

  bot.action(/search_game:(.+)/, async (ctx) => {
    const selected = ctx.match?.[1];
    const game = gamesList.find((g) => g === selected);
    await ctx.answerCbQuery?.();
    if (!game) {
      await askGame(ctx);
      return;
    }
    await runSearch(ctx, game);
  });

  bot.on('callback_query', async (ctx, next) => {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    if (!data) return next();

    if (data === 'search_change_game') {
      await ctx.answerCbQuery?.();
      await askGame(ctx);
      return;
    }

    if (data.startsWith('view_pf:')) {
      const id = Number(data.split(':')[1]);
      const p = await prisma.performerProfile.findUnique({ where: { id }, include: { user: true } });
      if (!p || p.status !== 'ACTIVE') { await ctx.answerCbQuery?.('Анкета недоступна'); return; }

      const labels: string[] = [];
      if (p.isBoosted && p.boostUntil && new Date(p.boostUntil).getTime() > Date.now()) labels.push('🚀 Boost');
      if (p.plan && p.plan !== 'BASIC') labels.push(p.plan === 'PRO' ? '🏆 PRO' : '⭐️ STANDARD');

      const header = [
        `${labels.length ? labels.join(' · ') + ' · ' : ''}🎮 Анкета #${p.id}`,
        `Игры: ${p.games.join(', ')}`,
        `Цена: ${p.pricePerHour}₽/ч`,
        p.about ? `О себе: ${p.about}` : undefined,
        p.rating ? `Рейтинг: ${p.rating.toFixed(1)}` : undefined,
      ].filter(Boolean).join('\n');

      const kb: any[] = [];
      kb.push([Markup.button.callback('Оставить заявку', `req_pf:${p.userId}`)]);
      kb.push([Markup.button.callback('Назад', 'view_back')]);

      await ctx.editMessageText(header, Markup.inlineKeyboard(kb));

      // Отправляем фото и голосовую пробу отдельными сообщениями
      if (p.photoUrl) {
        try {
          await ctx.replyWithPhoto(p.photoUrl.startsWith('tg:') ? p.photoUrl.slice(3) : p.photoUrl);
        } catch {
          await ctx.reply('Не удалось отправить фото.');
        }
      }
      if (p.voiceSampleUrl?.startsWith('tg:')) {
        try {
          await ctx.replyWithVoice(p.voiceSampleUrl.slice(3));
        } catch {
          await ctx.reply('Не удалось отправить голосовую пробу.');
        }
      }
      return;
    }

    if (data === 'view_back') {
      await ctx.answerCbQuery?.();
      const page = ((ctx.session as any).searchResults?.page as number) || 1;
      await showResults(ctx, page, 'edit');
      return;
    }

    if (data.startsWith('search_page:')) {
      const page = Number(data.split(':')[1]);
      await ctx.answerCbQuery?.();
      await showResults(ctx, page, 'edit');
      return;
    }

    if (data.startsWith('req_pf:')) {
      const performerUserId = Number(data.split(':')[1]);
      await ctx.answerCbQuery?.();
      await ctx.scene.enter('requestWizard', { performerUserId });
      return;
    }

    // Голосовая проба и фото отправляются автоматически

    return next();
  });
};
