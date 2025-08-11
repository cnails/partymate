import { Telegraf, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';

const PAGE_SIZE = 5;

type Tab = 'open' | 'done' | 'all';
type Who = 'p' | 'c';

function kbTabs(who: Who, tab: Tab, page: number, hasPrev: boolean, hasNext: boolean) {
  const rowTabs = [
    Markup.button.callback(tab === 'open' ? '• Открытые' : 'Открытые', `req_list:${who}:open:0`),
    Markup.button.callback(tab === 'done' ? '• Завершённые' : 'Завершённые', `req_list:${who}:done:0`),
    Markup.button.callback(tab === 'all' ? '• Все' : 'Все', `req_list:${who}:all:0`),
  ];
  const rowPager = [
    Markup.button.callback('« Назад', `req_list:${who}:${tab}:${Math.max(0, page-1)}`, !hasPrev),
    Markup.button.callback('Вперёд »', `req_list:${who}:${tab}:${page+1}`, !hasNext),
  ];
  return Markup.inlineKeyboard([rowTabs, rowPager]);
}

async function renderList(ctx: any, who: Who, tab: Tab, page: number) {
  if (!ctx.from) return;
  const me = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) } });
  if (!me) {
    await ctx.reply('Нужно начать с /start');
    return;
  }

  let where: any;
  if (who === 'p') {
    where = { performerId: me.id };
  } else {
    where = { clientId: me.id };
  }

  if (tab === 'open') {
    where.status = { in: ['NEW', 'NEGOTIATION', 'ACCEPTED'] };
  } else if (tab === 'done') {
    where.status = { in: ['COMPLETED', 'CANCELED', 'REJECTED'] };
  }

  const skip = page * PAGE_SIZE;
  const items = await prisma.request.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip,
    take: PAGE_SIZE + 1, // +1 чтобы понять, есть ли next
    include: { client: true, performer: true, paymentMeta: true },
  });

  const hasNext = items.length > PAGE_SIZE;
  const list = items.slice(0, PAGE_SIZE);
  const hasPrev = page > 0;

  if (!list.length) {
    await ctx.reply('Ничего нет по этому фильтру.', kbTabs(who, tab, page, hasPrev, hasNext));
    return;
  }

  await ctx.reply(
    list.map((r) => {
      const paid = r.paymentMeta?.clientMarkPaid ? ' (оплата отправлена)' : '';
      return `#${r.id} · ${r.game} · ${r.durationMin} мин · ${r.status}${paid}`;
    }).join('\n'),
    kbTabs(who, tab, page, hasPrev, hasNext),
  );

  // Отдельно — кнопки действий по каждой заявке
  for (const r of list) {
    const kb: any[] = [];
    kb.push([Markup.button.callback('💬 Чат', `join_room:${r.id}`)]);
    kb.push([Markup.button.callback('💳 Реквизиты', `show_payment:${r.id}`)]);
    if (who === 'c' && ['COMPLETED', 'REJECTED', 'CANCELED'].includes(r.status)) {
      kb.push([Markup.button.callback('Повторить с этой исполнительницей', `req_repeat:${r.id}`)]);
    }
    if (who === 'p' && ['NEW', 'NEGOTIATION'].includes(r.status)) {
      kb.push([Markup.button.callback('✅ Принять', `req_accept:${r.id}`), Markup.button.callback('❎ Отказать', `req_reject:${r.id}`)]);
    }
    await ctx.reply(
      `#${r.id} · ${who === 'p' ? 'клиент' : 'исполнительница'}: ${who === 'p' ? (r.client.username ? '@'+r.client.username : r.clientId) : (r.performer.username ? '@'+r.performer.username : r.performerId)}`,
      Markup.inlineKeyboard(kb),
    );
  }
}

export const registerRequestsCommand = (bot: Telegraf) => {
  bot.command('requests', async (ctx) => {
    if (!ctx.from) return;
    const me = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) } });
    if (!me) {
      await ctx.reply('Похоже, вы ещё не начали. Нажмите /start.');
      return;
    }
    const who: Who = me.role === 'PERFORMER' ? 'p' : 'c';
    await renderList(ctx, who, 'open', 0);
  });

  bot.on('callback_query', async (ctx, next) => {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    if (!data) return next();

    if (data.startsWith('req_list:')) {
      const [, who, tab, pageStr] = data.split(':');
      await ctx.answerCbQuery?.();
      await renderList(ctx, who as Who, tab as Tab, Number(pageStr) || 0);
      return;
    }

    // Повторить заявку (клиент)
    if (data.startsWith('req_repeat:')) {
      const id = Number(data.split(':')[1]);
      const r = await prisma.request.findUnique({ where: { id } });
      if (!r) {
        await ctx.answerCbQuery?.('Заявка не найдена');
        return;
      }
      await ctx.answerCbQuery?.('Ок, создадим новую');
      // Входим в мастер заявки с выбранной исполнительницей
      // @ts-ignore
      await ctx.scene.enter('requestWizard', { performerUserId: r.performerId });
      return;
    }

    return next();
  });
};
