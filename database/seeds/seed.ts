import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://surpluss:surpluss_secret@localhost:5432/surpluss';

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

const EVENT_TYPES = ['order.created', 'order.updated', 'payment.processed', 'inventory.updated'];
const SIMULATIONS = ['ok', 'ok', 'ok', 'ok', 'fail_then_succeed:2', 'always_fail', 'slow:5'];

async function seed() {
  console.log('🌱 Seeding database...');

  // Clear existing test data
  await prisma.processedOrder.deleteMany({});
  await prisma.processingAttempt.deleteMany({});
  await prisma.webhookEvent.deleteMany({});

  const events = Array.from({ length: 20 }, () => {
    const simulate = SIMULATIONS[Math.floor(Math.random() * SIMULATIONS.length)];
    const type = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
    const eventId = `seed-${randomUUID()}`;

    return {
      eventId,
      type,
      payload: {
        eventId,
        type,
        data: {
          simulate,
          orderId: randomUUID(),
          amount: Math.floor(Math.random() * 10000) / 100,
        },
      },
      maxAttempts: 5,
      status: 'PENDING' as const,
    };
  });

  for (const event of events) {
    await prisma.webhookEvent.create({ data: event as Parameters<typeof prisma.webhookEvent.create>[0]['data'] });
  }

  console.log(`✅ Seeded ${events.length} webhook events`);
  await prisma.$disconnect();
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
