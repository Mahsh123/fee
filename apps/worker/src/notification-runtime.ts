import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import nodemailer, { type SentMessageInfo, type Transporter } from 'nodemailer';
import type { WorkerEnv } from '@fee/config';

export const WORKER_CONFIG = Symbol('WORKER_CONFIG');
const QUEUE_NAME = 'tenant-notifications';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DeliveryJob = {
  tenantId: string;
  notificationId: string;
  to: string;
  subject?: string;
  body: string;
  from: string;
  fromName?: string;
};

type DeliveryResult = {
  tenantId: string;
  notificationId: string;
  attempt: number;
  status: 'SENT' | 'FAILED';
  providerMessageId?: string;
  errorCode?: string;
};

/** Sends rendered mail jobs; notification state stays behind the API boundary. */
@Injectable()
export class NotificationRuntime implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationRuntime.name);
  private redis?: IORedis;
  private worker?: Worker<DeliveryJob>;
  private transport?: Transporter;

  constructor(@Inject(WORKER_CONFIG) private readonly config: WorkerEnv) {}

  async onModuleInit() {
    this.redis = new IORedis(this.config.REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker<DeliveryJob>(
      QUEUE_NAME,
      (job) => this.deliver(job),
      { connection: this.redis, prefix: this.config.QUEUE_PREFIX, concurrency: 10 },
    );
    this.worker.on('failed', (job, error) => this.logger.warn({ jobId: job?.id, error: safeErrorCode(error) }, 'Notification delivery attempt failed'));
    this.worker.on('error', (error) => this.logger.error({ error: safeErrorCode(error) }, 'Notification queue worker error'));
    this.logger.log('Email delivery worker started without database access');
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.redis?.quit();
  }

  private async deliver(job: Job<DeliveryJob>) {
    const message = validateJob(job.data);
    const attempt = job.attemptsMade + 1;
    let info: SentMessageInfo;
    try {
      if (!this.config.SMTP_HOST) throw new Error('SMTP_NOT_CONFIGURED');
      if (!message.to) throw new Error('NOTIFICATION_RECIPIENT_MISSING');
      if (!message.subject) throw new Error('NOTIFICATION_SUBJECT_MISSING');
      info = await new Promise<SentMessageInfo>((resolve, reject) => {
        this.getTransport().sendMail({
          from: message.fromName ? { name: message.fromName, address: message.from } : message.from,
          to: message.to,
          subject: message.subject,
          text: message.body,
        }, (error, sent) => error ? reject(error) : resolve(sent));
      });
    } catch (error) {
      const errorCode = safeErrorCode(error);
      await this.report({ tenantId: message.tenantId, notificationId: message.notificationId, attempt, status: 'FAILED', errorCode });
      throw new Error(errorCode);
    }

    const providerMessageId = typeof info.messageId === 'string' && info.messageId.length <= 255
      ? info.messageId : undefined;
    await this.report({ tenantId: message.tenantId, notificationId: message.notificationId, attempt, status: 'SENT', providerMessageId });
  }

  private async report(result: DeliveryResult) {
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const body = JSON.stringify(result);
    const signature = createHmac('sha256', this.config.NOTIFICATION_WORKER_HMAC_SECRET)
      .update(`${timestamp}.${nonce}.`, 'utf8')
      .update(body, 'utf8')
      .digest('hex');
    let response: Response;
    try {
      response = await fetch(this.config.NOTIFICATION_CALLBACK_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-fee-worker-timestamp': timestamp,
          'x-fee-worker-nonce': nonce,
          'x-fee-worker-signature': signature,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error('WORKER_CALLBACK_UNAVAILABLE');
    }
    if (!response.ok) throw new Error('WORKER_CALLBACK_REJECTED');
  }

  private getTransport(): Transporter {
    if (!this.transport) {
      this.transport = nodemailer.createTransport({
        host: this.config.SMTP_HOST,
        port: this.config.SMTP_PORT,
        secure: this.config.SMTP_SECURE,
        auth: this.config.SMTP_USER ? { user: this.config.SMTP_USER, pass: this.config.SMTP_PASSWORD ?? '' } : undefined,
      });
    }
    return this.transport;
  }
}

function validateJob(value: unknown): DeliveryJob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('NOTIFICATION_JOB_INVALID');
  const job = value as Record<string, unknown>;
  if (typeof job.tenantId !== 'string' || !UUID_PATTERN.test(job.tenantId) ||
      typeof job.notificationId !== 'string' || !UUID_PATTERN.test(job.notificationId) ||
      typeof job.to !== 'string' || typeof job.from !== 'string' || typeof job.body !== 'string' ||
      (job.subject !== undefined && typeof job.subject !== 'string') ||
      (job.fromName !== undefined && typeof job.fromName !== 'string')) {
    throw new Error('NOTIFICATION_JOB_INVALID');
  }
  return job as DeliveryJob;
}

function safeErrorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z0-9_]{3,80}$/.test(error.message) ? error.message : 'WORKER_OPERATION_FAILED';
}
