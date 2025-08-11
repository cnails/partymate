export function formatListingStatus(s: string | null | undefined): string {
  switch (s) {
    case 'DRAFT': return '📝 Черновик';
    case 'MODERATION': return '🛡️ На модерации';
    case 'ACTIVE': return '🟢 Опубликована';
    case 'BANNED': return '⛔️ Заблокирована';
    default: return '—';
  }
}

export function formatRequestStatus(s: string | null | undefined): string {
  switch (s) {
    case 'NEW': return '🆕 Новая';
    case 'NEGOTIATION': return '💬 Переговоры';
    case 'ACCEPTED': return '✅ Принята';
    case 'REJECTED': return '❎ Отклонена';
    case 'COMPLETED': return '🏁 Завершена';
    case 'CANCELED': return '🚫 Отменена';
    default: return '—';
  }
}

export function planBadge(p: string | null | undefined): string {
  if (p === 'PRO') return '🏆 PRO';
  if (p === 'STANDARD') return '⭐️ STANDARD';
  return 'BASIC';
}

export function yesNoEmoji(v: boolean | null | undefined): string {
  return v ? '✅ Да' : '—';
}

export function dateLabel(d?: Date | null, fallback = '—'): string {
  if (!d) return fallback;
  // yyyy-mm-dd HH:mm
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}
