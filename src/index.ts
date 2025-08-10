import { config } from './config.js';
import { buildBot } from './bot/bot.js';
import { logger } from './logger.js';

const bot = buildBot();

async function main() {
  if (config.webhookDomain) {
    const url = new URL(config.webhookPath, config.webhookDomain).toString();
    await bot.telegram.setWebhook(url);
    logger.info({ url }, 'Webhook set');
    await bot.launch({ webhook: { domain: config.webhookDomain, hookPath: config.webhookPath } });
  } else {
    await bot.launch();
    logger.info('Bot launched with long polling');
  }

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch((e) => {
  logger.error(e, 'Failed to start bot');
  process.exit(1);
});
