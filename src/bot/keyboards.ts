import { Markup } from 'telegraf';

export const roleKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('👤 Я ищу напарницу', 'role_client')],
    [Markup.button.callback('🎮 Я исполнительница (18+)', 'role_performer')],
  ]);

export const yesNoKeyboard = (yesCb: string, noCb: string) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('Да', yesCb), Markup.button.callback('Нет', noCb)],
  ]);

export const gamesList = ['CS2', 'Dota 2', 'Valorant', 'LoL'] as const;
