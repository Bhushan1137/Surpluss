import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  EventSortField,
  EventStatus,
  SortOrder,
  WebhookEvent,
} from '@surpluss/shared';
import { Prisma } from '@prisma/client';

const ALLOWED_SORT_FIELDS: ReadonlySet<EventSortField> = new Set([
  'createdAt',
  'updatedAt',
  'attemptCount',
  'status',
]);

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async findMany(query: {
    page: number;
    pageSize: number;
    status?: EventStatus;
    type?: string;
    search?: string;
    sortBy?: EventSortField;
    sortOrder?: SortOrder;
  }) {
    const {
      page,
      pageSize,
      status,
      type,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;
    const skip = (page - 1) * pageSize;

    const where: Prisma.WebhookEventWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (type) {
      where.type = type;
    }

    if (search) {
      where.OR = [
        { eventId: { contains: search, mode: 'insensitive' } },
        { type: { contains: search, mode: 'insensitive' } },
      ];
    }

    const safeSortBy: EventSortField = ALLOWED_SORT_FIELDS.has(sortBy)
      ? sortBy
      : 'createdAt';
    const safeSortOrder: SortOrder = sortOrder === 'asc' ? 'asc' : 'desc';

    const [events, total] = await Promise.all([
      this.prisma.webhookEvent.findMany({
        where,
        orderBy: { [safeSortBy]: safeSortOrder },
        skip,
        take: pageSize,
        include: {
          processedOrder: { select: { orderId: true } },
        },
      }),
      this.prisma.webhookEvent.count({ where }),
    ]);

    return {
      data: events.map((e) => this.mapEvent(e)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string) {
    const event = await this.prisma.webhookEvent.findUnique({
      where: { id },
      include: {
        attempts: { orderBy: { attemptNumber: 'asc' } },
        processedOrder: true,
      },
    });

    if (!event) {
      throw new NotFoundException(`Event ${id} not found`);
    }

    return {
      ...this.mapEvent(event),
      attempts: event.attempts.map((a) => ({
        id: a.id,
        eventId: a.eventId,
        attemptNumber: a.attemptNumber,
        workerId: a.workerId,
        startedAt: a.startedAt.toISOString(),
        finishedAt: a.finishedAt?.toISOString() ?? null,
        result: a.result,
        errorDetails: a.errorDetails,
      })),
      processedOrder: event.processedOrder
        ? {
            id: event.processedOrder.id,
            orderId: event.processedOrder.orderId,
            eventId: event.processedOrder.eventId,
            processedAt: event.processedOrder.processedAt.toISOString(),
          }
        : null,
    };
  }

  async getStats() {
    const [groups, distinctTypes] = await Promise.all([
      this.prisma.webhookEvent.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.webhookEvent.findMany({
        distinct: ['type'],
        select: { type: true },
        orderBy: { type: 'asc' },
      }),
    ]);

    const counts = Object.fromEntries(
      groups.map((g) => [g.status, g._count._all]),
    );

    const total = Object.values(counts).reduce((acc, v) => acc + v, 0);

    return {
      total,
      completed: counts['COMPLETED'] ?? 0,
      processing: counts['PROCESSING'] ?? 0,
      pending: counts['PENDING'] ?? 0,
      failed: counts['FAILED'] ?? 0,
      retryPending: counts['RETRY_PENDING'] ?? 0,
      eventTypes: distinctTypes.map((t) => t.type),
    };
  }

  async retryFailedEvent(id: string) {
    const retryBudget = this.config.get<number>('app.retry.maxAttempts') ?? 5;

    const updated = await this.prisma.$transaction(async (tx) => {
      const event = await tx.webhookEvent.findUnique({
        where: { id },
        select: { id: true, status: true, eventId: true, attemptCount: true },
      });

      if (!event) {
        throw new NotFoundException(`Event ${id} not found`);
      }

      if (event.status !== 'FAILED') {
        throw new BadRequestException(
          `Event ${id} is not in FAILED status (current: ${event.status}). Only permanently failed events can be manually retried.`,
        );
      }

      // Atomic conditional update prevents race conditions on rapid double-clicks
      const result = await tx.webhookEvent.updateMany({
        where: { id, status: 'FAILED' },
        data: {
          status: 'RETRY_PENDING',
          maxAttempts: event.attemptCount + retryBudget,
          nextRetryAt: new Date(),
          workerId: null,
          leaseExpiresAt: null,
          lastError: null,
          failedAt: null,
        },
      });

      if (result.count === 0) {
        throw new BadRequestException(
          `Event ${id} is already queued for retry or no longer in FAILED status.`,
        );
      }

      return tx.webhookEvent.findUniqueOrThrow({
        where: { id },
        include: { processedOrder: { select: { orderId: true } } },
      });
    });

    this.logger.log(`Manual retry initiated for event ${updated.eventId}`);

    return this.mapEvent(updated);
  }

  private extractOrderId(
    payload: unknown,
    processedOrder?: { orderId: string } | null,
  ): string | null {
    if (typeof payload === 'object' && payload !== null) {
      const data = (payload as Record<string, unknown>)['data'];
      if (typeof data === 'object' && data !== null) {
        const orderId = (data as Record<string, unknown>)['orderId'];
        if (typeof orderId === 'string' && orderId.trim().length > 0) {
          return orderId.trim();
        }
      }
    }
    return processedOrder?.orderId ?? null;
  }

  private mapEvent(
    event: Prisma.WebhookEventGetPayload<{
      include?: { processedOrder?: { select: { orderId: true } } | boolean };
    }>,
  ): WebhookEvent {
    const processedOrder =
      'processedOrder' in event
        ? (event.processedOrder as { orderId: string } | null | undefined)
        : undefined;

    return {
      id: event.id,
      eventId: event.eventId,
      type: event.type,
      orderId: this.extractOrderId(event.payload, processedOrder),
      payload: event.payload as Record<string, unknown>,
      status: event.status as EventStatus,
      attemptCount: event.attemptCount,
      maxAttempts: event.maxAttempts,
      nextRetryAt: event.nextRetryAt?.toISOString() ?? null,
      workerId: event.workerId,
      leaseExpiresAt: event.leaseExpiresAt?.toISOString() ?? null,
      processedAt: event.processedAt?.toISOString() ?? null,
      failedAt: event.failedAt?.toISOString() ?? null,
      lastError: event.lastError,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    };
  }
}
