import { Telegraf, Markup } from 'telegraf';
import { prisma } from '../services/prisma.js';
import { config } from '../config.js';

const isAdmin = (tgId: string) => config.adminIds.includes(tgId);

async function activateOrder(orderId: number) {
  const o = await prisma.billingOrder.findUnique({
    where: { id: orderId },
    include: { performer: { include: { user: true } } },
  });
  if (!o) return null;
  const now = new Date();
  const until = new Date(now.getTime() + o.days * 24 * 60 * 60 * 1000);

  if (o.type === 'BOOST') {
    await prisma.performerProfile.update({
      where: { id: o.performerId },
      data: { isBoosted: true, boostUntil: until },
    });
  } else {
    await prisma.performerProfile.update({
      where: { id: o.performerId },
      data: { plan: o.plan || 'STANDARD', planUntil: until },
    });
  }

  const updated = await prisma.billingOrder.update({
    where: { id: o.id },
    data: { status: 'ACTIVATED', activatedUntil: until },
  });

  return { order: updated, until };
}

export const registerBillingAdmin = (bot: Telegraf) => {
  bot.command('admin_billing', async (ctx) => {
    if (!ctx.from) return;
    if (!isAdmin(String(ctx.from.id))) {
      await ctx.reply('Нет прав.');
      return;
    }
    const list = await prisma.billingOrder.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 20,
      include: { performer: { include: { user: true } } },
    });
    if (!list.length) {
      await ctx.reply('Ожидающих заказов нет.');
      return;
    }
    for (const o of list) {
      await ctx.reply(
        [
          `#${o.id} · ${o.type} · ${o.status}`,
          o.plan ? `План: ${o.plan} (${o.days} дн)` : `Буст: ${o.days} дн`,
          `Сумма: ${o.amountRub}₽`,
          `Исполнительница: ${o.performer.user.username ? '@' + o.performer.user.username : o.performer.userId}`,
          o.proofUrls?.length ? `Пруфы: ${o.proofUrls.length} файл(а)` : 'Пруфы: —',
        ].join('\n'),
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Активировать', `adm_bill_act:${o.id}`),
           Markup.button.callback('❌ Отклонить', `adm_bill_rej:${o.id}`)],
        ]),
      );
    }
  });

  bot.on('callback_query', async (ctx, next) => {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    if (!data) return next();
    const me = String(ctx.from!.id);

    if (data.startsWith('adm_bill_act:')) {
      if (!isAdmin(me)) { await ctx.answerCbQuery?.('Нет прав'); return; }
      const id = Number(data.split(':')[1]);
      const res = await activateOrder(id);
      if (!res) { await ctx.answerCbQuery?.('Не найдено'); return; }
      await ctx.answerCbQuery?.('Активировано');
      await ctx.editMessageText(`Заказ #${id} активирован до ${res.until.toISOString().slice(0,10)}.`);
      const o = await prisma.billingOrder.findUnique({ where: { id }, include: { performer: { include: { user: true } } } });
      if (o) {
        await ctx.telegram.sendMessage(Number(o.performer.user.tgId), `Ваш заказ #${o.id} активирован до ${res.until.toISOString().slice(0,10)}.`);
      }
      return;
    }

    if (data.startsWith('adm_bill_rej:')) {
      if (!isAdmin(me)) { await ctx.answerCbQuery?.('Нет прав'); return; }
      const id = Number(data.split(':')[1]);
      await prisma.billingOrder.update({ where: { id }, data: { status: 'REJECTED' } });
      await ctx.answerCbQuery?.('Отклонено');
      await ctx.editMessageText(`Заказ #${id} отклонён.`);
      const o = await prisma.billingOrder.findUnique({ where: { id }, include: { performer: { include: { user: true } } } });
      if (o) {
        await ctx.telegram.sendMessage(Number(o.performer.user.tgId), `Ваш заказ #${o.id} отклонён. Свяжитесь с поддержкой.`);
      }
      return;
    }

    return next();
  });
};
