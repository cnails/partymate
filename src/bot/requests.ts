import { Telegraf, Markup } from 'telegraf';
import { prisma } from '../services/prisma.js';

// === Proxy chat (relay) state in-memory (MVP) ===
// Ключ — requestId
const rooms = new Map<
  number,
  { clientTgId: string; performerTgId: string; joined: Set<string>; active: boolean }
>();

const getRoom = (reqId: number) => rooms.get(reqId);

const ensureRoom = (reqId: number, clientTgId: string, performerTgId: string) => {
  let r = rooms.get(reqId);
  if (!r) {
    r = { clientTgId, performerTgId, joined: new Set(), active: true };
    rooms.set(reqId, r);
  } else {
    r.clientTgId = clientTgId;
    r.performerTgId = performerTgId;
    r.active = true;
  }
  return r;
};

export const registerRequestFlows = (bot: Telegraf) => {
  bot.on('callback_query', async (ctx, next) => {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    if (!data) return next();

    // === Принятие/отказ ===
    if (data.startsWith('req_accept:')) {
      const id = Number(data.split(':')[1]);
      const req = await prisma.request.update({
        where: { id },
        data: { status: 'ACCEPTED' },
        include: { client: true, performer: true },
      });
      await ctx.editMessageText(`✅ Заявка #${id} принята.`);

      // Создаём комнату релея без раскрытия контактов
      const room = ensureRoom(
        id,
        String(req.client.tgId),
        String(req.performer.tgId),
      );

      // Сообщение клиенту — предлагает открыть чат через бота + кнопка «Оплатил»
      await ctx.telegram.sendMessage(
        Number(req.client.tgId),
        [
          `Заявка #${id} принята. Для переписки нажмите «Открыть чат через бота».`,
          `Оплатите по реквизитам после согласования и нажмите «Оплатил».`,
        ].join('\n'),
        {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('💬 Открыть чат через бота', `join_room:${id}`)],
            [Markup.button.callback('✅ Оплатил', `client_mark_paid:${id}`)],
          ]),
        },
      );

      // Сообщение исполнительнице — тоже кнопка для входа в чат и запрос на реквизиты
      await ctx.reply(
        `Для переписки с клиентом по заявке #${id} нажмите «Открыть чат через бота» и пришлите реквизиты одним сообщением.`,
        Markup.inlineKeyboard([[Markup.button.callback('💬 Открыть чат через бота', `join_room:${id}`)]]),
      );

      // Сохраняем ожидание реквизитов (старый поток P2P — остаётся)
      (ctx.session as any).awaitingPayInfoFor = id;
      return;
    }

    if (data.startsWith('req_reject:')) {
      const id = Number(data.split(':')[1]);
      const req = await prisma.request.update({ where: { id }, data: { status: 'REJECTED' }, include: { client: true } });
      await ctx.editMessageText(`❎ Заявка #${id} отклонена.`);
      await ctx.telegram.sendMessage(Number(req.client.tgId), `Заявка #${id} отклонена исполнителем.`);
      // Закрываем комнату, если была
      rooms.delete(id);
      return;
    }

    // === Вход/выход из прокси-комнаты ===
    if (data.startsWith('join_room:')) {
      const reqId = Number(data.split(':')[1]);
      const req = await prisma.request.findUnique({ where: { id: reqId }, include: { client: true, performer: true } });
      if (!req) {
        await ctx.answerCbQuery?.('Заявка не найдена');
        return;
      }
      const r = ensureRoom(reqId, String(req.client.tgId), String(req.performer.tgId));
      if (!r.active) {
        await ctx.answerCbQuery?.('Чат закрыт');
        return;
      }
      const me = String(ctx.from!.id);
      if (me !== r.clientTgId && me !== r.performerTgId) {
        await ctx.answerCbQuery?.('Вы не участник этой заявки');
        return;
      }
      r.joined.add(me);
      (ctx.session as any).proxyRoomFor = reqId;
      await ctx.answerCbQuery?.('Чат подключён');
      await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '🚪 Выйти из чата', callback_data: `leave_room:${reqId}` }]] });
      await ctx.reply(`Вы подключены к чату заявки #${reqId}. Все ваши сообщения будут доставлены второй стороне.`);

      // Если обе стороны в комнате — уведомим
      if (r.joined.has(r.clientTgId) && r.joined.has(r.performerTgId)) {
        await ctx.telegram.sendMessage(Number(r.clientTgId), 'Второй участник подключился. Можно переписываться.');
        await ctx.telegram.sendMessage(Number(r.performerTgId), 'Второй участник подключился. Можно переписываться.');
      }
      return;
    }

    if (data.startsWith('leave_room:')) {
      const reqId = Number(data.split(':')[1]);
      const r = getRoom(reqId);
      if (r) {
        r.joined.delete(String(ctx.from!.id));
      }
      (ctx.session as any).proxyRoomFor = undefined;
      await ctx.answerCbQuery?.('Вы вышли из чата');
      await ctx.editMessageReplyMarkup(undefined);
      return;
    }

    // === P2P оплата ===
    if (data.startsWith('client_mark_paid:')) {
      const id = Number(data.split(':')[1]);
      await prisma.paymentMeta.update({ where: { requestId: id }, data: { clientMarkPaid: true } });
      await ctx.editMessageText('Отправьте скрин/фото/документ подтверждения оплаты одним сообщением.');
      (ctx.session as any).awaitingProofFor = id;
      return;
    }

    if (data.startsWith('perf_got_money:')) {
      const id = Number(data.split(':')[1]);
      const req = await prisma.request.update({ where: { id }, data: { status: 'COMPLETED' }, include: { client: true } });
      await prisma.paymentMeta.update({ where: { requestId: id }, data: { performerReceived: true } });
      await ctx.editMessageText(`✅ Оплата подтверждена. Заявка #${id} завершена.`);
      await ctx.telegram.sendMessage(Number(req.client.tgId), 'Исполнительница подтвердила получение. Хорошей игры!');
      // Закрываем комнату
      const r = getRoom(id);
      if (r) {
        r.active = false;
        rooms.delete(id);
        await ctx.telegram.sendMessage(Number(r.clientTgId), 'Чат заявки закрыт.');
        await ctx.telegram.sendMessage(Number(r.performerTgId), 'Чат заявки закрыт.');
      }
      return;
    }

    return next();
  });

  // Исполнительница присылает инструкции — пересылаем клиенту и сохраняем (сохраняем старый P2P-флоу)
  bot.on('text', async (ctx, next) => {
    const awaiting = (ctx.session as any).awaitingPayInfoFor as number | undefined;
    if (!awaiting) return next();
    const req = await prisma.request.findUnique({ where: { id: awaiting }, include: { client: true } });
    if (!req) return next();
    await prisma.paymentMeta.update({ where: { requestId: awaiting }, data: { instructions: ctx.message!.text } });
    await ctx.telegram.sendMessage(Number(req.client.tgId), `Реквизиты для оплаты по заявке #${awaiting} :
${ctx.message!.text}`);
    await ctx.reply('Реквизиты отправлены клиенту.');
    (ctx.session as any).awaitingPayInfoFor = undefined;
  });

  // Клиент присылает пруф
  bot.on(['photo', 'document'], async (ctx, next) => {
    const awaiting = (ctx.session as any).awaitingProofFor as number | undefined;
    if (!awaiting) return next();
    const fileIds: string[] = [];
    if ('photo' in ctx.message! && (ctx.message as any).photo?.length) {
      fileIds.push((ctx.message as any).photo[(ctx.message as any).photo.length - 1].file_id);
    }
    if ('document' in ctx.message! && (ctx.message as any).document) {
      fileIds.push((ctx.message as any).document.file_id);
    }
    await prisma.paymentMeta.update({
      where: { requestId: awaiting },
      data: { proofUrls: { push: fileIds } },
    });
    const req = await prisma.request.findUnique({ where: { id: awaiting }, include: { performer: true } });
    if (req) {
      await ctx.telegram.sendMessage(
        Number(req.performer.tgId),
        `Клиент загрузил подтверждение оплаты по заявке #${awaiting}. Подтвердите получение.`,
        Markup.inlineKeyboard([[Markup.button.callback('Получено', `perf_got_money:${awaiting}`)]]),
      );
    }
    await ctx.reply('Спасибо! Подтверждение получено. Ожидайте подтверждения от исполнительницы.');
    (ctx.session as any).awaitingProofFor = undefined;
  });

  // === Универсальный релей сообщений между участниками комнаты ===
  const relayableUpdates = ['text', 'photo', 'voice', 'audio', 'video', 'document', 'sticker'];
  bot.on(relayableUpdates as any, async (ctx, next) => {
    // Не мешаем спец-флоу оплаты
    if ((ctx.session as any).awaitingPayInfoFor || (ctx.session as any).awaitingProofFor) return next();

    const roomId = (ctx.session as any).proxyRoomFor as number | undefined;
    if (!roomId) return next();
    const r = getRoom(roomId);
    if (!r || !r.active) return next();

    const me = String(ctx.from!.id);
    if (!r.joined.has(me)) return next(); // не нажал join_room

    const peer = me === r.clientTgId ? r.performerTgId : r.clientTgId;

    try {
      // Копируем любое сообщение как есть (сохраняет медиа/кнопки)
      // @ts-expect-error telegraf types
      await ctx.telegram.copyMessage(Number(peer), ctx.chat!.id, (ctx.message as any).message_id);
    } catch (e) {
      // Молча игнорируем ошибки доставки (например, если пользователь закрыл личку)
    }
  });
};
