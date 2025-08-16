import { Telegraf, Scenes, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { roleKeyboard, gamesList } from '../keyboards.js';

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
        Markup.inlineKeyboard([
          [Markup.button.callback('/listing', 'menu_listing')],
          [Markup.button.callback('/requests', 'menu_requests')],
          [Markup.button.callback('/help', 'menu_help')],
          [Markup.button.callback('/payinfo', 'menu_payinfo')],
        ]),
      );
    } else {
      await ctx.reply('Вы клиент.');
      await ctx.reply(
        'Меню:',
        Markup.inlineKeyboard([
          [Markup.button.callback('/search', 'menu_search')],
          [Markup.button.callback('/requests', 'menu_requests')],
          [Markup.button.callback('/help', 'menu_help')],
        ]),
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

  bot.action('menu_search', async (ctx) => {
    await ctx.answerCbQuery();
    const rows = gamesList.map((g) => [Markup.button.callback(g, `search_game:${g}`)]);
    await ctx.reply(
      `Укажите игру после команды, например:\n/search CS2\nили выберите из списка ниже.\n\nДоступно: ${gamesList.join(', ')}`,
      Markup.inlineKeyboard(rows),
    );
  });
  bot.action('menu_listing', async (ctx) => {
    await ctx.answerCbQuery();
    // @ts-ignore
    await ctx.scene.enter('performerListingWizard');
  });
  bot.action('menu_requests', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('/requests');
  });
  bot.action('menu_help', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('/help');
  });
  bot.action('menu_payinfo', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('/payinfo');
  });
};
