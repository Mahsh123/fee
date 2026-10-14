import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  AUTHENTICATION_REFRESH_TOKEN_UPDATE_COLUMNS,
  AUTHENTICATION_USER_UPDATE_COLUMNS,
  expectedPublicRelations,
  parsePrismaObjectInventory,
} from './database-acl-manifest.mjs';
import { buildAclManifest, validateCapabilityMarkerSchema, validateLargeObjectInventory } from './sync-database-acls.mjs';

const schema = await readFile(resolve('prisma/schema.prisma'), 'utf8');

test('derives one unique physical table and enum inventory from the complete Prisma schema', () => {
  const inventory = parsePrismaObjectInventory(schema);
  assert.ok(inventory.models.size > 0);
  assert.ok(inventory.enums.length > 0);
  assert.equal(inventory.models.get('User'), 'users');
  assert.equal(inventory.models.get('RefreshToken'), 'refresh_tokens');
  assert.equal(expectedPublicRelations(inventory).size, inventory.models.size + 1);
  assert.ok(expectedPublicRelations(inventory, { hasCapabilityTable: true }).has('app_schema_capabilities'));
});

test('rejects duplicate physical mappings and missing required authentication models', () => {
  assert.throws(() => parsePrismaObjectInventory(`
model First {
  id String @id
  @@map("same")
}
model Second {
  id String @id
  @@map("same")
}
enum State {
  ACTIVE
}`), /duplicate model or physical table mapping/);
  assert.throws(() => parsePrismaObjectInventory(`
model User {
  id String @id
}
enum State {
  ACTIVE
}`), /Required authentication ACL model is missing/);
});

test('grants reviewed application access and keeps audit v2 direct access closed', () => {
  const inventory = parsePrismaObjectInventory(schema);
  const legacy = buildAclManifest(inventory, { auditMode: 'legacy', hasCapabilityTable: true });

  assert.deepEqual(legacy.runtime.get('users'), {
    select: true,
    updateColumns: [
      ...AUTHENTICATION_USER_UPDATE_COLUMNS,
      'email', 'phone', 'firstName', 'lastName', 'status', 'updatedBy', 'passwordHash', 'mustChangePassword', 'sessionVersion',
      'invitationTokenHash', 'invitationExpiresAt', 'emailVerifiedAt', 'passwordResetTokenHash', 'passwordResetExpiresAt',
    ],
    insert: true,
    delete: false,
  });
  assert.deepEqual(legacy.runtime.get('refresh_tokens'), {
    select: true,
    insert: true,
    updateColumns: [...AUTHENTICATION_REFRESH_TOKEN_UPDATE_COLUMNS],
  });
  assert.deepEqual(legacy.runtime.get('audit_logs'), { select: true, insert: true });
  assert.deepEqual(legacy.runtime.get('app_schema_capabilities'), { select: true });
  assert.deepEqual(legacy.runtime.get('fee_demands'), {
    select: true,
    insert: true,
    delete: false,
    updateColumns: ['tenantId', 'updatedAt', 'status', 'issuedAt', 'creditedAmount', 'paidAmount', 'adjustmentAmount', 'updatedBy'],
  });
  assert.deepEqual(legacy.runtime.get('tenants'), {
    select: true,
    insert: true,
    delete: false,
    updateColumns: [
      'updatedAt', 'slug', 'name', 'status', 'contactEmail', 'contactPhone', 'countryCode', 'enabledModules', 'trialEndsAt',
      'subscriptionPlan', 'subscriptionStatus', 'subscriptionRenewalAt', 'updatedBy',
    ],
  });
  assert.deepEqual(legacy.runtime.get('tenant_domains'), {
    select: true,
    insert: true,
    delete: true,
    updateColumns: ['tenantId', 'isPrimary', 'verifiedAt', 'verificationToken'],
  });
  const tenantAdminColumns = new Set(legacy.runtime.get('users').updateColumns);
  for (const column of ['email', 'phone', 'firstName', 'lastName', 'status', 'passwordHash', 'mustChangePassword', 'sessionVersion', 'passwordResetTokenHash', 'passwordResetExpiresAt']) {
    assert.ok(tenantAdminColumns.has(column), `users should allow reviewed administrator operation ${column}`);
  }
  // tenantId is in the ACL for explicit tenant scoping; the immutable
  // identity trigger rejects changing a stored tenant identity.
  for (const column of ['isPlatformAdmin', 'createdBy', 'studentId', 'guardianId']) {
    assert.ok(!tenantAdminColumns.has(column), `users should protect identity field ${column}`);
  }

  const v2 = buildAclManifest(inventory, { auditMode: 'v2', hasCapabilityTable: true });
  assert.equal(v2.runtime.has('audit_logs'), false);
  assert.deepEqual(v2.runtime.get('app_schema_capabilities'), { select: true });
});

test('grants the SaaS provisioning, organization, subscription and billing paths with scoped writes', () => {
  const inventory = parsePrismaObjectInventory(schema);
  const { runtime } = buildAclManifest(inventory, { auditMode: 'legacy', hasCapabilityTable: true });
  const includes = (table, expected) => {
    const grant = runtime.get(table);
    assert.ok(grant, `${table} should be in the runtime ACL manifest`);
    for (const column of expected) assert.ok(grant.updateColumns?.includes(column), `${table} should allow ${column} updates`);
  };

  assert.deepEqual(runtime.get('platform_tenant_provisioning_operations'), {
    select: true, insert: true, delete: false,
  });
  assert.equal(runtime.get('tenant_subscriptions').select, true);
  assert.equal(runtime.get('tenant_subscriptions').insert, true);
  includes('tenant_subscriptions', ['tenantId', 'status', 'isCurrent', 'currentPeriodEnd', 'cancelAtPeriodEnd']);
  assert.equal(runtime.get('plans').insert, true);
  includes('plans', ['name', 'monthlyPrice', 'yearlyPrice', 'active']);
  assert.deepEqual(runtime.get('plan_modules'), { select: true, insert: true, delete: true });
  assert.deepEqual(runtime.get('plan_entitlements'), { select: true, insert: true, delete: true });
  includes('branches', ['tenantId', 'name', 'status', 'managerId', 'enabledModules']);
  includes('organization_units', ['tenantId', 'name', 'parentId', 'active']);
  includes('user_assignments', ['tenantId', 'status', 'dueAt', 'completedAt']);
  assert.equal(runtime.get('user_branch_memberships').delete, true);
  assert.equal(runtime.get('user_organization_memberships').delete, true);
  includes('tenant_module_overrides', ['tenantId', 'enabled', 'reason']);
  includes('tenant_entitlement_overrides', ['tenantId', 'limitValue', 'reason']);
  includes('platform_invoices', ['tenantId', 'status', 'paidAt']);
  includes('platform_payments', ['tenantId', 'status']);
  includes('platform_refunds', ['tenantId', 'status', 'processedAt']);

  assert.deepEqual(runtime.get('attendance_sessions'), {
    select: true, insert: true, delete: false, updateColumns: ['tenantId', 'updatedAt'],
  });
  assert.deepEqual(runtime.get('attendance_records'), {
    select: true, insert: true, delete: false, updateColumns: ['tenantId', 'updatedAt', 'status', 'remarks', 'updatedBy'],
  });
  assert.ok(runtime.get('notifications').updateColumns.includes('readAt'));

  for (const internalTable of ['audit_chain_heads', 'audit_signing_keys', 'audit_request_nonces', 'sequences', 'schema_index_builds']) {
    assert.equal(runtime.has(internalTable), false, `${internalTable} must stay closed to direct runtime access`);
  }
});

test('rejects unknown audit capability states', () => {
  const inventory = parsePrismaObjectInventory(schema);
  assert.throws(() => buildAclManifest(inventory, { auditMode: 'unknown' }), /Unknown audit capability mode/);
});

test('accepts only the approved single text primary-key capability marker schema', () => {
  const columns = [{ column_name: 'key', data_type: 'text', is_nullable: 'NO' }];
  const primaryKeys = [{ columns: ['key'] }];
  assert.doesNotThrow(() => validateCapabilityMarkerSchema(columns, primaryKeys));
  assert.throws(() => validateCapabilityMarkerSchema([...columns, {
    column_name: 'value', data_type: 'text', is_nullable: 'NO',
  }], primaryKeys), /only one non-null text key column/);
  assert.throws(() => validateCapabilityMarkerSchema([
    { ...columns[0], data_type: 'character varying' },
  ], primaryKeys), /only one non-null text key column/);
  assert.throws(() => validateCapabilityMarkerSchema([
    { ...columns[0], is_nullable: 'YES' },
  ], primaryKeys), /only one non-null text key column/);
  assert.throws(() => validateCapabilityMarkerSchema(columns, []), /only primary-key column/);
  assert.throws(() => validateCapabilityMarkerSchema(columns, [{ columns: ['key', 'value'] }]), /only primary-key column/);
});

test('fails closed when PostgreSQL large-object inventory is non-empty or unavailable', () => {
  assert.doesNotThrow(() => validateLargeObjectInventory(false));
  assert.throws(() => validateLargeObjectInventory(true), /large objects require an explicit backup and ACL policy/);
  assert.throws(() => validateLargeObjectInventory(undefined), /inventory could not be verified/);
});
