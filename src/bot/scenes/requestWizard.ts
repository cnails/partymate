import { Scenes, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';

interface ReqState extends Scenes.WizardSessionData {
  performerUserId?: number;
  durationMin?: number;
  preferredAt?: Date | null;
  game?: string;
}

function z(n: number) { return String(n).padStart(2, '0'); }
function todayAt(h: number, m: number) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}
function tomorrowAt(h: number, m: number) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(h, m, 0, 0);
  return d;
}
function plusHoursRounded(h: number) {
  const d = new Date(Date.now() + h * 3600 * 1000);
  // округлим до ближайших 15 минут вверх
  const mm = d.getMinutes();
  const add = (15 - (mm % 15)) % 15;
  d.setMinutes(mm + add, 0, 0);
  return d;
}
function parseNaturalDate(input: string): Date | null {
  const t = input.trim().toLowerCase();

  // skip
  if (t === 'skip' || t === 'пропустить') return null;

  // сегодня HH:MM
  let m = t.match(/^сегодня\s+(\d{1,2}):(\d{2})$/i);
  if (m) return todayAt(Number(m[1]), Number(m[2]));

  // завтра HH:MM
  m = t.match(/^завтра\s+(\d{1,2}):(\d{2})$/i);
  if (m) return tomorrowAt(Number(m[1]), Number(m[2]));

  // DD.MM HH:MM   или   DD.MM.YYYY HH:MM
  m = t.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+(\d{1,2}):(\d{2})$/);
  if (m) {
    const day = Number(m[1]), mon = Number(m[2]) - 1, year = m[3] ? Number(m[3]) : new Date().getFullYear();
    const d = new Date(year, mon, day, Number(m[4]), Number(m[5]), 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  // YYYY-MM-DD HH:MM
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  // HH:MM (сегодня; если уже прошло — завтра)
  m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const d = todayAt(Number(m[1]), Number(m[2]));
    if (d.getTime() < Date.now()) return tomorrowAt(Number(m[1]), Number(m[2]));
    return d;
  }

  // Fallback — Date.parse попытается
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

function dateKb() {
  const d1 = plusHoursRounded(2);
  const t1 = `Сегодня +2ч (${z(d1.getHours())}:${z(d1.getMinutes())})`;
  return Markup.inlineKeyboard([
    [Markup.button.callback(t1, `req_time:plus2`)],
    [Markup.button.callback('Сегодня 20:00', 'req_time:today:20:00')],
    [Markup.button.callback('Сегодня 21:00', 'req_time:today:21:00')],
    [Markup.button.callback('Завтра 20:00', 'req_time:tomorrow:20:00')],
    [Markup.button.callback('📝 Указать вручную', 'req_time:manual')],
    [Markup.button.callback('⏭ Пропустить', 'req_time:skip')],
    [Markup.button.callback('Отмена', 'wiz_cancel')],
  ]);
}

export const requestWizard = new Scenes.WizardScene<Scenes.WizardContext & { session: any }>(
  'requestWizard',
  async (ctx) => {
    const init = ctx.scene.state as { performerUserId?: number };
    (ctx.wizard.state as ReqState).performerUserId = init.performerUserId;

    const perf = await prisma.user.findUnique({ where: { id: init.performerUserId }, include: { performerProfile: true } });
    const games = perf?.performerProfile?.games || [];
    const rows = games.map((g) => [Markup.button.callback(g, `req_choose_game:${g}`)]);
    rows.push([Markup.button.callback('Отмена', 'wiz_cancel')]);
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
      [Markup.button.callback('Отмена', 'wiz_cancel')],
    ]));
    return ctx.wizard.next();
  },
  async (ctx) => {
    // шаг выбора длительности
    const data = (ctx.update as any)?.callback_query?.data as string | undefined;
    if (!data || !data.startsWith('req_dur:')) return;
    (ctx.wizard.state as ReqState).durationMin = Number(data.split(':')[1]);
    await ctx.editMessageText(`Длительность: ${(ctx.wizard.state as ReqState).durationMin} мин`);
    await ctx.reply(
      'Когда вам удобно? Выберите один из вариантов или укажите вручную (например: «сегодня 20:00», «12.09 18:00», «20:30»):',
      dateKb(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    // шаг выбора даты — поддерживаем и колбеки, и текст
    let picked: Date | null | undefined;

    const data = (ctx.update as any)?.callback_query?.data as string | undefined;
    if (data && data.startsWith('req_time:')) {
      const parts = data.split(':');
      if (parts[1] === 'plus2') picked = plusHoursRounded(2);
      else if (parts[1] === 'today') {
        const [h, m] = (parts[2] || '20:00').split('-')[0].split('.');
        // на всякий случай fallback:
        const hhmm = parts.slice(2).join(':') || '20:00';
        const [hh, mm] = hhmm.split(':').map(Number);
        picked = todayAt(hh || 20, mm || 0);
      } else if (parts[1] === 'tomorrow') {
        const hhmm = parts.slice(2).join(':') || '20:00';
        const [hh, mm] = hhmm.split(':').map(Number);
        picked = tomorrowAt(hh || 20, mm || 0);
      } else if (parts[1] === 'manual') {
        await ctx.answerCbQuery?.();
        await ctx.reply('Введите время текстом: «сегодня 20:00», «завтра 19:30», «12.09 18:00», «20:30» или «skip».');
        return; // остаёмся на этом же шаге, ждём текст
      } else if (parts[1] === 'skip') {
        picked = null;
      }
    } else if (ctx.message && 'text' in ctx.message) {
      picked = parseNaturalDate(ctx.message.text);
      if (picked === null) {
        // skip
      } else if (!picked) {
        await ctx.reply('Не распознал время. Пример: «сегодня 20:00», «12.09 18:00», «20:30», либо «skip».');
        return; // остаёмся на шаге
      }
    } else {
      return; // ждём корректный ввод
    }

    (ctx.wizard.state as ReqState).preferredAt = picked ?? null;

    if (!ctx.from) return;
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
        preferredAt: picked ?? undefined,
      },
    });

    await prisma.paymentMeta.create({ data: { requestId: req.id, proofUrls: [] } });

    await ctx.reply(`Заявка #${req.id} отправлена. Ожидайте ответа исполнительницы.`);

    const perf = await prisma.user.findUnique({ where: { id: performerUserId! } });
    if (perf) {
      const when = picked ? `Время: ${picked.getFullYear()}-${z(picked.getMonth()+1)}-${z(picked.getDate())} ${z(picked.getHours())}:${z(picked.getMinutes())}` : undefined;
      await (ctx.telegram as any).sendMessage(
        Number(perf.tgId),
        [
          `🆕 Новая заявка #${req.id}`,
          `Игра: ${game}`,
          `Длительность: ${durationMin} мин`,
          when,
        ].filter(Boolean).join('\n'),
        Markup.inlineKeyboard([
          [Markup.button.callback('✅ Принять', `req_accept:${req.id}`)],
          [Markup.button.callback('❎ Отказать', `req_reject:${req.id}`)],
        ]),
      );
    }

    return ctx.scene.leave();
  },
);
