import { Telegraf, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { runProfileAutoChecks } from '../autoChecks.js';

const MAX_PHOTOS = 8;
const MAX_IMAGE_MB = 4;
const MAX_VOICE_MB = 2;
const MAX_VOICE_SEC = 30;

function kb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Добавить фото', 'gal_add_photo')],
    [Markup.button.callback('🗑 Удалить последнее фото', 'gal_del_last')],
    [Markup.button.callback('🧹 Очистить все фото', 'gal_clear')],
    [Markup.button.callback('🎤 Загрузить голосовую пробу', 'gal_add_voice')],
    [Markup.button.callback('📋 Показать текущее', 'gal_show')],
  ]);
}

export const registerGalleryCommand = (bot: Telegraf) => {
  bot.command('gallery', async (ctx) => {
    if (!ctx.from) return;
    const me = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) }, include: { performerProfile: true } });
    if (!me || me.role !== 'PERFORMER' || !me.performerProfile) {
      await ctx.reply('Доступно только исполнительницам после онбординга.');
      return;
    }
    const p = me.performerProfile;
    await ctx.reply(
      [
        '📷 Галерея и голосовая проба',
        `Фото: ${(p.photos?.length || 0)}/${MAX_PHOTOS}`,
        p.voiceSampleUrl ? '🎤 Голосовая проба загружена' : '🎤 Голосовая проба: нет',
        '',
        'Добавьте до 8 фото (до 4 МБ каждое). Голосовую пробу — до 30 секунд и 2 МБ.',
      ].join('\n'),
      kb(),
    );
  });

  bot.on('callback_query', async (ctx, next) => {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    if (!data) return next();
    if (!ctx.from) return next();

    const me = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) }, include: { performerProfile: true } });
    if (!me?.performerProfile) return next();
    const p = me.performerProfile;

    if (data === 'gal_show') {
      await ctx.answerCbQuery?.();
      await ctx.reply(
        [`Фото: ${(p.photos?.length || 0)}/${MAX_PHOTOS}`, p.voiceSampleUrl ? '🎤 Голосовая проба: есть' : '🎤 Голосовая проба: нет'].join('\n'),
        kb(),
      );
      return;
    }

    if (data === 'gal_add_photo') {
      (ctx.session as any).awaitingPhotoFor = p.id;
      await ctx.answerCbQuery?.();
      await ctx.reply('Пришлите фото (или документ с изображением) одним сообщением.');
      return;
    }

    if (data === 'gal_del_last') {
      await ctx.answerCbQuery?.();
      const arr = [...(p.photos || [])];
      if (!arr.length) { await ctx.reply('В галерее нет фото.'); return; }
      arr.pop();
      await prisma.performerProfile.update({ where: { id: p.id }, data: { photos: arr } });
      await ctx.reply(`Удалил последнее. Фото: ${arr.length}/${MAX_PHOTOS}`);
      await runProfileAutoChecks(p.id);
      return;
    }

    if (data === 'gal_clear') {
      await ctx.answerCbQuery?.();
      await prisma.performerProfile.update({ where: { id: p.id }, data: { photos: [] } });
      await ctx.reply('Галерея очищена.');
      await runProfileAutoChecks(p.id);
      return;
    }

    if (data === 'gal_add_voice') {
      (ctx.session as any).awaitingVoiceFor = p.id;
      await ctx.answerCbQuery?.();
      await ctx.reply('Пришлите голосовое (voice) или аудио до 30 сек и до 2 МБ одним сообщением.');
      return;
    }

    return next();
  });

  // Приём фото
  bot.on(['photo', 'document'], async (ctx, next) => {
    const waiting = (ctx.session as any).awaitingPhotoFor as number | undefined;
    if (!waiting) return next();
    const perf = await prisma.performerProfile.findUnique({ where: { id: waiting } });
    if (!perf) return next();

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
        (ctx.session as any).awaitingPhotoFor = undefined;
        return;
      }
    }

    if (!fileId) {
      await ctx.reply('Не удалось прочитать файл. Попробуйте ещё раз.');
      (ctx.session as any).awaitingPhotoFor = undefined;
      return;
    }

    // Проверка размера файла (best-effort)
    try {
      const f = await ctx.telegram.getFile(fileId);
      const size = (f as any).file_size as number | undefined;
      if (size && size > MAX_IMAGE_MB * 1024 * 1024) {
        await ctx.reply(`Файл слишком большой (> ${MAX_IMAGE_MB} МБ).`);
        (ctx.session as any).awaitingPhotoFor = undefined;
        return;
      }
    } catch {}

    const arr = [...(perf.photos || [])];
    if (arr.length >= MAX_PHOTOS) {
      await ctx.reply(`Лимит фотографий: ${MAX_PHOTOS}. Удалите лишнее.`);
      (ctx.session as any).awaitingPhotoFor = undefined;
      return;
    }
    arr.push(`tg:${fileId}`);
    await prisma.performerProfile.update({ where: { id: waiting }, data: { photos: arr } });
    await ctx.reply(`Фото добавлено. Фото: ${arr.length}/${MAX_PHOTOS}`);
    (ctx.session as any).awaitingPhotoFor = undefined;
    await runProfileAutoChecks(waiting);
  });

  // Приём голоса
  bot.on(['voice', 'audio'], async (ctx, next) => {
    const waiting = (ctx.session as any).awaitingVoiceFor as number | undefined;
    if (!waiting) return next();
    const perf = await prisma.performerProfile.findUnique({ where: { id: waiting } });
    if (!perf) return next();

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
      (ctx.session as any).awaitingVoiceFor = undefined;
      return;
    }

    if (duration > MAX_VOICE_SEC) {
      await ctx.reply(`Слишком длинно. Максимум ${MAX_VOICE_SEC} секунд.`);
      (ctx.session as any).awaitingVoiceFor = undefined;
      return;
    }

    try {
      const f = await ctx.telegram.getFile(fileId);
      const size = (f as any).file_size as number | undefined;
      if (size && size > MAX_VOICE_MB * 1024 * 1024) {
        await ctx.reply(`Файл слишком большой (> ${MAX_VOICE_MB} МБ).`);
        (ctx.session as any).awaitingVoiceFor = undefined;
        return;
      }
    } catch {}

    await prisma.performerProfile.update({ where: { id: waiting }, data: { voiceSampleUrl: `tg:${fileId}` } });
    await ctx.reply('Голосовая проба обновлена.');
    (ctx.session as any).awaitingVoiceFor = undefined;
    await runProfileAutoChecks(waiting);
  });
};
