import { Scenes } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { logger } from '../../logger.js';

export const clientOnboarding = new Scenes.WizardScene<Scenes.WizardContext & { session: any }>(
  'clientOnboarding',
  async (ctx) => {
    logger.info(
      { botId: ctx.botInfo?.id, userId: ctx.from?.id, scene: 'clientOnboarding' },
      'scene entered',
    );
    await ctx.reply(
      'Подтвердите, что вам 16+ и вы принимаете правила сервиса (никакого NSFW/интима, только игры и общение). Напишите: "Да".',
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim().toLowerCase() : '';
    if (text !== 'да') {
      await ctx.reply('Сервис доступен только для лиц старше 16 лет. Приходите позже :)');
      return;
    }

    await prisma.user.upsert({
      where: { tgId: String(ctx.from!.id) },
      update: {
        role: 'CLIENT',
        ageConfirmed: true,
        username: ctx.from!.username ?? undefined,
      },
      create: {
        tgId: String(ctx.from!.id),
        role: 'CLIENT',
        ageConfirmed: true,
        username: ctx.from!.username ?? undefined,
      },
    });

    await ctx.reply('Готово! Используйте /search для подбора исполнителей и /requests для заявок.');
    return ctx.scene.leave();
  },
);
