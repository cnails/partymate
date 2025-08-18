import { Telegraf, Markup } from 'telegraf';
import { prisma } from '../services/prisma.js';
import { config } from '../config.js';

const isAdmin = (tgId: string) => config.adminIds.includes(tgId);

export const registerModeration = (bot: Telegraf) => {
  // Кнопка "Пожаловаться" на анкете
  bot.on('callback_query', async (ctx, next) => {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    if (!data) return next();

    // Жалоба на пользователя с анкеты
    if (data.startsWith('report_user:')) {
      const targetUserId = Number(data.split(':')[1]);
      (ctx.session as any).reportFlow = { targetUserId };
      await ctx.answerCbQuery?.();
      await ctx.reply(
        'Что не так? Выберите категорию или напишите текст.',
        Markup.inlineKeyboard([
          [Markup.button.callback('Скам/неверные реквизиты', 'rp_cat:scam')],
          [Markup.button.callback('Оскорбления/токсичность', 'rp_cat:abuse')],
          [Markup.button.callback('NSFW/интим', 'rp_cat:nsfw')],
          [Markup.button.callback('Другое', 'rp_cat:other')],
          [Markup.button.callback('Отмена', 'wiz_cancel')],
        ]),
      );
      return;
    }

    // Жалоба из комнаты заявки
    if (data.startsWith('report_req:')) {
      const requestId = Number(data.split(':')[1]);
      const req = await prisma.request.findUnique({ where: { id: requestId }, include: { client: true, performer: true } });
      if (!req || !ctx.from) return;
      const me = String(ctx.from.id);
      const targetUserId = me === req.client.tgId ? req.performerId : req.clientId;
      (ctx.session as any).reportFlow = { targetUserId, requestId };
      await ctx.answerCbQuery?.();
      await ctx.reply(
        'Опишите проблему (или выберите категорию):',
        Markup.inlineKeyboard([
          [Markup.button.callback('Скам/неверные реквизиты', 'rp_cat:scam')],
          [Markup.button.callback('Оскорбления/токсичность', 'rp_cat:abuse')],
          [Markup.button.callback('NSFW/интим', 'rp_cat:nsfw')],
          [Markup.button.callback('Другое', 'rp_cat:other')],
          [Markup.button.callback('Отмена', 'wiz_cancel')],
        ]),
      );
      return;
    }

    if (data.startsWith('rp_cat:')) {
      const cat = data.split(':')[1];
      const flow = (ctx.session as any).reportFlow as { targetUserId?: number; requestId?: number } | undefined;
      if (!flow?.targetUserId) {
        await ctx.answerCbQuery?.('Нет контекста жалобы');
        return;
      }
      // Сразу создаём репорт без текста
      const rep = await prisma.report.create({
        data: {
          reporterId: (await prisma.user.findUnique({ where: { tgId: String(ctx.from!.id) } }))!.id,
          targetUserId: flow.targetUserId,
          requestId: flow.requestId,
          category: cat,
          status: 'pending',
          attachments: [],
          text: undefined,
        },
      });
      (ctx.session as any).reportFlow = undefined;
      await ctx.editMessageText('Спасибо! Жалоба отправлена на модерацию.');

      // Если 3+ открытых жалоб — снять анкету с публикации до проверки
      const openCount = await prisma.report.count({ where: { targetUserId: rep.targetUserId, status: 'pending' } });
      if (openCount >= 3) {
        try {
          await prisma.performerProfile.update({ where: { userId: rep.targetUserId! }, data: { status: 'MODERATION' } });
        } catch {}
      }

      // Уведомим админов
      for (const admin of config.adminIds) {
        try {
          await ctx.telegram.sendMessage(Number(admin), `⚠️ Новая жалоба #${rep.id} на пользователя ${rep.targetUserId} (категория: ${cat}).`);
        } catch {}
      }
      return;
    }

    // Админка: открыть репорт
    if (data.startsWith('adm_rep_open:')) {
      const id = Number(data.split(':')[1]);
      const tgId = String(ctx.from!.id);
      if (!isAdmin(tgId)) {
        await ctx.answerCbQuery?.('Нет прав');
        return;
      }
      const r = (await prisma.report.findUnique({ where: { id }, include: { reporter: true, targetUser: true } })) as any;
      if (!r) {
        await ctx.answerCbQuery?.('Не найдено');
        return;
      }
      await ctx.answerCbQuery?.();
      await ctx.reply(
        [
          `#${r.id} · статус: ${r.status}`,
          `Категория: ${r.category}`,
          `Текст: ${r.text || '—'}`,
          `От: ${r.reporter.username ? '@'+r.reporter.username : r.reporterId}`,
          `Против: ${r.targetUser?.username ? '@'+r.targetUser.username : r.targetUserId}`,
          `Заявка: ${r.requestId ? '#' + r.requestId : '—'}`,
        ].join('\n'),
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Принять', `adm_rep_res:${id}:accept`), Markup.button.callback('❌ Отклонить', `adm_rep_res:${id}:reject`)],
        ]),
      );
      return;
    }

    // Админка: резолв репорта
    if (data.startsWith('adm_rep_res:')) {
      const [, idStr, res] = data.split(':');
      const id = Number(idStr);
      const tgId = String(ctx.from!.id);
      if (!isAdmin(tgId)) {
        await ctx.answerCbQuery?.('Нет прав');
        return;
      }
      const r = await prisma.report.update({ where: { id }, data: { status: res === 'accept' ? 'resolved' : 'rejected' } });
      await ctx.answerCbQuery?.('Сохранено');
      await ctx.editMessageText(`Репорт #${id} → ${res}.`);
      // Авто-действие при accept: снять анкету на модерацию
      if (res === 'accept' && r.targetUserId) {
        try {
          await prisma.performerProfile.update({ where: { userId: r.targetUserId }, data: { status: 'MODERATION' } });
        } catch {}
      }
      return;
    }

    // Админка: открыть анкету исполнителя
    if (data.startsWith('adm_prof_open:')) {
      const id = Number(data.split(':')[1]);
      const tgId = String(ctx.from!.id);
      if (!isAdmin(tgId)) {
        await ctx.answerCbQuery?.('Нет прав');
        return;
      }
      const p = await prisma.performerProfile.findUnique({
        where: { id },
        include: { user: true },
      });
      if (!p) {
        await ctx.answerCbQuery?.('Не найдено');
        return;
      }
      await ctx.answerCbQuery?.();
      await ctx.reply(
        [
          `#${p.id} · ${p.user.username ? '@' + p.user.username : p.userId}`,
          `Игры: ${p.games.join(', ') || '—'}`,
          `Цена: ${p.pricePerHour}₽/ч`,
          p.about ? `Описание: ${p.about}` : undefined,
          p.photoUrl ? `Фото: ${p.photoUrl}` : 'Фото: —',
          p.voiceSampleUrl ? `Голос: ${p.voiceSampleUrl}` : 'Голос: —',
        ]
          .filter(Boolean)
          .join('\n'),
        Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Одобрить', `adm_prof_app:${p.id}`),
            Markup.button.callback('❌ Отклонить', `adm_prof_rej:${p.id}`),
          ],
        ]),
      );
      if (p.photoUrl) {
        try {
          await ctx.replyWithPhoto(
            p.photoUrl.startsWith('tg:') ? p.photoUrl.slice(3) : p.photoUrl,
          );
        } catch {}
      }
      if (p.voiceSampleUrl?.startsWith('tg:')) {
        try {
          await ctx.replyWithVoice(p.voiceSampleUrl.slice(3));
        } catch {}
      }
      return;
    }

    // Админка: одобрить/отклонить анкету
    if (data.startsWith('adm_prof_app:')) {
      const id = Number(data.split(':')[1]);
      const tgId = String(ctx.from!.id);
      if (!isAdmin(tgId)) {
        await ctx.answerCbQuery?.('Нет прав');
        return;
      }
      const p = await prisma.performerProfile.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          plan: 'BASIC',
          planUntil: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        },
        include: { user: true },
      });
      await ctx.answerCbQuery?.('Одобрено');
      await ctx.editMessageText(`Анкета #${id} одобрена.`);
      try {
        await ctx.telegram.sendMessage(
          Number(p.user.tgId),
          'Анкета одобрена. Ваш 60‑дневный бесплатный период начался сегодня',
        );
      } catch {}
      return;
    }

    if (data.startsWith('adm_prof_rej:')) {
      const id = Number(data.split(':')[1]);
      const tgId = String(ctx.from!.id);
      if (!isAdmin(tgId)) {
        await ctx.answerCbQuery?.('Нет прав');
        return;
      }
      (ctx.session as any).admProfRej = { profileId: id };
      await ctx.answerCbQuery?.();
      await ctx.reply('Укажите причину отклонения анкеты:');
      return;
    }

    if (data.startsWith('adm_prof_rej_do:')) {
      const [, idStr, action] = data.split(':');
      const id = Number(idStr);
      const tgId = String(ctx.from!.id);
      if (!isAdmin(tgId)) {
        await ctx.answerCbQuery?.('Нет прав');
        return;
      }
      const reason = (ctx.session as any).admProfRej?.reason as string | undefined;
      if (!reason) {
        await ctx.answerCbQuery?.('Нет причины');
        return;
      }
      (ctx.session as any).admProfRej = undefined;
      const p = await prisma.performerProfile.update({
        where: { id },
        data: { status: action === 'ban' ? 'BANNED' : 'MODERATION' },
        include: { user: true },
      });
      await ctx.answerCbQuery?.('Отклонено');
      await ctx.editMessageText(`Анкета #${id} отклонена.`);
      try {
        await ctx.telegram.sendMessage(
          Number(p.user.tgId),
          `Ваша анкета отклонена. Причина: ${reason}`,
        );
      } catch {}
      return;
    }

    return next();
  });

  // Принимаем текст от админа при отклонении анкеты или текст жалобы
  bot.on('text', async (ctx, next) => {
    const admRej = (ctx.session as any).admProfRej as { profileId?: number; reason?: string } | undefined;
    if (admRej?.profileId && isAdmin(String(ctx.from?.id))) {
      admRej.reason = (ctx.message as any).text;
      await ctx.reply(
        'Что сделать с анкетой?',
        Markup.inlineKeyboard([
          [Markup.button.callback('🚫 Забанить', `adm_prof_rej_do:${admRej.profileId}:ban`)],
          [Markup.button.callback('↩️ Оставить на модерации', `adm_prof_rej_do:${admRej.profileId}:mod`)],
          [Markup.button.callback('Отмена', 'wiz_cancel')],
        ]),
      );
      return;
    }

    const flow = (ctx.session as any).reportFlow as { targetUserId?: number; requestId?: number } | undefined;
    if (!flow?.targetUserId) return next();
    const reporter = await prisma.user.findUnique({ where: { tgId: String(ctx.from!.id) } });
    if (!reporter) return next();
    const rep = await prisma.report.create({
      data: {
        reporterId: reporter.id,
        targetUserId: flow.targetUserId,
        requestId: flow.requestId,
        text: (ctx.message as any).text,
        category: 'text',
        status: 'pending',
        attachments: [],
      },
    });
    (ctx.session as any).reportFlow = undefined;
    await ctx.reply('Спасибо! Жалоба отправлена на модерацию.');
    // Auto-hide on threshold
    const openCount = await prisma.report.count({ where: { targetUserId: rep.targetUserId, status: 'pending' } });
    if (openCount >= 3) {
      try {
        await prisma.performerProfile.update({ where: { userId: rep.targetUserId! }, data: { status: 'MODERATION' } });
      } catch {}
    }
    for (const admin of config.adminIds) {
      try {
        await ctx.telegram.sendMessage(Number(admin), `⚠️ Новая жалоба #${rep.id} на пользователя ${rep.targetUserId}.`);
      } catch {}
    }
  });

  // Команды админа
  bot.command('admin_profiles', async (ctx) => {
    if (!ctx.from) return;
    if (!isAdmin(String(ctx.from.id))) {
      await ctx.reply('Нет прав.');
      return;
    }
    const text = (ctx.message as any).text as string | undefined;
    const take = Math.min(Number(text?.split(' ')[1]) || 10, 50);
    const list = await prisma.performerProfile.findMany({
      where: { status: 'MODERATION' },
      orderBy: { createdAt: 'desc' },
      take,
      include: { user: true },
    });
    if (!list.length) {
      await ctx.reply('Анкет нет.');
      return;
    }
    for (const p of list) {
      await ctx.reply(
        `#${p.id} · ${p.user.username ? '@' + p.user.username : p.userId}`,
        Markup.inlineKeyboard([[Markup.button.callback('Открыть', `adm_prof_open:${p.id}`)]]),
      );
    }
  });

  bot.command('admin_reports', async (ctx) => {
    if (!ctx.from) return;
    if (!isAdmin(String(ctx.from.id))) {
      await ctx.reply('Нет прав.');
      return;
    }
    const list = await prisma.report.findMany({ orderBy: { createdAt: 'desc' }, take: 10 });
    if (!list.length) {
      await ctx.reply('Жалоб нет.');
      return;
    }
    for (const r of list) {
      await ctx.reply(`#${r.id} · req: ${r.requestId ?? '—'} · ${r.category} · ${r.status}`, Markup.inlineKeyboard([[Markup.button.callback('Открыть', `adm_rep_open:${r.id}`)]]));
    }
  });
};
