import { Telegraf } from 'telegraf';
import { redis, rk } from '../services/redis.js';
import { prisma } from '../services/prisma.js';
import { logger } from '../logger.js';

let started = false;

async function sweep(bot: Telegraf) {
  const now = Date.now() / 1000; // seconds
  try {
    const due = await redis.zrangebyscore(rk.payZset(), 0, now);
    if (!due.length) return;
    for (const member of due) {
      const id = Number(member);
      try {
        const req = await prisma.request.findUnique({
          where: { id },
          include: { client: true, performer: true, paymentMeta: true },
        });
        if (!req) {
          await redis.zrem(rk.payZset(), member);
          continue;
        }
        // Only auto-cancel if still not paid and in ACCEPTED/NEGOTIATION
        if ((req.status === 'ACCEPTED' || req.status === 'NEGOTIATION') && !req.paymentMeta?.clientMarkPaid) {
          await prisma.request.update({ where: { id }, data: { status: 'CANCELED' } });
          await bot.telegram.sendMessage(Number(req.client.tgId), `⏳ Время на оплату по заявке #${id} истекло. Заявка отменена автоматически.`);
          await bot.telegram.sendMessage(Number(req.performer.tgId), `⏳ Время на оплату по заявке #${id} истекло. Заявка отменена автоматически.`);
          // close room
          const roomKey = rk.roomHash(id);
          const joinedKey = rk.roomJoined(id);
          await redis.hset(roomKey, { active: '0' });
          await redis.del(joinedKey);
        }
        await redis.zrem(rk.payZset(), member);
      } catch (e) {
        logger.error({ e }, 'sla sweep item failed');
      }
    }
  } catch (e) {
    logger.error({ e }, 'sla sweep failed');
  }
}

export const registerSlaWorker = (bot: Telegraf) => {
  if (started) return;
  started = true;
  // run on start
  setTimeout(() => sweep(bot), 2000);
  // then every 60s
  setInterval(() => sweep(bot), 60 * 1000);
  logger.info('SLA worker started (Redis-backed)');
};
