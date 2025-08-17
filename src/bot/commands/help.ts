import { Telegraf } from 'telegraf';
import { prisma } from '../../services/prisma.js';

export const registerHelp = (bot: Telegraf) => {
  bot.command('help', async (ctx) => {
    const user = ctx.from ? await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) } }) : null;
    const role = user?.role;

    const common = [
      '⚙️ Общие команды:',
      '/start — онбординг и быстрые действия',
      '/help — эта справка',
      '/cancel — отменить текущий шаг/мастер',
      '',
      'ℹ️ Подсказки:',
      '• В мастере заявки можно выбирать время кнопками (Сегодня/Завтра) или писать текстом: «сегодня 20:00», «завтра 19:30», «12.09 18:00».',
      '• Статусы заявок: 🆕 новая · 💬 переговоры · ✅ принята · ❎ отклонена · 🏁 завершена · 🚫 отменена.',
      '',
    ].join('\n');

    if (role === 'PERFORMER') {
      await ctx.reply(
        [
          common,
          '🎮 Для исполнительниц:',
          '/listing — управление анкетой (фото и голосовая проба, цена, описание, статус)',
          '/requests — входящие и текущие заявки (чат, оплата)',
          '/billing — тарифы и бусты',
          '/payinfo — реквизиты по умолчанию (автоматически отправляются клиентам)',
        ].join('\n'),
      );
      return;
    }

    if (role === 'ADMIN') {
      await ctx.reply(
        [
          common,
          '🛠 Для админов:',
          '/admin_billing — заказы биллинга (активация/отклонение)',
          // сюда позже можно добавить /admin_moderation
        ].join('\n'),
      );
      return;
    }

    // По умолчанию — для клиентов
    await ctx.reply(
      [
        common,
        '🧑‍💻 Для клиентов:',
        '/search [игра] — найти исполнительницу (например: /search CS2 или просто /search для списка)',
        '/requests — мои заявки (чат и оплата)',
      ].join('\n'),
    );
  });
};
