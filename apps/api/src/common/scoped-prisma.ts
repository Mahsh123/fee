import {
  TENANT_FOREIGN_KEY_TARGETS,
  type DatabaseClient,
  type AuditTransactionOperations,
  type NumberingTransactionOperations,
  type TenantScopedDatabaseClient,
  type TenantReferenceRule,
  type TenantReferenceTarget,
  type TransactionExecutorContext,
} from '@fee/database';
import { AppError } from './errors';
import type { TenantContextService } from './tenancy';

const MODEL_DELEGATE_OPERATIONS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'create', 'createMany', 'createManyAndReturn',
  'update', 'updateMany', 'updateManyAndReturn', 'upsert', 'delete', 'deleteMany',
  'count', 'aggregate', 'groupBy',
]);

/**
 * Deletion is opt-in while the database lifecycle guards are being assembled.
 * Financial and evidentiary rows are corrected through lifecycle operations,
 * not generic Prisma delete calls. These four operations are the only current
 * non-financial cleanup paths: replacing memberships/role links, and releasing
 * an idempotency reservation inside the transaction that rolls its work back.
 * Add a model/operation here only with its lifecycle rule and audit behavior.
 */
const APPROVED_DELETE_OPERATIONS = new Map<string, ReadonlySet<string>>([
  ['tenantDomain', new Set(['delete'])],
  ['studentGroupMember', new Set(['deleteMany'])],
  ['userRole', new Set(['deleteMany'])],
  ['rolePermission', new Set(['deleteMany'])],
  ['idempotencyKey', new Set(['delete'])],
]);

// Membership replacement is a purpose-built workflow and must not be filtered
// by the membership it is actively managing. Other branch-tagged assignments
// and their reads use the common live membership scope.
const BRANCH_SCOPE_SERVICE_OWNED_MODELS = new Set(['UserBranchMembership']);

// Records without their own branchId inherit scope from an authoritative parent.
// Each `[]` marks a to-many relation; all other hops are to-one relations.
const BRANCH_SCOPE_RELATION_PATHS: Readonly<Record<string, string>> = Object.freeze({
  Branch: 'memberships[]',
  User: 'branchMemberships[]',
  UserRole: 'user.branchMemberships[]',
  UserOrganizationMembership: 'user.branchMemberships[]',
  FeeDemandItem: 'demand',
  FeeDemandResponsibility: 'demand',
  FeeDemandItemAdjustment: 'demandItem.demand',
  Installment: 'demand',
  InstallmentItem: 'installment.demand',
  PaymentAllocation: 'payment',
  CreditAllocation: 'credit',
  RefundAllocation: 'refund',
  InvoiceLine: 'invoice',
  ReceiptLine: 'receipt',
  GatewayTransaction: 'paymentOrder',
  Guardian: 'students[].student',
  StudentGuardian: 'student',
  StudentGroupMember: 'student',
  StudentCustomAttribute: 'student',
  StudentUnitMembership: 'student',
});

/** Runtime guard for application handles; only generated model delegates are exposed. */
export function createTenantScopedDatabaseHandle(
  client: DatabaseClient,
  options: { numberingTransactionOperations?: boolean; auditTransactionOperations?: boolean } = {},
): TenantScopedDatabaseClient {
  const runtimeModels = (client as unknown as {
    _runtimeDataModel?: { models?: Record<string, unknown> };
  })._runtimeDataModel?.models;
  const modelNames = Object.keys(runtimeModels ?? TENANT_FOREIGN_KEY_TARGETS);
  if (!runtimeModels) modelNames.push('Tenant', 'Permission');
  const delegateNames = new Set(modelNames.map((model) => `${model[0]!.toLowerCase()}${model.slice(1)}`));
  const safeDelegates = new Map<string, object>();

  // Use an empty proxy target so raw Prisma client properties, internal methods,
  // descriptors, symbols, and prototype chains cannot leak around the allowlist.
  return new Proxy(Object.create(null) as object, {
    get(_target, property) {
      if (options.numberingTransactionOperations && property === 'reserveDocumentNumber') {
        return (input: Parameters<NumberingTransactionOperations['reserveDocumentNumber']>[0]) => reserveDocumentNumber(client, input);
      }
      if (options.numberingTransactionOperations && property === 'lockNumberingConfiguration') {
        return (tenantId: string) => lockNumberingConfiguration(client, tenantId);
      }
      if (options.auditTransactionOperations && property === 'prepareAuditAppend') {
        return (tenantId: string) => prepareAuditAppend(client, tenantId);
      }
      if (options.auditTransactionOperations && property === 'verifyAuditChain') {
        return (tenantId: string, limit: number) => verifyAuditChain(client, tenantId, limit);
      }
      if (options.auditTransactionOperations && property === 'readAuditLogs') {
        return (input: Parameters<AuditTransactionOperations['readAuditLogs']>[0]) => readAuditLogs(client, input);
      }
      if (options.auditTransactionOperations && property === 'appendSignedAudit') {
        return (input: Parameters<AuditTransactionOperations['appendSignedAudit']>[0]) => appendSignedAudit(client, input);
      }
      if (typeof property !== 'string' || !delegateNames.has(property)) return undefined;
      let safeDelegate = safeDelegates.get(property);
      if (!safeDelegate) {
        const rawDelegate = Reflect.get(client, property, client);
        if ((typeof rawDelegate !== 'object' && typeof rawDelegate !== 'function') || rawDelegate === null) return undefined;
        safeDelegate = createSafeModelDelegate(rawDelegate as object, property);
        safeDelegates.set(property, safeDelegate);
      }
      return safeDelegate;
    },
    has(_target, property) {
      return typeof property === 'string' && delegateNames.has(property);
    },
    ownKeys() {
      return [];
    },
    getOwnPropertyDescriptor() {
      return undefined;
    },
    getPrototypeOf() {
      return null;
    },
  }) as TenantScopedDatabaseClient;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function setDatabaseTenantContext(client: DatabaseClient, tenantId: string): Promise<void> {
  if (!UUID_PATTERN.test(tenantId)) throw new TypeError('A valid tenant UUID is required for database-scoped operations.');
  await client.$queryRaw`SELECT pg_catalog.set_config('fee.current_tenant', ${tenantId}, true) AS tenant_context`;
}

/**
 * Chooses the legacy or v2 append path under the shared cutover lock. Legacy
 * appends also take their per-tenant advisory lock before reading a timestamp;
 * a v2 append retains the shared lock while the signed wrapper locks its head.
 */
async function prepareAuditAppend(client: DatabaseClient, tenantId: string): Promise<{ mode: 'legacy'; recordedAt: Date } | { mode: 'v2' }> {
  if (!UUID_PATTERN.test(tenantId)) throw new TypeError('A valid tenant UUID is required for audit append.');
  await client.$queryRaw`SELECT pg_catalog.set_config('fee.current_tenant', ${tenantId}, true) AS tenant_context`;
  await client.$queryRaw`SELECT pg_catalog.pg_advisory_xact_lock_shared(4605253, 1095058482)::text AS lock_acquired`;
  const capabilityTable = await client.$queryRaw<Array<{ present: boolean }>>`
    SELECT pg_catalog.to_regclass('public.app_schema_capabilities') IS NOT NULL AS present
  `;
  if (capabilityTable[0]?.present) {
    const marker = await client.$queryRaw<Array<{ installed: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM public.app_schema_capabilities WHERE key = 'audit-chain-v2'
      ) AS installed
    `;
    if (marker[0]?.installed) return { mode: 'v2' };
  }
  await client.$queryRaw`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${tenantId}, 0))::text AS lock_acquired`;
  const result = await client.$queryRaw<Array<{ recorded_at: Date }>>`SELECT pg_catalog.clock_timestamp() AS recorded_at`;
  if (!(result[0]?.recorded_at instanceof Date) || Number.isNaN(result[0].recorded_at.getTime())) {
    throw new Error('The database did not return an audit append timestamp.');
  }
  return { mode: 'legacy', recordedAt: result[0].recorded_at };
}

async function appendSignedAudit(
  client: DatabaseClient,
  input: Parameters<AuditTransactionOperations['appendSignedAudit']>[0],
): Promise<string> {
  if (!UUID_PATTERN.test(input.tenantId) || (input.actorId !== null && !UUID_PATTERN.test(input.actorId))) {
    throw new TypeError('Signed audit tenant or actor context is invalid.');
  }
  if (typeof input.envelopeJson !== 'string' || input.envelopeJson.length === 0 || !(input.signature instanceof Uint8Array) || input.signature.length !== 32) {
    throw new TypeError('Signed audit envelope or signature is invalid.');
  }
  await client.$queryRaw`SELECT pg_catalog.set_config('fee.current_tenant', ${input.tenantId}, true) AS tenant_context`;
  await client.$queryRaw`SELECT pg_catalog.set_config('fee.current_actor_id', ${input.actorId ?? ''}, true) AS actor_context`;
  await client.$queryRaw`SELECT pg_catalog.set_config('fee.current_request_id', ${input.requestId ?? ''}, true) AS request_context`;
  const result = await client.$queryRaw<Array<{ audit_id: string }>>`
    SELECT app_private.fee_audit_append_api(${input.envelopeJson}::jsonb, ${input.signature}::bytea) AS audit_id
  `;
  const auditId = result[0]?.audit_id;
  if (!UUID_PATTERN.test(auditId ?? '')) throw new Error('The signed audit append function did not return an audit record ID.');
  return auditId;
}

async function verifyAuditChain(
  client: DatabaseClient,
  tenantId: string,
  limit: number,
): Promise<Awaited<ReturnType<AuditTransactionOperations['verifyAuditChain']>>> {
  if (!UUID_PATTERN.test(tenantId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100_000) {
    throw new TypeError('Audit verification tenant or limit is invalid.');
  }
  await setDatabaseTenantContext(client, tenantId);
  await client.$queryRaw`SELECT pg_catalog.pg_advisory_xact_lock_shared(4605253, 1095058482)::text AS lock_acquired`;
  const capabilityTable = await client.$queryRaw<Array<{ present: boolean }>>`
    SELECT pg_catalog.to_regclass('public.app_schema_capabilities') IS NOT NULL AS present
  `;
  if (!capabilityTable[0]?.present) return { mode: 'legacy' };
  const marker = await client.$queryRaw<Array<{ installed: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM public.app_schema_capabilities WHERE key = 'audit-chain-v2') AS installed
  `;
  if (!marker[0]?.installed) return { mode: 'legacy' };
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT app_private.fee_audit_verify_tenant(${tenantId}::uuid, ${limit}::integer) AS result
  `;
  const value = rows[0]?.result;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The tenant-scoped audit verifier returned an invalid result.');
  }
  const result = value as Record<string, unknown>;
  if (typeof result.intact !== 'boolean' || typeof result.checked !== 'number' ||
      (result.brokenAt !== null && result.brokenAt !== undefined && typeof result.brokenAt !== 'string')) {
    throw new Error('The tenant-scoped audit verifier returned an invalid result.');
  }
  return {
    mode: 'v2',
    result: { intact: result.intact, checked: result.checked, ...(typeof result.brokenAt === 'string' ? { brokenAt: result.brokenAt } : {}) },
  };
}

async function readAuditLogs(
  client: DatabaseClient,
  input: Parameters<AuditTransactionOperations['readAuditLogs']>[0],
): Promise<Awaited<ReturnType<AuditTransactionOperations['readAuditLogs']>>> {
  if (!UUID_PATTERN.test(input.tenantId) || (input.id !== undefined && !UUID_PATTERN.test(input.id)) ||
      !Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > 1_000_000 ||
      !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100 ||
      input.sort.length < 1 || input.sort.length > 4) {
    throw new TypeError('Audit read tenant, record, pagination, or sort is invalid.');
  }
  await setDatabaseTenantContext(client, input.tenantId);
  await client.$queryRaw`SELECT pg_catalog.pg_advisory_xact_lock_shared(4605253, 1095058482)::text AS lock_acquired`;
  const capabilityTable = await client.$queryRaw<Array<{ present: boolean }>>`
    SELECT pg_catalog.to_regclass('public.app_schema_capabilities') IS NOT NULL AS present
  `;
  if (!capabilityTable[0]?.present) return { mode: 'legacy' };
  const marker = await client.$queryRaw<Array<{ installed: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM public.app_schema_capabilities WHERE key = 'audit-chain-v2') AS installed
  `;
  if (!marker[0]?.installed) return { mode: 'legacy' };
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT app_private.fee_audit_read_tenant(
      ${input.tenantId}::uuid,
      ${input.id ?? null}::uuid,
      ${JSON.stringify(input.filters)}::jsonb,
      ${input.offset}::integer,
      ${input.limit}::integer,
      ${JSON.stringify(input.sort)}::jsonb
    ) AS result
  `;
  const value = rows[0]?.result;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The tenant-scoped audit reader returned an invalid result.');
  }
  const result = value as Record<string, unknown>;
  if (input.id !== undefined) {
    if (result.item !== null && (typeof result.item !== 'object' || Array.isArray(result.item))) {
      throw new Error('The tenant-scoped audit reader returned an invalid record.');
    }
    return { mode: 'v2', result: { item: result.item as Record<string, unknown> | null } };
  }
  if (!Array.isArray(result.items) || typeof result.total !== 'number' || !Number.isSafeInteger(result.total) ||
      result.items.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('The tenant-scoped audit reader returned an invalid page.');
  }
  return { mode: 'v2', result: { items: result.items as Record<string, unknown>[], total: result.total } };
}

async function lockNumberingConfiguration(client: DatabaseClient, tenantId: string): Promise<void> {
  await setDatabaseTenantContext(client, tenantId);
  const result = await client.$queryRaw<Array<{ fee_lock_numbering_configuration: boolean }>>`
    SELECT app_private.fee_lock_numbering_configuration(${tenantId}::uuid)
  `;
  if (result[0]?.fee_lock_numbering_configuration !== true) throw new Error('The database did not acquire the numbering configuration lock.');
}

async function reserveDocumentNumber(
  client: DatabaseClient,
  input: Parameters<NumberingTransactionOperations['reserveDocumentNumber']>[0],
): Promise<string> {
  if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(input.kind) || !/^\d{4}-\d{2}-\d{2}$/.test(input.asOfDate)
    || typeof input.consume !== 'boolean'
    || (input.scope !== null && (typeof input.scope !== 'string' || input.scope.length > 120))) {
    throw new TypeError('Document numbering input is invalid.');
  }
  await setDatabaseTenantContext(client, input.tenantId);
  const result = await client.$queryRaw<Array<{ document_number: string }>>`
    SELECT app_private.fee_document_number(
      ${input.tenantId}::uuid,
      ${input.kind}::public."SequenceKind",
      ${input.scope}::text,
      ${input.asOfDate}::date,
      ${input.consume}
    ) AS document_number
  `;
  if (!result[0]?.document_number) throw new Error('The database did not return a document number.');
  return result[0].document_number;
}

function createSafeModelDelegate(rawDelegate: object, modelDelegate: string): object {
  return new Proxy(Object.create(null) as object, {
    get(_target, property) {
      if (typeof property !== 'string' || !MODEL_DELEGATE_OPERATIONS.has(property)) return undefined;
      if ((property === 'delete' || property === 'deleteMany')
        && !APPROVED_DELETE_OPERATIONS.get(modelDelegate)?.has(property)) {
        throw new TypeError(`Direct ${property} is not enabled for ${modelDelegate}; use its approved lifecycle operation.`);
      }
      const operation = Reflect.get(rawDelegate, property, rawDelegate);
      return typeof operation === 'function' ? operation.bind(rawDelegate) : undefined;
    },
    has(_target, property) {
      if (typeof property !== 'string' || !MODEL_DELEGATE_OPERATIONS.has(property)) return false;
      if ((property === 'delete' || property === 'deleteMany')
        && !APPROVED_DELETE_OPERATIONS.get(modelDelegate)?.has(property)) return false;
      return typeof Reflect.get(rawDelegate, property, rawDelegate) === 'function';
    },
    ownKeys() {
      return [];
    },
    getOwnPropertyDescriptor() {
      return undefined;
    },
    getPrototypeOf() {
      return null;
    },
  });
}

/**
 * Prisma models that are intentionally global metadata. All other current
 * Prisma models have a `tenantId` column; defaulting new models to tenant scope
 * makes the safe choice automatic when the schema grows.
 */
const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);
const GLOBAL_PERMISSION_WRITE_OPERATIONS = new Set([
  ...CREATE_OPERATIONS,
  'update', 'updateMany', 'updateManyAndReturn', 'delete', 'deleteMany', 'upsert',
]);
const PLATFORM_CATALOG_MODELS = new Set(['Plan', 'PlanModule', 'PlanEntitlement']);
const PLATFORM_CATALOG_READ_OPERATIONS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
]);
const INTERNAL_ONLY_GLOBAL_MODELS = new Set(['AuditSigningKey', 'SchemaIndexBuild']);

/**
 * Extends every model operation so tenant-owned reads and writes cannot be
 * issued without a tenant scope. Explicit tenant predicates are checked rather
 * than trusted, and writes receive the authenticated tenant ID automatically.
 */
export function createTenantScopedClient(
  client: DatabaseClient,
  tenantContext: TenantContextService,
  transactionContext: TransactionExecutorContext,
): DatabaseClient {
  const runtimeModels = (client as unknown as {
    _runtimeDataModel?: { models?: Record<string, { fields?: Array<{
      name: string; kind: string; type?: string; relationName?: string; relationFromFields?: string[]; relationToFields?: string[];
    }> }> };
  })._runtimeDataModel?.models;

  const extended = client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const relationNames = getRelationNames(model, runtimeModels);
          if (model === 'Tenant' && isVerifiedCustomDomainDirectoryLookup(operation, args, relationNames)) {
            assertTenantDirectoryAccess(operation, args, tenantContext);
            return query(args);
          }
          if (model === 'Plan') {
            const context = tenantContext.peek();
            if (!context?.tenantId && !context?.isPlatformAdmin) throw AppError.forbidden('Plan catalog access requires an authenticated workspace or platform session.');
            if (!PLATFORM_CATALOG_READ_OPERATIONS.has(operation) && !context?.isPlatformAdmin) {
              throw AppError.forbidden('Only a verified platform administrator can modify the plan catalog.');
            }
            assertPlanCatalogRelationAccess(args, relationNames, Boolean(context?.isPlatformAdmin));
            return query(args);
          }
          assertNoRelationTraversal(args, relationNames, safeReadRelationNames(model, runtimeModels));

          if (model === 'Tenant') {
            assertTenantDirectoryAccess(operation, args, tenantContext);
            return query(args);
          }
          if (model === 'Permission') {
            if (GLOBAL_PERMISSION_WRITE_OPERATIONS.has(operation) && !tenantContext.peek()?.isPlatformAdmin) {
              throw AppError.forbidden('Only a verified platform administrator can modify global permissions.');
            }
            return query(args);
          }
          if (PLATFORM_CATALOG_MODELS.has(model)) {
            const context = tenantContext.peek();
            if (!context?.tenantId && !context?.isPlatformAdmin) throw AppError.forbidden('Plan catalog access requires an authenticated workspace or platform session.');
            if (!PLATFORM_CATALOG_READ_OPERATIONS.has(operation) && !context.isPlatformAdmin) {
              throw AppError.forbidden('Only a verified platform administrator can modify the plan catalog.');
            }
            return query(args);
          }
          if (INTERNAL_ONLY_GLOBAL_MODELS.has(model)) {
            throw AppError.forbidden('This database metadata is only available through its reviewed operational interface.');
          }

          const tenantId = tenantContext.requireTenantId();
          const input = args as Record<string, unknown>;
          const scoped: Record<string, unknown> = { ...input };
          const context = tenantContext.peek();
          const hasBranchId = Boolean(runtimeModels?.[model]?.fields?.some((field) => field.name === 'branchId' && field.kind === 'scalar'));
          const applyBranchScope = Boolean(context?.branchScopeEnabled && (hasBranchId || BRANCH_SCOPE_RELATION_PATHS[model]) && !BRANCH_SCOPE_SERVICE_OWNED_MODELS.has(model));

          if (WHERE_OPERATIONS.has(operation)) {
            scoped.where = scopeWhere(input.where, tenantId);
            if (applyBranchScope) scoped.where = withBranchScope(scoped.where, context?.branchIds ?? [], hasBranchId ? undefined : BRANCH_SCOPE_RELATION_PATHS[model]);
          }
          if (
            CREATE_OPERATIONS.has(operation) ||
            operation === 'update' ||
            operation === 'updateMany' ||
            operation === 'updateManyAndReturn'
          ) {
            scoped.data = scopeData(input.data, tenantId);
            if (applyBranchScope && hasBranchId) scoped.data = scopeBranchWrite(scoped.data, context?.branchIds ?? [], CREATE_OPERATIONS.has(operation));
            await verifyForeignKeyReferences(client, transactionContext, model, scoped.data, tenantId, operation);
          }
          if (operation === 'upsert') {
            scoped.create = scopeData(input.create, tenantId);
            scoped.update = scopeData(input.update, tenantId);
            if (applyBranchScope) {
              scoped.where = withBranchScope(scopeWhere(input.where, tenantId), context?.branchIds ?? [], hasBranchId ? undefined : BRANCH_SCOPE_RELATION_PATHS[model]);
              if (hasBranchId) {
                scoped.create = scopeBranchWrite(scoped.create, context?.branchIds ?? [], true);
                scoped.update = scopeBranchWrite(scoped.update, context?.branchIds ?? [], false);
              }
            }
            await verifyForeignKeyReferences(client, transactionContext, model, scoped.create, tenantId, 'create');
            await verifyForeignKeyReferences(client, transactionContext, model, scoped.update, tenantId, 'update');
          }

          return query(scoped as typeof args);
        },
      },
    },
  });

  // Query extensions retain the full Prisma client surface at runtime. The
  // generated structural type is preserved here for the existing transaction
  // helpers, while all model calls flow through the extension above.
  return extended as unknown as DatabaseClient;
}

type RuntimeField = {
  name: string;
  kind: string;
  type?: string;
  relationName?: string;
  relationFromFields?: string[];
  relationToFields?: string[];
};
type RuntimeModels = Record<string, { fields?: RuntimeField[] }> | undefined;

function getRelationNames(model: string, models: RuntimeModels): ReadonlySet<string> {
  const fields = models?.[model]?.fields;
  if (!fields) {
    throw new AppError({
      code: 'INTERNAL_ERROR',
      message: 'The database model metadata is unavailable; the operation was stopped safely.',
      status: 500,
      context: { model },
    });
  }
  return new Set(fields.filter((field) => field.kind === 'object').map((field) => field.name));
}

/**
 * Allows relation reads only when the schema has a tenant-keyed FK edge, a
 * direct FK to the already-pinned Tenant row, or a read-only global catalog
 * reference. Nested writes remain prohibited because the tenant extension
 * cannot inject tenantId into child records.
 */
function safeReadRelationNames(model: string, models: RuntimeModels): ReadonlySet<string> {
  const source = models?.[model];
  const sourceFields = source?.fields;
  if (!sourceFields?.some((field) => field.name === 'tenantId' && field.kind === 'scalar')) return new Set();
  const safe = new Set<string>();
  for (const relation of sourceFields.filter((field) => field.kind === 'object')) {
    const target = relation.type ? models?.[relation.type] : undefined;
    const targetFields = target?.fields ?? [];
    if (relation.type === 'Tenant') {
      if (relation.relationFromFields?.includes('tenantId') && relation.relationToFields?.includes('id')) safe.add(relation.name);
      continue;
    }
    if (['Plan', 'PlanModule', 'PlanEntitlement', 'Permission'].includes(relation.type ?? '')) {
      safe.add(relation.name);
      continue;
    }
    if (!targetFields.some((field) => field.name === 'tenantId' && field.kind === 'scalar')) continue;
    if (relation.relationFromFields?.includes('tenantId') && relation.relationToFields?.includes('tenantId')) {
      safe.add(relation.name);
      continue;
    }
    // The list side of a Prisma relation has no FK fields. Require its inverse
    // to carry the composite tenant key before allowing relation reads.
    const inverse = targetFields.find((field) => field.kind === 'object' && field.relationName === relation.relationName);
    if (inverse?.relationFromFields?.includes('tenantId') && inverse.relationToFields?.includes('tenantId')) safe.add(relation.name);
  }
  return safe;
}

/**
 * Prisma query extensions see root model operations only. Relation reads are
 * allowed only when runtime metadata proves a tenant-composite FK (or a narrow
 * global reference); nested relation writes remain rejected.
 */
function assertNoRelationTraversal(args: unknown, relationNames: ReadonlySet<string>, safeReadRelations: ReadonlySet<string> = new Set()): void {
  if (!isRecord(args)) return;
  const blockedReadRelations = new Set([...relationNames].filter((name) => !safeReadRelations.has(name)));

  for (const selectionKey of ['include', 'select'] as const) {
    const selection = args[selectionKey];
    if (isRecord(selection)) {
      if ([...blockedReadRelations].some((name) => selection[name] !== undefined && selection[name] !== false)) {
        throw unsafeRelationOperation();
      }
      if (selectsRelationCount(selection._count, blockedReadRelations)) throw unsafeRelationOperation();
    }
  }

  for (const key of ['where', 'orderBy', 'having', 'cursor'] as const) {
    if (containsRelationKey(args[key], blockedReadRelations, key === 'where')) throw unsafeRelationOperation();
  }

  // Root and nested relation rows cannot be proven to receive the current
  // tenant predicate, so the checked FK grants are used for reads only.
  for (const key of ['data', 'create', 'update'] as const) {
    if (containsRelationKey(args[key], relationNames, false)) throw unsafeRelationOperation();
  }
}

function selectsRelationCount(value: unknown, relationNames: ReadonlySet<string>): boolean {
  if (value === true) return relationNames.size > 0;
  if (!isRecord(value)) return false;
  const selected = isRecord(value.select) ? value.select : undefined;
  return !!selected && [...relationNames].some((name) => selected[name] !== undefined && selected[name] !== false);
}

async function verifyForeignKeyReferences(
  client: DatabaseClient,
  transactionContext: TransactionExecutorContext,
  model: string,
  data: unknown,
  tenantId: string,
  operation: string,
): Promise<void> {
  const targets = TENANT_FOREIGN_KEY_TARGETS[model];
  if (!targets) return;
  const rows = Array.isArray(data) ? data : [data];
  const idsByTarget = new Map<string, { target: TenantReferenceTarget; ids: Set<string> }>();
  const references: Array<{ id: string; targetKeys: string[] }> = [];

  for (const row of rows) {
    if (!isRecord(row)) continue;
    for (const [field, rule] of Object.entries(targets)) {
      const resolved = resolveReferenceTargets(row, field, rule as TenantReferenceRule, operation);
      if (!resolved) continue;
      const { ids, targetSpecs } = resolved;
      for (const id of ids) {
        const targetKeys: string[] = [];
        for (const target of targetSpecs) {
          const key = `${target.model}.${target.field}`;
          const grouped = idsByTarget.get(key) ?? { target, ids: new Set<string>() };
          grouped.ids.add(id);
          idsByTarget.set(key, grouped);
          targetKeys.push(key);
        }
        references.push({ id, targetKeys });
      }
    }
  }

  const executor = (transactionContext.current() ?? client) as unknown as Record<string, unknown>;
  const foundByTarget = new Map<string, Set<string>>();
  for (const [key, { target, ids }] of idsByTarget) {
    const delegateName = `${target.model[0]!.toLowerCase()}${target.model.slice(1)}`;
    const delegate = executor[delegateName];
    if (!isRecord(delegate) || typeof delegate.findMany !== 'function') throw unsafeRelationOperation();

    // Model and field names come from the schema/manifest; IDs are bound values
    // and tenant ownership is explicit. Dynamic references use one target per
    // discriminator value so same-UUID rows in different tables cannot collide.
    const found = (await (delegate.findMany as (args: unknown) => Promise<unknown[]>).call(delegate, {
      where: { tenantId, [target.field]: { in: [...ids] } },
      select: { [target.field]: true },
    })) as Array<Record<string, unknown>>;
    const foundIds = new Set<string>();
    for (const row of found) {
      const value = row[target.field];
      if (typeof value === 'string') foundIds.add(value);
    }
    foundByTarget.set(key, foundIds);
  }

  for (const reference of references) {
    if (!reference.targetKeys.some((key) => foundByTarget.get(key)?.has(reference.id))) {
      throw new AppError({
        code: 'TENANT_MISMATCH',
        message: 'A related record is unavailable in the authenticated institution.',
      });
    }
  }
}

function resolveReferenceTargets(
  row: Record<string, unknown>,
  field: string,
  rule: TenantReferenceRule,
  operation: string,
): { ids: string[]; targetSpecs: readonly TenantReferenceTarget[] } | undefined {
  const isDynamic = !Array.isArray(rule);
  if (!isDynamic) {
    const ids = referenceIds(row[field]);
    return ids.length > 0 ? { ids, targetSpecs: rule as readonly TenantReferenceTarget[] } : undefined;
  }

  const dynamicRule = rule as Exclude<TenantReferenceRule, readonly TenantReferenceTarget[]>;
  // Treat an own property whose value is `undefined` as omitted. Prisma ignores
  // those values, so treating them as a supplied pair would let a caller change
  // the discriminator while the stored ID remains unchanged.
  const hasReference = Object.hasOwn(row, field) && hasDefinedReferenceInput(row[field]);
  const hasDiscriminator = Object.hasOwn(row, dynamicRule.discriminator) && hasDefinedReferenceInput(row[dynamicRule.discriminator]);
  const ids = hasReference ? referenceIds(row[field]) : [];
  const isCreate = operation.startsWith('create');

  if (!hasReference && hasDiscriminator && !isCreate) {
    throw AppError.validation('A polymorphic reference and its type must be changed together.');
  }
  if (ids.length === 0) return undefined;
  const discriminatorValue = hasDiscriminator
    ? row[dynamicRule.discriminator]
    : isCreate ? dynamicRule.defaultValue : undefined;
  if (typeof discriminatorValue !== 'string') {
    throw AppError.validation('A polymorphic reference requires an explicit reference type.');
  }

  const targetSpecs = dynamicRule.values[discriminatorValue];
  if (!targetSpecs) throw AppError.validation('The polymorphic reference type is not supported.');
  return { ids, targetSpecs };
}

function referenceIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string')) return value;
    throw AppError.validation('Related record references must be record IDs.');
  }
  if (isRecord(value)) {
    const supportedOperations = Object.keys(value);
    if (supportedOperations.length === 0 || supportedOperations.some((key) => !['set', 'push'].includes(key))) {
      throw AppError.validation('A related record reference must be a record ID.');
    }
    return supportedOperations.flatMap((key) => referenceIds(value[key]));
  }
  throw AppError.validation('A related record reference must be a record ID.');
}

/** Prisma ignores `undefined` recursively, including inside scalar `set` operators. */
function hasDefinedReferenceInput(value: unknown): boolean {
  if (value === undefined) return false;
  if (isRecord(value)) {
    const entries = Object.values(value);
    return entries.length > 0 && entries.some(hasDefinedReferenceInput);
  }
  return true;
}

function containsRelationKey(value: unknown, relationNames: ReadonlySet<string>, logicalWhere: boolean): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsRelationKey(entry, relationNames, logicalWhere));
  if (!isRecord(value)) return false;

  for (const [key, nested] of Object.entries(value)) {
    if (relationNames.has(key)) return true;
    if (logicalWhere && (key === 'AND' || key === 'OR' || key === 'NOT')) {
      if (containsRelationKey(nested, relationNames, true)) return true;
    }
  }
  return false;
}

function unsafeRelationOperation(): AppError {
  return new AppError({
    code: 'INTERNAL_ERROR',
    message: 'The database operation was stopped because its tenant relationship could not be verified safely.',
    status: 500,
  });
}

const PUBLIC_TENANT_FIELDS = new Set(['id', 'slug', 'name', 'status']);

/**
 * Tenant is an intentionally unscoped directory model only for narrow public
 * slug resolution, current-tenant identity reads, and verified platform admins.
 */
function assertTenantDirectoryAccess(
  operation: string,
  args: unknown,
  tenantContext: TenantContextService,
): void {
  const context = tenantContext.peek();
  if (context?.isPlatformAdmin) return;
  if (!isRecord(args)) throw AppError.forbidden('Tenant directory access is not permitted.');

  const where = isRecord(args.where) ? args.where : undefined;
  const select = isRecord(args.select) ? args.select : undefined;
  if (!where || !select || Object.keys(select).length === 0) {
    throw AppError.forbidden('Tenant directory access is not permitted.');
  }
  const ownTenantModulesLookup = !!context?.tenantId &&
    operation === 'findFirst' &&
    Object.keys(where).length === 1 &&
    where.id === context.tenantId &&
    Object.keys(select).length === 1 &&
    select.enabledModules === true;
  if (Object.keys(select).some((field) => !PUBLIC_TENANT_FIELDS.has(field) || select[field] !== true) && !ownTenantModulesLookup) {
    throw AppError.forbidden('Tenant directory access is not permitted.');
  }

  const whereFields = Object.keys(where);
  const publicSlugLookup =
    !context?.tenantId &&
    operation === 'findUnique' &&
    whereFields.length === 1 &&
    typeof where.slug === 'string';
  const publicVerifiedDomainLookup =
    !context?.tenantId &&
    operation === 'findFirst' &&
    whereFields.length === 1 &&
    isVerifiedCustomDomainPredicate(where.domains) &&
    Object.keys(select).length === PUBLIC_TENANT_FIELDS.size &&
    [...PUBLIC_TENANT_FIELDS].every((field) => select[field] === true);
  const currentTenantLookup =
    !!context?.tenantId &&
    operation === 'findUnique' &&
    whereFields.length === 1 &&
    where.id === context.tenantId;

  if (!publicSlugLookup && !publicVerifiedDomainLookup && !currentTenantLookup && !ownTenantModulesLookup) {
    throw AppError.forbidden('Tenant directory access is not permitted.');
  }
}

/** The only public relation traversal allowed is an exact, verified hostname lookup. */
function isVerifiedCustomDomainDirectoryLookup(operation: string, args: unknown, relationNames: ReadonlySet<string>): boolean {
  if (operation !== 'findFirst' || !isRecord(args) || !isRecord(args.select)) return false;
  const select = args.select;
  if (!relationNames.has('domains') || Object.keys(select).length !== PUBLIC_TENANT_FIELDS.size ||
      ![...PUBLIC_TENANT_FIELDS].every((field) => select[field] === true)) return false;
  const where = isRecord(args.where) ? args.where : undefined;
  return !!where && Object.keys(where).length === 1 && isVerifiedCustomDomainPredicate(where.domains);
}

function isVerifiedCustomDomainPredicate(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isRecord(value.some)) return false;
  const domain = value.some;
  if (Object.keys(domain).length !== 2 || typeof domain.domain !== 'string' || !isRecord(domain.verifiedAt)) return false;
  return Object.keys(domain.verifiedAt).length === 1 && domain.verifiedAt.not === null;
}

/** Plans are global, but only the platform can edit them or inspect all subscriber counts. */
function assertPlanCatalogRelationAccess(args: unknown, relationNames: ReadonlySet<string>, isPlatformAdmin: boolean): void {
  if (!isRecord(args)) return;
  for (const selectionKey of ['include', 'select'] as const) {
    const selection = args[selectionKey];
    if (!isRecord(selection)) continue;
    for (const [field, value] of Object.entries(selection)) {
      if (relationNames.has(field) && !['modules', 'entitlements'].includes(field)) throw unsafeRelationOperation();
      if (field === '_count' && value !== undefined && value !== false) {
        const counts = isRecord(value) && isRecord(value.select) ? value.select : undefined;
        if (!isPlatformAdmin || !counts || !isRecord(value) || Object.keys(value).some((key) => key !== 'select') ||
            Object.keys(counts).some((name) => name !== 'subscriptions' || counts[name] !== true)) {
          throw unsafeRelationOperation();
        }
      }
    }
  }
  for (const key of ['where', 'orderBy', 'having', 'cursor'] as const) {
    if (containsRelationKey(args[key], relationNames, key === 'where')) throw unsafeRelationOperation();
  }
  const allowedNestedMutation = new Set(['modules', 'entitlements']);
  for (const key of ['data', 'create', 'update'] as const) {
    const value = args[key];
    const rows = Array.isArray(value) ? value : [value];
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const relationFields = Object.keys(row).filter((field) => relationNames.has(field));
      if (relationFields.some((field) => !isPlatformAdmin || !allowedNestedMutation.has(field))) throw unsafeRelationOperation();
      const forbiddenRelations = new Set([...relationNames].filter((field) => !allowedNestedMutation.has(field)));
      if (containsRelationKey(row, forbiddenRelations, false)) throw unsafeRelationOperation();
    }
  }
}

export function scopeWhere(where: unknown, tenantId: string): Record<string, unknown> {
  const source = isRecord(where) ? where : {};
  assertTenant(source.tenantId, tenantId);
  return { ...source, tenantId };
}

export function scopeData(data: unknown, tenantId: string): Record<string, unknown> | Record<string, unknown>[] {
  if (Array.isArray(data)) return data.map((row) => scopeData(row, tenantId) as Record<string, unknown>);
  if (!isRecord(data)) {
    throw AppError.validation('Tenant-owned writes must use an object or an array of objects.');
  }
  assertTenant(data.tenantId, tenantId);
  return { ...data, tenantId };
}

function withBranchScope(where: unknown, branchIds: string[], relationPath?: string): Record<string, unknown> {
  const source = isRecord(where) ? where : {};
  const { AND: currentAnd, ...uniqueAndScalarFields } = source;
  const conditions = currentAnd === undefined ? [] : Array.isArray(currentAnd) ? currentAnd : [currentAnd];
  const branchCondition = relationPath
    ? buildBranchRelationFilter(relationPath, branchIds)
    : { branchId: { in: [...new Set(branchIds)] } };
  // Keep Prisma unique selectors at the top level (findUnique/update/delete)
  // while adding the independently verified branch predicate.
  return { ...uniqueAndScalarFields, AND: [...conditions, branchCondition] };
}

function buildBranchRelationFilter(path: string, branchIds: string[]): Record<string, unknown> {
  const relations = path.split('.');
  let nested: Record<string, unknown> = { branchId: { in: [...new Set(branchIds)] } };
  for (let index = relations.length - 1; index >= 0; index -= 1) {
    const rawRelation = relations[index]!;
    const many = rawRelation.endsWith('[]');
    const relation = many ? rawRelation.slice(0, -2) : rawRelation;
    nested = { [relation]: many ? { some: nested } : { is: nested } };
  }
  return nested;
}

function scopeBranchWrite(data: unknown, branchIds: string[], isCreate: boolean): Record<string, unknown> | Record<string, unknown>[] {
  if (Array.isArray(data)) return data.map((row) => scopeBranchWrite(row, branchIds, isCreate) as Record<string, unknown>);
  if (!isRecord(data)) throw AppError.validation('Branch-scoped writes must use an object or an array of objects.');
  let branchId = data.branchId;
  if (branchId === undefined && !isCreate) return data;
  // Single-branch staff do not need to repeat their only authorized branch in
  // every service payload. Multi-branch staff must select it explicitly so a
  // write can never silently land in an arbitrary branch.
  if (branchId === undefined && isCreate && branchIds.length === 1) {
    branchId = branchIds[0];
    return { ...data, branchId };
  }
  if (typeof branchId !== 'string' || !branchIds.includes(branchId)) {
    throw AppError.forbidden('Choose a branch you are assigned to for this record.');
  }
  return data;
}

function assertTenant(candidate: unknown, tenantId: string): void {
  if (candidate !== undefined && candidate !== tenantId) {
    throw new AppError({
      code: 'TENANT_MISMATCH',
      message: 'The requested record does not belong to the authenticated tenant.',
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
