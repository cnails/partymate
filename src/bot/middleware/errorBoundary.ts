import { Context, MiddlewareFn } from 'telegraf';
import { logger } from '../../logger.js';

export const errorBoundary = (): MiddlewareFn<Context> => async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    logger.error({ err }, 'Bot error');
    try {
      await ctx.reply('❌ Произошла ошибка. Попробуйте ещё раз позже.');
    } catch {}
  }
};
