import { Scenes } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { gamesList } from '../keyboards.js';

interface ClientWizardState extends Scenes.WizardSessionData {
  games?: string[];
}

export const clientOnboarding = new Scenes.WizardScene<Scenes.WizardContext & { session: { wizard: ClientWizardState } }>(
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
    await ctx.reply(
      `Выберите интересующие игры (через запятую). Доступно: ${gamesList.join(', ')}`,
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.from) return;
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const games = text
      .split(',')
      .map((s) => s.trim())
      .filter((s) => gamesList.includes(s as any));

    await prisma.user.update({
      where: { tgId: String(ctx.from.id) },
      data: { role: 'CLIENT', ageConfirmed: true, searchPrefs: { games } },
    });

    await ctx.reply('Готово! Вы клиент. Используйте /search для подбора или /requests для заявок.');
    return ctx.scene.leave();
  },
);
