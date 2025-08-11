import { MiddlewareFn } from 'telegraf';
import { prisma } from '../../services/prisma.js';

/**
 * Обновляет lastSeenAt для каждого апдейта, чтобы можно было фильтровать "онлайн"
 * (условно: lastSeenAt > now - 10 минут).
 */
export const heartbeat: MiddlewareFn = async (ctx, next) => {
  try {
    if (ctx.from) {
      await prisma.user.upsert({
        where: { tgId: String(ctx.from.id) },
        update: { lastSeenAt: new Date(), username: ctx.from.username ?? undefined },
        create: {
          tgId: String(ctx.from.id),
          role: 'CLIENT',
          username: ctx.from.username ?? undefined,
          lastSeenAt: new Date(),
        },
      });
    }
  } catch {}
  return next();
};
