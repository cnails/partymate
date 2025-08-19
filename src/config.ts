import 'dotenv/config';

const parseAdminIds = () => {
  const raw = process.env.ADMIN_IDS || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
};

const int = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
};

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

  // Moderation
  autoApprovePerformers: String(process.env.AUTO_APPROVE_PERFORMERS || '').toLowerCase() === 'true',
  adminIds: parseAdminIds(),

  // Billing
  autoApproveBilling: String(process.env.AUTO_APPROVE_BILLING || '').toLowerCase() === 'true',
  billing: {
    BOOST_7D_RUB: int(process.env.BOOST_7D_RUB, 500),
    BOOST_14D_RUB: int(process.env.BOOST_14D_RUB, 900),
    PLAN_STD_30D_RUB: int(process.env.PLAN_STD_30D_RUB, 900),
    PLAN_STD_90D_RUB: int(process.env.PLAN_STD_90D_RUB, 2400),
    PLAN_PRO_30D_RUB: int(process.env.PLAN_PRO_30D_RUB, 1500),
    PLAN_PRO_90D_RUB: int(process.env.PLAN_PRO_90D_RUB, 4000),
    INSTRUCTIONS:
      process.env.BILLING_INSTRUCTIONS ||
      'Перевод на карту: XXXX XXXX; в комментарии укажите ваш @username. После оплаты загрузите скрин сюда.',
  },

  // Trial for performers (days)
  trialDays: int(process.env.TRIAL_DAYS, 60),
};

if (!config.botToken || !config.databaseUrl) {
  // eslint-disable-next-line no-console
  console.error('Missing BOT_TOKEN or DATABASE_URL in env');
  process.exit(1);
}
