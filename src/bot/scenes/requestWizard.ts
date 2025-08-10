import { Scenes, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';

interface ReqState extends Scenes.WizardSessionData {
  performerUserId?: number;
  durationMin?: number;
  preferredAt?: Date | null;
  game?: string;
}

export const requestWizard = new Scenes.WizardScene<Scenes.WizardContext & { session: any }>(
  'requestWizard',
  async (ctx) => {
    const init = ctx.scene.state as { performerUserId?: number };
    (ctx.wizard.state as ReqState).performerUserId = init.performerUserId;

    const perf = await prisma.user.findUnique({ where: { id: init.performerUserId }, include: { performerProfile: true } });
    const games = perf?.performerProfile?.games || [];
    const rows = games.map((g) => [Markup.button.callback(g, `req_choose_game:${g}`)]);
    await ctx.reply('Выберите игру для заявки:', Markup.inlineKeyboard(rows));
    return ctx.wizard.next();
  },
  async (ctx) => {
    const data = (ctx.update as any)?.callback_query?.data as string | undefined;
    if (!data || !data.startsWith('req_choose_game:')) return;
    (ctx.wizard.state as ReqState).game = data.split(':')[1];
    await ctx.editMessageText(`Игра: ${(ctx.wizard.state as ReqState).game}`);
    await ctx.reply('Выберите длительность:', Markup.inlineKeyboard([
      [Markup.button.callback('60 мин', 'req_dur:60')],
      [Markup.button.callback('90 мин', 'req_dur:90')],
      [Markup.button.callback('120 мин', 'req_dur:120')],
    ]));
    return ctx.wizard.next();
  },
  async (ctx) => {
    const data = (ctx.update as any)?.callback_query?.data as string | undefined;
    if (!data || !data.startsWith('req_dur:')) return;
    (ctx.wizard.state as ReqState).durationMin = Number(data.split(':')[1]);
    await ctx.editMessageText(`Длительность: ${(ctx.wizard.state as ReqState).durationMin} мин`);
    await ctx.reply('Укажите желаемое время (например: 2025-08-08 20:00) или напишите "skip".');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.from) return;
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : 'skip';
    let preferredAt: Date | null = null;
    if (text.toLowerCase() !== 'skip') {
      const parsed = new Date(text);
      if (!isNaN(parsed.getTime())) preferredAt = parsed;
    }
    (ctx.wizard.state as ReqState).preferredAt = preferredAt;

    const { performerUserId, durationMin, game } = (ctx.wizard.state as ReqState);

    const client = await prisma.user.upsert({
      where: { tgId: String(ctx.from.id) },
      update: { role: 'CLIENT', username: ctx.from.username ?? undefined },
      create: { tgId: String(ctx.from.id), role: 'CLIENT', username: ctx.from.username ?? undefined },
    });

    const req = await prisma.request.create({
      data: {
        clientId: client.id,
        performerId: performerUserId!,
        game: game || 'Unknown',
        durationMin: durationMin || 60,
        preferredAt: preferredAt ?? undefined,
      },
    });

    await prisma.paymentMeta.create({ data: { requestId: req.id, proofUrls: [] } });

    await ctx.reply(`Заявка #${req.id} отправлена. Ожидайте ответа исполнительницы.`);

    const perf = await prisma.user.findUnique({ where: { id: performerUserId! } });
    if (perf) {
      await (ctx.telegram as any).sendMessage(
        Number(perf.tgId),
        [
          `🆕 Новая заявка #${req.id}`,
          `Игра: ${game}`,
          `Длительность: ${durationMin} мин`,
          preferredAt ? `Время: ${preferredAt.toISOString().slice(0,16).replace('T', ' ')}` : undefined,
        ].filter(Boolean).join('\n'),
        Markup.inlineKeyboard([
          [Markup.button.callback('Принять', `req_accept:${req.id}`)],
          [Markup.button.callback('Отказать', `req_reject:${req.id}`)],
        ]),
      );
    }

    return ctx.scene.leave();
  },
);
