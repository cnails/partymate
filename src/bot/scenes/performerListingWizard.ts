import { Scenes, Markup, Composer } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { formatListingStatus, yesNoEmoji } from '../utils/format.js';

async function showMenu(ctx: Scenes.WizardContext) {
  if (!ctx.from) return;
  const u = await prisma.user.findUnique({
    where: { tgId: String(ctx.from.id) },
    include: { performerProfile: true },
  });
  if (!u || u.role !== 'PERFORMER') {
    await ctx.reply('Эта функция доступна только исполнительницам. Пройдите онбординг.');
    return ctx.scene.leave();
  }
  const p = u.performerProfile;
  if (!p) {
    await ctx.reply('Профиль не найден. Запустите онбординг заново: /start');
    return ctx.scene.leave();
  }
  await ctx.reply(
    [
      `Статус: ${formatListingStatus(p.status)}`,
      `Цена: ${p.pricePerHour}₽/час`,
      `О себе: ${p.about ?? '—'}`,
      `Реквизиты по умолчанию: ${yesNoEmoji(!!p.defaultPayInstructions)}`,
      '',
      'Выберите поле для редактирования:',
    ].join('\n'),
    Markup.inlineKeyboard([
      [Markup.button.callback('Цена', 'edit_price')],
      [Markup.button.callback('Описание', 'edit_about')],
      [Markup.button.callback('Готово', 'done')],
    ]),
  );
}

export const performerListingWizard = new Scenes.WizardScene<Scenes.WizardContext>(
  'performerListingWizard',
  async (ctx) => {
    await showMenu(ctx);
    return ctx.wizard.next();
  },
  new Composer<Scenes.WizardContext>()
    .action('edit_price', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply('Напишите новую цену (числом) или "skip".');
      ctx.wizard.selectStep(2);
    })
    .action('edit_about', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply('Отправьте короткое описание или "skip".');
      ctx.wizard.selectStep(3);
    })
    .action('done', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply('Готово. Статус анкеты можно посмотреть командой /listing. Управляйте галереей: /gallery');
      return ctx.scene.leave();
    }),
  async (ctx) => {
    if (!ctx.from) return;
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : '';
    if (text.toLowerCase() !== 'skip') {
      const price = Number(text.replace(/[^0-9]/g, ''));
      if (price > 0) {
        const u = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) } });
        if (u) {
          await prisma.performerProfile.update({
            where: { userId: u.id },
            data: { pricePerHour: price },
          });
        }
        await ctx.reply(`Цена обновлена: ${price}₽/час.`);
      } else {
        await ctx.reply('Цена не распознана. Пропускаю.');
      }
    }
    await showMenu(ctx);
    ctx.wizard.selectStep(1);
  },
  async (ctx) => {
    if (!ctx.from) return;
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : '';
    if (text.toLowerCase() !== 'skip') {
      const u = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) } });
      if (u) {
        await prisma.performerProfile.update({
          where: { userId: u.id },
          data: { about: text },
        });
      }
      await ctx.reply('Описание обновлено.');
    }
    await showMenu(ctx);
    ctx.wizard.selectStep(1);
  },
);

