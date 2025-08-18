import { Telegraf, Markup } from "telegraf";
import { prisma } from "../services/prisma.js";
import { redis, rk } from "../services/redis.js";

type RoomInfo = {
  clientTgId: string;
  performerTgId: string;
  joined: Set<string>;
  active: boolean;
};

const getRoom = async (reqId: number): Promise<RoomInfo | undefined> => {
  const [hash, members] = await Promise.all([
    redis.hgetall(rk.roomHash(reqId)),
    redis.smembers(rk.roomJoined(reqId)),
  ]);
  if (!hash.clientTgId) return undefined;
  return {
    clientTgId: hash.clientTgId,
    performerTgId: hash.performerTgId,
    active: hash.active === "1" || hash.active === "true",
    joined: new Set(members),
  };
};

const ensureRoom = async (
  reqId: number,
  clientTgId: string,
  performerTgId: string,
): Promise<RoomInfo> => {
  await redis.hset(rk.roomHash(reqId), {
    clientTgId,
    performerTgId,
    active: "1",
  });
  return (await getRoom(reqId))!;
};

const joinRoom = async (reqId: number, tgId: string): Promise<Set<string>> => {
  await redis.sadd(rk.roomJoined(reqId), tgId);
  const members = await redis.smembers(rk.roomJoined(reqId));
  return new Set(members);
};

const leaveRoom = async (reqId: number, tgId: string): Promise<void> => {
  await redis.srem(rk.roomJoined(reqId), tgId);
};

export const registerRequestFlows = (bot: Telegraf) => {
  bot.on("callback_query", async (ctx, next) => {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    if (!data) return next();

    if (data.startsWith("req_accept:")) {
      const id = Number(data.split(":")[1]);
      const req = await prisma.request.update({
        where: { id },
        data: { status: "ACCEPTED" },
        include: {
          client: true,
          performer: { include: { performerProfile: true } },
          paymentMeta: true,
        },
      });
      await ctx.editMessageText(`✅ Заявка #${id} принята. Вперёд к деталям!`);

      // Создаём комнату прокси-чата (без контактов)
      await ensureRoom(id, String(req.client.tgId), String(req.performer.tgId));

      // Если у исполнительницы есть реквизиты по умолчанию — сразу отправим клиенту и сохраним
      const defaultPay =
        req.performer.performerProfile?.defaultPayInstructions?.trim();
      if (defaultPay) {
        if (!req.paymentMeta) {
          await prisma.paymentMeta.create({
            data: {
              requestId: req.id,
              proofUrls: [],
              instructions: defaultPay,
            },
          });
        } else if (!req.paymentMeta.instructions) {
          await prisma.paymentMeta.update({
            where: { requestId: req.id },
            data: { instructions: defaultPay },
          });
        }

        await ctx.telegram.sendMessage(
          Number(req.client.tgId),
          [
            `🆕 Отличные новости: заявка #${req.id} принята.`,
            "",
            `💬 Нажмите кнопку, чтобы открыть прокси-чат через бота и обсудить детали с исполнительницей.`,
            `💳 Реквизиты для оплаты:\n${defaultPay}`,
          ].join("\n"),
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                "💬 Открыть чат через бота",
                `join_room:${req.id}`,
              ),
            ],
            [
              Markup.button.callback(
                "✅ Оплатил",
                `client_mark_paid:${req.id}`,
              ),
            ],
          ]),
        );

        // Сообщение исполнительнице — напоминание про /payinfo
        await ctx.reply(
          `💬 [Чат заявки #${id}] Нажмите, чтобы подключиться.\nОбсудите детали - обменяйтесь контактами для связи, согласуйте время, дату и остальные подробности\nРеквизиты по умолчанию уже отправлены клиенту. Настроить: /payinfo`,
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                "💬 Открыть чат через бота",
                `join_room:${id}`,
              ),
            ],
          ]),
        );
      } else {
        // Реквизиты по умолчанию не настроены — попросим указать через /payinfo для автоматической отправки
        await ctx.telegram.sendMessage(
          Number(req.client.tgId),
          [
            `🆕 Новая заявка #${req.id} принята.`,
            "",
            `💬 [Чат заявки #${req.id}] Нажмите кнопку, чтобы открыть прокси-чат через бота.`,
            `💳 [Оплата заявки #${req.id}] Реквизиты ещё не предоставлены исполнительницей.`,
          ].join("\n"),
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                "💬 Открыть чат через бота",
                `join_room:${req.id}`,
              ),
            ],
            [
              Markup.button.callback(
                "✅ Оплатил",
                `client_mark_paid:${req.id}`,
              ),
            ],
          ]),
        );

        await ctx.reply(
          `💬 [Чат заявки #${id}] Нажмите, чтобы подключиться.\nРеквизиты по умолчанию не настроены — укажите их через /payinfo для автоматической отправки клиенту`,
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                "💬 Открыть чат через бота",
                `join_room:${id}`,
              ),
            ],
          ]),
        );
      }

      return;
    }

    if (data.startsWith("req_reject:")) {
      const id = Number(data.split(":")[1]);
      const req = await prisma.request.update({
        where: { id },
        data: { status: "REJECTED" },
        include: { client: true },
      });
      await ctx.editMessageText(`❎ Заявка #${id} отклонена.`);
      await ctx.telegram.sendMessage(
        Number(req.client.tgId),
        `Заявка #${id} отклонена исполнителем.`,
      );
      await redis.del(rk.roomHash(id), rk.roomJoined(id));
      return;
    }

    if (data.startsWith("join_room:")) {
      const reqId = Number(data.split(":")[1]);
      const req = await prisma.request.findUnique({
        where: { id: reqId },
        include: { client: true, performer: true },
      });
      if (!req) {
        await ctx.answerCbQuery?.("Заявка не найдена");
        return;
      }
      const r = await ensureRoom(
        reqId,
        String(req.client.tgId),
        String(req.performer.tgId),
      );
      if (!r.active) {
        await ctx.answerCbQuery?.("Чат закрыт");
        return;
      }
      const me = String(ctx.from!.id);
      if (me !== r.clientTgId && me !== r.performerTgId) {
        await ctx.answerCbQuery?.("Вы не участник этой заявки");
        return;
      }
      const joined = await joinRoom(reqId, me);
      await prisma.user.update({
        where: { tgId: me },
        data: { activeInChat: true, lastChatRequestId: reqId },
      });
      (ctx as any).session.proxyRoomFor = reqId;
      (ctx as any).session.lastChatRequestId = reqId;
      await ctx.answerCbQuery?.("Чат подключён ✅");
      await ctx.editMessageReplyMarkup({
        inline_keyboard: [
          [{ text: "🚪 Выйти из чата", callback_data: `leave_room:${reqId}` }],
          [{ text: "⚠️ Жалоба", callback_data: `report_req:${reqId}` }],
        ],
      });
      await ctx.reply(
        `💬 [Чат заявки #${reqId}] Вы подключены. Все ваши сообщения будут доставлены второй стороне.`,
      );

      // deliver queued messages for this participant
      const qKey = rk.roomMsgQueue(reqId, me);
      const queued = await redis.lrange(qKey, 0, -1);
      if (queued.length) {
        for (const item of queued) {
          try {
            const payload = JSON.parse(item) as { from: string; msgId: number };
            // resend message preserving original sender
            await ctx.telegram.copyMessage(
              Number(me),
              Number(payload.from),
              payload.msgId,
            );
          } catch {}
        }
        await redis.del(qKey);
      }

      const meta = await prisma.paymentMeta.findUnique({
        where: { requestId: reqId },
      });
      if (meta && !meta.performerReceived && me === r.clientTgId) {
        const text = meta.paymentPending
          ? "⏳ Оплата ожидает подтверждения. Прикрепите подтверждение или нажмите «Оплатил» повторно."
          : "💳 Не забудьте оплатить заявку. Нажмите «Оплатил», когда отправите деньги.";
        await ctx.reply(
          text,
          Markup.inlineKeyboard([
            [Markup.button.callback("✅ Оплатил", `client_mark_paid:${reqId}`)],
          ]),
        );
      }

      const bothIn = joined.has(r.clientTgId) && joined.has(r.performerTgId);
      if (bothIn) {
        const [clientWarn, perfWarn] = await redis.hmget(
          rk.roomHash(reqId),
          "clientWaitMsgId",
          "perfWaitMsgId",
        );
        if (clientWarn) {
          await ctx.telegram
            .deleteMessage(Number(r.clientTgId), Number(clientWarn))
            .catch(() => {});
        }
        if (perfWarn) {
          await ctx.telegram
            .deleteMessage(Number(r.performerTgId), Number(perfWarn))
            .catch(() => {});
        }
        await redis.hdel(
          rk.roomHash(reqId),
          "clientWaitMsgId",
          "perfWaitMsgId",
        );
        await ctx.telegram.sendMessage(
          Number(r.clientTgId),
          "Обе стороны в чате. Можно переписываться.",
        );
        await ctx.telegram.sendMessage(
          Number(r.performerTgId),
          "Обе стороны в чате. Можно переписываться.",
        );
      } else {
        const field = me === r.clientTgId ? "clientWaitMsgId" : "perfWaitMsgId";
        const oldWarn = await redis.hget(rk.roomHash(reqId), field);
        if (oldWarn) {
          await ctx.telegram
            .deleteMessage(Number(me), Number(oldWarn))
            .catch(() => {});
        }
        const warnMsg = await ctx.reply("Собеседник пока не в сети");
        await redis.hset(rk.roomHash(reqId), {
          [field]: String(warnMsg.message_id),
        });
      }
      return;
    }

    if (data.startsWith("leave_room:")) {
      const reqId = Number(data.split(":")[1]);
      const me = String(ctx.from!.id);
      await leaveRoom(reqId, me);
      await prisma.user.update({
        where: { tgId: me },
        data: { activeInChat: false, lastChatRequestId: reqId },
      });
      (ctx as any).session.proxyRoomFor = undefined;
      (ctx as any).session.lastChatRequestId = reqId;
      await ctx.answerCbQuery?.("Вы вышли из чата");
      await ctx.editMessageReplyMarkup(undefined);
      const r = await getRoom(reqId);
      if (r && r.active) {
        const peer = me === r.clientTgId ? r.performerTgId : r.clientTgId;
        if (r.joined.has(peer)) {
          const field =
            peer === r.clientTgId ? "clientWaitMsgId" : "perfWaitMsgId";
          const oldWarn = await redis.hget(rk.roomHash(reqId), field);
          if (oldWarn) {
            await ctx.telegram
              .deleteMessage(Number(peer), Number(oldWarn))
              .catch(() => {});
          }
          const warn = await ctx.telegram.sendMessage(
            Number(peer),
            "Собеседник пока не в сети",
          );
          await redis.hset(rk.roomHash(reqId), {
            [field]: String(warn.message_id),
          });
        }
      }
      return;
    }

    if (data.startsWith("show_payment:")) {
      const id = Number(data.split(":")[1]);
      const meta = await prisma.paymentMeta.findUnique({
        where: { requestId: id },
      });
      const body = meta?.instructions
        ? `💳 [Оплата заявки #${id}]\n${meta.instructions}`
        : `💳 [Оплата заявки #${id}]\nРеквизиты ещё не предоставлены исполнительницей.`;
      await ctx.reply(body);
      return;
    }

    if (data.startsWith("client_mark_paid:")) {
      const id = Number(data.split(":")[1]);
      await prisma.paymentMeta.update({
        where: { requestId: id },
        data: { clientMarkPaid: true, paymentPending: true },
      });
      await ctx.editMessageText(
        "Отправьте скрин/фото/документ подтверждения оплаты одним сообщением.",
      );
      (ctx as any).session.awaitingProofFor = id;
      return;
    }

    if (data.startsWith("perf_got_money:")) {
      const id = Number(data.split(":")[1]);
      const req = await prisma.request.update({
        where: { id },
        data: { status: "COMPLETED" },
        include: { client: true },
      });
      await prisma.paymentMeta.update({
        where: { requestId: id },
        data: { performerReceived: true, paymentPending: false },
      });
      await ctx.editMessageText(
        `✅ Оплата подтверждена. Заявка #${id} завершена.`,
      );
      await ctx.telegram.sendMessage(
        Number(req.client.tgId),
        "Исполнительница подтвердила получение. Приятного времяпровождения!",
      );
      const r = await getRoom(id);
      if (r) {
        await redis.hset(rk.roomHash(id), { active: "0" });
        await redis.del(rk.roomJoined(id));
        await ctx.telegram.sendMessage(
          Number(r.clientTgId),
          "Чат заявки закрыт.",
        );
        await ctx.telegram.sendMessage(
          Number(r.performerTgId),
          "Чат заявки закрыт.",
        );
        await prisma.user.update({
          where: { tgId: r.clientTgId },
          data: { activeInChat: false, lastChatRequestId: null },
        });
        await prisma.user.update({
          where: { tgId: r.performerTgId },
          data: { activeInChat: false, lastChatRequestId: null },
        });
      }
      return;
    }

    return next();
  });

  bot.on(["photo", "document"], async (ctx, next) => {
    const awaiting = (ctx as any).session.awaitingProofFor as
      | number
      | undefined;
    if (!awaiting) return next();
    const fileIds: string[] = [];
    if ("photo" in ctx.message! && (ctx.message as any).photo?.length) {
      fileIds.push(
        (ctx.message as any).photo[(ctx.message as any).photo.length - 1]
          .file_id,
      );
    }
    if ("document" in ctx.message! && (ctx.message as any).document) {
      fileIds.push((ctx.message as any).document.file_id);
    }
    await prisma.paymentMeta.update({
      where: { requestId: awaiting },
      data: { proofUrls: { push: fileIds } },
    });
    const req = await prisma.request.findUnique({
      where: { id: awaiting },
      include: { performer: true },
    });
    if (req) {
      await ctx.telegram.sendMessage(
        Number(req.performer.tgId),
        `Клиент загрузил подтверждение оплаты по заявке #${awaiting}. Подтвердите получение.`,
        Markup.inlineKeyboard([
          [Markup.button.callback("Получено", `perf_got_money:${awaiting}`)],
        ]),
      );
    }
    await ctx.reply(
      "Спасибо! Подтверждение получено. Ожидайте подтверждения от исполнительницы.",
    );
    (ctx as any).session.awaitingProofFor = undefined;
  });

  const relayableUpdates = [
    "text",
    "photo",
    "voice",
    "audio",
    "video",
    "document",
    "sticker",
  ];
  bot.on(relayableUpdates as any, async (ctx, next) => {
    if ((ctx as any).session.awaitingProofFor) return next();

    const roomId = (ctx as any).session.proxyRoomFor as number | undefined;
    if (!roomId) return next();
    const r = await getRoom(roomId);
    if (!r || !r.active) return next();

    const me = String(ctx.from!.id);
    if (!r.joined.has(me)) return next();

    const peer = me === r.clientTgId ? r.performerTgId : r.clientTgId;
    const messageId = (ctx.message as any).message_id as number;

    const peerRec = await prisma.user.findUnique({
      where: { tgId: peer },
      select: { activeInChat: true },
    });

    if (peerRec?.activeInChat && r.joined.has(peer)) {
      try {
        // @ts-expect-error telegraf types
        await ctx.telegram.copyMessage(Number(peer), ctx.chat!.id, messageId);
      } catch {}
    } else {
      // store message for later delivery
      await redis.rpush(
        rk.roomMsgQueue(roomId, peer),
        JSON.stringify({ from: me, msgId: messageId }),
      );
    }
  });
};
