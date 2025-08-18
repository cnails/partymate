import { Telegraf, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { formatRequestStatus, dateLabelMsk } from '../utils/format.js';

export const registerRequestsCommand = (bot: Telegraf) => {
  bot.command('requests', async (ctx) => {
    if (!ctx.from) return;
    const me = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) } });
    if (!me) {
      await ctx.reply('Похоже, вы ещё не начали. Нажмите /start.');
      return;
    }

    if (me.role === 'PERFORMER') {
      const items = await prisma.request.findMany({
        where: { performerId: me.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { client: true },
      });
      if (!items.length) {
        await ctx.reply('Заявок пока нет.');
        return;
      }
      for (const r of items) {
        const kb: any[] = [];
        kb.push([Markup.button.callback('💬 Чат заявки', `join_room:${r.id}`)]);
        if (r.status === 'NEW' || r.status === 'NEGOTIATION') {
          kb.push([
            Markup.button.callback('✅ Принять', `req_accept:${r.id}`),
            Markup.button.callback('❎ Отказать', `req_reject:${r.id}`),
          ]);
        }
        await ctx.reply(
          [
            `#${r.id} · ${r.game} · ${r.durationMin} мин`,
            `Дата: ${dateLabelMsk(r.createdAt)} (МСК)`,
            `Статус: ${formatRequestStatus(r.status)}`,
          ].join('\n'),
          Markup.inlineKeyboard(kb),
        );
      }
    } else {
      const items = await prisma.request.findMany({
        where: { clientId: me.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { performer: true, paymentMeta: true },
      });
      if (!items.length) {
        await ctx.reply('У вас пока нет заявок. Найдите исполнительницу через /search.');
        return;
      }
      for (const r of items) {
        const paid = r.paymentMeta?.performerReceived
          ? ' (оплата подтверждена)'
          : r.paymentMeta?.paymentPending
            ? ' (оплата ожидает подтверждения)'
            : r.paymentMeta?.clientMarkPaid
              ? ' (оплата отправлена)'
              : '';
        const kb: any[] = [];
        kb.push([Markup.button.callback('💬 Чат заявки', `join_room:${r.id}`)]);
        kb.push([Markup.button.callback('💳 Реквизиты', `show_payment:${r.id}`)]);
        if ((r.status === 'ACCEPTED' || r.status === 'NEGOTIATION') && !r.paymentMeta?.performerReceived) {
          kb.push([Markup.button.callback('✅ Оплатил', `client_mark_paid:${r.id}`)]);
        }
        await ctx.reply(
          [
            `#${r.id} · ${r.game} · ${r.durationMin} мин`,
            `Дата: ${dateLabelMsk(r.createdAt)} (МСК)`,
            `Статус: ${formatRequestStatus(r.status)}${paid}`,
          ].join('\n'),
          Markup.inlineKeyboard(kb),
        );
      }
    }
  });
};
