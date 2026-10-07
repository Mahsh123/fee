/** Return a stable, safe error identifier without logging database or user data. */
export function safeOperationalErrorCode(error: unknown, fallback = 'INTERNAL_ERROR'): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') {
      if (/^P\d{4}$/.test(code) || /^\d{5}$/.test(code)) return `DATABASE_${code}`;
      if (/^[A-Z][A-Z0-9_]{2,79}$/.test(code)) return code;
    }
    if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,79}$/.test(error.message)) return error.message;
  }
  return fallback;
}
