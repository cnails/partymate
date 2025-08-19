import { Telegraf, Scenes, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { gamesList } from '../keyboards.js';

// Приоритеты тарифов: используется при сортировке результатов поиска
const planWeight: Record<string, number> = { BASIC: 0, STANDARD: 1, PRO: 2 };

export const registerSearch = (bot: Telegraf, stage: Scenes.Stage) => {
  const askGame = async (ctx: any) => {
    const rows = gamesList.map((g) => [Markup.button.callback(g, `search_game:${g}`)]);
    rows.push([Markup.button.callback('Все анкеты', 'search_game:__all')]);
    await ctx.reply(
      `Укажите услугу (игру или общение) после команды, например:\n/search CS2\nили выберите из списка ниже.\n\nДоступно: ${gamesList.join(', ')}\nЧтобы посмотреть все анкеты без фильтра, используйте /search all или кнопку ниже`,
      Markup.inlineKeyboard(rows),
    );
  };

  const formatProfile = (ctx: any, p: any) => {
    const labels: string[] = [];
    const now = Date.now();
    if (p.isBoosted && p.boostUntil && new Date(p.boostUntil).getTime() > now) labels.push('🚀');
    if (
      p.plan &&
      p.plan !== 'BASIC' &&
      p.planUntil &&
      new Date(p.planUntil).getTime() > now
    )
      labels.push(p.plan === 'PRO' ? '🏆' : '⭐️');
    const rating = p.rating ? p.rating.toFixed(1) : '0.0';
    const title = `${labels.join(' ')} ${p.user.username ? '@' + p.user.username : 'ID ' + p.userId}`.trim();
    const lines = [title, `Цена: ${p.pricePerHour}₽/ч`, `Рейтинг: ${rating}`];
    if (p.about) lines.push(p.about);
    const btns: any[] = [[Markup.button.callback('Подробнее', `view_pf:${p.id}`)]];
    if (!ctx.from || ctx.from.id !== p.userId) {
      btns[0].push(Markup.button.callback('Оставить заявку', `req_pf:${p.userId}`));
    }
    return { text: lines.join('\n'), keyboard: Markup.inlineKeyboard(btns) };
  };

  const showResults = async (ctx: any, page = 1, mode: 'reply' | 'edit' = 'reply') => {
    const sr = (ctx.session as any).searchResults as { game?: string; profiles: any[]; page: number } | undefined;
    if (!sr) return;
    const { game, profiles } = sr;
    const perPage = 10;
    const totalPages = Math.ceil(profiles.length / perPage);
    const pageProfiles = profiles.slice((page - 1) * perPage, page * perPage);

    for (const p of pageProfiles) {
      const { text, keyboard } = formatProfile(ctx, p);
      await ctx.reply(text, keyboard);
    }

    const nav: any[] = [];
    if (page > 1) nav.push(Markup.button.callback('Предыдущая', `search_page:${page - 1}`));
    if (page < totalPages) nav.push(Markup.button.callback('Следующая', `search_page:${page + 1}`));

    const header = game
      ? `Найдено ${profiles.length} анкет по услуге ${game} (страница ${page} из ${totalPages}):`
      : `Найдено ${profiles.length} анкет (страница ${page} из ${totalPages}):`;
    const kb = nav.length ? Markup.inlineKeyboard([nav]) : Markup.inlineKeyboard([]);
    if (mode === 'edit') await ctx.editMessageText(header, kb);
    else await ctx.reply(header, kb);
    sr.page = page;
  };

  const runSearch = async (ctx: any, game?: string) => {
    const raw = await prisma.performerProfile.findMany({
      where: {
        status: 'ACTIVE',
        hidden: false,
        ...(game ? { games: { has: game } } : {}),
        ...(ctx.from?.id ? { userId: { not: ctx.from.id } } : {}),
      },
      // Сначала выбираем профили с приоритетом по тарифу, затем по бусту
      // Берём больше строк, чтобы после ручной сортировки учесть все планы
      take: 90,
      orderBy: [
        { plan: 'desc' },
        { planUntil: 'desc' },
        { boostUntil: 'desc' },
        { rating: 'desc' },
        { createdAt: 'desc' },
      ],
      include: { user: true },
    });

    // Пересортируем профили: план → буст → рейтинг → дата, затем ограничим 30
    const now = Date.now();
    const profiles = raw
      .map((p) => ({
        p,
        boostKey:
          p.boostUntil && new Date(p.boostUntil).getTime() > now
            ? new Date(p.boostUntil).getTime()
            : 0,
        planKey:
          p.plan && p.planUntil && new Date(p.planUntil).getTime() > now
            ? planWeight[(p.plan as any) || 'BASIC'] || 0
            : 0,
        rating: p.rating || 0,
      }))
      .sort((a, b) => {
        if (b.planKey !== a.planKey) return b.planKey - a.planKey;
        if (b.boostKey !== a.boostKey) return b.boostKey - a.boostKey;
        if (b.rating !== a.rating) return b.rating - a.rating;
        return (b.p.createdAt as any) - (a.p.createdAt as any);
      })
      .slice(0, 30)
      .map((x) => x.p);

    if (!profiles.length) {
      await ctx.reply(
        'Пока нет анкет по заданным параметрам :(',
        Markup.inlineKeyboard([[Markup.button.callback('🔁 Изменить услугу', 'search_change_game')]]),
      );
      return;
    }

    (ctx.session as any).searchResults = { game, profiles, page: 1 };
    await showResults(ctx, 1, 'reply');
  };

  bot.command('search', async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '/search';
    const arg = text.split(' ').slice(1).join(' ').trim();
    const argLower = arg.toLowerCase();
    if (argLower === 'all' || argLower === 'все') {
      await runSearch(ctx);
      return;
    }
    const game = gamesList.find((g) => g.toLowerCase() === argLower);
    if (!arg || !game) {
      await askGame(ctx);
      return;
    }
    await runSearch(ctx, game);
  });

  bot.action(/search_game:(.+)/, async (ctx) => {
    const selected = ctx.match?.[1];
    await ctx.answerCbQuery?.();
    if (selected === '__all') {
      await runSearch(ctx);
      return;
    }
    const game = gamesList.find((g) => g === selected);
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
      if (!p) { await ctx.answerCbQuery?.('Анкета недоступна'); return; }
      if (p.status === 'MODERATION') { await ctx.answerCbQuery?.('Анкета на модерации'); return; }
      if (p.status !== 'ACTIVE') { await ctx.answerCbQuery?.('Анкета недоступна'); return; }

      const labels: string[] = [];
      const now = Date.now();
      if (p.isBoosted && p.boostUntil && new Date(p.boostUntil).getTime() > now) labels.push('🚀 Boost');
      if (
        p.plan &&
        p.plan !== 'BASIC' &&
        p.planUntil &&
        new Date(p.planUntil).getTime() > now
      )
        labels.push(p.plan === 'PRO' ? '🏆 PRO' : '⭐️ STANDARD');

      const header = [
        `${labels.length ? labels.join(' · ') + ' · ' : ''}🎮 Анкета #${p.id}`,
        `Услуги: ${p.games.join(', ')}`,
        `Цена: ${p.pricePerHour}₽/ч`,
        p.about ? `О себе: ${p.about}` : undefined,
        p.rating ? `Рейтинг: ${p.rating.toFixed(1)}` : undefined,
      ].filter(Boolean).join('\n');

      const kb: any[] = [];
      kb.push([Markup.button.callback('Оставить заявку', `req_pf:${p.userId}`)]);
      kb.push([Markup.button.callback('Назад', `view_back:${p.id}`)]);

      await ctx.editMessageText(header, Markup.inlineKeyboard(kb));

      // Определяем активный тариф исполнителя
      const activePlan =
        p.plan && p.planUntil && new Date(p.planUntil).getTime() > now ? p.plan : 'BASIC';
      const activePlanWeight = planWeight[activePlan] ?? 0;

      // Отправляем фото и голосовую пробу отдельными сообщениями
      if (p.photoUrl) {
        if (activePlanWeight >= planWeight['STANDARD']) {
          try {
            await ctx.replyWithPhoto(p.photoUrl.startsWith('tg:') ? p.photoUrl.slice(3) : p.photoUrl);
          } catch {
            await ctx.reply('Не удалось отправить фото.');
          }
        }
      }
      if (p.voiceSampleUrl?.startsWith('tg:')) {
        if (activePlanWeight >= planWeight['PRO']) {
          try {
            await ctx.replyWithVoice(p.voiceSampleUrl.slice(3));
          } catch {
            await ctx.reply('Не удалось отправить голосовую пробу.');
          }
        }
      }
      return;
    }

    if (data.startsWith('view_back:')) {
      await ctx.answerCbQuery?.();
      const id = Number(data.split(':')[1]);
      const sr = (ctx.session as any).searchResults as { profiles: any[] } | undefined;
      const p = sr?.profiles.find((x: any) => x.id === id);
      if (!p) { await ctx.editMessageText('Анкета недоступна'); return; }
      const { text, keyboard } = formatProfile(ctx, p);
      await ctx.editMessageText(text, keyboard);
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

    // Остальные callback-данные обрабатываются в других сценах

    return next();
  });
};
