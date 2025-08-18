import { Telegraf, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';

export const registerProfileCommand = (bot: Telegraf) => {
  bot.command('profile', async (ctx) => {
    if (!ctx.from) return;
    const me = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) }, include: { performerProfile: true } });
    if (!me) {
      await ctx.reply('Похоже, вы ещё не начали. Нажмите /start.');
      return;
    }

    if (me.role === 'PERFORMER') {
      const p = me.performerProfile;
      if (!p) {
        await ctx.reply('Профиль исполнительницы не найден. Запустите онбординг: /start');
        return;
      }
      if (p.status === 'MODERATION') {
        await ctx.reply('Анкета на модерации');
      }
      const openCount = await prisma.request.count({
        where: { performerId: me.id, status: { in: ['NEW', 'NEGOTIATION', 'ACCEPTED', 'PAID'] } as any },
      });
      const doneCount = await prisma.request.count({
        where: { performerId: me.id, status: { in: ['DONE', 'COMPLETED'] } as any },
      });
      await ctx.reply(
        [
          '👩‍💻 Профиль исполнительницы',
          `Статус: ${p.status}`,
          `Услуги: ${p.games.join(', ')}`,
          `Цена: ${p.pricePerHour}₽/ч`,
          p.about ? `О себе: ${p.about}` : undefined,
          `Рейтинг: ${p.rating?.toFixed(1) ?? '—'}`,
          `Заявок: открытых ${openCount} · завершено ${doneCount}`,
        ].filter(Boolean).join('\n'),
        Markup.inlineKeyboard([
          [Markup.button.callback('Отзывы', `view_reviews:${me.id}`)],
          [Markup.button.callback('Мои заявки', `req_list:p:open:0`)],
          [Markup.button.callback('Изменить анкету', 'go_listing')],
        ]),
      );
    } else {
      // CLIENT
      const last = await prisma.request.findMany({
        where: { clientId: me.id },
        orderBy: { createdAt: 'desc' },
        take: 3,
        include: { performer: true },
      });
      const prefs: any = me.searchPrefs ?? {};
      const prefsLine =
        prefs.games?.length ? `Предпочтения: ${prefs.games.join(', ')}` : undefined;
      await ctx.reply(
        [
          '🧑‍💻 Профиль клиента',
          prefsLine,
          last.length ? 'Последние заявки:' : 'Пока нет заявок.',
          ...last.map((r) => `• #${r.id} · ${r.game} · ${r.durationMin} мин · статус: ${r.status}`),
        ].filter(Boolean).join('\n'),
        Markup.inlineKeyboard([
          [Markup.button.callback('Мои заявки', `req_list:c:open:0`)],
        ]),
      );
    }
  });

  // Навигация из /profile
  bot.action('go_listing', async (ctx) => {
    await ctx.answerCbQuery();
    // @ts-ignore
    await ctx.scene.enter('performerListingWizard');
  });
};
