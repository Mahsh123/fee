import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ZodValidationPipe } from './http';

const bodyMetadata = { type: 'body', metatype: Object, data: undefined } as const;
const queryMetadata = { type: 'query', metatype: Object, data: undefined } as const;
const paramMetadata = { type: 'param', metatype: String, data: 'id' } as const;
const customMetadata = { type: 'custom', metatype: String, data: undefined } as const;

describe('ZodValidationPipe', () => {
  it('validates and replaces only the request body by default', () => {
    const pipe = new ZodValidationPipe(z.object({ enabled: z.boolean() }));
    expect(pipe.transform({ enabled: true, unexpected: 'strip me' }, bodyMetadata)).toEqual({ enabled: true });
  });

  it('does not apply a body schema to route params, tenant context, or request metadata', () => {
    const pipe = new ZodValidationPipe(z.object({ enabled: z.boolean() }));
    const routeId = 'tenant-123';
    const tenantContext = 'tenant-456';
    const request = { headers: {} };

    expect(pipe.transform(routeId, paramMetadata)).toBe(routeId);
    expect(pipe.transform(tenantContext, customMetadata)).toBe(tenantContext);
    expect(pipe.transform(request, { type: 'custom', metatype: Object, data: undefined })).toBe(request);
  });

  it('supports explicit query argument validation', () => {
    const pipe = new ZodValidationPipe(z.object({ date: z.string().date() }), 'query');
    expect(pipe.transform({ date: '2026-10-13' }, queryMetadata)).toEqual({ date: '2026-10-13' });
    const body = { date: '2026-10-13' };
    expect(pipe.transform(body, bodyMetadata)).toBe(body);
  });

  it('still rejects invalid values for the configured argument type', () => {
    const pipe = new ZodValidationPipe(z.object({ enabled: z.boolean() }));
    expect(() => pipe.transform({ enabled: 'true' }, bodyMetadata)).toThrowError(/request payload is invalid/i);
  });
});
