import { Scenes, Markup, Composer } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { formatListingStatus, yesNoEmoji } from '../utils/format.js';
import { runProfileAutoChecks } from '../autoChecks.js';
import { config } from '../../config.js';

const MAX_IMAGE_MB = 4;
const MAX_VOICE_MB = 2;
const MAX_VOICE_SEC = 30;

async function showMenu(ctx: Scenes.WizardContext) {
  if (!ctx.from) return;
  const u = await prisma.user.findUnique({
    where: { tgId: String(ctx.from.id) },
    include: { performerProfile: true },
  });
  if (!u || u.role !== 'PERFORMER') {
    await ctx.reply('Эта функция доступна только исполнительницам. Пройдите онбординг.');
    return ctx.scene.leave();
  }
  const p = u.performerProfile;
  if (!p) {
    await ctx.reply('Профиль не найден. Запустите онбординг заново: /start');
    return ctx.scene.leave();
  }
  await ctx.reply(
    [
      p.status === 'MODERATION' ? 'Анкета на модерации' : undefined,
      `Статус: ${formatListingStatus(p.status)}`,
      `Цена: ${p.pricePerHour}₽/час`,
      `О себе: ${p.about ?? '—'}`,
      `Фото: ${yesNoEmoji(!!p.photoUrl)}`,
      `Голос: ${yesNoEmoji(!!p.voiceSampleUrl)}`,
      `Реквизиты по умолчанию: ${yesNoEmoji(!!p.defaultPayInstructions)}`,
      '',
      'Выберите поле для редактирования:',
    ].join('\n'),
    Markup.inlineKeyboard([
      [Markup.button.callback('Цена', 'edit_price')],
      [Markup.button.callback('Описание', 'edit_about')],
      [Markup.button.callback('Фото', 'edit_photo')],
      [Markup.button.callback('Голос', 'edit_voice')],
      [Markup.button.callback('Готово', 'done')],
    ]),
  );
}

export const performerListingWizard = new Scenes.WizardScene<Scenes.WizardContext>(
  'performerListingWizard',
  async (ctx) => {
    await showMenu(ctx);
    return ctx.wizard.next();
  },
  new Composer<Scenes.WizardContext>()
    .action('edit_price', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply('Напишите новую цену (числом) или "skip".');
      ctx.wizard.selectStep(2);
    })
    .action('edit_about', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply('Отправьте короткое описание или "skip".');
      ctx.wizard.selectStep(3);
    })
    .action('edit_photo', async (ctx) => {
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
          'Добавление фото доступно при активной подписке STANDARD или PRO. Оформите её через /billing.',
        );
        return;
      }
      await ctx.reply('Пришлите новое фото (или документ с изображением) до 4 МБ.');
      ctx.wizard.selectStep(4);
    })
    .action('edit_voice', async (ctx) => {
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
          'Добавление голосовой пробы доступно только при активной подписке PRO. Оформите её через /billing.',
        );
        return;
      }
      await ctx.reply('Пришлите голосовую пробу до 30 сек.');
      ctx.wizard.selectStep(5);
    })
    .action('done', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply('Готово. Статус анкеты можно посмотреть командой /listing.');
      return ctx.scene.leave();
    }),
  async (ctx) => {
    if (!ctx.from) return;
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : '';
    if (text.toLowerCase() !== 'skip') {
      const price = Number(text.replace(/[^0-9]/g, ''));
      if (price > 0) {
        const u = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) } });
        if (u) {
          await prisma.performerProfile.update({
            where: { userId: u.id },
            data: { pricePerHour: price },
          });
        }
        await ctx.reply(`Цена обновлена: ${price}₽/час.`);
      } else {
        await ctx.reply('Цена не распознана. Пропускаю.');
      }
    }
    await showMenu(ctx);
    ctx.wizard.selectStep(1);
  },
  async (ctx) => {
    if (!ctx.from) return;
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : '';
    if (text.toLowerCase() !== 'skip') {
      const u = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) } });
      if (u) {
        await prisma.performerProfile.update({
          where: { userId: u.id },
          data: { about: text },
        });
      }
      await ctx.reply('Описание обновлено.');
    }
    await showMenu(ctx);
    ctx.wizard.selectStep(1);
  },
  async (ctx) => {
    if (!ctx.from) return;
    if (ctx.message && 'text' in ctx.message) {
      await ctx.reply('Пожалуйста, пришлите фото (или документ с изображением) до 4 МБ.');
      return;
    }

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

    const u = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) }, include: { performerProfile: true } });
    if (u?.performerProfile) {
      const had = !!u.performerProfile.photoUrl;
      await prisma.performerProfile.update({ where: { userId: u.id }, data: { photoUrl: `tg:${fileId}` } });
      await ctx.reply(had ? 'Фото обновлено.' : 'Фото добавлено.');
      await runProfileAutoChecks(u.performerProfile.id);
      const upd = await prisma.performerProfile.findUnique({
        where: { id: u.performerProfile.id },
        select: { status: true },
      });
      if (upd?.status === 'MODERATION') {
        for (const admin of config.adminIds) {
          try {
            await ctx.telegram.sendMessage(
              Number(admin),
              `#${u.performerProfile.id} · ${u.username ? '@' + u.username : u.id}`,
              Markup.inlineKeyboard([[Markup.button.callback('Открыть', `adm_prof_open:${u.performerProfile.id}`)]]),
            );
          } catch {}
        }
      }
    }

    await showMenu(ctx);
    ctx.wizard.selectStep(1);
  },
  async (ctx) => {
    if (!ctx.from) return;
    if (ctx.message && 'text' in ctx.message) {
      await ctx.reply('Пожалуйста, пришлите голосовую пробу до 30 сек.');
      return;
    }

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

    const u = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) }, include: { performerProfile: true } });
    if (u?.performerProfile) {
      await prisma.performerProfile.update({ where: { userId: u.id }, data: { voiceSampleUrl: `tg:${fileId}` } });
      await ctx.reply('Голосовая проба обновлена.');
      await runProfileAutoChecks(u.performerProfile.id);
      const upd = await prisma.performerProfile.findUnique({
        where: { id: u.performerProfile.id },
        select: { status: true },
      });
      if (upd?.status === 'MODERATION') {
        for (const admin of config.adminIds) {
          try {
            await ctx.telegram.sendMessage(
              Number(admin),
              `#${u.performerProfile.id} · ${u.username ? '@' + u.username : u.id}`,
              Markup.inlineKeyboard([[Markup.button.callback('Открыть', `adm_prof_open:${u.performerProfile.id}`)]]),
            );
          } catch {}
        }
      }
    }

    await showMenu(ctx);
    ctx.wizard.selectStep(1);
  },
);

