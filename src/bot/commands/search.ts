import { Telegraf, Scenes, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { gamesList } from '../keyboards.js';

type SortKey = 'rating' | 'price';

const ONLINE_WINDOW_MIN = 10;

function filtersKeyboard(game: string, f: { onlineOnly?: boolean; priceLe?: number | null; sort?: SortKey }) {
  const onlineTxt = f.onlineOnly ? '🟢 Только online: Вкл' : '⚪︎ Только online: Выкл';
  const priceTxt = f.priceLe ? `Цена ≤ ${f.priceLe}₽` : 'Цена: любая';
  const sortTxt = f.sort === 'price' ? 'Сорт: цена' : 'Сорт: рейтинг';
  return Markup.inlineKeyboard([
    [Markup.button.callback(`🎮 Игра: ${game}`, `sr_game_menu`)],
    [Markup.button.callback(onlineTxt, `sr_toggle_online`)],
    [Markup.button.callback(priceTxt, `sr_price_menu`)],
    [Markup.button.callback(sortTxt, `sr_sort_toggle`)],
    [Markup.button.callback('🔄 Сбросить фильтры', `sr_reset`)],
  ]);
}

function gamesMenuKeyboard() {
  const rows = gamesList.map((g) => [Markup.button.callback(g, `sr_game:${g}`)]);
  rows.push([Markup.button.callback('Назад', 'sr_back_from_game')]);
  return Markup.inlineKeyboard(rows);
}

function priceMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('≤ 500₽', 'sr_price:500')],
    [Markup.button.callback('≤ 700₽', 'sr_price:700')],
    [Markup.button.callback('≤ 1000₽', 'sr_price:1000')],
    [Markup.button.callback('Любая', 'sr_price:any')],
    [Markup.button.callback('Назад', 'sr_back_from_price')],
  ]);
}

async function listProfiles(ctx: any, game: string, f: { onlineOnly?: boolean; priceLe?: number | null; sort?: SortKey }) {
  const me = await prisma.user.upsert({
    where: { tgId: String(ctx.from.id) },
    update: {},
    create: { tgId: String(ctx.from.id), role: 'CLIENT', username: ctx.from.username ?? undefined },
  });

  // Save filters to user prefs
  await prisma.user.update({
    where: { id: me.id },
    data: { searchPrefs: { game, filters: f } },
  });

  const where: any = {
    status: 'ACTIVE',
    games: { has: game },
  };
  if (f.onlineOnly) {
    const threshold = new Date(Date.now() - ONLINE_WINDOW_MIN * 60 * 1000);
    where.user = { is: { lastSeenAt: { gt: threshold } } };
  }
  if (f.priceLe) {
    where.pricePerHour = { lte: f.priceLe };
  }

  const orderBy: any[] = [];
  orderBy.push({ boostUntil: 'desc' });
  if (f.sort === 'price') orderBy.push({ pricePerHour: 'asc' });
  else orderBy.push({ rating: 'desc' });
  orderBy.push({ createdAt: 'desc' });

  const profiles = await prisma.performerProfile.findMany({
    where,
    include: { user: true },
    orderBy,
    take: 10,
  });

  if (!profiles.length) {
    await ctx.replyWithMarkdownV2(`*Нет анкет* по игре ${game} с текущими фильтрами.`);
    await ctx.reply('Измените фильтры:', filtersKeyboard(game, f));
    return;
  }

  await ctx.reply('Фильтры:', filtersKeyboard(game, f));

  for (const p of profiles) {
    const last = p.user.lastSeenAt ? new Date(p.user.lastSeenAt as any) : null;
    const online = last && Date.now() - last.getTime() < ONLINE_WINDOW_MIN * 60 * 1000;
    const header = [
      `🎮 Анкета #${p.id}`,
      `Игры: ${p.games.join(', ')}`,
      `Цена: ${p.pricePerHour}₽/ч`,
      p.about ? `О себе: ${p.about}` : undefined,
      p.rating ? `Рейтинг: ${p.rating.toFixed(1)}` : undefined,
      online ? '🟢 online' : '⚪︎ оффлайн',
    ].filter(Boolean).join('\n');

    await ctx.reply(
      header,
      Markup.inlineKeyboard([
        [Markup.button.callback('Оставить заявку', `req_pf:${p.userId}`)],
        [Markup.button.callback('Отзывы', `view_reviews:${p.userId}`)],
        [Markup.button.callback('Пожаловаться', `report_user:${p.userId}`)],
      ]),
    );
  }
}

export const registerSearch = (bot: Telegraf, stage: Scenes.Stage) => {
  bot.command('search', async (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '/search';
    const arg = text.split(' ').slice(1).join(' ').trim();

    const defaultFilters: { onlineOnly?: boolean; priceLe?: number | null; sort?: SortKey } = {
      onlineOnly: false,
      priceLe: null,
      sort: 'rating',
    };

    let game = (arg && gamesList.find((g) => g.toLowerCase() === arg.toLowerCase())) || gamesList[0];
    const me = await prisma.user.upsert({
      where: { tgId: String(ctx.from!.id) },
      update: {},
      create: { tgId: String(ctx.from!.id), role: 'CLIENT', username: ctx.from!.username ?? undefined },
    });

    const prefs: any = me.searchPrefs ?? {};
    if (!arg && prefs?.game && gamesList.includes(prefs.game)) game = prefs.game;

    const f = Object.assign({}, defaultFilters, prefs?.filters || {});
    await listProfiles(ctx, game, f);
  });

  bot.on('callback_query', async (ctx, next) => {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    if (!data) return next();

    // MISSING BEFORE: 'req_pf' -> вход в мастер заявки
    if (data.startsWith('req_pf:')) {
      const performerUserId = Number(data.split(':')[1]);
      await ctx.answerCbQuery?.();
      await ctx.scene.enter('requestWizard', { performerUserId });
      return;
    }

    const me = await prisma.user.findUnique({ where: { tgId: String(ctx.from!.id) } });
    const prefs: any = me?.searchPrefs ?? {};
    let game = prefs?.game && gamesList.includes(prefs.game) ? prefs.game : gamesList[0];
    let f: any = Object.assign({ onlineOnly: false, priceLe: null, sort: 'rating' }, prefs?.filters || {});

    if (data === 'sr_game_menu') {
      await ctx.editMessageText('Выберите игру:', gamesMenuKeyboard());
      return;
    }
    if (data.startsWith('sr_game:')) {
      game = data.split(':')[1];
      await ctx.answerCbQuery?.(`Игра: ${game}`);
      await listProfiles(ctx, game, f);
      return;
    }
    if (data === 'sr_back_from_game') {
      await listProfiles(ctx, game, f);
      return;
    }

    if (data === 'sr_toggle_online') {
      f.onlineOnly = !f.onlineOnly;
      await ctx.answerCbQuery?.(f.onlineOnly ? 'Только online: Вкл' : 'Только online: Выкл');
      await listProfiles(ctx, game, f);
      return;
    }

    if (data === 'sr_price_menu') {
      await ctx.editMessageText('Выберите фильтр по цене (верхняя граница):', priceMenuKeyboard());
      return;
    }
    if (data.startsWith('sr_price:')) {
      const val = data.split(':')[1];
      f.priceLe = val === 'any' ? null : Number(val);
      await ctx.answerCbQuery?.(f.priceLe ? `Цена ≤ ${f.priceLe}₽` : 'Цена: любая');
      await listProfiles(ctx, game, f);
      return;
    }
    if (data === 'sr_back_from_price') {
      await listProfiles(ctx, game, f);
      return;
    }

    if (data === 'sr_sort_toggle') {
      f.sort = f.sort === 'price' ? 'rating' : 'price';
      await ctx.answerCbQuery?.(f.sort === 'price' ? 'Сорт: цена' : 'Сорт: рейтинг');
      await listProfiles(ctx, game, f);
      return;
    }

    if (data === 'sr_reset') {
      f = { onlineOnly: false, priceLe: null, sort: 'rating' };
      await ctx.answerCbQuery?.('Фильтры сброшены');
      await listProfiles(ctx, game, f);
      return;
    }

    return next();
  });
};
