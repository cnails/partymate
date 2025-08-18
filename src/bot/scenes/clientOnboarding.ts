import { Scenes, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { gamesList } from '../keyboards.js';

interface ClientWizardState extends Scenes.WizardSessionData {
  games: string[];
  stage?: 'select_games';
}

const gamesKeyboard = (selected: string[]) => {
  const rows = gamesList.map((g) => {
    const marked = selected.includes(g) ? '✅ ' + g : '◻️ ' + g;
    return [Markup.button.callback(marked, `co_game:${g}`)];
  });
  rows.push([Markup.button.callback('Готово', 'co_done')]);
  rows.push([Markup.button.callback('Отмена', 'wiz_cancel')]);
  return Markup.inlineKeyboard(rows);
};

export const clientOnboarding = new Scenes.WizardScene<Scenes.WizardContext & { session: any }>(
  'clientOnboarding',
  async (ctx) => {
    await ctx.reply('Подтвердите, что вам 16+ и вы принимаете правила сервиса (никакого NSFW/интима, только игры и общение). Напишите: "Да".');
    return ctx.wizard.next();
  },
  async (ctx) => {
    // Initialize game selection
    if ((ctx.wizard.state as ClientWizardState).stage !== 'select_games') {
      const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim().toLowerCase() : '';
      if (text !== 'да') {
        await ctx.reply('Нужно подтвердить 16+ одним словом: Да');
        return;
      }
      (ctx.wizard.state as ClientWizardState).games = [];
      (ctx.wizard.state as ClientWizardState).stage = 'select_games';
      await ctx.reply('Выберите интересующие услуги (игры или общение)…', gamesKeyboard([]));
      return;
    }

    // Handle selection callbacks
    const data = (ctx.update as any)?.callback_query?.data as string | undefined;
    if (!data) return;
    if (data === 'co_done') {
      const selected = (ctx.wizard.state as ClientWizardState).games || [];
      await prisma.user.upsert({
        where: { tgId: String(ctx.from!.id) },
        update: {
          role: 'CLIENT',
          ageConfirmed: true,
          searchPrefs: { games: selected },
          username: ctx.from!.username ?? undefined,
        },
        create: {
          tgId: String(ctx.from!.id),
          role: 'CLIENT',
          ageConfirmed: true,
          searchPrefs: { games: selected },
          username: ctx.from!.username ?? undefined,
        },
      });
      await ctx.answerCbQuery?.('Сохранено');
      await ctx.reply('Готово! Вы клиент. Используйте /search для подбора или /requests для заявок.');
      return ctx.scene.leave();
    }
    if (data.startsWith('co_game:')) {
      const g = data.split(':')[1];
      const st = (ctx.wizard.state as ClientWizardState);
      st.games = st.games || [];
      if (st.games.includes(g)) st.games = st.games.filter((x) => x !== g);
      else st.games.push(g);
      await ctx.answerCbQuery?.(st.games.includes(g) ? `Добавлено: ${g}` : `Убрано: ${g}`);
      // @ts-ignore
      await ctx.editMessageReplyMarkup(gamesKeyboard(st.games).reply_markup);
      return;
    }
  },
);
