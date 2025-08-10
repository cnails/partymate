import 'dotenv/config';

export const config = {
  botToken: process.env.BOT_TOKEN!,
  webhookDomain: process.env.WEBHOOK_DOMAIN,
  webhookPath: process.env.WEBHOOK_PATH || '/tg/webhook',
  databaseUrl: process.env.DATABASE_URL!,
  redisUrl: process.env.REDIS_URL,
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION,
  },
  autoApprovePerformers: String(process.env.AUTO_APPROVE_PERFORMERS || '').toLowerCase() === 'true',
};

if (!config.botToken || !config.databaseUrl) {
  // eslint-disable-next-line no-console
  console.error('Missing BOT_TOKEN or DATABASE_URL in env');
  process.exit(1);
}
