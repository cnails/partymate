import { Telegraf, Scenes } from 'telegraf';

export const registerBecomePerformer = (bot: Telegraf, stage: Scenes.Stage) => {
  bot.command(['become_performer', 'performer'], async (ctx) => {
    await ctx.scene.enter('performerOnboarding');
  });
};