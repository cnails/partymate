import { Telegraf, Scenes, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { roleKeyboard } from '../keyboards.js';

export const registerStart = (bot: Telegraf, stage: Scenes.Stage) => {
  bot.start(async (ctx) => {
    if (!ctx.from) return;
    const tgId = String(ctx.from.id);
    const existed = await prisma.user.findUnique({ where: { tgId } });
    if (!existed) {
      await prisma.user.create({ data: { tgId, role: 'CLIENT', username: ctx.from.username ?? undefined } });
    }

    const u = await prisma.user.findUnique({ where: { tgId } });
    if (!u || !u.role) {
      await ctx.reply(
        [
          'Это бот-площадка для поиска напарницы по игре и общения. Без NSFW. Оплата P2P напрямую исполнительницам.',
          'Кто вы?',
        ].join('\n'),
        roleKeyboard(),
      );
      return;
    }

    if (u.role === 'PERFORMER') {
      await ctx.reply('Вы исполнительница.');
      await ctx.reply(
        'Меню:',
        Markup.keyboard([
          ['/listing'],
          ['/requests'],
          ['/payinfo'],
          ['/help'],
          ['/cancel'],
        ])
          .resize()
          .oneTime(),
      );
    } else {
      await ctx.reply('Вы клиент.');
      await ctx.reply(
        'Меню:',
        Markup.keyboard([
          ['/search'],
          ['/requests'],
          ['/help'],
          ['/cancel'],
        ])
          .resize()
          .oneTime(),
      );
    }
  });

  bot.action('role_client', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('clientOnboarding');
  });

  bot.action('role_performer', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('performerOnboarding');
  });

};
