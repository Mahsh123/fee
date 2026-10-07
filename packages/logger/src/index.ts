import pino, { type Logger, type LoggerOptions } from 'pino';

export interface CreateLoggerOptions {
  level?: LoggerOptions['level'];
  service: string;
  environment?: string;
  /** Extra paths can be redacted when an integration adds secret-bearing fields. */
  redactPaths?: string[];
  destination?: Parameters<typeof pino>[1];
}

const defaultRedactPaths = [
  'password',
  '*.password',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'authorization',
  'headers.authorization',
  '*.headers.authorization',
  'secret',
  '*.secret',
  'apiKey',
  '*.apiKey',
  'JWT_SECRET',
  '*.JWT_SECRET',
  'JWT_REFRESH_SECRET',
  '*.JWT_REFRESH_SECRET',
  'ENCRYPTION_KEY',
  '*.ENCRYPTION_KEY',
  'AUDIT_SIGNING_KEYS_JSON',
  '*.AUDIT_SIGNING_KEYS_JSON',
  'NOTIFICATION_WORKER_HMAC_SECRET',
  '*.NOTIFICATION_WORKER_HMAC_SECRET',
  'S3_ACCESS_KEY_ID',
  '*.S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  '*.S3_SECRET_ACCESS_KEY',
  'SMTP_PASSWORD',
  '*.SMTP_PASSWORD',
  'RAZORPAY_KEY_SECRET',
  '*.RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  '*.RAZORPAY_WEBHOOK_SECRET',
  'CASHFREE_SECRET_KEY',
  '*.CASHFREE_SECRET_KEY',
  'CASHFREE_WEBHOOK_SECRET',
  '*.CASHFREE_WEBHOOK_SECRET',
  'PAYU_SALT',
  '*.PAYU_SALT',
  'STRIPE_SECRET_KEY',
  '*.STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  '*.STRIPE_WEBHOOK_SECRET',
  'POSTGRES_PASSWORD',
  '*.POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
  '*.REDIS_PASSWORD',
  'DATABASE_URL',
  '*.DATABASE_URL',
  'REDIS_URL',
  '*.REDIS_URL',
  'SEED_PLATFORM_ADMIN_PASSWORD',
  '*.SEED_PLATFORM_ADMIN_PASSWORD',
  'SEED_DEMO_PASSWORD',
  '*.SEED_DEMO_PASSWORD',
  'SENTRY_DSN',
  '*.SENTRY_DSN',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  '*.OTEL_EXPORTER_OTLP_ENDPOINT',
];

/** Creates a structured application logger with secret redaction enabled by default. */
export function createLogger(options: CreateLoggerOptions): Logger {
  const redactPaths = [...new Set([...defaultRedactPaths, ...(options.redactPaths ?? [])])];
  const pinoOptions: LoggerOptions = {
    level: options.level ?? 'info',
    base: { service: options.service, ...(options.environment ? { environment: options.environment } : {}) },
    redact: { paths: redactPaths, censor: '[REDACTED]' },
    messageKey: 'message',
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return options.destination ? pino(pinoOptions, options.destination) : pino(pinoOptions);
}
