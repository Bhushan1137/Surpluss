import { PrismaClient } from '@prisma/client';
import {
  parseSimulate,
  parseFailThenSucceedN,
  parseSlowN,
  computeNextRetryDelay,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_WORKER_CONFIG,
  RetryConfig,
  WorkerConfig,
} from '@surpluss/shared';
import { randomUUID } from 'crypto';

// ─── Worker Configuration ────────────────────────────────────────────────────

function loadConfig() {
  const retryConfig: RetryConfig = {
    maxAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS || '5', 10),
    initialDelayMs: parseInt(process.env.RETRY_INITIAL_DELAY_MS || '1000', 10),
    maxDelayMs: parseInt(process.env.RETRY_MAX_DELAY_MS || '60000', 10),
    backoffMultiplier: parseFloat(process.env.RETRY_BACKOFF_MULTIPLIER || '2'),
  };

  const workerConfig: WorkerConfig = {
    pollIntervalMs: parseInt(process.env.WORKER_POLL_INTERVAL_MS || '1000', 10),
    leaseDurationMs: parseInt(process.env.WORKER_LEASE_DURATION_MS || '30000', 10),
    heartbeatIntervalMs: parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS || '10000', 10),
    recoveryCheckIntervalMs: parseInt(process.env.WORKER_RECOVERY_INTERVAL_MS || '15000', 10),
  };

  return { retryConfig, workerConfig };
}

// ─── Logger ───────────────────────────────────────────────────────────────────

function createLogger(workerId: string) {
  const prefix = `[Worker:${workerId.slice(0, 8)}]`;
  return {
    log: (msg: string) => console.log(`${new Date().toISOString()} ${prefix} ${msg}`),
    warn: (msg: string) => console.warn(`${new Date().toISOString()} ${prefix} WARN ${msg}`),
    error: (msg: string, err?: unknown) =>
      console.error(
        `${new Date().toISOString()} ${prefix} ERROR ${msg}`,
        err instanceof Error ? err.stack : err,
      ),
  };
}

// ─── Worker Main Class ───────────────────────────────────────────────────────

class WebhookWorker {
  private readonly prisma: PrismaClient;
  private readonly workerId: string;
  private readonly retryConfig: RetryConfig;
  private readonly workerConfig: WorkerConfig;
  private readonly log: ReturnType<typeof createLogger>;

  private isShuttingDown = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private activeEventId: string | null = null;
  private activeAttemptId: string | null = null;

  constructor() {
    const { retryConfig, workerConfig } = loadConfig();
    this.retryConfig = retryConfig;
    this.workerConfig = workerConfig;
    this.workerId = process.env.WORKER_ID || `worker-${randomUUID()}`;
    this.prisma = new PrismaClient();
    this.log = createLogger(this.workerId);
  }

  async run() {
    await this.prisma.$connect();
    this.log.log('Started');

    // Start crash recovery loop in background
    this.scheduleRecoveryCheck();

    // Main poll loop
    while (!this.isShuttingDown) {
      try {
        const processed = await this.pollAndProcess();
        if (!processed) {
          // No work available; wait before polling again
          await this.sleep(this.workerConfig.pollIntervalMs);
        }
      } catch (err) {
        this.log.error('Unexpected error in poll loop', err);
        await this.sleep(this.workerConfig.pollIntervalMs);
      }
    }

    await this.prisma.$disconnect();
    this.log.log('Shut down cleanly');
  }

  // ─── Event Claiming ──────────────────────────────────────────────────────

  private async pollAndProcess(): Promise<boolean> {
    const event = await this.claimNextEvent();
    if (!event) return false;

    this.activeEventId = event.id;
    this.log.log(`Claimed event ${event.eventId} (attempt #${event.attemptCount + 1})`);

    // Create attempt record
    const attempt = await this.prisma.processingAttempt.create({
      data: {
        eventId: event.id,
        attemptNumber: event.attemptCount + 1,
        workerId: this.workerId,
      },
    });

    this.activeAttemptId = attempt.id;

    // Start heartbeat for lease renewal
    this.startHeartbeat(event.id);

    try {
      await this.processEvent(event, attempt.id);
    } finally {
      this.stopHeartbeat();
      this.activeEventId = null;
      this.activeAttemptId = null;
    }

    return true;
  }

  /**
   * Atomically claim the next eligible event using SELECT FOR UPDATE SKIP LOCKED.
   * This ensures only one worker processes a given event at a time.
   */
  private async claimNextEvent() {
    const leaseExpiresAt = new Date(
      Date.now() + this.workerConfig.leaseDurationMs,
    );
    const now = new Date();

    // Use a raw transaction with FOR UPDATE SKIP LOCKED
    const result = await this.prisma.$transaction(async (tx) => {
      // Find an eligible event (PENDING or RETRY_PENDING with nextRetryAt <= now)
      const rows = await tx.$queryRaw<Array<{
        id: string;
        event_id: string;
        type: string;
        payload: unknown;
        status: string;
        attempt_count: number;
        max_attempts: number;
      }>>`
        SELECT id, event_id, type, payload, status, attempt_count, max_attempts
        FROM webhook_events
        WHERE (
          status = 'PENDING'
          OR (status = 'RETRY_PENDING' AND next_retry_at <= ${now})
        )
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) return null;

      const row = rows[0];

      // Atomically transition to PROCESSING and assign this worker + lease
      await tx.$executeRaw`
        UPDATE webhook_events
        SET
          status = 'PROCESSING',
          worker_id = ${this.workerId},
          lease_expires_at = ${leaseExpiresAt},
          attempt_count = attempt_count + 1,
          updated_at = NOW()
        WHERE id = ${row.id}
      `;

      return {
        id: row.id,
        eventId: row.event_id,
        type: row.type,
        payload: row.payload as Record<string, unknown>,
        status: row.status,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
      };
    });

    return result;
  }

  // ─── Event Processing ────────────────────────────────────────────────────

  private async processEvent(
    event: {
      id: string;
      eventId: string;
      type: string;
      payload: Record<string, unknown>;
      attemptCount: number;
      maxAttempts: number;
    },
    attemptId: string,
  ) {
    const payload = event.payload as {
      data?: { simulate?: string };
    };
    const simulate = parseSimulate(payload.data?.simulate);
    const currentAttempt = event.attemptCount + 1; // already incremented in DB

    this.log.log(
      `Processing event ${event.eventId} | attempt=${currentAttempt} | simulate=${simulate}`,
    );

    try {
      await this.executeSimulation(simulate, currentAttempt, event.id);
      await this.completeEvent(event, attemptId);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown processing error';
      await this.failAttempt(event, attemptId, errorMessage, currentAttempt);
    }
  }

  /**
   * Execute the simulated business logic.
   */
  private async executeSimulation(
    simulate: string,
    currentAttempt: number,
    eventId: string,
  ): Promise<void> {
    switch (true) {
      case simulate === 'ok':
        // Successful processing – no-op beyond the DB operations
        await this.sleep(50); // Simulate minimal processing time
        return;

      case simulate === 'always_fail':
        throw new Error('Simulated permanent failure (always_fail)');

      case simulate.startsWith('fail_then_succeed:'): {
        const failUntil = parseFailThenSucceedN(simulate);
        if (currentAttempt <= failUntil) {
          throw new Error(
            `Simulated failure (fail_then_succeed:${failUntil}, attempt ${currentAttempt})`,
          );
        }
        await this.sleep(50);
        return;
      }

      case simulate.startsWith('slow:'): {
        const durationSeconds = parseSlowN(simulate);
        this.log.log(
          `Slow processing for ${durationSeconds}s (heartbeat will renew lease)`,
        );
        await this.sleep(durationSeconds * 1000);
        return;
      }

      default:
        await this.sleep(50);
        return;
    }
  }

  /**
   * Atomically complete the event and insert processed_orders record.
   * This is the critical exactly-once transaction.
   */
  private async completeEvent(
    event: {
      id: string;
      eventId: string;
    },
    attemptId: string,
  ): Promise<void> {
    // Verify we still own the lease before committing
    const current = await this.prisma.webhookEvent.findUnique({
      where: { id: event.id },
      select: { workerId: true, leaseExpiresAt: true, status: true },
    });

    if (!current) {
      this.log.warn(`Event ${event.eventId} no longer exists, skipping completion`);
      return;
    }

    if (current.workerId !== this.workerId) {
      this.log.warn(
        `Event ${event.eventId} ownership lost (current owner: ${current.workerId}). Aborting completion.`,
      );
      return;
    }

    if (current.status !== 'PROCESSING') {
      this.log.warn(
        `Event ${event.eventId} status is ${current.status}, not PROCESSING. Skipping.`,
      );
      return;
    }

    const orderId = randomUUID();
    const now = new Date();

    // ATOMIC TRANSACTION: insert processed_order AND mark event completed
    // If this transaction rolls back (e.g. crash), neither side effect is durable.
    // If it commits, both are durable. The unique constraint on event_id in
    // processed_orders prevents duplicate records even if this runs twice.
    try {
      await this.prisma.$transaction(async (tx) => {
        // Upsert processed_orders – idempotent via unique constraint on event_id
        await tx.$executeRaw`
          INSERT INTO processed_orders (id, order_id, event_id, processed_at)
          VALUES (${randomUUID()}, ${orderId}, ${event.id}, ${now})
          ON CONFLICT (event_id) DO NOTHING
        `;

        // Mark event as completed with ownership verification
        const updated = await tx.$executeRaw`
          UPDATE webhook_events
          SET
            status = 'COMPLETED',
            processed_at = ${now},
            worker_id = ${this.workerId},
            lease_expires_at = NULL,
            last_error = NULL,
            updated_at = NOW()
          WHERE id = ${event.id}
            AND worker_id = ${this.workerId}
            AND status = 'PROCESSING'
        `;

        if (!updated) {
          throw new Error('Ownership check failed during completion');
        }

        // Mark attempt as successful
        await tx.processingAttempt.update({
          where: { id: attemptId },
          data: {
            finishedAt: now,
            result: 'SUCCESS',
          },
        });
      });

      this.log.log(`Successfully completed event ${event.eventId}`);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Ownership check failed')) {
        this.log.warn(`Lost ownership of event ${event.eventId} during completion`);
        return;
      }
      throw err;
    }
  }

  /**
   * Handle a failed processing attempt – schedule retry or mark permanently failed.
   */
  private async failAttempt(
    event: {
      id: string;
      eventId: string;
      attemptCount: number;
      maxAttempts: number;
    },
    attemptId: string,
    errorMessage: string,
    currentAttempt: number,
  ): Promise<void> {
    // Verify we still own the event before updating
    const current = await this.prisma.webhookEvent.findUnique({
      where: { id: event.id },
      select: { workerId: true, status: true },
    });

    if (!current || current.workerId !== this.workerId) {
      this.log.warn(
        `Cannot record failure for event ${event.eventId}: ownership lost`,
      );
      return;
    }

    const isExhausted = currentAttempt >= event.maxAttempts;
    const now = new Date();

    if (isExhausted) {
      this.log.warn(
        `Event ${event.eventId} permanently failed after ${currentAttempt} attempts`,
      );

      await this.prisma.$transaction(async (tx) => {
        await tx.webhookEvent.update({
          where: { id: event.id },
          data: {
            status: 'FAILED',
            failedAt: now,
            lastError: errorMessage,
            workerId: null,
            leaseExpiresAt: null,
          },
        });

        await tx.processingAttempt.update({
          where: { id: attemptId },
          data: { finishedAt: now, result: 'FAILURE', errorDetails: errorMessage },
        });
      });
    } else {
      const delayMs = computeNextRetryDelay(currentAttempt, this.retryConfig);
      const nextRetryAt = new Date(Date.now() + delayMs);

      this.log.log(
        `Event ${event.eventId} failed (attempt ${currentAttempt}/${event.maxAttempts}). ` +
          `Retry in ${delayMs}ms at ${nextRetryAt.toISOString()}`,
      );

      await this.prisma.$transaction(async (tx) => {
        await tx.webhookEvent.update({
          where: { id: event.id },
          data: {
            status: 'RETRY_PENDING',
            nextRetryAt,
            lastError: errorMessage,
            workerId: null,
            leaseExpiresAt: null,
          },
        });

        await tx.processingAttempt.update({
          where: { id: attemptId },
          data: { finishedAt: now, result: 'FAILURE', errorDetails: errorMessage },
        });
      });
    }
  }

  // ─── Heartbeat ───────────────────────────────────────────────────────────

  /**
   * Periodically renew the processing lease to prevent other workers from
   * reclaiming a long-running but healthy job.
   */
  private startHeartbeat(eventId: string) {
    this.heartbeatTimer = setInterval(async () => {
      try {
        const newExpiry = new Date(
          Date.now() + this.workerConfig.leaseDurationMs,
        );

        const result = await this.prisma.$executeRaw`
          UPDATE webhook_events
          SET lease_expires_at = ${newExpiry}, updated_at = NOW()
          WHERE id = ${eventId}
            AND worker_id = ${this.workerId}
            AND status = 'PROCESSING'
        `;

        if (result > 0) {
          this.log.log(`Heartbeat: renewed lease for event ${eventId}`);
        } else {
          this.log.warn(`Heartbeat: lost ownership of event ${eventId}`);
          this.stopHeartbeat();
        }
      } catch (err) {
        this.log.error('Heartbeat error', err);
      }
    }, this.workerConfig.heartbeatIntervalMs);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ─── Crash Recovery ──────────────────────────────────────────────────────

  /**
   * Periodically scan for PROCESSING events whose leases have expired.
   * These indicate crashed workers; eligible events are reset to RETRY_PENDING.
   */
  private scheduleRecoveryCheck() {
    const runCheck = async () => {
      if (this.isShuttingDown) return;
      try {
        await this.recoverExpiredLeases();
      } catch (err) {
        this.log.error('Recovery check error', err);
      }
      setTimeout(runCheck, this.workerConfig.recoveryCheckIntervalMs);
    };

    setTimeout(runCheck, this.workerConfig.recoveryCheckIntervalMs);
  }

  private async recoverExpiredLeases() {
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      // Find PROCESSING events with expired leases
      const stuck = await tx.$queryRaw<Array<{ id: string; event_id: string; attempt_count: number; max_attempts: number }>>`
        SELECT id, event_id, attempt_count, max_attempts
        FROM webhook_events
        WHERE status = 'PROCESSING'
          AND lease_expires_at < ${now}
        FOR UPDATE SKIP LOCKED
      `;

      if (stuck.length === 0) return 0;

      let recovered = 0;
      for (const row of stuck) {
        const isExhausted = row.attempt_count >= row.max_attempts;
        const nextStatus = isExhausted ? 'FAILED' : 'RETRY_PENDING';

        // Calculate retry time (use current attempt count as base for delay)
        const delayMs = isExhausted
          ? 0
          : computeNextRetryDelay(row.attempt_count, this.retryConfig);
        const nextRetryAt = isExhausted ? null : new Date(Date.now() + delayMs);
        const failedAt = isExhausted ? now : null;

        await tx.$executeRaw`
          UPDATE webhook_events
          SET
            status = ${nextStatus}::\"EventStatus\",
            worker_id = NULL,
            lease_expires_at = NULL,
            next_retry_at = ${nextRetryAt},
            failed_at = ${failedAt},
            last_error = 'Worker lease expired (crash recovery)',
            updated_at = NOW()
          WHERE id = ${row.id}
        `;

        // Mark any in-progress attempt as failed
        await tx.$executeRaw`
          UPDATE processing_attempts
          SET
            finished_at = ${now},
            result = 'FAILURE',
            error_details = 'Worker lease expired (crash recovery)'
          WHERE event_id = ${row.id}
            AND finished_at IS NULL
        `;

        recovered++;
        this.log.log(
          `Recovered stuck event ${row.event_id} → ${nextStatus}`,
        );
      }

      return recovered;
    });

    if (result > 0) {
      this.log.log(`Crash recovery: recovered ${result} stuck events`);
    }
  }

  // ─── Graceful Shutdown ───────────────────────────────────────────────────

  async shutdown() {
    this.log.log('Shutting down...');
    this.isShuttingDown = true;
    this.stopHeartbeat();

    // If we're in the middle of processing, give a brief grace period
    if (this.activeEventId) {
      this.log.warn(
        `Shutdown while processing event ${this.activeEventId}; lease will expire for recovery`,
      );
    }
  }

  // ─── Utilities ───────────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

async function main() {
  const worker = new WebhookWorker();

  process.on('SIGTERM', async () => {
    await worker.shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    await worker.shutdown();
    process.exit(0);
  });

  await worker.run();
}

main().catch((err) => {
  console.error('Fatal worker error:', err);
  process.exit(1);
});
