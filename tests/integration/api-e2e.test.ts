/**
 * HTTP API & end-to-end integration tests against the running API and PostgreSQL.
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://surpluss:surpluss_secret@localhost:5432/surpluss';

let prisma: PrismaClient;
const createdPrefixes: string[] = [];

beforeAll(async () => {
  prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  await prisma.$connect();
});

afterAll(async () => {
  for (const prefix of createdPrefixes) {
    await prisma.webhookEvent.deleteMany({
      where: { eventId: { startsWith: prefix } },
    });
  }
  await prisma.$disconnect();
});

describe('API Health & Ingestion Validation', () => {
  const prefix = `api-test-${Date.now()}-`;
  createdPrefixes.push(prefix);

  it('GET /health returns ok with database connected', async () => {
    const res = await request(API_URL).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('connected');
  });

  it('POST /webhooks accepts valid payload with 202 and deduplicates concurrent deliveries', async () => {
    const eventId = `${prefix}${randomUUID()}`;
    const payload = {
      eventId,
      type: 'order.created',
      data: { orderId: 'ORD-API-1', simulate: 'ok' },
    };

    const responses = await Promise.all([
      request(API_URL).post('/webhooks').send(payload),
      request(API_URL).post('/webhooks').send({
        eventId,
        type: 'order.created',
        data: { orderId: 'ORD-DIFF', simulate: 'always_fail' },
      }),
      request(API_URL).post('/webhooks').send(payload),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data.eventId).toBe(eventId);
    }

    const nonDuplicates = responses.filter((r) => r.body.data.duplicate === false);
    const duplicates = responses.filter((r) => r.body.data.duplicate === true);
    expect(nonDuplicates).toHaveLength(1);
    expect(duplicates).toHaveLength(2);

    const dbEvent = await prisma.webhookEvent.findUnique({ where: { eventId } });
    expect((dbEvent?.payload as { data?: { orderId?: string } })?.data?.orderId).toBe('ORD-API-1');
  });

  it('POST /webhooks rejects invalid inputs with 400', async () => {
    const invalidCases = [
      {},
      { type: 'order.created' },
      { eventId: 'evt-no-type' },
      { eventId: '   ', type: 'order.created' },
      { eventId: 'evt-ws-type', type: '   ' },
      { eventId: 'evt-arr', type: 'order.created', data: ['not', 'an', 'object'] },
    ];

    for (const body of invalidCases) {
      const res = await request(API_URL).post('/webhooks').send(body);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    }
  });
});

describe('Events Management & Race-Safe Manual Retry', () => {
  const prefix = `api-evt-${Date.now()}-`;
  createdPrefixes.push(prefix);

  it('GET /events supports filtering, sorting, and pagination', async () => {
    const eventId = `${prefix}${randomUUID()}`;
    await request(API_URL)
      .post('/webhooks')
      .send({ eventId, type: 'payment.captured', data: { orderId: 'ORD-SORT-1' } })
      .expect(202);

    const res = await request(API_URL)
      .get('/events')
      .query({ page: 1, pageSize: 10, type: 'payment.captured', search: eventId, sortBy: 'createdAt', sortOrder: 'desc' })
      .expect(200);

    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].eventId).toBe(eventId);
    expect(res.body.data[0].orderId).toBe('ORD-SORT-1');
  });

  it('GET /events rejects invalid query params with 400', async () => {
    await request(API_URL).get('/events').query({ pageSize: 500 }).expect(400);
    await request(API_URL).get('/events').query({ status: 'BOGUS' }).expect(400);
    await request(API_URL).get('/events').query({ sortBy: 'password' }).expect(400);
  });

  it('GET /events/stats returns counts and distinct eventTypes', async () => {
    const res = await request(API_URL).get('/events/stats').expect(200);
    expect(typeof res.body.total).toBe('number');
    expect(Array.isArray(res.body.eventTypes)).toBe(true);
  });

  it('POST /events/:id/retry is race-safe and only allows FAILED events', async () => {
    const eventId = `${prefix}${randomUUID()}`;
    const created = await prisma.webhookEvent.create({
      data: {
        eventId,
        type: 'order.created',
        payload: { eventId, type: 'order.created', data: {} } as object,
        status: 'FAILED',
        attemptCount: 5,
        maxAttempts: 5,
        failedAt: new Date(),
        lastError: 'Simulated permanent failure',
      },
    });

    // Two concurrent manual retry clicks: only 1 should succeed (200), the other must fail (400)
    const [r1, r2] = await Promise.all([
      request(API_URL).post(`/events/${created.id}/retry`),
      request(API_URL).post(`/events/${created.id}/retry`),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 400]);

    const updated = await prisma.webhookEvent.findUnique({ where: { id: created.id } });
    expect(updated?.status).toBe('RETRY_PENDING');
    expect(updated?.attemptCount).toBe(5); // preserved
    expect(updated?.maxAttempts).toBe(10); // fresh budget assigned
  });

  it('POST /events/:id/retry returns 404 for unknown event', async () => {
    await request(API_URL).post(`/events/${randomUUID()}/retry`).expect(404);
  });
});
