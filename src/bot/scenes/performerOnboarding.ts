import { Scenes, Markup, Composer } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { gamesList } from '../keyboards.js';
import { runProfileAutoChecks } from '../autoChecks.js';
import { yesNoEmoji } from '../utils/format.js';
import { config } from '../../config.js';
import { logger } from '../../logger.js';

interface PerfWizardState extends Scenes.WizardSessionData {
  games: string[];
  price?: number;
  about?: string;
  stage?: 'select_games';
  photoUrl?: string;
  voiceSampleUrl?: string;
  payInstructions?: string;
  editReturn?: boolean;
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

const showSummary = async (ctx: Scenes.WizardContext) => {
  const st = ctx.wizard.state as PerfWizardState;
  await ctx.reply(
    [
      'Проверим анкету перед отправкой:',
      `Услуги: ${st.games?.join(', ') || '—'}`,
      `Цена: ${st.price ? `${st.price}₽/час` : '—'}`,
      `О себе: ${st.about ?? '—'}`,
      `Фото: ${yesNoEmoji(!!st.photoUrl)}${st.photoUrl ? ' (не видно клиентам без активной подписки STANDARD)' : ''}`,
      `Голос: ${yesNoEmoji(!!st.voiceSampleUrl)}${st.voiceSampleUrl ? ' (не слышно клиентам без активной подписки PRO)' : ''}`,
      `Реквизиты: ${st.payInstructions ?? '—'}`,
      '',
      'Все ли верно?',
    ].join('\n'),
    Markup.inlineKeyboard([
      [Markup.button.callback('Отправить на проверку', 'po_submit')],
      [Markup.button.callback('Редактировать', 'po_edit')],
    ]),
  );
};

export const performerOnboarding = new Scenes.WizardScene<Scenes.WizardContext & { session: any }>(
  'performerOnboarding',
  async (ctx) => {
    logger.info(
      { botId: ctx.botInfo?.id, userId: ctx.from?.id, scene: 'performerOnboarding' },
      'scene entered',
    );
    await ctx.reply('Подтвердите, что вам уже есть 18. Напишите «Да», и продолжим ✨');
    return ctx.wizard.next();
  },
  async (ctx) => {
    const st = ctx.wizard.state as PerfWizardState;
    if (st.stage !== 'select_games') {
      const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim().toLowerCase() : '';
      if (text !== 'да') {
        await ctx.reply('Для предоставления услуг необходимо быть совершеннолетним. Возвращайтесь позже :)');
        return;
      }
      st.games = st.games || [];
      st.stage = 'select_games';
      await ctx.reply('Теперь давайте заполним анкету - после её заполнения и прохождения модерации вы получите буст анкеты на 3 дня 🚀\nВся информация в анкете, кроме ваших контактов, будет доступна для просмотра клиентам в каталоге (/search)\nВыберите услуги: игры или общение (можно несколько) 👇', gamesKeyboard(st.games));
      return;
    }

    const data = (ctx.update as any)?.callback_query?.data as string | undefined;
    if (!data) return;
    if (data === 'po_done') {
      await ctx.answerCbQuery?.('Сохранили ✅');
      st.stage = undefined;
      if (st.editReturn) {
        st.editReturn = false;
        await showSummary(ctx);
        ctx.wizard.selectStep(7);
      } else {
        await ctx.reply('Укажите ставку в ₽ за час (только число), например 400');
        return ctx.wizard.next();
      }
      return;
    }
    if (data.startsWith('po_game:')) {
      const g = data.split(':')[1];
      st.games = st.games || [];
      if (st.games.includes(g)) st.games = st.games.filter((x) => x !== g);
      else st.games.push(g);
      await ctx.answerCbQuery?.(st.games.includes(g) ? `Выбрано: ${g}` : `Снято: ${g}`);
      await ctx.editMessageReplyMarkup(gamesKeyboard(st.games).reply_markup);
      return;
    }
  },
  async (ctx) => {
    const st = ctx.wizard.state as PerfWizardState;
    const price = Number(
      ctx.message && 'text' in ctx.message ? (ctx.message.text || '').replace(/[^0-9]/g, '') : '0',
    );
    if (!price || price <= 0) {
      await ctx.reply('Введите корректную цену, например: 500');
      return;
    }
    st.price = price;
    if (st.editReturn) {
      st.editReturn = false;
      await showSummary(ctx);
      ctx.wizard.selectStep(7);
    } else {
      await ctx.reply('Пара предложений о вас: стиль, опыт, формат сессий.');
      return ctx.wizard.next();
    }
  },
  async (ctx) => {
    const st = ctx.wizard.state as PerfWizardState;
    const about = ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
    st.about = about;
    if (st.editReturn) {
      st.editReturn = false;
      await showSummary(ctx);
      ctx.wizard.selectStep(7);
    } else {
      await ctx.reply('Пришлите фото для анкеты. Оно поможет выделиться 🌟\nВажно: Фото должно быть уместным, без откровенного контента и нарушений — все анкеты проходят модерацию');
      return ctx.wizard.next();
    }
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
        await ctx.reply('Не распознали картинку. Отправьте файл jpg/png/webp.');
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
        await ctx.reply(`Размер превышает ${MAX_IMAGE_MB} МБ. Сожмите или пришлите другое фото`);
        return;
      }
    } catch {}

    st.photoUrl = `tg:${fileId}`;
    await ctx.reply('Супер, фото сохранено');
    if (st.editReturn) {
      st.editReturn = false;
      await showSummary(ctx);
      ctx.wizard.selectStep(7);
    } else {
      await ctx.reply('Запишите и отправьте голосовую до 30 сек - можете рассказать о себе, либо о том во что вы любите играть, или быть может вы хотите предложить посмотреть вместе фильм/аниме?');
      return ctx.wizard.next();
    }
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
      await ctx.reply('Не распознали аудио. Отправите еще раз?');
      return;
    }

    if (duration > MAX_VOICE_SEC) {
      await ctx.reply(`Чуть короче, пожалуйста — не более ${MAX_VOICE_SEC} сек`);
      return;
    }

    try {
      const f = await ctx.telegram.getFile(fileId);
      const size = (f as any).file_size as number | undefined;
      if (size && size > MAX_VOICE_MB * 1024 * 1024) {
        await ctx.reply(`Аудио весит больше ${MAX_VOICE_MB} МБ. Сожмите или перезапишите короче`);
        return;
      }
    } catch {}

    st.voiceSampleUrl = `tg:${fileId}`;

    await ctx.reply('Готово, голос сохранили ✔️');
    if (st.editReturn) {
      st.editReturn = false;
      await showSummary(ctx);
      ctx.wizard.selectStep(7);
    } else {
      await ctx.reply('Напишите ваши платёжные реквизиты: банк/сервис/ник - эту информацию увидят пользователи');
      return ctx.wizard.next();
    }
  },
  async (ctx) => {
    const st = ctx.wizard.state as PerfWizardState;
    if (!ctx.from) return;
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : '';
    if (!text) {
      await ctx.reply('Нужно указать реквизиты, иначе не сможем продолжить');
      return;
    }
    st.payInstructions = text;
    await showSummary(ctx);
    return ctx.wizard.next();
  },
  new Composer<Scenes.WizardContext>()
    .action('po_submit', async (ctx) => {
      await ctx.answerCbQuery();
      const st = ctx.wizard.state as PerfWizardState;
      if (!ctx.from) return;
      const { games, price, about, photoUrl, voiceSampleUrl, payInstructions } = st;

      const user = await prisma.user.upsert({
        where: { tgId: String(ctx.from.id) },
        update: { role: 'PERFORMER', ageConfirmed: true, username: ctx.from.username ?? undefined },
        create: { tgId: String(ctx.from.id), role: 'PERFORMER', ageConfirmed: true, username: ctx.from.username ?? undefined },
      });

      const perf = await prisma.performerProfile.upsert({
        where: { userId: user.id },
        update: {
          games: games ?? [],
          pricePerHour: price!,
          about,
          photoUrl: photoUrl ?? '',
          voiceSampleUrl: voiceSampleUrl ?? '',
          defaultPayInstructions: payInstructions ?? '',
          status: 'MODERATION',
        },
        create: {
          userId: user.id,
          games: games ?? [],
          pricePerHour: price!,
          about,
          photoUrl: photoUrl ?? '',
          voiceSampleUrl: voiceSampleUrl ?? '',
          defaultPayInstructions: payInstructions ?? '',
          status: 'MODERATION',
        },
      });

      await runProfileAutoChecks(perf.id);

      for (const admin of config.adminIds) {
        try {
          await ctx.telegram.sendMessage(
            Number(admin),
            `#${perf.id} · ${ctx.from.username ? '@' + ctx.from.username : user.id}`,
            Markup.inlineKeyboard([[Markup.button.callback('Открыть', `adm_prof_open:${perf.id}`)]]),
          );
        } catch {}
      }

      await ctx.reply('Отправили на модерацию — сообщим, как только проверим 🙌');
      return ctx.scene.leave();
    })
    .action('po_edit', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply(
        'Что хотите изменить?',
        Markup.inlineKeyboard([
          [Markup.button.callback('Услуги/игры', 'po_edit_games')],
          [Markup.button.callback('Цена', 'po_edit_price')],
          [Markup.button.callback('О себе', 'po_edit_about')],
          [Markup.button.callback('Фото', 'po_edit_photo')],
          [Markup.button.callback('Голос', 'po_edit_voice')],
          [Markup.button.callback('Реквизиты', 'po_edit_pay')],
        ]),
      );
    })
    .action('po_edit_games', async (ctx) => {
      const st = ctx.wizard.state as PerfWizardState;
      await ctx.answerCbQuery();
      st.stage = 'select_games';
      st.editReturn = true;
      await ctx.reply('Выберите услуги: игры или общение (можно несколько) 👇', gamesKeyboard(st.games || []));
      ctx.wizard.selectStep(1);
    })
    .action('po_edit_price', async (ctx) => {
      await ctx.answerCbQuery();
      (ctx.wizard.state as PerfWizardState).editReturn = true;
      await ctx.reply('Укажите ставку в ₽ за час (только число), например 400');
      ctx.wizard.selectStep(2);
    })
    .action('po_edit_about', async (ctx) => {
      await ctx.answerCbQuery();
      (ctx.wizard.state as PerfWizardState).editReturn = true;
      await ctx.reply('Коротко о себе (1-2 предложения).');
      ctx.wizard.selectStep(3);
    })
    .action('po_edit_photo', async (ctx) => {
      await ctx.answerCbQuery();
      if (!ctx.from) return;
      const u = await prisma.user.findUnique({
        where: { tgId: String(ctx.from.id) },
        include: { performerProfile: true },
      });
      const p = u?.performerProfile;
      const planActive =
        p && p.planUntil && new Date(p.planUntil).getTime() > Date.now();
      if (!planActive || (p?.plan !== 'STANDARD' && p?.plan !== 'PRO')) {
        await ctx.reply(
          'Добавить фото можно при активной подписке STANDARD или PRO. Оформите её через /billing.',
        );
        return;
      }
      (ctx.wizard.state as PerfWizardState).editReturn = true;
      await ctx.reply('Пришлите фото или документ с изображением.');
      ctx.wizard.selectStep(4);
    })
    .action('po_edit_voice', async (ctx) => {
      await ctx.answerCbQuery();
      if (!ctx.from) return;
      const u = await prisma.user.findUnique({
        where: { tgId: String(ctx.from.id) },
        include: { performerProfile: true },
      });
      const p = u?.performerProfile;
      const planActive =
        p && p.planUntil && new Date(p.planUntil).getTime() > Date.now();
      if (!planActive || p?.plan !== 'PRO') {
        await ctx.reply(
          'Добавить голосовую пробу можно только при активной подписке PRO. Оформите её через /billing.',
        );
        return;
      }
      (ctx.wizard.state as PerfWizardState).editReturn = true;
      await ctx.reply('Запишите и отправьте голосовую до 30 сек - можете рассказать о себе, либо о том во что вы любите играть, или быть может вы хотите предложить посмотреть вместе фильм/аниме?');
      ctx.wizard.selectStep(5);
    })
    .action('po_edit_pay', async (ctx) => {
      await ctx.answerCbQuery();
      (ctx.wizard.state as PerfWizardState).editReturn = true;
      await ctx.reply('Укажите реквизиты для оплаты.');
      ctx.wizard.selectStep(6);
    }),
);
