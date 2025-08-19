import { prisma } from '../services/prisma.js';

/**
 * Daily job to reset expired boosts and plans.
 * Should be run by a cron scheduler.
 */
export async function expireBoostsPlans() {
  const now = new Date();

  await prisma.performerProfile.updateMany({
    where: { isBoosted: true, boostUntil: { lt: now } },
    data: { isBoosted: false, boostUntil: null },
  });

  await prisma.performerProfile.updateMany({
    where: { plan: { not: 'BASIC' }, planUntil: { lt: now } },
    data: { plan: 'BASIC', planUntil: null },
  });
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  expireBoostsPlans().finally(() => prisma.$disconnect());
}

