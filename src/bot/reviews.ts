import { Telegraf, Markup } from 'telegraf';
import { prisma } from '../services/prisma.js';

function stars(n: number) {
  const full = '★'.repeat(n);
  const empty = '☆'.repeat(5 - n);
  return full + empty;
}

async function promptForReview(bot: Telegraf, requestId: number) {
  const req = await prisma.request.findUnique({
    where: { id: requestId },
    include: { client: true, performer: true },
  });
  if (!req) return;

  // Клиенту — оценить исполнительницу
  await bot.telegram.sendMessage(
    Number(req.client.tgId),
    `Заявка #${requestId} завершена. Пожалуйста, оцените исполнительницу.`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('★', `review_rate:${requestId}:1`),
        Markup.button.callback('★★', `review_rate:${requestId}:2`),
        Markup.button.callback('★★★', `review_rate:${requestId}:3`),
        Markup.button.callback('★★★★', `review_rate:${requestId}:4`),
        Markup.button.callback('★★★★★', `review_rate:${requestId}:5`),
      ],
    ]),
  );

  // Исполнительнице — оценить клиента (опционально)
  await bot.telegram.sendMessage(
    Number(req.performer.tgId),
    `Заявка #${requestId} завершена. Оцените клиента (необязательно).`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('★', `review_rate_p:${requestId}:1`),
        Markup.button.callback('★★', `review_rate_p:${requestId}:2`),
        Markup.button.callback('★★★', `review_rate_p:${requestId}:3`),
        Markup.button.callback('★★★★', `review_rate_p:${requestId}:4`),
        Markup.button.callback('★★★★★', `review_rate_p:${requestId}:5`),
      ],
    ]),
  );
}

async function upsertProfileAvgForUser(targetUserId: number) {
  const agg = await prisma.review.aggregate({
    where: { targetId: targetUserId },
    _avg: { rating: true },
    _count: { rating: true },
  });
  const user = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!user) return;
  try {
    await prisma.performerProfile.update({
      where: { userId: targetUserId },
      data: { rating: (agg._avg.rating || 0) },
    });
  } catch {
    // target может быть не исполнителем — тихо игнорируем
  }
}

export const registerReviewFlows = (bot: Telegraf) => {
  // Кнопки выбора оценки: клиент → исполнительнице
  bot.on('callback_query', async (ctx, next) => {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    if (!data) return next();

    // Клиент оценивает исполнительницу
    if (data.startsWith('review_rate:')) {
      const [, reqIdStr, rateStr] = data.split(':');
      const requestId = Number(reqIdStr);
      const rating = Number(rateStr);
      if (!ctx.from) return;
      const me = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) } });
      const req = await prisma.request.findUnique({ where: { id: requestId }, include: { client: true, performer: true } });
      if (!me || !req || me.id !== req.clientId) {
        await ctx.answerCbQuery?.('Недоступно');
        return;
      }
      // Уже оценивал?
      const exists = await prisma.review.findFirst({ where: { requestId, authorId: me.id } });
      if (exists) {
        await ctx.answerCbQuery?.('Отзыв уже оставлен');
        return;
      }
      // Сохраняем оценку в сессию и просим текст (опционально)
      (ctx.session as any).pendingReview = { requestId, rating, targetId: req.performerId, authorId: me.id, role: 'client' };
      await ctx.editMessageText(`Ваша оценка: ${stars(rating)}. Напишите короткий комментарий (или нажмите «Пропустить»).`, 
        Markup.inlineKeyboard([[Markup.button.callback('Пропустить', `review_skip:${requestId}`)]]));
      return;
    }

    // Исполнительница оценивает клиента
    if (data.startsWith('review_rate_p:')) {
      const [, reqIdStr, rateStr] = data.split(':');
      const requestId = Number(reqIdStr);
      const rating = Number(rateStr);
      if (!ctx.from) return;
      const me = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) } });
      const req = await prisma.request.findUnique({ where: { id: requestId }, include: { client: true, performer: true } });
      if (!me || !req || me.id !== req.performerId) {
        await ctx.answerCbQuery?.('Недоступно');
        return;
      }
      const exists = await prisma.review.findFirst({ where: { requestId, authorId: me.id } });
      if (exists) {
        await ctx.answerCbQuery?.('Отзыв уже оставлен');
        return;
      }
      (ctx.session as any).pendingReview = { requestId, rating, targetId: req.clientId, authorId: me.id, role: 'performer' };
      await ctx.editMessageText(`Ваша оценка: ${stars(rating)}. Напишите короткий комментарий (или нажмите «Пропустить»).`, 
        Markup.inlineKeyboard([[Markup.button.callback('Пропустить', `review_skip:${requestId}`)]]));
      return;
    }

    // Пропуск текста
    if (data.startsWith('review_skip:')) {
      const requestId = Number(data.split(':')[1]);
      const pr = (ctx.session as any).pendingReview as { requestId: number; rating: number; targetId: number; authorId: number } | undefined;
      if (!pr || pr.requestId !== requestId) {
        await ctx.answerCbQuery?.('Нет ожидаемого отзыва');
        return;
      }
      await prisma.review.create({
        data: {
          requestId: pr.requestId,
          authorId: pr.authorId,
          targetId: pr.targetId,
          rating: pr.rating,
        },
      });
      await upsertProfileAvgForUser(pr.targetId);
      (ctx.session as any).pendingReview = undefined;
      await ctx.editMessageText('Спасибо! Отзыв сохранён.');
      return;
    }

    // Просмотр отзывов профиля (из поиска/профиля)
    if (data.startsWith('view_reviews:')) {
      const userId = Number(data.split(':')[1]);
      const items = await prisma.review.findMany({
        where: { targetId: userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { author: true },
      });
      if (!items.length) {
        await ctx.answerCbQuery?.();
        await ctx.reply('Пока нет отзывов.');
        return;
      }
      await ctx.answerCbQuery?.();
      for (const r of items) {
        await ctx.reply([
          `${stars(r.rating)} — от ${r.author.username ? '@'+r.author.username : 'пользователя'}`,
          r.text ? `«${r.text}»` : undefined,
        ].filter(Boolean).join('\n'));
      }
      return;
    }

    return next();
  });

  // Принимаем текст комментария (если есть pendingReview)
  bot.on('text', async (ctx, next) => {
    const pr = (ctx.session as any).pendingReview as { requestId: number; rating: number; targetId: number; authorId: number } | undefined;
    if (!pr) return next();
    const text = (ctx.message as any).text as string;
    await prisma.review.create({
      data: {
        requestId: pr.requestId,
        authorId: pr.authorId,
        targetId: pr.targetId,
        rating: pr.rating,
        text,
      },
    });
    await upsertProfileAvgForUser(pr.targetId);
    (ctx.session as any).pendingReview = undefined;
    await ctx.reply('Спасибо! Отзыв сохранён.');
  });
};

export { promptForReview };
