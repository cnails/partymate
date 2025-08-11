import { Telegraf, Scenes, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { gamesList } from '../keyboards.js';

const planWeight: Record<string, number> = { BASIC: 0, STANDARD: 1, PRO: 2 };

export const registerSearch = (bot: Telegraf, stage: Scenes.Stage) => {
  bot.command('search', async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '/search';
    const arg = text.split(' ').slice(1).join(' ').trim();

    if (!arg) {
      await ctx.reply(`Укажите игру после команды, например: 
/search CS2

Доступно: ${gamesList.join(', ')}`);
      return;
    }

    const game = gamesList.find((g) => g.toLowerCase() === arg.toLowerCase());
    if (!game) {
      await ctx.reply(`Игра не распознана. Доступно: ${gamesList.join(', ')}`);
      return;
    }

    const raw = await prisma.performerProfile.findMany({
      where: { status: 'ACTIVE', games: { has: game } },
      take: 30,
      orderBy: [{ boostUntil: 'desc' }, { rating: 'desc' }, { createdAt: 'desc' }],
      include: { user: true },
    });

    // Домешаем вес плана вручную и сократим до 10
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
      .slice(0, 10)
      .map((x) => x.p);

    if (!profiles.length) {
      await ctx.reply('Пока нет анкет по этой игре. Попробуйте позже или другую игру.');
      return;
    }

    const rows = profiles.map((p) => {
      const labels: string[] = [];
      if (p.isBoosted && p.boostUntil && new Date(p.boostUntil).getTime() > Date.now()) labels.push('🚀');
      if (p.plan && p.plan !== 'BASIC') labels.push(p.plan === 'PRO' ? '🏆' : '⭐️');
      const title = `${labels.join(' ')} ${p.user.username ? '@' + p.user.username : 'ID ' + p.userId} — ${p.pricePerHour}₽/ч`.trim();
      return [Markup.button.callback(title, `view_pf:${p.id}`)];
    });

    await ctx.reply(`Найдено ${profiles.length} анкет по игре ${game}:`, Markup.inlineKeyboard(rows));
  });

  bot.on('callback_query', async (ctx, next) => {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    if (!data) return next();

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
      if (p.voiceSampleUrl?.startsWith('tg:')) kb.push([Markup.button.callback('🎤 Голос', `play_voice:${p.userId}`)]);
      if ((p.photos?.length || 0) > 0) kb.push([Markup.button.callback('📷 Галерея', `view_gallery:${p.userId}`)]);

      await ctx.editMessageText(header, Markup.inlineKeyboard(kb));
      return;
    }

    if (data.startsWith('req_pf:')) {
      const performerUserId = Number(data.split(':')[1]);
      await ctx.answerCbQuery?.();
      await ctx.scene.enter('requestWizard', { performerUserId });
      return;
    }

    // Голосовая проба
    if (data.startsWith('play_voice:')) {
      const userId = Number(data.split(':')[1]);
      const u = await prisma.user.findUnique({ where: { id: userId }, include: { performerProfile: true } });
      const fileId = u?.performerProfile?.voiceSampleUrl?.startsWith('tg:') ? u.performerProfile.voiceSampleUrl.slice(3) : null;
      await ctx.answerCbQuery?.();
      if (!fileId) { await ctx.reply('Голосовая проба недоступна.'); return; }
      try { await ctx.replyWithVoice(fileId); } catch { await ctx.reply('Не удалось отправить голосовую пробу.'); }
      return;
    }

    // Галерея
    if (data.startsWith('view_gallery:')) {
      const userId = Number(data.split(':')[1]);
      const u = await prisma.user.findUnique({ where: { id: userId }, include: { performerProfile: true } });
      const photos = u?.performerProfile?.photos || [];
      await ctx.answerCbQuery?.();
      if (!photos.length) { await ctx.reply('Галерея пуста.'); return; }
      const media = photos.slice(0, 10).map((s, i) => ({
        type: 'photo',
        media: s.startsWith('tg:') ? s.slice(3) : s,
        caption: i === 0 ? `Галерея (${photos.length} фото)` : undefined,
      }));
      try {
        // @ts-ignore
        await ctx.replyWithMediaGroup(media);
      } catch {
        for (const [i, s] of photos.entries()) {
          try {
            if (i === 0) await ctx.replyWithPhoto(s.startsWith('tg:') ? s.slice(3) : s, { caption: `Галерея (${photos.length} фото)` });
            else await ctx.replyWithPhoto(s.startsWith('tg:') ? s.slice(3) : s);
          } catch {}
        }
      }
      return;
    }

    return next();
  });
};
