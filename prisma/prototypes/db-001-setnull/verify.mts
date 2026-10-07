import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';
import { Client } from 'pg';

const runtimeUrl = process.env.DATABASE_URL;
const adminUrl = process.env.ADMIN_DATABASE_URL;
if (!runtimeUrl || !adminUrl) {
  throw new Error('Set DATABASE_URL to db001_runtime and ADMIN_DATABASE_URL to the disposable PostgreSQL admin connection.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtimeUrl }) });
const runtimeSql = new Client({ connectionString: runtimeUrl });
const admin = new Client({ connectionString: adminUrl });
const p = prisma as any;
const tenantOwnedTables = [
  'academic_units', 'admission_applications', 'admissions', 'fee_assignments',
  'fee_demands', 'payment_orders', 'payments', 'gateway_transactions', 'credits',
  'invoices', 'settlements', 'audit_chain_heads', 'audit_log',
];

async function expectPgFailure(work: () => Promise<unknown>, expectedCode: string, label: string) {
  let failure: any;
  try {
    await work();
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, `${label}: expected a failure`);
  assert.equal(failure.code, expectedCode, `${label}: SQLSTATE`);
}

async function expectPrismaFailure(work: () => Promise<unknown>, label: string) {
  let failure: any;
  try {
    await work();
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, `${label}: expected a Prisma failure`);
}

async function createTenant(id: string) {
  await p.tenant.create({ data: { id } });
}

async function tenantConnect(tenantId: string) {
  return { tenant: { connect: { id: tenantId } } };
}

async function snapshotTenantData(tenantId: string) {
  const snapshot: Record<string, unknown[]> = {};
  for (const table of tenantOwnedTables) {
    const result = await admin.query(
      `SELECT to_jsonb(t) AS row FROM public.${table} AS t WHERE t."tenantId" = $1`,
      [tenantId],
    );
    snapshot[table] = result.rows.map((entry) => entry.row).sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
  }
  return snapshot;
}

async function verifyDetach({
  targetModel,
  targetId,
  childModel,
  childId,
  relation,
  relationIdField,
  targetTable,
  childTable,
  tenantId,
}: {
  targetModel: string;
  targetId: string;
  childModel: string;
  childId: string;
  relation: string;
  relationIdField: string;
  targetTable: string;
  childTable: string;
  tenantId: string;
}) {
  await p[childModel].update({
    where: { id: childId },
    data: { [relation]: { connect: { tenantId_id: { tenantId, id: targetId } } } },
  });

  const before = await p[childModel].findUnique({
    where: { id: childId },
    include: { [relation]: true },
  });
  assert.equal(before.tenantId, tenantId);
  assert.equal(before[relationIdField], targetId);
  assert.equal(before[relation]?.id, targetId, `${childModel} generated-client relation read`);

  const beforeTarget = await admin.query(
    `SELECT to_jsonb(t) AS row FROM public.${targetTable} AS t WHERE t."tenantId" = $1 AND t.id = $2`,
    [tenantId, targetId],
  );
  const beforeChild = await admin.query(
    `SELECT to_jsonb(s) AS row FROM public.${childTable} AS s WHERE s."tenantId" = $1 AND s.id = $2`,
    [tenantId, childId],
  );
  assert.equal(beforeTarget.rows.length, 1);
  assert.equal(beforeChild.rows.length, 1);

  await p[targetModel].delete({ where: { id: targetId } });

  const after = await p[childModel].findUnique({ where: { id: childId } });
  assert.ok(after, `${childModel} source row survives target deletion`);
  assert.equal(after.tenantId, tenantId, `${childModel} tenantId remains unchanged`);
  assert.equal(after[relationIdField], null, `${childModel}.${relationIdField} is the only cleared field`);

  const audit = await admin.query(
    `SELECT operation, entity_table, entity_id, before_image FROM public.audit_log
      WHERE "tenantId" = $1 AND entity_id IN ($2, $3)
        AND ((entity_table = $4 AND entity_id = $2) OR (entity_table = $5 AND entity_id = $3))
      ORDER BY chain_sequence`,
    [tenantId, targetId, childId, targetTable, childTable],
  );
  assert.equal(audit.rows.length, 2, `${targetModel} and detached child each have one audit event`);
  assert.deepEqual(audit.rows.map((row) => row.operation).sort(), ['DELETE', 'DETACH']);
  const targetEvent = audit.rows.find((row) => row.operation === 'DELETE');
  const childEvent = audit.rows.find((row) => row.operation === 'DETACH');
  assert.equal(targetEvent.entity_table, targetTable);
  assert.equal(targetEvent.entity_id, targetId);
  assert.deepEqual(targetEvent.before_image, beforeTarget.rows[0].row, `${targetModel} full target before-image`);
  assert.equal(childEvent.entity_table, childTable);
  assert.equal(childEvent.entity_id, childId);
  assert.deepEqual(childEvent.before_image, beforeChild.rows[0].row, `${childModel} full child before-image`);
  assert.equal(childEvent.before_image.tenantId, tenantId);
  assert.equal(childEvent.before_image[relationIdField], targetId);
}

async function verifyAuditChain(tenantId: string, expectedEvents: number) {
  const integrity = await admin.query(`
    WITH ordered AS (
      SELECT l.*,
             lag(event_hash, 1, 'GENESIS') OVER (PARTITION BY "tenantId" ORDER BY chain_sequence) AS expected_previous,
             jsonb_build_object(
               'tenantId', "tenantId", 'sequence', chain_sequence,
               'entityTable', entity_table, 'entityId', entity_id,
               'operation', operation, 'beforeImage', before_image
             )::text AS payload
        FROM public.audit_log AS l
       WHERE l."tenantId" = $1
    ), checked AS (
      SELECT *, encode(digest(convert_to(
        'fee-audit-prototype:v1' || E'\\n' || "tenantId"::text || E'\\n' ||
        chain_sequence::text || E'\\n' || previous_hash || E'\\n' || payload,
        'UTF8'
      ), 'sha256'), 'hex') AS recomputed_hash
      FROM ordered
    )
    SELECT count(*)::int AS count,
           min(chain_sequence) AS min_sequence,
           max(chain_sequence) AS max_sequence,
           bool_and(previous_hash = expected_previous) AS links_valid,
           bool_and(event_hash = recomputed_hash) AS hashes_valid,
           count(DISTINCT append_nonce) = count(*) AS nonce_unique
      FROM checked
  `, [tenantId]);
  const row = integrity.rows[0];
  assert.equal(row.count, expectedEvents);
  assert.equal(Number(row.min_sequence), 1);
  assert.equal(Number(row.max_sequence), expectedEvents);
  assert.equal(row.links_valid, true);
  assert.equal(row.hashes_valid, true);
  assert.equal(row.nonce_unique, true);

  const head = await admin.query(`
    SELECT h.last_sequence, h.last_hash,
           max(l.chain_sequence) AS max_sequence,
           (array_agg(l.event_hash ORDER BY l.chain_sequence DESC))[1] AS final_hash
      FROM public.audit_chain_heads AS h
      LEFT JOIN public.audit_log AS l USING ("tenantId")
     WHERE h."tenantId" = $1
     GROUP BY h."tenantId", h.last_sequence, h.last_hash
  `, [tenantId]);
  assert.equal(Number(head.rows[0].last_sequence), expectedEvents);
  assert.equal(Number(head.rows[0].max_sequence), expectedEvents);
  assert.equal(head.rows[0].last_hash, head.rows[0].final_hash);
}

try {
  await admin.connect();
  await runtimeSql.connect();
  await p.$connect();

  const migrations = await admin.query(`
    SELECT migration_name FROM public."_prisma_migrations"
     WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
     ORDER BY migration_name
  `);
  assert.deepEqual(migrations.rows.map((row) => row.migration_name), [
    '20260929000000_initial',
    '20260929000100_trigger_feasibility',
  ], 'fresh-database Prisma migration deployment applied both fixture migrations');

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  await createTenant(tenantA);
  await createTenant(tenantB);

  const heads = await admin.query('SELECT count(*)::int AS count FROM public.audit_chain_heads');
  assert.equal(heads.rows[0].count, 2, 'tenant insert atomically provisions one audit head');

  const pairs = [
    { targetModel: 'academicUnit', childModel: 'academicUnit', relation: 'parent', relationIdField: 'parentId', targetTable: 'academic_units', childTable: 'academic_units' },
    { targetModel: 'admissionApplication', childModel: 'admission', relation: 'application', relationIdField: 'applicationId', targetTable: 'admission_applications', childTable: 'admissions' },
    { targetModel: 'feeAssignment', childModel: 'feeDemand', relation: 'feeAssignment', relationIdField: 'feeAssignmentId', targetTable: 'fee_assignments', childTable: 'fee_demands' },
    { targetModel: 'payment', childModel: 'credit', relation: 'payment', relationIdField: 'paymentId', targetTable: 'payments', childTable: 'credits' },
    { targetModel: 'feeDemand', childModel: 'invoice', relation: 'demand', relationIdField: 'demandId', targetTable: 'fee_demands', childTable: 'invoices' },
  ];

  const auditStart = await admin.query('SELECT count(*)::int AS count FROM public.audit_log');
  for (const pair of pairs) {
    const targetId = randomUUID();
    const childId = randomUUID();
    await p[pair.targetModel].create({
      data: { id: targetId, ...(await tenantConnect(tenantA)), deleteEligible: true },
    });
    await p[pair.childModel].create({ data: { id: childId, ...(await tenantConnect(tenantA)) } });
    await verifyDetach({ ...pair, targetId, childId, tenantId: tenantA });
  }
  const auditAfter = await admin.query('SELECT count(*)::int AS count FROM public.audit_log');
  assert.equal(auditAfter.rows[0].count - auditStart.rows[0].count, 10, 'five target deletes plus five detached child rows append once each');

  const dependentParentId = randomUUID();
  const dependentChildId = randomUUID();
  await p.academicUnit.create({ data: { id: dependentParentId, ...(await tenantConnect(tenantA)), deleteEligible: true } });
  await p.academicUnit.create({ data: { id: dependentChildId, ...(await tenantConnect(tenantA)) } });
  await p.academicUnit.update({
    where: { id: dependentChildId },
    data: { parent: { connect: { tenantId_id: { tenantId: tenantA, id: dependentParentId } } } },
  });
  await expectPgFailure(
    () => runtimeSql.query('UPDATE public.academic_units SET "tenantId" = $1 WHERE id = $2', [tenantB, dependentChildId]),
    '42501',
    'dependent-row tenant reparenting',
  );
  const dependentUnchanged = await p.academicUnit.findUnique({ where: { id: dependentChildId }, include: { parent: true } });
  assert.equal(dependentUnchanged.tenantId, tenantA);
  assert.equal(dependentUnchanged.parent.id, dependentParentId);
  await runtimeSql.query('UPDATE public.academic_units SET "tenantId" = $1 WHERE id = $2', [tenantA, dependentChildId]);

  const blockedId = randomUUID();
  await p.academicUnit.create({ data: { id: blockedId, ...(await tenantConnect(tenantA)) } });
  const beforeBlocked = await admin.query('SELECT count(*)::int AS count FROM public.audit_log');
  await expectPrismaFailure(() => p.academicUnit.delete({ where: { id: blockedId } }), 'ineligible target delete');
  assert.ok(await p.academicUnit.findUnique({ where: { id: blockedId } }), 'ineligible target remains');
  const afterBlocked = await admin.query('SELECT count(*)::int AS count FROM public.audit_log');
  assert.equal(afterBlocked.rows[0].count, beforeBlocked.rows[0].count, 'rejected lifecycle gate writes no audit events');

  const orderPaymentId = randomUUID();
  const paymentId = randomUUID();
  await p.paymentOrder.create({ data: { id: orderPaymentId, ...(await tenantConnect(tenantA)) } });
  await p.payment.create({
    data: {
      id: paymentId,
      ...(await tenantConnect(tenantA)),
      paymentOrder: { connect: { tenantId_id: { tenantId: tenantA, id: orderPaymentId } } },
    },
  });
  const orderGatewayId = randomUUID();
  const gatewayTransactionId = randomUUID();
  await p.paymentOrder.create({ data: { id: orderGatewayId, ...(await tenantConnect(tenantA)) } });
  await p.gatewayTransaction.create({
    data: {
      id: gatewayTransactionId,
      ...(await tenantConnect(tenantA)),
      paymentOrder: { connect: { tenantId_id: { tenantId: tenantA, id: orderGatewayId } } },
    },
  });
  const settlementId = randomUUID();
  const settlementTransactionId = randomUUID();
  await p.settlement.create({ data: { id: settlementId, ...(await tenantConnect(tenantA)) } });
  await p.gatewayTransaction.create({
    data: {
      id: settlementTransactionId,
      ...(await tenantConnect(tenantA)),
      settlement: { connect: { tenantId_id: { tenantId: tenantA, id: settlementId } } },
    },
  });

  const beforeRestrictedDeletes = await admin.query('SELECT count(*)::int AS count FROM public.audit_log');
  await expectPrismaFailure(() => p.paymentOrder.delete({ where: { id: orderPaymentId } }), 'PaymentOrder linked to Payment');
  await expectPrismaFailure(() => p.paymentOrder.delete({ where: { id: orderGatewayId } }), 'PaymentOrder linked to GatewayTransaction');
  await expectPrismaFailure(() => p.settlement.delete({ where: { id: settlementId } }), 'Settlement linked to GatewayTransaction');
  const afterRestrictedDeletes = await admin.query('SELECT count(*)::int AS count FROM public.audit_log');
  assert.equal(afterRestrictedDeletes.rows[0].count, beforeRestrictedDeletes.rows[0].count, 'NoAction failures invoke no detach audit trigger');

  const unitToMove = randomUUID();
  await p.academicUnit.create({ data: { id: unitToMove, ...(await tenantConnect(tenantA)) } });
  await expectPgFailure(
    () => runtimeSql.query('UPDATE public.academic_units SET "tenantId" = $1 WHERE id = $2', [tenantB, unitToMove]),
    '42501',
    'direct SQL tenant reparenting',
  );
  await runtimeSql.query('UPDATE public.academic_units SET "tenantId" = $1 WHERE id = $2', [tenantA, unitToMove]);

  const foreignAppId = randomUUID();
  await p.admissionApplication.create({ data: { id: foreignAppId, ...(await tenantConnect(tenantB)) } });
  await expectPgFailure(
    () => runtimeSql.query(
      'INSERT INTO public.admissions (id, "tenantId", "applicationId") VALUES ($1, $2, $3)',
      [randomUUID(), tenantA, foreignAppId],
    ),
    '23503',
    'cross-tenant composite foreign key',
  );

  // A lock-order regression would hold the audit head while waiting for
  // childA; the competing delete would then hold childA and wait for that head.
  // The corrected trigger locks both child sets before either append.
  const raceTargetA = randomUUID();
  const raceChildA = randomUUID();
  const raceTargetB = randomUUID();
  const raceChildB = randomUUID();
  await p.academicUnit.create({ data: { id: raceTargetA, ...(await tenantConnect(tenantB)), deleteEligible: true } });
  await p.academicUnit.create({ data: { id: raceChildA, ...(await tenantConnect(tenantB)) } });
  await p.academicUnit.update({ where: { id: raceChildA }, data: { parent: { connect: { tenantId_id: { tenantId: tenantB, id: raceTargetA } } } } });
  await p.academicUnit.create({ data: { id: raceTargetB, ...(await tenantConnect(tenantB)), deleteEligible: true } });
  await p.academicUnit.create({ data: { id: raceChildB, ...(await tenantConnect(tenantB)) } });
  await p.academicUnit.update({ where: { id: raceChildB }, data: { parent: { connect: { tenantId_id: { tenantId: tenantB, id: raceTargetB } } } } });

  const lockHolder = new Client({ connectionString: runtimeUrl });
  const deleteSession = new Client({ connectionString: runtimeUrl });
  await lockHolder.connect();
  await deleteSession.connect();
  try {
    await lockHolder.query('BEGIN');
    await lockHolder.query('SELECT id FROM public.academic_units WHERE id = $1 FOR UPDATE', [raceChildA]);
    await deleteSession.query("SET application_name = 'db001_prototype_delete_a'");
    await deleteSession.query("SET lock_timeout = '5s'");
    const firstDelete = deleteSession.query('DELETE FROM public.academic_units WHERE id = $1', [raceTargetA]);
    let firstIsWaiting = false;
    for (let attempt = 0; attempt < 30 && !firstIsWaiting; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const activity = await admin.query(`
        SELECT wait_event_type FROM pg_stat_activity
         WHERE application_name = 'db001_prototype_delete_a'
      `);
      firstIsWaiting = activity.rows[0]?.wait_event_type === 'Lock';
    }
    assert.equal(firstIsWaiting, true, 'first delete waits on its child row before taking the audit head');
    await lockHolder.query('DELETE FROM public.academic_units WHERE id = $1', [raceTargetB]);
    await lockHolder.query('COMMIT');
    await firstDelete;
  } catch (error) {
    await lockHolder.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await lockHolder.end();
    await deleteSession.end();
  }
  assert.equal((await p.academicUnit.findUnique({ where: { id: raceChildA } })).parentId, null);
  assert.equal((await p.academicUnit.findUnique({ where: { id: raceChildB } })).parentId, null);

  const replacementTenantId = randomUUID();
  const tenantBefore = await admin.query('SELECT to_jsonb(t) AS row FROM public."Tenant" AS t WHERE id = $1', [tenantA]);
  const tenantDataBefore = await snapshotTenantData(tenantA);
  const tenantAuditBefore = tenantDataBefore.audit_log;
  await expectPgFailure(
    () => runtimeSql.query('UPDATE public."Tenant" SET id = $1 WHERE id = $2', [replacementTenantId, tenantA]),
    '42501',
    'tenant identity update with dependent rows and audit history',
  );
  await runtimeSql.query('UPDATE public."Tenant" SET id = id WHERE id = $1', [tenantA]);
  const tenantAfter = await admin.query('SELECT to_jsonb(t) AS row FROM public."Tenant" AS t WHERE id = $1', [tenantA]);
  const tenantDataAfter = await snapshotTenantData(tenantA);
  assert.deepEqual(tenantAfter.rows[0].row, tenantBefore.rows[0].row, 'Tenant row is unchanged after rejected identity update');
  assert.deepEqual(tenantDataAfter, tenantDataBefore, 'all tenant-owned rows, references, audit head, and audit log remain unchanged');
  assert.deepEqual(tenantDataAfter.audit_log, tenantAuditBefore, 'rejected tenant identity update appends no audit events');
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM public."Tenant" WHERE id = $1', [replacementTenantId])).rows[0].count, 0);

  await expectPgFailure(() => runtimeSql.query('SELECT * FROM public.audit_log'), '42501', 'runtime audit read');
  const auditMutationAttempts: Array<[string, () => Promise<unknown>]> = [
    ['audit_log INSERT', () => runtimeSql.query('INSERT INTO public.audit_log DEFAULT VALUES')],
    ['audit_log UPDATE', () => runtimeSql.query('UPDATE public.audit_log SET operation = operation WHERE false')],
    ['audit_log DELETE', () => runtimeSql.query('DELETE FROM public.audit_log WHERE false')],
    ['audit_log TRUNCATE', () => runtimeSql.query('TRUNCATE public.audit_log')],
    ['audit_chain_heads INSERT', () => runtimeSql.query('INSERT INTO public.audit_chain_heads DEFAULT VALUES')],
    ['audit_chain_heads UPDATE', () => runtimeSql.query('UPDATE public.audit_chain_heads SET last_sequence = last_sequence WHERE false')],
    ['audit_chain_heads DELETE', () => runtimeSql.query('DELETE FROM public.audit_chain_heads WHERE false')],
    ['audit_chain_heads TRUNCATE', () => runtimeSql.query('TRUNCATE public.audit_chain_heads')],
  ];
  for (const [label, attempt] of auditMutationAttempts) {
    await expectPgFailure(attempt, '42501', `runtime ${label} denied`);
  }
  await expectPgFailure(
    () => runtimeSql.query('SELECT app_private.append_event($1, $2, $3, $4, $5::jsonb)', [tenantA, 'x', randomUUID(), 'DELETE', '{}']),
    '42501',
    'runtime direct audit core call',
  );
  await expectPgFailure(
    () => runtimeSql.query('ALTER TABLE public.academic_units ADD COLUMN forbidden integer'),
    '42501',
    'runtime DDL privilege',
  );
  await expectPgFailure(
    () => runtimeSql.query("SET session_replication_role = 'replica'"),
    '42501',
    'runtime trigger-disable privilege',
  );

  await verifyAuditChain(tenantA, 10);
  await verifyAuditChain(tenantB, 4);

  const triggerInventory = await admin.query(`
    SELECT count(*)::int AS count
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname = 'public'
       AND t.tgname LIKE '%_tenant_immutable'
  `);
  assert.equal(triggerInventory.rows[0].count, 13, 'one immutable-tenant trigger per tenant-owned prototype table');
  const tenantIdTrigger = await admin.query(`
    SELECT t.tgenabled
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname = 'public'
       AND c.relname = 'Tenant' AND t.tgname = 'tenant_id_immutable'
  `);
  assert.equal(tenantIdTrigger.rows.length, 1, 'Tenant.id immutable guard is installed');
  assert.equal(tenantIdTrigger.rows[0].tgenabled, 'O', 'Tenant.id immutable guard is enabled');

  const actorAttribution = await admin.query(`
    SELECT count(*)::int AS count FROM public.audit_log WHERE actor_type <> 'DATABASE'
  `);
  assert.equal(actorAttribution.rows[0].count, 0, 'all prototype trigger events have DATABASE actor attribution');

  const restrictedEdges = await admin.query(`
    SELECT conname, confdeltype
      FROM pg_constraint
     WHERE conname = ANY($1::text[])
     ORDER BY conname
  `, [[
    'payments_tenantId_paymentOrderId_fkey',
    'gateway_transactions_tenantId_paymentOrderId_fkey',
    'gateway_transactions_tenantId_settlementId_fkey',
  ]]);
  assert.equal(restrictedEdges.rows.length, 3);
  assert.ok(restrictedEdges.rows.every((row) => row.confdeltype === 'a'), 'all three provenance FKs are NO ACTION');
  const noDetachOnProvenance = await admin.query(`
    SELECT count(*)::int AS count FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname = 'public'
      AND c.relname IN ('payment_orders', 'settlements')
      AND t.tgname NOT LIKE '%_tenant_immutable'
  `);
  assert.equal(noDetachOnProvenance.rows[0].count, 0, 'no detach trigger on PaymentOrder or Settlement');

  const unsafeSql = await readFile(new URL('./invalid-generated-setnull.sql', import.meta.url), 'utf8');
  assert.match(unsafeSql, /FOREIGN KEY \("tenantId", "parentId"\)[\s\S]*ON DELETE SET NULL/);
  await admin.query(`
    CREATE SCHEMA unsafe_setnull;
    CREATE TABLE unsafe_setnull.unit (
      id uuid PRIMARY KEY,
      "tenantId" uuid NOT NULL,
      "parentId" uuid,
      UNIQUE ("tenantId", id),
      FOREIGN KEY ("tenantId", "parentId") REFERENCES unsafe_setnull.unit ("tenantId", id) ON DELETE SET NULL
    );
  `);
  const unsafeParent = randomUUID();
  const unsafeChild = randomUUID();
  await admin.query('INSERT INTO unsafe_setnull.unit (id, "tenantId") VALUES ($1, $2)', [unsafeParent, tenantA]);
  await admin.query('INSERT INTO unsafe_setnull.unit (id, "tenantId", "parentId") VALUES ($1, $2, $3)', [unsafeChild, tenantA, unsafeParent]);
  await expectPgFailure(() => admin.query('DELETE FROM unsafe_setnull.unit WHERE id = $1', [unsafeParent]), '23502', 'unsafe generated SetNull');
  const unsafeRow = await admin.query('SELECT "tenantId", "parentId" FROM unsafe_setnull.unit WHERE id = $1', [unsafeChild]);
  assert.equal(unsafeRow.rows[0].tenantId, tenantA);
  assert.equal(unsafeRow.rows[0].parentId, unsafeParent, 'failed full-tuple SetNull leaves the relation intact');
  await admin.query('DROP SCHEMA unsafe_setnull CASCADE');

  const runtimeRole = await admin.query(`
    SELECT r.rolsuper, r.rolcreaterole, r.rolcreatedb,
           pg_has_role('db001_runtime', 'db001_owner', 'MEMBER') AS owner_member
      FROM pg_roles r WHERE r.rolname = 'db001_runtime'
  `);
  assert.deepEqual(runtimeRole.rows[0], { rolsuper: false, rolcreaterole: false, rolcreatedb: false, owner_member: false });

  console.log('PASS: Prisma generated-client composite relation connect/read.');
  console.log('PASS: five optional-ID detach triggers under db001_runtime; only relation IDs cleared.');
  console.log('PASS: rejected eligibility gate has no row or audit changes.');
  console.log('PASS: three NoAction provenance deletes rejected without detachment/audit.');
  console.log('PASS: audit append, contiguous chain, hash recomputation, head agreement, and nonce uniqueness.');
  console.log('PASS: runtime tenantId reparenting, audit access/core, DDL, and trigger-disable attempts rejected.');
  console.log('PASS: Tenant.id changes and all eight audit/head DML/TRUNCATE attempts rejected; full tenant snapshots unchanged.');
  console.log('PASS: all persisted prototype trigger events have DATABASE actor attribution.');
  console.log('PASS: child-before-audit lock order completes a barrier-controlled competing delete.');
  console.log('PASS: Prisma whole-tuple SetNull behavior confirmed to fail with SQLSTATE 23502.');
} finally {
  await p.$disconnect().catch(() => undefined);
  await runtimeSql.end().catch(() => undefined);
  await admin.end().catch(() => undefined);
}
