import 'reflect-metadata';
import { Logger, RequestMethod, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './config/env';
import { RequestIdMiddleware } from './common/http';
import { TenantHostResolutionMiddleware } from './common/tenant-host';
import type { RequestWithContext } from './common/errors';
import type { NextFunction, Response } from 'express';
import type { CustomOrigin } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * API bootstrap.
 *
 * Ordering here is deliberate:
 *   - security headers and compression wrap everything, including errors
 *   - the request id is assigned before any handler can log
 *   - the global prefix excludes the health routes, because a load balancer should
 *     not have to know the API version to ask whether an instance is alive
 */

/**
 * Routes that live outside `/api/v1`. A probe that has to track the API version
 * is a probe that breaks during a version bump.
 */
const UNVERSIONED_ROUTES = [
  { path: 'health', method: RequestMethod.ALL },
  { path: 'health/live', method: RequestMethod.ALL },
  { path: 'health/ready', method: RequestMethod.ALL },
];

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
  const config = app.get(AppConfigService);
  const logger = new Logger('Bootstrap');

  configureSecurity(app, config);
  configureRouting(app, config);
  configureDocumentation(app, config);

  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');
  logger.log(`Wasl API listening on http://localhost:${config.port}${config.apiBasePath}`);
  logger.log(`OpenAPI documentation at http://localhost:${config.port}/api/docs`);
}

function configureSecurity(app: INestApplication, config: AppConfigService): void {
  // `crossOriginResourcePolicy` is relaxed so branded PDFs can be embedded by the
  // tenant's own frontend origin. Content-type sniffing stays off and framing
  // stays denied.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      contentSecurityPolicy: false,
    }),
  );
  app.use(compression());
  app.use(cookieParser());
  const requestIdMiddleware = app.get(RequestIdMiddleware);
  app.use((request: never, response: never, next: () => void) => requestIdMiddleware.use(request, response, next));

  const tenantHostMiddleware = app.get(TenantHostResolutionMiddleware);
  app.use((request: RequestWithContext, response: Response, next: NextFunction) => {
    void tenantHostMiddleware.use(request, response, next).catch(next);
  });
  // CORS origin allowlisting is paired with a same-workspace check. This keeps a
  // page on one tenant subdomain from making credentialed requests to a sibling.
  app.use((request: RequestWithContext, response: Response, next: NextFunction) => {
    const origin = request.headers.origin;
    if (origin && !config.allowsBrowserOrigin(origin, request.headers.host)) {
      response.status(403).json({
        success: false,
        error: { code: 'PERMISSION_DENIED', message: 'The request origin is not allowed for this workspace.' },
        requestId: request.requestId ?? 'unknown',
      });
      return;
    }
    next();
  });

  const corsOrigin: CustomOrigin = (origin, callback) => callback(null, origin ? config.allowsBrowserOrigin(origin) : false);
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-request-id', 'x-idempotency-key'],
    exposedHeaders: ['x-request-id'],
    maxAge: 600,
  });
}

function configureRouting(app: INestApplication, config: AppConfigService): void {
  app.setGlobalPrefix(`${config.globalPrefix}/${config.apiVersion}`, { exclude: UNVERSIONED_ROUTES });
}

function configureDocumentation(app: INestApplication, config: AppConfigService): void {
  const builder = new DocumentBuilder()
    .setTitle('Wasl API')
    .setDescription(
      [
        'Multi-tenant fee collection and payment management.',
        '',
        'Every financial response preserves the distinction between what was configured, what was demanded,',
        'what was adjusted, what was paid, what it was allocated to, and what remains outstanding.',
        '',
        'Money is transmitted as decimal strings (`"27000.0000"`), never as JSON numbers, so a value cannot',
        'lose precision in transit.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addTag('auth', 'Sign in, refresh, session')
    .addTag('health', 'Liveness and readiness')
    .addServer(config.apiBasePath)
    .build();

  const document = SwaggerModule.createDocument(app, builder);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
  });
}

void bootstrap().catch((error: unknown) => {
  // A boot failure must be loud: the process is useless, and a silent exit leaves
  // an orchestrator restarting it in a loop with no explanation in the logs.
  // eslint-disable-next-line no-console
  console.error('Failed to start the API:', error);
  process.exit(1);
});
