import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GlobalExceptionFilter } from './errors';

describe('GlobalExceptionFilter', () => {
  it('returns actionable field paths for Zod validation failures without echoing submitted values', () => {
    let exception: unknown;
    try {
      z.object({ enabled: z.boolean() }).parse({ enabled: 'private-value' });
    } catch (error) {
      exception = error;
    }

    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ requestId: 'validation-test' }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    new GlobalExceptionFilter({ includeHints: false }).catch(exception, host);

    expect(response.status).toHaveBeenCalledWith(422);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        message: expect.stringContaining('enabled:'),
        details: [expect.objectContaining({ path: 'enabled' })],
      }),
    }));
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('private-value');
  });
});
