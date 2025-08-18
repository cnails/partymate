import { Scenes } from 'telegraf';
import { prisma } from '../../services/prisma.js';

export const clientOnboarding = new Scenes.WizardScene<Scenes.WizardContext & { session: any }>(
  'clientOnboarding',
  async (ctx) => {
    await ctx.reply(
      'Подтвердите, что вам 16+ и вы принимаете правила сервиса (никакого NSFW/интима, только игры и общение). Напишите: "Да".',
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim().toLowerCase() : '';
    if (text !== 'да') {
      await ctx.reply('Нужно подтвердить 16+ одним словом: Да');
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
