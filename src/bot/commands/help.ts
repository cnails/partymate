import { Telegraf } from 'telegraf';

export const registerHelp = (bot: Telegraf) => {
  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        'Доступные команды:',
        '/start — онбординг',
        '/help — помощь',
        '/become_performer — перейти в онбординг исполнительницы',
        '/listing — (для исполнительниц) управление анкетой',
        '/search — (для клиентов) подбор анкет',
        '/requests — мои заявки',
        '/report — жалоба',
      ].join('\n'),
    );
  });
};