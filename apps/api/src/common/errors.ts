import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { ERROR_CODES, type ApiFailure, type ApiSuccess, type ErrorCode } from '@fee/types';
import { Prisma } from '@fee/database';
import { Observable, catchError, map, throwError } from 'rxjs';
import type { Request } from 'express';
import type { ResolvedTenantHost } from './tenant-host';
import { ZodError } from 'zod';

/**
 * Error handling.
 *
 * One error vocabulary for the whole API. A domain failure carries a stable
 * `code` the client can branch on, a human `message`, and an HTTP status derived
 * from the code rather than decided at each throw site - which is how endpoints
 * end up disagreeing about whether "not found" is 404 or 200-with-null.
 *
 * Stack traces never leave the process. The `requestId` is the bridge between a
 * user's report and the log line that explains it.
 */

export interface AppErrorOptions {
  code: ErrorCode | string;
  message: string;
  status?: number;
  details?: Array<{ path: string; message: string; code?: string }>;
  hint?: string;
  /** Extra context for the log line; never sent to the client. */
  context?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: ErrorCode | string;
  readonly status: number;
  readonly details?: Array<{ path: string; message: string; code?: string }>;
  readonly hint?: string;
  readonly context?: Record<string, unknown>;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code;
    this.status = options.status ?? statusForCode(options.code);
    this.details = options.details;
    this.hint = options.hint;
    this.context = options.context;
  }

  static notFound(what: string, code: ErrorCode | string = ERROR_CODES.NOT_FOUND): AppError {
    return new AppError({ code, message: `${what} was not found.` });
  }

  static forbidden(message = 'You do not have permission to perform this action.'): AppError {
    return new AppError({ code: ERROR_CODES.PERMISSION_DENIED, message });
  }

  static validation(message: string, details?: AppErrorOptions['details']): AppError {
    return new AppError({ code: ERROR_CODES.VALIDATION_FAILED, message, details });
  }

  static conflict(code: ErrorCode | string, message: string): AppError {
    return new AppError({ code, message, status: HttpStatus.CONFLICT });
  }

  static unprocessable(code: ErrorCode | string, message: string, hint?: string): AppError {
    return new AppError({ code, message, status: HttpStatus.UNPROCESSABLE_ENTITY, hint });
  }
}

/**
 * HTTP status per domain code. Grouped by intent so an unfamiliar code still
 * lands on a sensible status rather than defaulting to 500.
 */
function statusForCode(code: string): number {
  if (
    code === ERROR_CODES.UNAUTHENTICATED ||
    code === ERROR_CODES.TOKEN_EXPIRED
  ) {
    return HttpStatus.UNAUTHORIZED;
  }
  if (
    code === ERROR_CODES.FORBIDDEN ||
    code === ERROR_CODES.PERMISSION_DENIED ||
    code === ERROR_CODES.TENANT_MISMATCH ||
    code === ERROR_CODES.APPROVAL_REQUIRED
  ) {
    return HttpStatus.FORBIDDEN;
  }
  if (code === ERROR_CODES.NOT_FOUND || code.endsWith('_NOT_FOUND')) return HttpStatus.NOT_FOUND;
  if (
    code === ERROR_CODES.CONFLICT ||
    code === ERROR_CODES.PAYMENT_ALREADY_PROCESSED ||
    code === ERROR_CODES.WEBHOOK_DUPLICATE ||
    code === ERROR_CODES.IDEMPOTENCY_KEY_REUSED ||
    code === ERROR_CODES.IDEMPOTENCY_IN_PROGRESS ||
    code === ERROR_CODES.CONCURRENT_PAYMENT_DETECTED ||
    code === ERROR_CODES.DEMAND_ALREADY_ISSUED ||
    code === ERROR_CODES.APPROVAL_ALREADY_DECIDED ||
    code === ERROR_CODES.REFUND_ALREADY_COMPLETED ||
    code === ERROR_CODES.PAYMENT_INVALID_STATE ||
    code === ERROR_CODES.IMMUTABLE_RECORD
  ) {
    return HttpStatus.CONFLICT;
  }
  if (code === ERROR_CODES.RATE_LIMITED) return HttpStatus.TOO_MANY_REQUESTS;
  if (
    code === ERROR_CODES.GATEWAY_ERROR ||
    code === ERROR_CODES.GATEWAY_TIMEOUT ||
    code === ERROR_CODES.GATEWAY_DISABLED ||
    code === ERROR_CODES.GATEWAY_NOT_CONFIGURED ||
    code === ERROR_CODES.GATEWAY_SIGNATURE_INVALID
  ) {
    return HttpStatus.BAD_GATEWAY;
  }
  if (code === ERROR_CODES.INTERNAL_ERROR) return HttpStatus.INTERNAL_SERVER_ERROR;
  // Domain rules that a caller could satisfy with different input.
  return HttpStatus.UNPROCESSABLE_ENTITY;
}

/** Maps a Prisma failure onto a domain error, without leaking driver detail. */
export function mapPrismaError(error: unknown, entity = 'record'): AppError | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target) ? (error.meta?.target as string[]).join(', ') : 'unique field';
      return AppError.conflict(ERROR_CODES.CONFLICT, `A ${entity} with the same ${target} already exists.`);
    }
    if (error.code === 'P2003') {
      return AppError.unprocessable(
        ERROR_CODES.VALIDATION_FAILED,
        `The ${entity} references a record that does not exist.`,
      );
    }
    if (error.code === 'P2025') {
      return AppError.notFound(entity);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Response envelope
// ---------------------------------------------------------------------------

export interface RequestWithContext extends Request {
  requestId?: string;
  rawBody?: Buffer;
  tenantId?: string;
  tenantHost?: ResolvedTenantHost;
  user?: {
    id: string;
    tenantId: string;
    email: string;
    permissions: string[];
    roles: string[];
    isPlatformAdmin: boolean;
    sessionVersion?: number;
    /** Set for portal accounts, which are pinned to a single student. */
    studentId?: string | null;
    /** Set for parent/guardian portal accounts. */
    guardianId?: string | null;
  };
}

export function requestIdOf(request: RequestWithContext): string {
  return request.requestId ?? 'unknown';
}

export function buildSuccess<T>(data: T, requestId: string, meta?: ApiSuccess<T>['meta']): ApiSuccess<T> {
  return { success: true, data, requestId, ...(meta ? { meta } : {}) };
}

export function buildFailure(error: AppError, requestId: string, includeHint: boolean): ApiFailure {
  return {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      ...(includeHint && error.hint ? { hint: error.hint } : {}),
    },
    requestId,
  };
}

/**
 * Wraps every successful response so the client branches on `success` rather than
 * on the HTTP status alone, and never has to guess at the shape of an error.
 */
export function envelopeInterceptor(options: { includeHints: boolean }): NestInterceptor {
  return {
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
      const request = context.switchToHttp().getRequest<RequestWithContext>();
      return next.handle().pipe(
        map((payload: unknown) => {
          // Streaming responses and already-enveloped payloads pass through.
          if (payload && typeof payload === 'object' && 'success' in (payload as Record<string, unknown>)) {
            return payload;
          }
          return buildSuccess(payload, requestIdOf(request));
        }),
      );
    },
  };
}

/**
 * Converts anything thrown into the standard failure envelope.
 *
 * The filter is deliberately total: an unexpected error still returns a well-formed
 * body with a request id, so the client never has to handle a raw Express error
 * page.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');
  private readonly includeHints: boolean;

  constructor(options: { includeHints: boolean }) {
    this.includeHints = options.includeHints;
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse();
    const request = context.getRequest<RequestWithContext>();
    const requestId = requestIdOf(request);

    const appError = this.toAppError(exception);

    const logPayload = {
      requestId,
      tenantId: request.tenantId,
      userId: request.user?.id,
      method: request.method,
      url: request.originalUrl,
      code: appError.code,
      status: appError.status,
      message: appError.message,
      context: appError.context,
    };

    if (appError.status >= 500) {
      this.logger.error(
        { ...logPayload, err: exception instanceof Error ? exception.stack : exception },
        'Request failed',
      );
    } else {
      this.logger.warn(logPayload, 'Request rejected');
    }

    response.status(appError.status).json(buildFailure(appError, requestId, this.includeHints));
  }

  private toAppError(exception: unknown): AppError {
    if (exception instanceof AppError) return exception;

    if (exception instanceof ZodError) {
      const details = exception.issues.map((issue) => ({
        path: issue.path.join('.') || '(body)',
        message: issue.message,
        code: issue.code,
      }));
      return new AppError({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: `The request payload is invalid: ${details.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
        details,
      });
    }

    const prismaError = mapPrismaError(exception);
    if (prismaError) return prismaError;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as Record<string, unknown>).message as string | string[] | undefined) ?? exception.message;
      const normalisedMessage = Array.isArray(message) ? message.join('; ') : message;
      const code =
        status === HttpStatus.UNAUTHORIZED
          ? ERROR_CODES.UNAUTHENTICATED
          : status === HttpStatus.FORBIDDEN
            ? ERROR_CODES.PERMISSION_DENIED
            : status === HttpStatus.NOT_FOUND
              ? ERROR_CODES.NOT_FOUND
              : status === HttpStatus.TOO_MANY_REQUESTS
                ? ERROR_CODES.RATE_LIMITED
                : ERROR_CODES.VALIDATION_FAILED;
      return new AppError({ code, message: normalisedMessage, status });
    }

    return new AppError({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'An unexpected error occurred. Please quote the request id if you contact support.',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      context: { originalMessage: exception instanceof Error ? exception.message : String(exception) },
    });
  }
}

/** Re-throws an unknown value so `catchError` keeps rxjs semantics intact. */
export function rethrow(handler: (error: unknown) => never): (error: unknown) => Observable<never> {
  return (error: unknown) => throwError(() => handler(error));
}
