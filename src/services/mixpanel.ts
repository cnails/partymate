import Mixpanel from 'mixpanel';
import type { Context } from 'telegraf';
import { config } from '../config.js';

const globalForMixpanel = global as unknown as { mixpanel?: any };

export const mixpanel =
  globalForMixpanel.mixpanel ||
  (config.mixpanelApiKey ? Mixpanel.init(config.mixpanelApiKey) : null);

if (process.env.NODE_ENV !== 'production') {
  globalForMixpanel.mixpanel = mixpanel;
}

export const trackCommand = (command: string, ctx: Context) => {
  mixpanel?.track('command_invoked', {
    command,
    botId: ctx.botInfo?.id,
    userId: ctx.from?.id,
  });
};

export const trackScene = (scene: string, ctx: Context) => {
  mixpanel?.track('scene_entered', {
    scene,
    botId: ctx.botInfo?.id,
    userId: ctx.from?.id,
  });
};
