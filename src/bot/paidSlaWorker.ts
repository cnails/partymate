import { Telegraf } from 'telegraf';
import { redis, rk } from '../services/redis.js';
import { prisma } from '../services/prisma.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

// Delay after marking as PAID to send reminder (seconds)
export const PAID_REMINDER_DELAY = 24 * 60 * 60; // 24h
// Delay after reminder to auto-cancel/escalate (seconds)
export const PAID_FINAL_DELAY = 24 * 60 * 60; // 24h after reminder

let started = false;

async function sweep(bot: Telegraf) {
  const now = Date.now() / 1000; // seconds
  try {
    const due = await redis.zrangebyscore(rk.confirmZset(), 0, now);
    if (!due.length) return;
    for (const member of due) {
      const id = Number(member);
      try {
        const req = await prisma.request.findUnique({
          where: { id },
          include: { client: true, performer: true },
        });
        const reminded = await redis.sismember(rk.confirmRemindedSet(), member);
        if (!req || req.status !== 'PAID') {
          await redis.zrem(rk.confirmZset(), member);
          await redis.srem(rk.confirmRemindedSet(), member);
          continue;
        }
        if (req.clientConfirmed && req.performerConfirmed) {
          await redis.zrem(rk.confirmZset(), member);
          await redis.srem(rk.confirmRemindedSet(), member);
          continue;
        }
        if (!reminded) {
          await bot.telegram.sendMessage(
            Number(req.client.tgId),
            `⏳ Заявка #${id} ожидает подтверждения. Подтвердите выполнение.`,
          );
          await bot.telegram.sendMessage(
            Number(req.performer.tgId),
            `⏳ Заявка #${id} ожидает подтверждения. Подтвердите выполнение.`,
          );
          await redis.sadd(rk.confirmRemindedSet(), member);
          await redis.zadd(rk.confirmZset(), now + PAID_FINAL_DELAY, member);
        } else {
          await prisma.request.update({
            where: { id },
            data: { status: 'CANCELED' },
          });
          await bot.telegram.sendMessage(
            Number(req.client.tgId),
            `⏳ Заявка #${id} отменена из-за отсутствия подтверждения.`,
          );
          await bot.telegram.sendMessage(
            Number(req.performer.tgId),
            `⏳ Заявка #${id} отменена из-за отсутствия подтверждения.`,
          );
          for (const admin of config.adminIds) {
            await bot.telegram.sendMessage(
              Number(admin),
              `Заявка #${id} отменена по таймауту подтверждения`,
            );
          }
          await redis.zrem(rk.confirmZset(), member);
          await redis.srem(rk.confirmRemindedSet(), member);
        }
      } catch (e) {
        logger.error({ e }, 'paid sla sweep item failed');
      }
    }
  } catch (e) {
    logger.error({ e }, 'paid sla sweep failed');
  }
}

export const registerPaidSlaWorker = (bot: Telegraf) => {
  if (started) return;
  started = true;
  setTimeout(() => sweep(bot), 2000);
  setInterval(() => sweep(bot), 60 * 1000);
  logger.info('Paid confirmation SLA worker started (Redis-backed)');
};
