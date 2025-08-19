import { prisma } from './prisma.js';

/**
 * Clears expired boost and plan statuses for performer profile.
 * @param performerId performer profile identifier
 */
export async function clearExpiredStatuses(performerId: number) {
  const now = new Date();

  await prisma.performerProfile.updateMany({
    where: { id: performerId, boostUntil: { lt: now } },
    data: { isBoosted: false, boostUntil: null },
  });

  await prisma.performerProfile.updateMany({
    where: { id: performerId, planUntil: { lt: now } },
    data: { plan: 'BASIC', planUntil: null },
  });
}

