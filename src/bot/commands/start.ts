import { Telegraf, Markup } from "telegraf";
import { prisma } from "../../services/prisma.js";
import { roleKeyboard } from "../keyboards.js";

export const registerStart = (bot: Telegraf) => {
  bot.start(async (ctx) => {
    if (!ctx.from) return;
    const tgId = String(ctx.from.id);
    const u = await prisma.user.findUnique({ where: { tgId } });
    if (u?.lastChatRequestId) {
      (ctx.session as any).lastChatRequestId = u.lastChatRequestId;
    }
    if (!u?.role) {
      await ctx.reply(
        [
          "Привет! 👋",
          "Я partymate — помогу найти напарника для игр или просто поболтать по интересам.",
          "",
          "С чего начнём?",
        ].join("\n"),
        roleKeyboard(),
      );
      return;
    }
    if (u.role === "PERFORMER") {
      await ctx.reply("Вы исполнительница! 🎉");
      await ctx.reply(
        "Меню:",
        Markup.keyboard([
          ["/listing"],
          ["/requests"],
          ["/payinfo"],
          ["/help"],
          ["/rules"],
          ["/cancel"],
        ])
          .resize()
          .oneTime(),
      );
    } else if (u.role === "CLIENT") {
      await ctx.reply("Вы клиент! 😊");
      await ctx.reply(
        "Меню:",
        Markup.keyboard([["/search"], ["/requests"], ["/help"], ["/rules"], ["/cancel"]])
          .resize()
          .oneTime(),
      );

      const pending = await prisma.request.findMany({
        where: {
          clientId: u.id,
          paymentMeta: { paymentPending: true, performerReceived: false },
        },
        include: { paymentMeta: true },
      });
      for (const p of pending) {
        await ctx.reply(
          `⚠️ Заявка #${p.id} ожидает подтверждения оплаты.`,
          Markup.inlineKeyboard([
            [Markup.button.callback("✅ Оплатил", `client_mark_paid:${p.id}`)],
          ]),
        );
      }
    } else {
      await ctx.reply(
        ["Давайте опредемился с ролью", "Кто вы?"].join("\n"),
        roleKeyboard(),
      );
    }

    if (u.lastChatRequestId) {
      await ctx.reply(
        "Продолжить предыдущий чат?",
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "💬 Вернуться в чат",
              `join_room:${u.lastChatRequestId}`,
            ),
          ],
        ]),
      );
    }
  });

  bot.action("role_client", async (ctx) => {
    await ctx.answerCbQuery();
    await (ctx as any).scene.enter("clientOnboarding");
  });

  bot.action("role_performer", async (ctx) => {
    await ctx.answerCbQuery();
    await (ctx as any).scene.enter("performerOnboarding");
  });
};
