import { Scenes } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { gamesList } from '../keyboards.js';
import { config } from '../../config.js';

interface PerfWizardState extends Scenes.WizardSessionData {
  games?: string[];
  price?: number;
  about?: string;
}

export const performerOnboarding = new Scenes.WizardScene<Scenes.WizardContext & { session: any }>(
  'performerOnboarding',
  async (ctx) => {
    await ctx.reply('Подтвердите, что вам 18+. Напишите: "Да".');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim().toLowerCase() : '';
    if (text !== 'да') {
      await ctx.reply('Для продолжения напишите: Да');
      return;
    }
    await ctx.reply(`Укажите игры (через запятую). Доступно: ${gamesList.join(', ')}`);
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const games = text
      .split(',')
      .map((s) => s.trim())
      .filter((s) => gamesList.includes(s as any));
    (ctx.wizard.state as PerfWizardState).games = games;
    await ctx.reply('Укажите вашу ставку (₽ за час), числом.');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const price = Number(
      ctx.message && 'text' in ctx.message ? (ctx.message.text || '').replace(/[^0-9]/g, '') : '0',
    );
    if (!price || price <= 0) {
      await ctx.reply('Введите корректную цену, например: 500');
      return;
    }
    (ctx.wizard.state as PerfWizardState).price = price;
    await ctx.reply('Коротко о себе (1-2 предложения).');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.from) return;
    const about = ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
    const { games, price } = (ctx.wizard.state as PerfWizardState);

    const user = await prisma.user.upsert({
      where: { tgId: String(ctx.from.id) },
      update: { role: 'PERFORMER', ageConfirmed: true, username: ctx.from.username ?? undefined },
      create: {
        tgId: String(ctx.from.id),
        role: 'PERFORMER',
        ageConfirmed: true,
        username: ctx.from.username ?? undefined,
      },
    });

    await prisma.performerProfile.upsert({
      where: { userId: user.id },
      update: {
        games: games ?? [],
        pricePerHour: price!,
        about,
        status: config.autoApprovePerformers ? 'ACTIVE' : 'MODERATION',
      },
      create: {
        userId: user.id,
        games: games ?? [],
        pricePerHour: price!,
        about,
        status: config.autoApprovePerformers ? 'ACTIVE' : 'MODERATION',
        photos: [],
      },
    });

    await ctx.reply(
      config.autoApprovePerformers
        ? 'Ваша анкета опубликована и уже в каталоге! Используйте /listing для управления.'
        : 'Спасибо! Ваша анкета отправлена на модерацию. После одобрения она появится в каталоге. Используйте /listing для просмотра статуса.',
    );
    return ctx.scene.leave();
  },
);