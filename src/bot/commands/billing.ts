import { Telegraf, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { config } from '../../config.js';

const planTitle = (p: 'BASIC'|'STANDARD'|'PRO') => ({ BASIC: 'BASIC', STANDARD: 'STANDARD', PRO: 'PRO' }[p]);

function kbMain() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🚀 Купить буст 7 дней', 'bill_buy:boost:7')],
    [Markup.button.callback('🚀 Купить буст 14 дней', 'bill_buy:boost:14')],
    [Markup.button.callback('⭐️ Подписка STANDARD 30 дней', 'bill_buy:plan:STANDARD:30')],
    [Markup.button.callback('⭐️ Подписка STANDARD 90 дней', 'bill_buy:plan:STANDARD:90')],
    [Markup.button.callback('🏆 Подписка PRO 30 дней', 'bill_buy:plan:PRO:30')],
    [Markup.button.callback('🏆 Подписка PRO 90 дней', 'bill_buy:plan:PRO:90')],
    [Markup.button.callback('❓ Зачем это нужно?', 'bill_help')],
    [Markup.button.callback('🧾 Мои заказы', 'bill_orders')],
  ]);
}

export const registerBillingCommand = (bot: Telegraf) => {
  bot.command('billing', async (ctx) => {
    if (!ctx.from) return;
    const me = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) }, include: { performerProfile: true } });
    if (!me || me.role !== 'PERFORMER' || !me.performerProfile) {
      await ctx.reply('Команда доступна только для исполнительниц.');
      return;
    }
    const p = me.performerProfile;
    const now = Date.now();
    const planActive =
      p.plan !== 'BASIC' && p.planUntil && new Date(p.planUntil).getTime() > now;
    const boostActive =
      p.isBoosted && p.boostUntil && new Date(p.boostUntil).getTime() > now;
    await ctx.reply(
      [
        '💳 Размещение и продвижение анкеты',
        'Буст поднимает анкету в выдаче на выбранный срок (7 или 14 дней).',
        `Тариф: ${planTitle((planActive ? p.plan : 'BASIC') as any)}${
          planActive && p.planUntil
            ? ` (до ${new Date(p.planUntil).toISOString().slice(0, 10)})`
            : ''
        }`,
        boostActive
          ? `Буст активен до ${new Date(p.boostUntil!).toISOString().slice(0, 10)}`
          : 'Буст: нет',
        '',
        'BASIC — только описание анкеты.',
        'STANDARD — описание и фото.',
        'PRO — описание, фото и голос.',
        'После окончания подписки элементы остаются в анкете, но не показываются клиентам.',
        'Приоритет: PRO + буст > PRO > STANDARD + буст > STANDARD > BASIC + буст > BASIC.',
        '',
        `Цены: буст 7д — ${config.billing.BOOST_7D_RUB}₽; буст 14д — ${config.billing.BOOST_14D_RUB}₽; STANDARD 30д — ${config.billing.PLAN_STD_30D_RUB}₽; STANDARD 90д — ${config.billing.PLAN_STD_90D_RUB}₽; PRO 30д — ${config.billing.PLAN_PRO_30D_RUB}₽; PRO 90д — ${config.billing.PLAN_PRO_90D_RUB}₽.`,
      ].join('\n'),
      kbMain(),
    );
  });

  bot.on('callback_query', async (ctx, next) => {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    if (!data) return next();

    if (data === 'bill_orders') {
      if (!ctx.from) return;
      const me = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) }, include: { performerProfile: true } });
      if (!me?.performerProfile) return;
      const orders = await prisma.billingOrder.findMany({
        where: { performerId: me.performerProfile.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      if (!orders.length) {
        await ctx.answerCbQuery?.();
        await ctx.reply('У вас пока нет заказов.', kbMain());
        return;
      }
      await ctx.answerCbQuery?.();
      for (const o of orders) {
        const text = [
          `#${o.id} · ${o.type} · ${o.status}`,
          o.plan ? `План: ${o.plan} (${o.days} дн)` : `Буст: ${o.days} дн`,
          `Сумма: ${o.amountRub}₽`,
          o.activatedUntil ? `Активен до ${new Date(o.activatedUntil).toISOString().slice(0,10)}` : undefined,
        ].filter(Boolean).join('\n');
        const markup =
          o.status === 'PENDING'
            ? Markup.inlineKeyboard([
                [Markup.button.callback('Загрузить подтверждение', `bill_upload:${o.id}`)],
                [Markup.button.callback('Отмена заказа', `bill_cancel:${o.id}`)],
              ])
            : undefined;
        await ctx.reply(text, markup);
      }
      return;
    }

    if (data === 'bill_help') {
      await ctx.answerCbQuery?.();
      await ctx.reply(
        [
          'Буст поднимает анкету в выдаче и помогает быстрее получать заявки.',
          'BASIC — только описание анкеты.',
          'STANDARD — описание и фото.',
          'PRO — описание, фото и голос.',
          'После окончания подписки элементы остаются в анкете, но не показываются клиентам.',
          'Приоритет: PRO + буст > PRO > STANDARD + буст > STANDARD > BASIC + буст > BASIC.',
        ].join('\n'),
        kbMain(),
      );
      return;
    }

    if (data.startsWith('bill_buy:boost:')) {
      const days = Number(data.split(':')[2]);
      const key = `BOOST_${days}D_RUB` as keyof typeof config.billing;
      const amount = (config.billing as any)[key];
      if (!amount) { await ctx.answerCbQuery?.('Неизвестный вариант'); return; }
      if (!ctx.from) return;
      const me = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) }, include: { performerProfile: true } });
      if (!me?.performerProfile) return;
      const order = await prisma.billingOrder.create({
        data: { performerId: me.performerProfile.id, type: 'BOOST', days, amountRub: amount, proofUrls: [] },
      });
      await ctx.answerCbQuery?.();
      await ctx.reply(
        [
          `Заказ #${order.id}: БУСТ на ${days} дней — ${amount}₽.`,
          `Оплата: ${config.billing.INSTRUCTIONS}`,
          'После оплаты: «Загрузить подтверждение» и пришлите скрин (фото/документ).',
        ].join('\n'),
        Markup.inlineKeyboard([[Markup.button.callback('Загрузить подтверждение', `bill_upload:${order.id}`)]]),
      );
      return;
    }

    if (data.startsWith('bill_buy:plan:')) {
      const [, , plan, daysStr] = data.split(':');
      const days = Number(daysStr);
      const prefix = plan === 'PRO' ? 'PRO' : 'STD';
      const key = `PLAN_${prefix}_${days}D_RUB` as keyof typeof config.billing;
      const amount = (config.billing as any)[key];
      if (!amount) { await ctx.answerCbQuery?.('Неизвестный вариант'); return; }
      if (!ctx.from) return;
      const me = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) }, include: { performerProfile: true } });
      if (!me?.performerProfile) return;
      const order = await prisma.billingOrder.create({
        data: { performerId: me.performerProfile.id, type: 'PLAN', plan: plan as any, days, amountRub: amount, proofUrls: [] },
      });
      await ctx.answerCbQuery?.();
      await ctx.reply(
        [
          `Заказ #${order.id}: Тариф ${plan} на ${days} дней — ${amount}₽.`,
          `Оплата: ${config.billing.INSTRUCTIONS}`,
          'После оплаты: «Загрузить подтверждение» и пришлите скрин (фото/документ).',
        ].join('\n'),
        Markup.inlineKeyboard([[Markup.button.callback('Загрузить подтверждение', `bill_upload:${order.id}`)]]),
      );
      return;
    }

    if (data.startsWith('bill_upload:')) {
      const id = Number(data.split(':')[1]);
      const order = await prisma.billingOrder.findUnique({ where: { id } });
      if (!order) {
        await ctx.answerCbQuery?.('Заказ не найден');
        return;
      }
      if (order.proofUrls && order.proofUrls.length) {
        await ctx.answerCbQuery?.('Подтверждение уже загружено');
        return;
      }
      (ctx.session as any).awaitingBillingProofFor = id;
      await ctx.answerCbQuery?.();
      await ctx.reply('Пришлите скрин/фото/документ одним сообщением.');
      return;
    }

    if (data.startsWith('bill_cancel:')) {
      const id = Number(data.split(':')[1]);
      const order = await prisma.billingOrder.findUnique({ where: { id } });
      if (!order || order.status !== 'PENDING') {
        await ctx.answerCbQuery?.('Заказ уже обработан');
        await ctx.editMessageText('Заказ уже обработан.');
        return;
      }
      await prisma.billingOrder.update({ where: { id }, data: { status: 'CANCELED' } });
      await ctx.answerCbQuery?.('Заказ отменён');
      await ctx.editMessageText('Заказ отменён.');
      return;
    }

    return next();
  });

  // Приём пруфов (фото/док)
  bot.on(['photo', 'document'], async (ctx, next) => {
    const awaiting = (ctx.session as any).awaitingBillingProofFor as number | undefined;
    if (!awaiting) return next();

    const fileIds: string[] = [];
    if ('photo' in ctx.message! && (ctx.message as any).photo?.length) {
      fileIds.push((ctx.message as any).photo[(ctx.message as any).photo.length - 1].file_id);
    }
    if ('document' in ctx.message! && (ctx.message as any).document) {
      fileIds.push((ctx.message as any).document.file_id);
    }
    await prisma.billingOrder.update({ where: { id: awaiting }, data: { proofUrls: { push: fileIds } } });
    (ctx.session as any).awaitingBillingProofFor = undefined;
    await ctx.reply('Спасибо! Подтверждение добавлено. Мы проверим и активируем.');
  });
};
