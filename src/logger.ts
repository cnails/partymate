import pino from 'pino';
import { join } from 'path';

const transport = pino.transport({
  target: 'pino/file',
  options: {
    destination: join(process.cwd(), 'logs', 'app.log'),
    mkdir: true,
  },
});

export const logger = pino<{
  botId?: number;
  userId?: number;
  command?: string;
  scene?: string;
}>({ level: process.env.LOG_LEVEL || 'info' }, transport);
