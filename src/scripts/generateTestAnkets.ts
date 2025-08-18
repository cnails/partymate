import { PrismaClient, Role, ListingStatus } from '@prisma/client';

const prisma = new PrismaClient();

const games = ['CS2', 'Dota 2', 'Valorant', 'Fortnite', 'League of Legends'];
const descriptions = [
  'Привет! Буду твоей милой тиммейткой, всегда поддержу и подарю улыбку.',
  'Обожаю помогать в игре, стану заботливой саппорткой и подниму тебе настроение.',
  'Я внимательная девочка-стратег, вместе разберём ошибки и станем сильнее.',
  'Улыбчивая снайперша, попадание с первого выстрела и чуть-чуть шуток.',
  'Очень дружелюбная, с радостью обучу новеньких и поддержу каждого.',
  'Всегда гибкая и позитивная, легко подстроюсь под твой стиль игры.',
  'Немного киберкоуч, с теплотой тренирую и мотивирую к победе.',
  'Всегда на связи и с добрым словом, чтобы тебе было комфортно.',
  'Я как игровой психолог, выслушаю и помогу пережить поражения.',
  'Постоянно учусь и вместе с тобой стремлюсь к победам с улыбкой.',
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
