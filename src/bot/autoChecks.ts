import { prisma } from '../services/prisma.js';

const BANNED_PATTERNS: RegExp[] = [
  /(nsfw|эрот|интим|sex|секс|escort|эскорт)/i,
  /(18\+\s*контент|порно|порн)/i,
  /(донат|donat|donation)/i,
];

const CONTACT_PATTERNS: RegExp[] = [
  /@\w{3,}/i,
  /https?:\/\//i,
  /(tg|телеграм|telegram)/i,
  /(\+?\d[\d\s\-()]{7,})/i, // телефон
];

export type AutoCheckResult = { flagged: boolean; reasons: string[] };

export async function runProfileAutoChecks(performerId: number): Promise<AutoCheckResult> {
  const p = await prisma.performerProfile.findUnique({ where: { id: performerId }, include: { user: true } });
  if (!p) return { flagged: false, reasons: [] };
  const reasons: string[] = [];

  const about = p.about || '';
  if (BANNED_PATTERNS.some((rx) => rx.test(about))) reasons.push('NSFW/Adult в описании');
  if (CONTACT_PATTERNS.some((rx) => rx.test(about))) reasons.push('Запрещённый обмен контактами в описании');
  if (!p.photoUrl) reasons.push('Нет фото');
  if (!p.voiceSampleUrl) reasons.push('Нет голосового сэмпла');
  if ((p.games?.length || 0) === 0) reasons.push('Не выбраны услуги');

  const flagged = reasons.length > 0;
  if (flagged) {
    await prisma.performerProfile.update({ where: { id: p.id }, data: { status: 'MODERATION' } });
  }
  return { flagged, reasons };
}
