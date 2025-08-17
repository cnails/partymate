import { Context, MiddlewareFn } from 'telegraf';
import { prisma } from '../../services/prisma.js';

/**
 * Обновляет lastSeenAt для каждого апдейта, чтобы можно было фильтровать "онлайн"
 * (условно: lastSeenAt > now - 10 минут).
 */
export const heartbeat: MiddlewareFn<Context> = async (ctx, next) => {
  if (ctx.from) {
    // updateMany does not throw if the user is missing
    await prisma.user.updateMany({
      where: { tgId: String(ctx.from.id) },
      data: { lastSeenAt: new Date(), username: ctx.from.username ?? undefined },
    });
  }
  return next();
};
