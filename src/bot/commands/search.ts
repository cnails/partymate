import { Telegraf, Scenes, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { gamesList } from '../keyboards.js';

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

    const profiles = await prisma.performerProfile.findMany({
      where: { status: 'ACTIVE', games: { has: game } },
      take: 10,
      orderBy: [{ boostUntil: 'desc' }, { createdAt: 'desc' }],
      include: { user: true },
    });

    if (!profiles.length) {
      await ctx.reply('Пока нет анкет по этой игре. Попробуйте позже или другую игру.');
      return;
    }

    const rows = profiles.map((p) => [
      Markup.button.callback(
        `${p.user.username ? '@' + p.user.username : 'ID ' + p.userId} — ${p.pricePerHour}₽/ч`,
        `view_pf:${p.id}`,
      ),
    ]);

    await ctx.reply(`Найдено ${profiles.length} анкет по игре ${game}:`, Markup.inlineKeyboard(rows));
  });

  // обработка колбеков для просмотра и создания заявки
  bot.on('callback_query', async (ctx, next) => {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    if (!data) return next();

    if (data.startsWith('view_pf:')) {
      const id = Number(data.split(':')[1]);
      const p = await prisma.performerProfile.findUnique({ where: { id }, include: { user: true } });
      if (!p || p.status !== 'ACTIVE') {
        await ctx.answerCbQuery?.('Анкета недоступна');
        return;
      }
      await ctx.editMessageText(
        [
          `🎮 Анкета #${p.id}`,
          `Игры: ${p.games.join(', ')}`,
          `Цена: ${p.pricePerHour}₽/ч`,
          p.about ? `О себе: ${p.about}` : undefined,
          p.rating ? `Рейтинг: ${p.rating.toFixed(1)}` : undefined,
        ].filter(Boolean).join('\n'),
        Markup.inlineKeyboard([[Markup.button.callback('Оставить заявку', `req_pf:${p.userId}`)]]),
      );
      return;
    }

    if (data.startsWith('req_pf:')) {
      const performerUserId = Number(data.split(':')[1]);
      await ctx.answerCbQuery?.();
      await ctx.scene.enter('requestWizard', { performerUserId });
      return;
    }

    return next();
  });
};
