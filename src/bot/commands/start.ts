import { Telegraf, Scenes } from 'telegraf';
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
      await ctx.reply('Кто вы?', roleKeyboard());
      return;
    }

    if (u.role === 'PERFORMER') {
      await ctx.reply('Вы исполнительница. Используйте /listing для управления анкетой.');
    } else {
      await ctx.reply('Вы клиент. Используйте /search для подбора анкет.');
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