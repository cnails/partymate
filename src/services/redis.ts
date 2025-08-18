import Redis from 'ioredis';
import { config } from '../config.js';

const globalForRedis = global as unknown as { __redis?: Redis };

export const redis: Redis =
  globalForRedis.__redis ||
  new Redis(config.redisUrl || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.__redis = redis;
}

// Helper accessors for keys
export const rk = {
  roomHash: (reqId: number) => `room:${reqId}`,                  // hash: clientTgId, performerTgId, active, clientWaitMsgId?, perfWaitMsgId?
  roomJoined: (reqId: number) => `room:${reqId}:joined`,         // set: tgIds
  roomMsgQueue: (reqId: number, tgId: string) => `room:${reqId}:mq:${tgId}`, // list: queued messages for participant
  payZset: () => `pay_deadlines`,                                // zset: member=reqId, score=deadlineTs
  confirmZset: () => `confirm_deadlines`,                        // zset: member=reqId, score=deadlineTs
  confirmRemindedSet: () => `confirm_reminded`,                  // set: reqIds already reminded
};

