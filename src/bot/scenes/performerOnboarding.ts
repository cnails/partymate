import { Scenes, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { gamesList } from '../keyboards.js';
import { config } from '../../config.js';

interface PerfWizardState extends Scenes.WizardSessionData {
  games: string[];
  price?: number;
  about?: string;
  stage?: 'select_games' | 'price' | 'about';
}

const gamesKeyboard = (selected: string[]) => {
  const rows = gamesList.map((g) => {
    const marked = selected.includes(g) ? '✅ ' + g : '◻️ ' + g;
    return [Markup.button.callback(marked, `po_game:${g}`)];
  });
  rows.push([Markup.button.callback('Готово', 'po_done')]);
  rows.push([Markup.button.callback('Отмена', 'wiz_cancel')]);
  return Markup.inlineKeyboard(rows);
};

export const performerOnboarding = new Scenes.WizardScene<Scenes.WizardContext & { session: any }>(
  'performerOnboarding',
  // Step 0: age confirm
  async (ctx) => {
    await ctx.reply('Подтвердите, что вам 18+. Напишите: "Да".');
    return ctx.wizard.next();
  },
  // Step 1: games multi-select
  async (ctx) => {
    // Handle initial confirmation
    if ((ctx.wizard.state as PerfWizardState).stage !== 'select_games') {
      const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim().toLowerCase() : '';
      if (text !== 'да') {
        await ctx.reply('Для продолжения напишите: Да');
        return;
      }
      (ctx.wizard.state as PerfWizardState).games = [];
      (ctx.wizard.state as PerfWizardState).stage = 'select_games';
      await ctx.reply('Выберите игры (можно несколько):', gamesKeyboard([]));
      return; // stay on this step to process callbacks
    }

    // Handle callbacks for selecting games
    const data = (ctx.update as any)?.callback_query?.data as string | undefined;
    if (!data) return;
    if (data === 'po_done') {
      const selected = (ctx.wizard.state as PerfWizardState).games || [];
      if (!selected.length) {
        await ctx.answerCbQuery?.('Выберите хотя бы одну игру');
        return;
      }
      await ctx.answerCbQuery?.('Сохранено');
      await ctx.reply('Укажите вашу ставку (₽ за час), числом.', Markup.inlineKeyboard([[Markup.button.callback('Отмена', 'wiz_cancel')]]));
      return ctx.wizard.next();
    }
    if (data.startsWith('po_game:')) {
      const g = data.split(':')[1];
      const st = (ctx.wizard.state as PerfWizardState);
      st.games = st.games || [];
      if (st.games.includes(g)) st.games = st.games.filter((x) => x !== g);
      else st.games.push(g);
      await ctx.answerCbQuery?.(st.games.includes(g) ? `Добавлено: ${g}` : `Убрано: ${g}`);
      // refresh keyboard
      // @ts-expect-error types
      await ctx.editMessageReplyMarkup(gamesKeyboard(st.games).reply_markup);
      return;
    }
  },
  // Step 2: price
  async (ctx) => {
    const data = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const price = Number((data || '').replace(/[^0-9]/g, ''));
    if (!price || price <= 0) {
      await ctx.reply('Введите корректную цену, например: 500');
      return;
    }
    (ctx.wizard.state as PerfWizardState).price = price;
    await ctx.reply('Коротко о себе (1–2 предложения).', Markup.inlineKeyboard([[Markup.button.callback('Отмена', 'wiz_cancel')]]));
    return ctx.wizard.next();
  },
  // Step 3: about + save
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
