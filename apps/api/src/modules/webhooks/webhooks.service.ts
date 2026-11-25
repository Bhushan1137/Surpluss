import {
  Injectable,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IngestWebhookDto } from './dto/ingest-webhook.dto';
import { SimulateSchema } from '@surpluss/shared';
import { ConfigService } from '@nestjs/config';

export interface IngestResult {
  id: string;
  eventId: string;
  isDuplicate: boolean;
  status: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async ingest(dto: IngestWebhookDto): Promise<IngestResult> {
    // Validate simulate value if present
    if (dto.data?.simulate !== undefined) {
      const simulateStr = String(dto.data.simulate);
      const parsed = SimulateSchema.safeParse(simulateStr);
      if (!parsed.success) {
        this.logger.warn(
          `Invalid simulate value "${simulateStr}" for eventId=${dto.eventId}. Defaulting to "ok".`,
        );
        dto.data = { ...dto.data, simulate: 'ok' };
      }
    }

    const maxAttempts = this.config.get<number>('app.retry.maxAttempts') ?? 5;
    const payload = { eventId: dto.eventId, type: dto.type, data: dto.data ?? {} };

    // Atomic upsert: insert if not exists, return existing if duplicate
    // We use createMany with skipDuplicates=false and catch unique constraint violation
    // to handle the race condition atomically at database level.
    try {
      const event = await this.prisma.webhookEvent.create({
        data: {
          eventId: dto.eventId,
          type: dto.type,
          payload: payload as object,
          maxAttempts,
          status: 'PENDING',
        },
        select: { id: true, eventId: true, status: true },
      });

      this.logger.log(`Ingested new event: ${dto.eventId} [${dto.type}]`);

      return {
        id: event.id,
        eventId: event.eventId,
        isDuplicate: false,
        status: event.status,
      };
    } catch (err: unknown) {
      // Unique constraint violation → duplicate eventId
      if (this.isUniqueConstraintError(err)) {
        const existing = await this.prisma.webhookEvent.findUniqueOrThrow({
          where: { eventId: dto.eventId },
          select: { id: true, eventId: true, status: true },
        });

        this.logger.log(
          `Duplicate event received for eventId=${dto.eventId}; preserving original`,
        );

        return {
          id: existing.id,
          eventId: existing.eventId,
          isDuplicate: true,
          status: existing.status,
        };
      }

      throw err;
    }
  }

  private isUniqueConstraintError(err: unknown): boolean {
    if (typeof err === 'object' && err !== null) {
      const e = err as Record<string, unknown>;
      // Prisma unique constraint violation code
      return e['code'] === 'P2002';
    }
    return false;
  }
}
