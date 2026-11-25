import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3001',

  retry: {
    maxAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS || '5', 10),
    initialDelayMs: parseInt(process.env.RETRY_INITIAL_DELAY_MS || '1000', 10),
    maxDelayMs: parseInt(process.env.RETRY_MAX_DELAY_MS || '60000', 10),
    backoffMultiplier: parseFloat(process.env.RETRY_BACKOFF_MULTIPLIER || '2'),
  },

  worker: {
    pollIntervalMs: parseInt(process.env.WORKER_POLL_INTERVAL_MS || '1000', 10),
    leaseDurationMs: parseInt(process.env.WORKER_LEASE_DURATION_MS || '30000', 10),
    heartbeatIntervalMs: parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS || '10000', 10),
    recoveryCheckIntervalMs: parseInt(process.env.WORKER_RECOVERY_INTERVAL_MS || '15000', 10),
  },
}));
