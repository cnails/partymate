import { Telegraf, Scenes } from 'telegraf';
import { logger } from '../../logger.js';

export const registerBecomePerformer = (bot: Telegraf, stage: Scenes.Stage) => {
  bot.command(['become_performer', 'performer'], async (ctx) => {
    logger.info(
      { botId: ctx.botInfo?.id, userId: ctx.from?.id, command: 'become_performer' },
      'command received',
    );
    await ctx.scene.enter('performerOnboarding');
  });
};