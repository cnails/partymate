import { Scenes } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { runProfileAutoChecks } from '../autoChecks.js';

export const performerListingWizard = new Scenes.WizardScene<Scenes.WizardContext>(
  'performerListingWizard',
  async (ctx) => {
    if (!ctx.from) return;
    const u = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) }, include: { performerProfile: true } });
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
      `Статус: ${p.status}\nЦена: ${p.pricePerHour}₽/час\nО себе: ${p.about ?? '—'}\n\nНапишите новую цену (числом) или отправьте "skip".`,
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.from) return;
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : '';
    if (text.toLowerCase() !== 'skip') {
      const price = Number(text.replace(/[^0-9]/g, ''));
      if (price > 0) {
        const u = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) } });
        if (u) await prisma.performerProfile.update({ where: { userId: u.id }, data: { pricePerHour: price } });
        await ctx.reply(`Цена обновлена: ${price}₽/час.`);
      } else {
        await ctx.reply('Цена не распознана. Пропускаю.');
      }
    }
    await ctx.reply('Отправьте короткое описание или "skip".');
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.from) return;
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim() : '';
    const u = await prisma.user.findUnique({ where: { tgId: String(ctx.from.id) }, include: { performerProfile: true } });
    if (text.toLowerCase() !== 'skip' && u?.performerProfile) {
      await prisma.performerProfile.update({ where: { userId: u.id }, data: { about: text } });
      await ctx.reply('Описание обновлено.');
      const res = await runProfileAutoChecks(u.performerProfile.id);
      if (res.flagged) {
        await ctx.reply('⚠️ Профиль отправлен на модерацию из-за нарушений в описании/настройках. Мы проверим и сообщим результат.');
      }
    }
    await ctx.reply('Готово. Статус анкеты можно посмотреть командой /listing. Управляйте галереей: /gallery');
    return ctx.scene.leave();
  },
);
