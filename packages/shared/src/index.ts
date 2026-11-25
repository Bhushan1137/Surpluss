import { z } from 'zod';

// ─── Event Status ───────────────────────────────────────────────────────────

export const EventStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  RETRY_PENDING: 'RETRY_PENDING',
  FAILED: 'FAILED',
} as const;

export type EventStatus = (typeof EventStatus)[keyof typeof EventStatus];

// ─── Attempt Result ──────────────────────────────────────────────────────────

export const AttemptResult = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
} as const;

export type AttemptResult = (typeof AttemptResult)[keyof typeof AttemptResult];

// ─── Simulation Types ────────────────────────────────────────────────────────

export const SimulateSchema = z.union([
  z.literal('ok'),
  z.literal('always_fail'),
  z.string().regex(/^fail_then_succeed:\d+$/, 'Must be fail_then_succeed:N'),
  z.string().regex(/^slow:\d+$/, 'Must be slow:N'),
]);

export type Simulate = z.infer<typeof SimulateSchema>;

// ─── Webhook Payload ─────────────────────────────────────────────────────────

export const WebhookPayloadSchema = z.object({
  eventId: z.string().min(1, 'eventId is required').max(255),
  type: z.string().min(1, 'type is required').max(255),
  data: z
    .object({
      simulate: SimulateSchema.optional(),
    })
    .passthrough()
    .optional()
    .default({}),
});

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

// ─── API Response Types ──────────────────────────────────────────────────────

export interface WebhookEvent {
  id: string;
  eventId: string;
  type: string;
  orderId: string | null;
  payload: Record<string, unknown>;
  status: EventStatus;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  workerId: string | null;
  leaseExpiresAt: string | null;
  processedAt: string | null;
  failedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessingAttempt {
  id: string;
  eventId: string;
  attemptNumber: number;
  workerId: string;
  startedAt: string;
  finishedAt: string | null;
  result: AttemptResult | null;
  errorDetails: string | null;
}

export interface ProcessedOrder {
  id: string;
  orderId: string;
  eventId: string;
  processedAt: string;
}

export interface EventStats {
  total: number;
  completed: number;
  processing: number;
  pending: number;
  failed: number;
  retryPending: number;
  eventTypes?: string[];
}

// ─── Pagination ──────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type EventSortField = 'createdAt' | 'updatedAt' | 'attemptCount' | 'status';
export type SortOrder = 'asc' | 'desc';

export interface EventListQuery {
  page?: number;
  pageSize?: number;
  status?: EventStatus;
  type?: string;
  search?: string;
  sortBy?: EventSortField;
  sortOrder?: SortOrder;
}

// ─── API Response Wrapper ────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ─── Retry Config ─────────────────────────────────────────────────────────────

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  initialDelayMs: 1000,
  maxDelayMs: 60_000,
  backoffMultiplier: 2,
};

// ─── Worker Config ───────────────────────────────────────────────────────────

export interface WorkerConfig {
  pollIntervalMs: number;
  leaseDurationMs: number;
  heartbeatIntervalMs: number;
  recoveryCheckIntervalMs: number;
}

export const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  pollIntervalMs: 1000,
  leaseDurationMs: 30_000,
  heartbeatIntervalMs: 10_000,
  recoveryCheckIntervalMs: 15_000,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function parseSimulate(simulate: string | undefined): Simulate {
  if (!simulate) return 'ok';
  const result = SimulateSchema.safeParse(simulate);
  if (!result.success) return 'ok';
  return result.data;
}

export function parseFailThenSucceedN(simulate: string): number {
  const match = simulate.match(/^fail_then_succeed:(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

export function parseSlowN(simulate: string): number {
  const match = simulate.match(/^slow:(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

export function computeNextRetryDelay(
  attempt: number,
  config: RetryConfig,
): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
  return Math.min(delay, config.maxDelayMs);
}
