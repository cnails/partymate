import { Telegraf } from 'telegraf';
import { prisma } from '../../services/prisma.js';

export const registerHelp = (bot: Telegraf) => {
  bot.command('help', async (ctx) => {
    const role = ctx.from
      ? (await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) } }))?.role
      : undefined;

    const common = [
      '⚙️ Общие:',
      '/start — онбординг и быстрые действия',
      '/help — эта справка',
      '/cancel — отменить текущий шаг/мастер',
      '',
    ].join('\n');

    if (role === 'PERFORMER') {
      await ctx.reply(
        [
          common,
          '🎮 Для исполнительниц:',
          '/listing — управление анкетой',
          '/requests — входящие/текущие заявки',
        ].join('\n'),
      );
    } else {
      await ctx.reply(
        [
          common,
          '🧑‍💻 Для клиентов:',
          '/search <игра> — найти исполнительницу',
          '/requests — мои заявки (чат и оплата)',
        ].join('\n'),
      );
    }
  });
};
