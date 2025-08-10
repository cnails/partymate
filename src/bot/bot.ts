import { Telegraf, session, Scenes } from 'telegraf';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { errorBoundary } from './middleware/errorBoundary.js';
import { registerStart } from './commands/start.js';
import { registerHelp } from './commands/help.js';
import { performerOnboarding } from './scenes/performerOnboarding.js';
import { clientOnboarding } from './scenes/clientOnboarding.js';
import { performerListingWizard } from './scenes/performerListingWizard.js';
import { registerSearch } from './commands/search.js';
import { requestWizard } from './scenes/requestWizard.js';
import { registerRequestFlows } from './requests.js';
import { registerBecomePerformer } from './commands/becomePerformer.js';

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
  bot.use(stage.middleware());

  registerStart(bot, stage);
  registerHelp(bot);
  registerSearch(bot, stage);
  registerRequestFlows(bot);
  registerBecomePerformer(bot, stage);

  // команды для сцен
  bot.command('listing', async (ctx) => ctx.scene.enter('performerListingWizard'));

  // базовые заглушки
  bot.command('profile', async (ctx) => ctx.reply('Профиль — в разработке.'));

  bot.catch((err, ctx) => {
    logger.error({ err }, 'Unhandled bot error');
    return ctx.reply('Что-то пошло не так.');
  });

  return bot;
};
