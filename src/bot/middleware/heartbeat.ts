import { Context, MiddlewareFn } from 'telegraf';
import { prisma } from '../../services/prisma.js';

/**
 * Обновляет lastSeenAt для каждого апдейта, чтобы можно было фильтровать "онлайн"
 * (условно: lastSeenAt > now - 10 минут).
 */
export const heartbeat: MiddlewareFn<Context> = async (ctx, next) => {
  try {
    if (ctx.from) {
      await prisma.user.update({
        where: { tgId: String(ctx.from.id) },
        data: { lastSeenAt: new Date(), username: ctx.from.username ?? undefined },
      });
    }
  } catch {
    // ignore errors: user might not exist yet
  }
  return next();
};
