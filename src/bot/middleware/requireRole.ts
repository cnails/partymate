import { Context, MiddlewareFn } from 'telegraf';
import { prisma } from '../../services/prisma.js';

export type RoleGuard = 'CLIENT' | 'PERFORMER' | 'ADMIN';

export const requireRole = (roles: RoleGuard[]): MiddlewareFn<Context> => {
  return async (ctx, next) => {
    if (!ctx.from) return;
    const u = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) } });
    if (!u || !roles.includes(u.role as RoleGuard)) {
      await ctx.reply('Недостаточно прав для этой команды.');
      return;
    }
    return next();
  };
};
