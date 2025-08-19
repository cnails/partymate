import { Telegraf, Markup } from 'telegraf';
import { prisma } from '../../services/prisma.js';
import { logger } from '../../logger.js';

function mainKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Изменить', 'pi_set')],
    [Markup.button.callback('🗑 Очистить', 'pi_clear')],
    [Markup.button.callback('Закрыть', 'pi_close')],
  ]);
}

export const registerPayinfoCommand = (bot: Telegraf) => {
  bot.command('payinfo', async (ctx) => {
    if (!ctx.from) return;
    logger.info(
      { botId: ctx.botInfo?.id, userId: ctx.from.id, command: 'payinfo' },
      'command received',
    );
    const me = await prisma.user.findUnique({
      where: { tgId: String(ctx.from.id) },
      include: { performerProfile: true },
    });
    if (!me || me.role !== 'PERFORMER' || !me.performerProfile) {
      await ctx.reply('Команда доступна только исполнительницам.');
      return;
    }
    const txt = me.performerProfile.defaultPayInstructions
      ? `💳 Реквизиты по умолчанию:\n${me.performerProfile.defaultPayInstructions}`
      : '💳 Реквизиты по умолчанию не заданы.\nНажмите «Изменить», чтобы указать.';
    await ctx.reply(txt, mainKb());
  });

  bot.on('callback_query', async (ctx, next) => {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    if (!data) return next();
    if (!ctx.from) return next();

    if (data === 'pi_close') {
      await ctx.answerCbQuery?.();
      try { await ctx.editMessageReplyMarkup(undefined); } catch {}
      return;
    }

    const me = await prisma.user.findUnique({
      where: { tgId: String(ctx.from.id) },
      include: { performerProfile: true },
    });
    if (!me?.performerProfile) return next();

    if (data === 'pi_set') {
      (ctx.session as any).awaitingDefaultPayInfo = me.performerProfile.id;
      await ctx.answerCbQuery?.();
      await ctx.reply(
        'Отправьте одним сообщением ваши реквизиты (текст). Пример:\n' +
          'Банк Тинькофф, 5536 **** **** 1234; получатель Иван И.; комментарий: заявка #{ID}',
      );
      return;
    }

    if (data === 'pi_clear') {
      await prisma.performerProfile.update({
        where: { id: me.performerProfile.id },
        data: { defaultPayInstructions: null },
      });
      await ctx.answerCbQuery?.('Очищено');
      await ctx.reply('Реквизиты по умолчанию удалены.', mainKb());
      return;
    }

    return next();
  });

  // Принимаем текст для сохранения реквизитов по умолчанию
  bot.on('text', async (ctx, next) => {
    const perfId = (ctx.session as any).awaitingDefaultPayInfo as number | undefined;
    if (!perfId) return next();
    const text = (ctx.message as any).text?.trim();
    if (!text) {
      await ctx.reply('Пустой текст. Отправьте реквизиты одним сообщением или /cancel.');
      return;
    }
    await prisma.performerProfile.update({
      where: { id: perfId },
      data: { defaultPayInstructions: text },
    });
    (ctx.session as any).awaitingDefaultPayInfo = undefined;
    await ctx.reply('Готово! Реквизиты по умолчанию сохранены. Теперь они будут автоматически высылаться клиентам при принятии заявок.');
  });
};
