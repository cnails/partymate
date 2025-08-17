import { Telegraf, session, Scenes } from 'telegraf';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { errorBoundary } from './middleware/errorBoundary.js';
import { heartbeat } from './middleware/heartbeat.js';
import { registerStart } from './commands/start.js';
import { registerHelp } from './commands/help.js';
import { performerOnboarding } from './scenes/performerOnboarding.js';
import { clientOnboarding } from './scenes/clientOnboarding.js';
import { performerListingWizard } from './scenes/performerListingWizard.js';
import { registerSearch } from './commands/search.js';
import { requestWizard } from './scenes/requestWizard.js';
import { registerRequestFlows } from './requests.js';
import { registerBecomePerformer } from './commands/becomePerformer.js';
import { registerRequestsCommand } from './commands/requests.js';
import { registerBillingCommand } from './commands/billing.js';
import { registerBillingAdmin } from './billingAdmin.js';
import { registerGalleryCommand } from './commands/gallery.js';
import { registerPayinfoCommand } from './commands/payinfo.js';
import { registerReviewFlows } from './reviews.js';
import { registerModeration } from './moderation.js';
import { registerSlaWorker } from './paymentsSlaWorker.js';
import { prisma } from '../services/prisma.js';

export const buildBot = () => {
  const bot = new Telegraf(config.botToken);

  const stage = new Scenes.Stage([
    performerOnboarding,
    clientOnboarding,
    performerListingWizard,
    requestWizard,
  ]);

  bot.use(errorBoundary());
  bot.use(session());
  bot.use(heartbeat);
  bot.use(stage.middleware());

  registerStart(bot);
  registerHelp(bot);
  registerSearch(bot, stage);
  registerRequestFlows(bot);
  registerBecomePerformer(bot, stage);
  registerRequestsCommand(bot);
  registerBillingCommand(bot);
  registerBillingAdmin(bot);
  registerGalleryCommand(bot);
  registerPayinfoCommand(bot);
  registerReviewFlows(bot);
  registerModeration(bot);
  registerSlaWorker(bot);

  void bot.telegram.setMyCommands([
    { command: 'start', description: 'Начало' },
    { command: 'help', description: 'Помощь' },
    { command: 'search', description: 'Поиск' },
    { command: 'requests', description: 'Заявки' },
    { command: 'listing', description: 'Анкета' },
    { command: 'cancel', description: 'Отмена' },
  ]);

  void (async () => {
    try {
      const performers = await prisma.user.findMany({
        where: { role: 'PERFORMER' },
        select: { tgId: true },
      });
      const performerCommands = [
        { command: 'start', description: 'Начало' },
        { command: 'help', description: 'Помощь' },
        { command: 'requests', description: 'Заявки' },
        { command: 'listing', description: 'Анкета' },
        { command: 'payinfo', description: 'Реквизиты' },
        { command: 'billing', description: 'Размещение' },
        { command: 'cancel', description: 'Отмена' },
      ];
      for (const p of performers) {
        await bot.telegram.setMyCommands(performerCommands, {
          scope: { type: 'chat', chat_id: Number(p.tgId) },
        });
      }

      const adminCommands = [
        { command: 'start', description: 'Начало' },
        { command: 'help', description: 'Помощь' },
        { command: 'search', description: 'Поиск' },
        { command: 'requests', description: 'Заявки' },
        { command: 'listing', description: 'Анкета' },
        { command: 'billing', description: 'Размещение' },
        { command: 'admin_billing', description: 'Заказы' },
        { command: 'cancel', description: 'Отмена' },
      ];
      for (const id of config.adminIds) {
        await bot.telegram.setMyCommands(adminCommands, {
          scope: { type: 'chat', chat_id: Number(id) },
        });
      }
    } catch (err) {
      logger.error({ err }, 'Failed to set command list');
    }
  })();

  bot.command('listing', async (ctx) => ctx.scene.enter('performerListingWizard'));

  bot.command('cancel', async (ctx) => {
    (ctx.session as any).awaitingPayInfoFor = undefined;
    (ctx.session as any).awaitingProofFor = undefined;
    (ctx.session as any).proxyRoomFor = undefined;
    (ctx.session as any).awaitingBillingProofFor = undefined;
    (ctx.session as any).awaitingPhotoFor = undefined;
    (ctx.session as any).awaitingVoiceFor = undefined;
    try { await (ctx as any).scene.leave(); } catch {}
    await ctx.reply('Ок, остановил текущий шаг.');
  });
  bot.action('wiz_cancel', async (ctx) => {
    await ctx.answerCbQuery();
    (ctx.session as any).awaitingPayInfoFor = undefined;
    (ctx.session as any).awaitingProofFor = undefined;
    (ctx.session as any).proxyRoomFor = undefined;
    (ctx.session as any).awaitingBillingProofFor = undefined;
    try { await (ctx as any).scene.leave(); } catch {}
    await ctx.editMessageText('Действие отменено.');
  });

  bot.catch((err, ctx) => {
    logger.error({ err }, 'Unhandled bot error');
    return ctx.reply('Что-то пошло не так.');
  });

  return bot;
};
