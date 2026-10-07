import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { AppConfigService } from '../config/env';

export type AuditJsonValue = null | boolean | number | string | AuditJsonValue[] | { [key: string]: AuditJsonValue };

/** Fixed envelope accepted by the signed PostgreSQL audit append wrapper. */
export interface AuditApiEnvelope {
  tenantId: string;
  actorId: string | null;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  requestId: string | null;
  context: {
    actorEmail: string | null;
    actorRoles: string[];
    entityRef: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    severity: string;
  };
  payload: {
    before: AuditJsonValue;
    after: AuditJsonValue;
    diff: AuditJsonValue;
  };
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  keyVersion: number;
}

export type UnsignedAuditApiEnvelope = Omit<AuditApiEnvelope, 'nonce' | 'issuedAt' | 'expiresAt' | 'keyVersion'>;

export interface SignedAuditApiEnvelope {
  envelope: AuditApiEnvelope;
  canonicalEnvelope: string;
  signature: Buffer;
}

/**
 * API-side half of the versioned audit HMAC contract. The matching verifier
 * keys are provisioned separately to fee_audit_owner in PostgreSQL.
 */
@Injectable()
export class AuditEnvelopeSigner {
  constructor(private readonly config: AppConfigService) {}

  sign(input: UnsignedAuditApiEnvelope, now = new Date()): SignedAuditApiEnvelope {
    const signing = this.config.auditSigning;
    const keyVersion = signing.activeKeyVersion;
    const keyHex = signing.keysByVersion[keyVersion];
    if (!keyHex) throw new Error('The active audit signing key is not configured.');
    if (!Number.isFinite(now.getTime())) throw new TypeError('Audit envelope issuance time is invalid.');

    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + signing.maxLifetimeMs).toISOString();
    const envelope: AuditApiEnvelope = {
      ...input,
      nonce: randomUUID(),
      issuedAt,
      expiresAt,
      keyVersion,
    };
    const canonicalEnvelope = canonicalAuditJson(envelope);
    const signature = createHmac('sha256', Buffer.from(keyHex, 'hex'))
      .update(`fee-audit-api:v2\n${canonicalEnvelope}`, 'utf8')
      .digest();
    return { envelope, canonicalEnvelope, signature };
  }
}

/**
 * Canonical JSON shared with the PostgreSQL jsonb canonicalizer. Keys sort by
 * UTF-8 byte order (C collation), arrays preserve order, numbers use normalized
 * decimal notation, and strings use JSON escaping without insignificant space.
 */
export function canonicalAuditJson(value: unknown): string {
  return canonicalAuditJsonInner(value, new WeakSet<object>());
}

function canonicalAuditJsonInner(value: unknown, active: WeakSet<object>): string {
  if (value === null) return 'null';
  if (value === undefined) throw new TypeError('Audit envelope values must not contain undefined.');
  if (typeof value === 'string') {
    assertWellFormedUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Audit envelope numbers must be finite.');
    return normalizeAuditNumber(value);
  }
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError('Audit envelope contains a value that cannot be represented in JSON.');
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new TypeError('Audit envelope contains an invalid date.');
    return JSON.stringify(value.toISOString());
  }
  if (typeof value !== 'object') throw new TypeError('Audit envelope contains an unsupported value.');
  if (active.has(value)) throw new TypeError('Audit envelope contains a cyclic value.');
  active.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${Array.from(value, (item) => item === undefined ? 'null' : canonicalAuditJsonInner(item, active)).join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Audit envelope objects must be plain JSON objects.');
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) throw new TypeError('Audit envelope objects cannot contain symbol keys.');
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')));
    for (const [key] of entries) assertWellFormedUnicode(key);
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalAuditJsonInner(entry, active)}`).join(',')}}`;
  } finally {
    active.delete(value);
  }
}

function normalizeAuditNumber(value: number): string {
  if (Object.is(value, -0)) return '0';
  const source = String(value).toLowerCase();
  const match = source.match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/);
  if (!match) throw new TypeError('Audit envelope number could not be normalized.');
  const [, sign, whole, fraction = '', exponentText = '0'] = match;
  const digits = whole + fraction;
  const point = whole.length + Number(exponentText);
  let integer: string;
  let decimals: string;
  if (point <= 0) {
    integer = '0';
    decimals = '0'.repeat(-point) + digits;
  } else if (point >= digits.length) {
    integer = digits + '0'.repeat(point - digits.length);
    decimals = '';
  } else {
    integer = digits.slice(0, point);
    decimals = digits.slice(point);
  }
  integer = integer.replace(/^0+(?=\d)/, '') || '0';
  decimals = decimals.replace(/0+$/, '');
  const normalized = decimals ? `${integer}.${decimals}` : integer;
  return sign === '-' && normalized !== '0' ? `-${normalized}` : normalized;
}

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('Audit envelope strings must contain valid Unicode.');
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError('Audit envelope strings must contain valid Unicode.');
    }
  }
}
