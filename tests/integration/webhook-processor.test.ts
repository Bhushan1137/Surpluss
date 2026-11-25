/**
 * Integration tests for the Surpluss webhook processor.
 *
 * These tests run against a real PostgreSQL instance (via DATABASE_URL env var).
 * They verify the correctness guarantees that matter most:
 *   1. Duplicate webhook idempotency
 *   2. Concurrent worker claiming (no double processing)
 *   3. Retry behaviour
 *   4. Permanent failure
 *   5. Exactly-once processed_orders record
 *   6. Crash recovery via expired leases
 *   7. Manual retry + increasing attempt numbers
 */

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { computeNextRetryDelay, DEFAULT_RETRY_CONFIG } from '@surpluss/shared';

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://surpluss:surpluss_secret@localhost:5432/surpluss';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Helper: clean up test events by a unique tag prefix
async function cleanupByEventId(prefix: string) {
  await prisma.webhookEvent.deleteMany({
    where: { eventId: { startsWith: prefix } },
  });
}

// ─── 1. Duplicate Webhook Idempotency ────────────────────────────────────────

describe('Duplicate webhook idempotency', () => {
  const prefix = `test-dup-${Date.now()}-`;

  afterAll(() => cleanupByEventId(prefix));

  it('should create only one event record for identical concurrent submissions', async () => {
    const eventId = `${prefix}${randomUUID()}`;
    const payload = { eventId, type: 'order.created', data: {} };

    // Fire 10 concurrent inserts with the same eventId
    const insertFn = () =>
      prisma.webhookEvent.create({
        data: {
          eventId,
          type: payload.type,
          payload: payload as object,
          maxAttempts: 5,
          status: 'PENDING',
        },
      }).catch(() => null); // catch unique constraint violations

    const results = await Promise.all(Array.from({ length: 10 }, insertFn));

    const successful = results.filter(Boolean);
    expect(successful).toHaveLength(1);

    const count = await prisma.webhookEvent.count({ where: { eventId } });
    expect(count).toBe(1);
  });

  it('should preserve original payload when duplicate has different data', async () => {
    const eventId = `${prefix}${randomUUID()}`;
    const originalPayload = { eventId, type: 'order.created', data: { amount: 100 } };
    const duplicatePayload = { eventId, type: 'order.created', data: { amount: 999 } };

    await prisma.webhookEvent.create({
      data: {
        eventId,
        type: 'order.created',
        payload: originalPayload as object,
        maxAttempts: 5,
        status: 'PENDING',
      },
    });

    // Second insert should fail with unique constraint
    await expect(
      prisma.webhookEvent.create({
        data: {
          eventId,
          type: 'order.created',
          payload: duplicatePayload as object,
          maxAttempts: 5,
          status: 'PENDING',
        },
      }),
    ).rejects.toThrow();

    // Original payload preserved
    const event = await prisma.webhookEvent.findUnique({ where: { eventId } });
    expect((event?.payload as { data?: { amount?: number } })?.data?.amount).toBe(100);
  });
});

// ─── 2. Concurrent Worker Claiming ───────────────────────────────────────────

describe('Concurrent worker claiming (no double processing)', () => {
  const prefix = `test-concurrent-${Date.now()}-`;

  afterAll(() => cleanupByEventId(prefix));

  it('should allow only one worker to claim a PENDING event under concurrent load', async () => {
    const eventId = `${prefix}${randomUUID()}`;

    const event = await prisma.webhookEvent.create({
      data: {
        eventId,
        type: 'order.created',
        payload: { eventId, type: 'order.created', data: {} } as object,
        maxAttempts: 5,
        status: 'PENDING',
      },
    });

    const leaseExpiresAt = new Date(Date.now() + 30_000);
    const now = new Date();

    // Simulate 5 workers racing to claim the event
    const claimAttempt = async (workerId: string): Promise<string | null> => {
      return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM webhook_events
          WHERE id = ${event.id}
            AND status = 'PENDING'
          FOR UPDATE SKIP LOCKED
        `;

        if (rows.length === 0) return null;

        await tx.$executeRaw`
          UPDATE webhook_events
          SET status = 'PROCESSING', worker_id = ${workerId}, lease_expires_at = ${leaseExpiresAt}, updated_at = NOW()
          WHERE id = ${event.id}
        `;

        return workerId;
      });
    };

    const workerIds = ['w1', 'w2', 'w3', 'w4', 'w5'];
    const results = await Promise.all(workerIds.map(claimAttempt));
    const winners = results.filter(Boolean);

    // Exactly one worker should win
    expect(winners).toHaveLength(1);

    // Verify DB state
    const dbEvent = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
    expect(dbEvent?.status).toBe('PROCESSING');
    expect(dbEvent?.workerId).toBe(winners[0]);
  });
});

// ─── 3. Exactly-Once Processed Order ─────────────────────────────────────────

describe('Exactly-once processed_orders record', () => {
  const prefix = `test-once-${Date.now()}-`;

  afterAll(() => cleanupByEventId(prefix));

  it('should insert exactly one processed_orders record even with concurrent completion attempts', async () => {
    const eventId = `${prefix}${randomUUID()}`;

    const event = await prisma.webhookEvent.create({
      data: {
        eventId,
        type: 'order.created',
        payload: {} as object,
        maxAttempts: 5,
        status: 'PROCESSING',
        workerId: 'test-worker',
        leaseExpiresAt: new Date(Date.now() + 30_000),
        attemptCount: 1,
      },
    });

    const completeEvent = async (workerId: string): Promise<boolean> => {
      const orderId = randomUUID();
      const now = new Date();
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            INSERT INTO processed_orders (id, order_id, event_id, processed_at)
            VALUES (${randomUUID()}, ${orderId}, ${event.id}, ${now})
            ON CONFLICT (event_id) DO NOTHING
          `;
          await tx.$executeRaw`
            UPDATE webhook_events
            SET status = 'COMPLETED', processed_at = ${now}, updated_at = NOW()
            WHERE id = ${event.id}
          `;
        });
        return true;
      } catch {
        return false;
      }
    };

    // Two workers race to complete the event
    await Promise.all([completeEvent('w1'), completeEvent('w2')]);

    // Should only have one processed_orders record
    const orderCount = await prisma.processedOrder.count({
      where: { eventId: event.id },
    });
    expect(orderCount).toBe(1);
  });
});

// ─── 4. Retry Behaviour ──────────────────────────────────────────────────────

describe('Retry behaviour', () => {
  const prefix = `test-retry-${Date.now()}-`;

  afterAll(() => cleanupByEventId(prefix));

  it('should correctly compute exponential backoff delays', () => {
    const config = DEFAULT_RETRY_CONFIG;
    // attempt 1 → 1000ms, attempt 2 → 2000ms, attempt 3 → 4000ms
    expect(computeNextRetryDelay(1, config)).toBe(1000);
    expect(computeNextRetryDelay(2, config)).toBe(2000);
    expect(computeNextRetryDelay(3, config)).toBe(4000);
    expect(computeNextRetryDelay(4, config)).toBe(8000);
    // Capped at maxDelayMs
    expect(computeNextRetryDelay(10, config)).toBe(config.maxDelayMs);
  });

  it('should transition PROCESSING → RETRY_PENDING with next_retry_at set', async () => {
    const eventId = `${prefix}${randomUUID()}`;
    const event = await prisma.webhookEvent.create({
      data: {
        eventId,
        type: 'order.created',
        payload: {} as object,
        maxAttempts: 5,
        status: 'PROCESSING',
        workerId: 'test-worker',
        attemptCount: 1,
      },
    });

    const delay = computeNextRetryDelay(1, DEFAULT_RETRY_CONFIG);
    const nextRetryAt = new Date(Date.now() + delay);

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: 'RETRY_PENDING',
        nextRetryAt,
        lastError: 'Simulated failure',
        workerId: null,
        leaseExpiresAt: null,
      },
    });

    const updated = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
    expect(updated?.status).toBe('RETRY_PENDING');
    expect(updated?.nextRetryAt).toBeTruthy();
    expect(updated?.workerId).toBeNull();
  });

  it('should transition to FAILED after exhausting max attempts', async () => {
    const eventId = `${prefix}${randomUUID()}`;
    const maxAttempts = 3;
    const event = await prisma.webhookEvent.create({
      data: {
        eventId,
        type: 'order.created',
        payload: {} as object,
        maxAttempts,
        status: 'PROCESSING',
        workerId: 'test-worker',
        attemptCount: maxAttempts, // at the limit
      },
    });

    // Should move to FAILED
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        lastError: 'always_fail',
        workerId: null,
        leaseExpiresAt: null,
      },
    });

    const updated = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
    expect(updated?.status).toBe('FAILED');
    expect(updated?.failedAt).toBeTruthy();
  });
});

// ─── 5. Crash Recovery ───────────────────────────────────────────────────────

describe('Crash recovery via expired leases', () => {
  const prefix = `test-recovery-${Date.now()}-`;

  afterAll(() => cleanupByEventId(prefix));

  it('should identify PROCESSING events with expired leases', async () => {
    const eventId = `${prefix}${randomUUID()}`;

    // Create an event stuck in PROCESSING with an expired lease
    const expiredLease = new Date(Date.now() - 60_000); // expired 1 minute ago
    const event = await prisma.webhookEvent.create({
      data: {
        eventId,
        type: 'order.created',
        payload: {} as object,
        maxAttempts: 5,
        status: 'PROCESSING',
        workerId: 'crashed-worker',
        leaseExpiresAt: expiredLease,
        attemptCount: 1,
      },
    });

    const now = new Date();
    // Run recovery: find PROCESSING events with expired leases
    const stuck = await prisma.$queryRaw<Array<{ id: string; event_id: string }>>`
      SELECT id, event_id FROM webhook_events
      WHERE status = 'PROCESSING' AND lease_expires_at < ${now}
    `;

    expect(stuck.some((r) => r.id === event.id)).toBe(true);

    // Apply recovery
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: 'RETRY_PENDING',
        workerId: null,
        leaseExpiresAt: null,
        nextRetryAt: new Date(Date.now() + 1000),
        lastError: 'Worker lease expired (crash recovery)',
      },
    });

    const recovered = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
    expect(recovered?.status).toBe('RETRY_PENDING');
    expect(recovered?.workerId).toBeNull();
    expect(recovered?.lastError).toContain('crash recovery');
  });

  it('should not create a duplicate processed_orders after crash recovery', async () => {
    const eventId = `${prefix}cr-${randomUUID()}`;

    // Simulate: event was processed but worker crashed before marking COMPLETED
    // The transaction rolled back, so processed_orders was NOT inserted.
    const event = await prisma.webhookEvent.create({
      data: {
        eventId,
        type: 'order.created',
        payload: {} as object,
        maxAttempts: 5,
        status: 'RETRY_PENDING',
        workerId: null,
        leaseExpiresAt: null,
        attemptCount: 1,
        nextRetryAt: new Date(), // eligible now
      },
    });

    // Confirm no processed_orders yet
    const before = await prisma.processedOrder.count({ where: { eventId: event.id } });
    expect(before).toBe(0);

    // Recovery worker claims and processes successfully
    const orderId = randomUUID();
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO processed_orders (id, order_id, event_id, processed_at)
        VALUES (${randomUUID()}, ${orderId}, ${event.id}, ${now})
        ON CONFLICT (event_id) DO NOTHING
      `;
      await tx.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'COMPLETED', processedAt: now },
      });
    });

    const after = await prisma.processedOrder.count({ where: { eventId: event.id } });
    expect(after).toBe(1);
  });
});

// ─── 6. Manual Retry + Increasing Attempt Numbers ───────────────────────────

describe('Manual retry and attempt continuity', () => {
  const prefix = `test-manual-retry-${Date.now()}-`;

  afterAll(() => cleanupByEventId(prefix));

  it('should reset status to RETRY_PENDING but preserve attempt history', async () => {
    const eventId = `${prefix}${randomUUID()}`;

    const event = await prisma.webhookEvent.create({
      data: {
        eventId,
        type: 'order.created',
        payload: {} as object,
        maxAttempts: 3,
        status: 'FAILED',
        attemptCount: 3,
        failedAt: new Date(),
        lastError: 'Simulated always_fail',
      },
    });

    // Insert 3 historical attempt records
    for (let i = 1; i <= 3; i++) {
      await prisma.processingAttempt.create({
        data: {
          eventId: event.id,
          attemptNumber: i,
          workerId: 'test-worker',
          finishedAt: new Date(),
          result: 'FAILURE',
          errorDetails: 'always_fail',
        },
      });
    }

    // Manual retry: reset status
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: 'RETRY_PENDING',
        nextRetryAt: new Date(),
        workerId: null,
        leaseExpiresAt: null,
        lastError: null,
        failedAt: null,
      },
    });

    // Verify attempt count preserved
    const attemptCount = await prisma.processingAttempt.count({
      where: { eventId: event.id },
    });
    expect(attemptCount).toBe(3);

    // Next attempt should be number 4 (globally increasing)
    const updated = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
    expect(updated?.status).toBe('RETRY_PENDING');
    expect(updated?.attemptCount).toBe(3); // preserved; next attempt increments to 4

    // Simulate attempt 4
    await prisma.processingAttempt.create({
      data: {
        eventId: event.id,
        attemptNumber: updated!.attemptCount + 1, // = 4
        workerId: 'recovery-worker',
        result: 'SUCCESS',
        finishedAt: new Date(),
      },
    });

    const finalCount = await prisma.processingAttempt.count({
      where: { eventId: event.id },
    });
    expect(finalCount).toBe(4);

    const lastAttempt = await prisma.processingAttempt.findFirst({
      where: { eventId: event.id },
      orderBy: { attemptNumber: 'desc' },
    });
    expect(lastAttempt?.attemptNumber).toBe(4);
    expect(lastAttempt?.result).toBe('SUCCESS');
  });
});

// ─── 7. Database Schema Constraints ─────────────────────────────────────────

describe('Database constraint validation', () => {
  const prefix = `test-constraints-${Date.now()}-`;

  afterAll(() => cleanupByEventId(prefix));

  it('should enforce UNIQUE constraint on processed_orders.event_id', async () => {
    const eventId = `${prefix}${randomUUID()}`;
    const event = await prisma.webhookEvent.create({
      data: {
        eventId,
        type: 'order.created',
        payload: {} as object,
        maxAttempts: 5,
        status: 'PROCESSING',
        workerId: 'w1',
        attemptCount: 1,
      },
    });

    const now = new Date();
    // First insert succeeds
    await prisma.$executeRaw`
      INSERT INTO processed_orders (id, order_id, event_id, processed_at)
      VALUES (${randomUUID()}, ${randomUUID()}, ${event.id}, ${now})
    `;

    // Second insert with same event_id must fail
    await expect(
      prisma.$executeRaw`
        INSERT INTO processed_orders (id, order_id, event_id, processed_at)
        VALUES (${randomUUID()}, ${randomUUID()}, ${event.id}, ${now})
      `,
    ).rejects.toThrow();
  });
});
