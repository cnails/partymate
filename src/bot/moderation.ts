import { Telegraf, Markup } from 'telegraf';
import { ReportStatus } from '@prisma/client';
import { prisma } from '../services/prisma.js';
import { config } from '../config.js';

const isAdmin = (tgId: string) => config.adminIds.includes(tgId);

export const registerModeration = (bot: Telegraf) => {
  const finishReport = async (
    ctx: any,
    flow: {
      targetUserId: number;
      requestId?: number;
      attachments?: string[];
      category?: string;
    },
    text?: string,
  ) => {
    const reporter = await prisma.user.findUnique({ where: { tgId: String(ctx.from!.id) } });
    if (!reporter) return;
    const rep = await prisma.report.create({
      data: {
        reporterId: reporter.id,
        targetUserId: flow.targetUserId,
        requestId: flow.requestId,
        text,
        category: flow.category || 'other',
        status: ReportStatus.PENDING,
        attachments: flow.attachments ?? [],
      },
    });
    (ctx.session as any).reportFlow = undefined;
    await ctx.reply('Спасибо! Жалоба отправлена на модерацию.');
    // Auto-hide on threshold
    const openCount = await prisma.report.count({ where: { targetUserId: rep.targetUserId, status: ReportStatus.PENDING } });
    if (openCount >= 3) {
      try {
        await prisma.performerProfile.update({ where: { userId: rep.targetUserId! }, data: { status: 'MODERATION' } });
      } catch {}
    }
    for (const admin of config.adminIds) {
      try {
        await ctx.telegram.sendMessage(
          Number(admin),
          `⚠️ Новая жалоба #${rep.id} на пользователя ${rep.targetUserId} (категория: ${rep.category}).`,
        );
      } catch {}
    }
  };

  const openReport = async (ctx: any, id: number) => {
    const r = (await prisma.report.findUnique({
      where: { id },
      include: { reporter: true, targetUser: true },
    })) as any;
    if (!r) {
      await ctx.reply('Не найдено');
      return;
    }
    let openCount = 0;
    if (r.targetUserId) {
      openCount = await prisma.report.count({
        where: { targetUserId: r.targetUserId, status: ReportStatus.PENDING },
      });
    }
    const profile = r.targetUserId
      ? await prisma.performerProfile.findUnique({ where: { userId: r.targetUserId } })
      : null;
    const buttons: any[] = [
      [
        Markup.button.callback('✅ Принять', `adm_rep_res:${id}:accept`),
        Markup.button.callback('❌ Отклонить', `adm_rep_res:${id}:reject`),
      ],
    ];
    if (r.targetUserId) {
      const row: any[] = [
        Markup.button.callback(
          'История',
          `adm_rep_list:1:-:-:${r.targetUserId}`,
        ),
      ];
      if (profile) {
        row.push(Markup.button.callback('Анкета', `adm_prof_open:${profile.id}`));
      }
      buttons.push(row);
    }
    await ctx.reply(
      [
        `#${r.id} · статус: ${r.status}`,
        `Категория: ${r.category}`,
        `Текст: ${r.text || '—'}`,
        `От: ${r.reporter.username ? '@' + r.reporter.username : r.reporterId}`,
        `Против: ${r.targetUser?.username ? '@' + r.targetUser.username : r.targetUserId}`,
        `Заявка: ${r.requestId ? '#' + r.requestId : '—'}`,
        r.targetUserId ? `Открытых жалоб на пользователя: ${openCount}` : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
      Markup.inlineKeyboard(buttons),
    );
    if (r.attachments?.length) {
      const links: string[] = [];
      for (const f of r.attachments) {
        try {
          const l = await ctx.telegram.getFileLink(f);
          links.push(String(l));
        } catch {}
      }
      if (links.length) {
        await ctx.reply('Вложения:\n' + links.join('\n'));
      }
    }
  };

  const listReports = async (
    ctx: any,
    filters: { status?: ReportStatus; category?: string; user?: number },
    page = 1,
  ) => {
    const take = 10;
    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.category) where.category = filters.category;
    if (filters.user) where.targetUserId = filters.user;
    const list = await prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * take,
      take,
    });
    if (!list.length) {
      await ctx.reply('Жалоб нет.');
      return;
    }
    for (const r of list) {
      await ctx.reply(
        `#${r.id} · req: ${r.requestId ?? '—'} · ${r.category} · ${r.status}`,
        Markup.inlineKeyboard([[Markup.button.callback('Открыть', `adm_rep_open:${r.id}`)]]),
      );
    }
    const total = await prisma.report.count({ where });
    const maxPage = Math.max(1, Math.ceil(total / take));
    if (maxPage > 1) {
      const nav: any[] = [];
      const st = filters.status || '-';
      const cat = filters.category || '-';
      const usr = filters.user ? String(filters.user) : '-';
      if (page > 1)
        nav.push(
          Markup.button.callback('⬅️', `adm_rep_list:${page - 1}:${st}:${cat}:${usr}`),
        );
      if (page < maxPage)
        nav.push(
          Markup.button.callback('➡️', `adm_rep_list:${page + 1}:${st}:${cat}:${usr}`),
        );
      await ctx.reply(`Страница ${page}/${maxPage}`, Markup.inlineKeyboard([nav]));
    } else {
      await ctx.reply(`Страница ${page}/${maxPage}`);
    }
  };
  // Кнопка "Пожаловаться" на анкете
  bot.on('callback_query', async (ctx, next) => {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    if (!data) return next();

    // Жалоба на пользователя с анкеты
    if (data.startsWith('report_user:')) {
      const targetUserId = Number(data.split(':')[1]);
      (ctx.session as any).reportFlow = { targetUserId, attachments: [], requireText: true };
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
      (ctx.session as any).reportFlow = { targetUserId, requestId, attachments: [], requireText: true };
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
      const flow = (ctx.session as any).reportFlow as {
        targetUserId?: number;
        requestId?: number;
        attachments?: string[];
        category?: string;
        requireText?: boolean;
      } | undefined;
      if (!flow?.targetUserId) {
        await ctx.answerCbQuery?.('Нет контекста жалобы');
        return;
      }
      flow.category = cat;
      flow.requireText = cat === 'other';
      await ctx.answerCbQuery?.();
      await ctx.editMessageText(
        flow.requireText
          ? 'Категория сохранена. Опишите проблему текстом (можно добавить медиа).'
          : 'Категория сохранена. Опишите проблему или отправьте медиа.',
      );
      return;
    }

    // Админка: список репортов (пагинация/история)
    if (data.startsWith('adm_rep_list:')) {
      const [, pageStr, status, category, userStr] = data.split(':');
      const tgId = String(ctx.from!.id);
      if (!isAdmin(tgId)) {
        await ctx.answerCbQuery?.('Нет прав');
        return;
      }
      const page = Number(pageStr);
      const st = status === '-' ? undefined : (status as ReportStatus);
      const cat = category === '-' ? undefined : category;
      const user = userStr === '-' ? undefined : Number(userStr);
      await ctx.answerCbQuery?.();
      await listReports(ctx, { status: st, category: cat, user }, page);
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
      await ctx.answerCbQuery?.();
      await openReport(ctx, id);
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
      (ctx.session as any).admRepRes = { id, res };
      await ctx.answerCbQuery?.();
      await ctx.reply('Введите комментарий к решению:');
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
          `Услуги: ${p.games.join(', ') || '—'}`,
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

  // Собираем медиа в жалобе
  bot.on(['photo', 'document', 'video', 'audio', 'voice'], async (ctx, next) => {
    const flow = (ctx.session as any).reportFlow as {
      targetUserId?: number;
      requestId?: number;
      attachments?: string[];
      category?: string;
      requireText?: boolean;
    } | undefined;
    if (!flow?.targetUserId) return next();
    const msg = ctx.message as any;
    let fileId: string | undefined;
    if (msg.photo) fileId = msg.photo[msg.photo.length - 1].file_id;
    else if (msg.document) fileId = msg.document.file_id;
    else if (msg.video) fileId = msg.video.file_id;
    else if (msg.audio) fileId = msg.audio.file_id;
    else if (msg.voice) fileId = msg.voice.file_id;
    if (fileId) {
      flow.attachments = [...(flow.attachments ?? []), fileId];
      if (flow.requireText) {
        await ctx.reply('Медиа сохранено. Пожалуйста, опишите проблему текстом.');
        return;
      }
      await finishReport(ctx, flow);
    }
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

    const admRepRes = (ctx.session as any).admRepRes as { id?: number; res?: string } | undefined;
    if (admRepRes?.id && isAdmin(String(ctx.from?.id))) {
      const comment = (ctx.message as any).text as string;
      const admin = await prisma.user.findUnique({ where: { tgId: String(ctx.from!.id) } });
      const r = await prisma.report.update({
        where: { id: admRepRes.id },
        data: {
          status: admRepRes.res === 'accept' ? ReportStatus.RESOLVED : ReportStatus.REJECTED,
          resolvedBy: admin?.id,
          resolutionComment: comment,
        },
        include: { reporter: true, targetUser: true },
      });
      (ctx.session as any).admRepRes = undefined;
      await ctx.reply(`Репорт #${r.id} → ${admRepRes.res}.`);
      if (admRepRes.res === 'accept' && r.targetUserId) {
        try {
          await prisma.performerProfile.update({
            where: { userId: r.targetUserId },
            data: { status: 'MODERATION' },
          });
        } catch {}
      }
      return;
    }

    const flow = (ctx.session as any).reportFlow as {
      targetUserId?: number;
      requestId?: number;
      attachments?: string[];
      category?: string;
      requireText?: boolean;
    } | undefined;
    if (!flow?.targetUserId) return next();
    const text = (ctx.message as any).text as string;
    if (text.startsWith('/')) return next();
    await finishReport(ctx, flow, text);
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
    const text = (ctx.message as any).text as string | undefined;
    const args = text?.split(' ').slice(1) ?? [];
    const params: any = {};
    for (const a of args) {
      const [k, v] = a.split('=');
      if (k && v) params[k] = v;
    }
    const page = Number(params.page) || 1;
    const status = params.status as ReportStatus | undefined;
    const category = params.category as string | undefined;
    const user = params.user ? Number(params.user) : undefined;
    await listReports(ctx, { status, category, user }, page);
  });

  bot.command('admin_report', async (ctx) => {
    if (!ctx.from) return;
    if (!isAdmin(String(ctx.from.id))) {
      await ctx.reply('Нет прав.');
      return;
    }
    const text = (ctx.message as any).text as string | undefined;
    const id = Number(text?.split(' ')[1]);
    if (!id) {
      await ctx.reply('Укажите ID');
      return;
    }
    await openReport(ctx, id);
  });
};
