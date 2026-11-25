-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'RETRY_PENDING', 'FAILED');

-- CreateEnum
CREATE TYPE "AttemptResult" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateTable: webhook_events
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "next_retry_at" TIMESTAMP(3),
    "worker_id" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable: processing_attempts
CREATE TABLE "processing_attempts" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "worker_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "result" "AttemptResult",
    "error_details" TEXT,

    CONSTRAINT "processing_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: processed_orders
CREATE TABLE "processed_orders" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_orders_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex
CREATE UNIQUE INDEX "webhook_events_event_id_key" ON "webhook_events"("event_id");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "processed_orders_order_id_key" ON "processed_orders"("order_id");

-- CreateUniqueIndex (critical: prevents duplicate processed orders per event)
CREATE UNIQUE INDEX "processed_orders_event_id_key" ON "processed_orders"("event_id");

-- Performance indexes
CREATE INDEX "webhook_events_status_idx" ON "webhook_events"("status");
CREATE INDEX "webhook_events_status_next_retry_at_idx" ON "webhook_events"("status", "next_retry_at");
CREATE INDEX "webhook_events_status_lease_expires_at_idx" ON "webhook_events"("status", "lease_expires_at");
CREATE INDEX "webhook_events_created_at_idx" ON "webhook_events"("created_at");
CREATE INDEX "processing_attempts_event_id_idx" ON "processing_attempts"("event_id");
CREATE INDEX "processing_attempts_attempt_number_idx" ON "processing_attempts"("attempt_number");
CREATE INDEX "processed_orders_event_id_idx" ON "processed_orders"("event_id");

-- AddForeignKey
ALTER TABLE "processing_attempts" ADD CONSTRAINT "processing_attempts_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "webhook_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processed_orders" ADD CONSTRAINT "processed_orders_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "webhook_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_webhook_events_updated_at
    BEFORE UPDATE ON webhook_events
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
