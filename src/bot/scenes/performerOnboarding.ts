import { Scenes, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { gamesList } from '../keyboards.js';
import { config } from '../../config.js';
import { runProfileAutoChecks } from '../autoChecks.js';

interface PerfWizardState extends Scenes.WizardSessionData {
  games: string[];
  price?: number;
  about?: string;
  stage?: 'select_games';
  photoUrl?: string;
  voiceSampleUrl?: string;
}

const MAX_IMAGE_MB = 4;
const MAX_VOICE_MB = 2;
const MAX_VOICE_SEC = 30;

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
  async (ctx) => {
    await ctx.reply('Подтвердите, что вам 18+. Напишите: "Да".');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const st = ctx.wizard.state as PerfWizardState;
    if (st.stage !== 'select_games') {
      const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim().toLowerCase() : '';
      if (text !== 'да') {
        await ctx.reply('Для продолжения напишите: Да');
        return;
      }
      st.games = [];
      st.stage = 'select_games';
      await ctx.reply('Выберите ваши игры (можно несколько):', gamesKeyboard([]));
      return;
    }

    const data = (ctx.update as any)?.callback_query?.data as string | undefined;
    if (!data) return;
    if (data === 'po_done') {
      await ctx.answerCbQuery?.('Сохранено');
      await ctx.reply('Укажите вашу ставку (₽ за час), числом.');
      return ctx.wizard.next();
    }
    if (data.startsWith('po_game:')) {
      const g = data.split(':')[1];
      st.games = st.games || [];
      if (st.games.includes(g)) st.games = st.games.filter((x) => x !== g);
      else st.games.push(g);
      await ctx.answerCbQuery?.(st.games.includes(g) ? `Добавлено: ${g}` : `Убрано: ${g}`);
      await ctx.editMessageReplyMarkup(gamesKeyboard(st.games).reply_markup);
      return;
    }
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
    const about = ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
    (ctx.wizard.state as PerfWizardState).about = about;
    await ctx.reply('Пришлите фото (обязательно, до 4 МБ; можно документ с изображением).');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const st = ctx.wizard.state as PerfWizardState;
    let fileId: string | undefined;
    if ('photo' in ctx.message! && (ctx.message as any).photo?.length) {
      const ph = (ctx.message as any).photo[(ctx.message as any).photo.length - 1];
      fileId = ph.file_id;
    } else if ('document' in ctx.message! && (ctx.message as any).document) {
      const doc = (ctx.message as any).document;
      const name = String(doc.file_name || '').toLowerCase();
      if (name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png') || name.endsWith('.webp')) {
        fileId = doc.file_id;
      } else {
        await ctx.reply('Документ не является изображением (jpg/png/webp). Пришлите фото или изображение.');
        return;
      }
    }

    if (!fileId) {
      await ctx.reply('Не удалось прочитать файл. Попробуйте ещё раз.');
      return;
    }

    try {
      const f = await ctx.telegram.getFile(fileId);
      const size = (f as any).file_size as number | undefined;
      if (size && size > MAX_IMAGE_MB * 1024 * 1024) {
        await ctx.reply(`Файл слишком большой (> ${MAX_IMAGE_MB} МБ).`);
        return;
      }
    } catch {}

    st.photoUrl = `tg:${fileId}`;
    await ctx.reply('Фото сохранено. Теперь пришлите голосовую пробу (обязательно, voice или audio до 30 сек и 2 МБ).');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const st = ctx.wizard.state as PerfWizardState;
    if (!ctx.from) return;
    let fileId: string | undefined;
    let duration = 0;
    if ('voice' in ctx.message!) {
      const v = (ctx.message as any).voice;
      fileId = v.file_id;
      duration = Number(v.duration || 0);
    } else if ('audio' in ctx.message!) {
      const a = (ctx.message as any).audio;
      fileId = a.file_id;
      duration = Number(a.duration || 0);
    }

    if (!fileId) {
      await ctx.reply('Не удалось прочитать аудио. Попробуйте ещё раз.');
      return;
    }

    if (duration > MAX_VOICE_SEC) {
      await ctx.reply(`Слишком длинно. Максимум ${MAX_VOICE_SEC} секунд.`);
      return;
    }

    try {
      const f = await ctx.telegram.getFile(fileId);
      const size = (f as any).file_size as number | undefined;
      if (size && size > MAX_VOICE_MB * 1024 * 1024) {
        await ctx.reply(`Файл слишком большой (> ${MAX_VOICE_MB} МБ).`);
        return;
      }
    } catch {}

    st.voiceSampleUrl = `tg:${fileId}`;

    const { games, price, about, photoUrl, voiceSampleUrl } = st;

    const user = await prisma.user.upsert({
      where: { tgId: String(ctx.from.id) },
      update: { role: 'PERFORMER', ageConfirmed: true, username: ctx.from.username ?? undefined },
      create: { tgId: String(ctx.from.id), role: 'PERFORMER', ageConfirmed: true, username: ctx.from.username ?? undefined },
    });

    const trialUntil = new Date(Date.now() + config.trialDays * 24 * 60 * 60 * 1000);

    const perf = await prisma.performerProfile.upsert({
      where: { userId: user.id },
      update: {
        games: games ?? [],
        pricePerHour: price!,
        about,
        photoUrl: photoUrl ?? '',
        voiceSampleUrl: voiceSampleUrl ?? '',
        status: config.autoApprovePerformers ? 'ACTIVE' : 'MODERATION',
        plan: 'BASIC',
        planUntil: trialUntil,
      },
      create: {
        userId: user.id,
        games: games ?? [],
        pricePerHour: price!,
        about,
        photoUrl: photoUrl ?? '',
        voiceSampleUrl: voiceSampleUrl ?? '',
        status: config.autoApprovePerformers ? 'ACTIVE' : 'MODERATION',
        plan: 'BASIC',
        planUntil: trialUntil,
      },
    });

    await runProfileAutoChecks(perf.id);

    await ctx.reply(
      (config.autoApprovePerformers
        ? 'Ваша анкета опубликована и уже в каталоге!'
        : 'Спасибо! Ваша анкета отправлена на модерацию.') +
        ` У вас активирован бесплатный период размещения на ${config.trialDays} дней. Управление — /listing, тарифы и буст — /billing.`,
    );
    return ctx.scene.leave();
  },
);
