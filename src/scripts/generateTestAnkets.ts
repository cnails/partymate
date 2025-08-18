import { PrismaClient, Role, ListingStatus } from '@prisma/client';

const prisma = new PrismaClient();

const games = ['CS2', 'Dota 2', 'Valorant', 'Fortnite', 'League of Legends'];
const descriptions = [
  'Весёлый тиммейт, подниму вам настроение и рейтинг.',
  'Опытный саппорт, всегда помогу выиграть.',
  'Стратег и аналитик — разберу ваши ошибки.',
  'Невероятный снайпер, попадание с первого выстрела.',
  'Дружелюбный игрок, обучу новичков.',
  'Игрок-универсал, подстроюсь под любой стиль.',
  'Специалист по киберспорту, тренирую с нуля.',
  'Всегда позитивный и коммуникабельный.',
  'Игровой психолог: поддержу в сложный момент.',
  'Постоянно совершенствуюсь и веду к победе.',
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function main() {
  const count = randomInt(10, 20);

  for (let i = 0; i < count; i++) {
    const user = await prisma.user.create({
      data: {
        tgId: `test_tg_${Date.now()}_${i}`,
        username: `test_user_${i}`,
        role: Role.PERFORMER,
      },
    });

    const gameCount = randomInt(1, 3);
    const profileGames = [...games].sort(() => 0.5 - Math.random()).slice(0, gameCount);
    const pricePerHour = randomInt(100, 300);
    const rating = parseFloat((Math.random() * 4 + 1).toFixed(1));
    const about = descriptions[Math.floor(Math.random() * descriptions.length)];

    await prisma.performerProfile.create({
      data: {
        userId: user.id,
        games: profileGames,
        pricePerHour,
        status: ListingStatus.ACTIVE,
        rating,
        about,
      },
    });
  }

  console.log(`Created ${count} test ankets`);
}

main()
  .catch((e) => {
    console.error('Failed to generate ankets', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
