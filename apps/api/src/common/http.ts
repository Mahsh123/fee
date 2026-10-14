import {
  Injectable,
  Logger,
  type ArgumentMetadata,
  type CanActivate,
  type ExecutionContext,
  type NestMiddleware,
  type PipeTransform,
} from '@nestjs/common';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, buildPaginationMeta, type PaginationMeta } from '@fee/types';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError, type RequestWithContext } from './errors';
import { TenantContextService } from './tenancy';

/**
 * HTTP plumbing shared by every route.
 *
 * The pieces here exist so that no controller has to re-implement them, and so
 * that the answers to "what is the request id?", "how do I validate a body?" and
 * "how is a list paginated?" are the same everywhere.
 */

// ---------------------------------------------------------------------------
// Request correlation
// ---------------------------------------------------------------------------

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Propagates an inbound request id or mints one, and echoes it on the response.
 *
 * A client that reports a failure can quote one string, and the whole request
 * becomes findable across logs, the audit trail and the outbox.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContextService) {}

  use(request: RequestWithContext, response: Response, next: NextFunction): void {
    const inbound = request.headers[REQUEST_ID_HEADER];
    const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
    // Only a bounded, safe token is accepted; an unbounded client value would let
    // a caller inject junk into every log line for the request.
    const requestId =
      candidate && /^[A-Za-z0-9._:-]{8,128}$/.test(candidate) ? candidate : randomUUID();

    request.requestId = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);
    // Keep the scope open around the entire Express/Nest request chain. Auth
    // fills in the tenant after validating the bearer token.
    this.tenantContext.run({ requestId, isPlatformAdmin: false }, next);
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates and *replaces* the payload with the parsed result.
 *
 * Replacing matters: a Zod object strips unknown keys by default, so a request
 * body carrying `tenantId` or `paidAmount` cannot smuggle it past validation into
 * a Prisma call.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(
    private readonly schema: ZodType,
    private readonly argumentType: ArgumentMetadata['type'] = 'body',
  ) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    // A method-scoped Nest pipe runs for every decorated parameter, including
    // route ids, the tenant context, and request/response objects. Validation
    // schemas here describe one HTTP argument only; applying a body schema to
    // those unrelated values makes valid mutation routes fail before reaching
    // their service. Query schemas opt in explicitly at the call site.
    if (metadata.type !== this.argumentType) return value;

    const result = this.schema.safeParse(value);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(body)',
        message: issue.message,
        code: issue.code,
      }));
      throw new AppError({
        code: 'VALIDATION_FAILED',
        message: `The request payload is invalid: ${details.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
        details,
        context: {
          argumentType: metadata.type,
          expectedArgumentType: this.argumentType,
          issues: result.error.issues.map(({ path, code }) => ({ path: path.join('.'), code })),
        },
      });
    }
    return result.data;
  }
}

export function createValidationPipe<T>(schema: ZodType<T>): ZodValidationPipe {
  return new ZodValidationPipe(schema);
}

// ---------------------------------------------------------------------------
// Pagination, filtering, sorting
// ---------------------------------------------------------------------------

export interface ListQuery {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  search?: string;
  sort: Array<{ field: string; direction: 'asc' | 'desc' }>;
  from?: string;
  to?: string;
  status?: string[];
}

/** Prisma accepts only these as sort directions; anything else is rejected. */
const ALLOWED_SORT_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'paidAt',
  'dueDate',
  'issueDate',
  'entryDate',
  'amount',
  'netAmount',
  'paidAmount',
  'name',
  'firstName',
  'admissionNumber',
  'demandNumber',
  'paymentNumber',
  'receiptNumber',
  'employeeNumber',
  'code',
]);

export function parseListQuery(
  raw: Record<string, unknown>,
  options: { defaultSort?: string; allowedSortFields?: readonly string[] } = {},
): ListQuery {
  const allowed = new Set([...ALLOWED_SORT_FIELDS, ...(options.allowedSortFields ?? [])]);

  const page = clampInt(raw.page, 1, 1, 100_000);
  const pageSize = clampInt(raw.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

  const sortSpec = typeof raw.sort === 'string' && raw.sort.trim() !== '' ? raw.sort.trim() : options.defaultSort ?? '-createdAt';
  const sort = sortSpec
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    // An unknown sort field is dropped rather than passed to the ORM, because a
    // sort on a non-existent column is a 500 and a sort on an unexpected relation
    // can leak data across the tenant boundary.
    .filter((entry) => allowed.has(entry.replace(/^-/, '')))
    .map((entry) => ({
      field: entry.replace(/^-/, ''),
      direction: (entry.startsWith('-') ? 'desc' : 'asc') as 'asc' | 'desc',
    }));

  const statusRaw = raw.status;
  const status = Array.isArray(statusRaw)
    ? (statusRaw as string[])
    : typeof statusRaw === 'string' && statusRaw.trim() !== ''
      ? statusRaw.split(',').map((value) => value.trim()).filter(Boolean)
      : undefined;

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
    search: typeof raw.search === 'string' && raw.search.trim() !== '' ? raw.search.trim() : undefined,
    sort,
    from: typeof raw.from === 'string' ? raw.from : undefined,
    to: typeof raw.to === 'string' ? raw.to : undefined,
    status,
  };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/** Builds Prisma's `orderBy` from the parsed sort spec. */
export function toPrismaOrderBy(sort: ListQuery['sort']): Record<string, 'asc' | 'desc'>[] {
  return sort.length > 0 ? sort.map((entry) => ({ [entry.field]: entry.direction })) : [{ createdAt: 'desc' }];
}

export function paginate<T>(items: T[], total: number, query: ListQuery): { items: T[]; pagination: PaginationMeta } {
  return { items, pagination: buildPaginationMeta(query.page, query.pageSize, total) };
}

/**
 * Builds a case-insensitive OR containment filter over the given columns.
 *
 * `mode: 'insensitive'` is required for PostgreSQL: without it `ILIKE` behaviour
 * is not applied and a search for "priya" misses "Priya", which is the single
 * most common complaint about a school fee search box.
 */
export function buildSearchFilter(
  search: string | undefined,
  fields: readonly string[],
): Record<string, unknown> | undefined {
  if (!search || fields.length === 0) return undefined;
  return {
    OR: fields.map((field) => ({ [field]: { contains: search, mode: 'insensitive' } })),
  };
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export interface RateLimitStore {
  hit(key: string, windowSeconds: number): Promise<{ count: number; resetAt: number }>;
}

/**
 * In-process fixed-window limiter.
 *
 * Adequate for a single instance and for the webhook endpoint's primary purpose,
 * which is absorbing a provider's redelivery storm. In a multi-instance
 * deployment the store is swapped for the Redis-backed implementation; the guard
 * depends on the interface, not on this class.
 */
@Injectable()
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private readonly logger = new Logger(InMemoryRateLimitStore.name);

  async hit(key: string, windowSeconds: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      const bucket = { count: 1, resetAt: now + windowSeconds * 1_000 };
      this.buckets.set(key, bucket);
      this.sweep(now);
      return bucket;
    }

    existing.count += 1;
    return existing;
  }

  private sweep(now: number): void {
    if (this.buckets.size < 10_000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    this.logger.debug({ remaining: this.buckets.size }, 'Rate limit buckets swept');
  }
}

export interface RateLimitOptions {
  windowSeconds: number;
  max: number;
  keyPrefix: string;
  /** Use the authenticated tenant when present, else the client address. */
  scope: 'tenant' | 'ip' | 'tenant-or-ip';
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly store: InMemoryRateLimitStore,
    private readonly options: RateLimitOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const key = `${this.options.keyPrefix}:${this.keyFor(request)}`;
    const { count } = await this.store.hit(key, this.options.windowSeconds);

    if (count > this.options.max) {
      throw new AppError({
        code: 'RATE_LIMITED',
        message: `Too many requests. Please retry in ${this.options.windowSeconds} seconds.`,
        status: 429,
        context: { key, count, max: this.options.max },
      });
    }
    return true;
  }

  private keyFor(request: RequestWithContext): string {
    if (this.options.scope === 'ip') return clientAddress(request);
    if (this.options.scope === 'tenant') return request.user?.tenantId ?? clientAddress(request);
    return request.user?.tenantId ?? clientAddress(request);
  }
}

export function clientAddress(request: RequestWithContext): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return request.ip ?? 'unknown';
}

/**
 * Login is limited per client address, not per tenant: an attacker has no tenant
 * yet, and limiting per tenant would let them lock out a real one.
 */
@Injectable()
export class LoginRateLimitGuard extends RateLimitGuard {
  constructor(store: InMemoryRateLimitStore) {
    super(store, { windowSeconds: 60, max: 10, keyPrefix: 'auth:login', scope: 'ip' });
  }
}

/**
 * Webhook endpoints get a deliberately generous budget.
 *
 * The provider is not an attacker, and rejecting a legitimate redelivery storm
 * would lose money events. The budget exists only to bound an unbounded flood.
 */
@Injectable()
export class WebhookRateLimitGuard extends RateLimitGuard {
  constructor(store: InMemoryRateLimitStore) {
    super(store, { windowSeconds: 60, max: 600, keyPrefix: 'webhook', scope: 'ip' });
  }
}

/** Factory so a route can add a limiter with its own budget. */
export function createRateLimitGuard(store: InMemoryRateLimitStore, options: RateLimitOptions): RateLimitGuard {
  return new RateLimitGuard(store, options);
}
