import { Telegraf, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { roleKeyboard } from '../keyboards.js';

export const registerStart = (bot: Telegraf) => {
  bot.start(async (ctx) => {
    if (!ctx.from) return;
    const tgId = String(ctx.from.id);
    const u = await prisma.user.findUnique({ where: { tgId } });
    if (!u?.role) {
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
    } else if (u.role === 'CLIENT') {
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
    } else {
      await ctx.reply(
        [
          'Роль не выбрана. Пожалуйста, выберите роль для продолжения.',
          'Кто вы?',
        ].join('\n'),
        roleKeyboard(),
      );
    }
  });

  bot.action('role_client', async (ctx) => {
    await ctx.answerCbQuery();
    await (ctx as any).scene.enter('clientOnboarding');
  });

  bot.action('role_performer', async (ctx) => {
    await ctx.answerCbQuery();
    await (ctx as any).scene.enter('performerOnboarding');
  });

};
