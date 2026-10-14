import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseModels } from './generate-concurrent-index-plan.mjs';
import { TENANT_MODEL_NAMES } from './tenant-model-manifest.mjs';
import { parseRelationList, validateTenantRelationSchema } from './tenant-relation-schema-validator.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(root, 'prisma/schema.prisma');
const migrationRoot = resolve(root, 'prisma/migrations');
const stageManifestPath = resolve(root, 'prisma/migration-stages.json');
const migrationDirectories = Object.freeze({
  add: '20260930000100_tenant_composite_foreign_keys_add',
  validate: '20260930000200_tenant_composite_foreign_keys_validate',
  dropLegacy: '20260930000300_tenant_composite_foreign_keys_drop_legacy',
});
const additiveBranchMigrationDirectories = Object.freeze({
  add: '20261006001000_branch_finance_composite_foreign_keys_add',
  validate: '20261006001100_branch_finance_composite_foreign_keys_validate',
});
const additivePeopleMigrationDirectories = Object.freeze({
  add: '20261013000200_tenant_person_composite_foreign_keys_add',
  validate: '20261013000300_tenant_person_composite_foreign_keys_validate',
});
// Relations introduced after the historical tenant-FK rollout must never be
// retroactively written into its checksummed migration files. Register each
// new relation here so the generator creates a separately staged add/validate
// pair and continues to fail closed for unclassified schema changes.
const additiveBranchRelations = new Set([
  'Student.branch',
  'FeeAssignment.branch',
  'FeeDemand.branch',
  'PaymentOrder.branch',
  'Payment.branch',
  'Refund.branch',
  'Credit.branch',
  'Adjustment.branch',
  'LedgerEntry.branch',
  'Receipt.branch',
  'Invoice.branch',
  'LateFeeAccrual.branch',
]);
const additivePeopleRelations = new Set([
  'User.tenantPerson',
  'Student.person',
  'TenantPerson.branch',
  'TenantPersonGroupMember.person',
  'TenantPersonGroupMember.group',
  'AttendanceSession.personGroup',
  'AttendanceRecord.person',
  'FeeDemand.person',
  'PaymentOrder.person',
  'Payment.person',
  'Credit.person',
  'Adjustment.person',
  'Receipt.person',
  'Invoice.person',
  'Notification.person',
]);
const additiveBillingMigrationDirectories = Object.freeze({
  add: '20261013000600_fee_assignment_cycle_composite_foreign_keys_add',
  validate: '20261013000700_fee_assignment_cycle_composite_foreign_keys_validate',
});
const additiveBillingRelations = new Set([
  'FeeAssignmentCycle.assignment',
  'FeeAssignmentCycle.branch',
  'FeeUsageInput.cycle',
  'FeeUsageInput.person',
  'FeeUsageInput.feeStructureItem',
  'FeeDemand.cycle',
]);
const additiveTenantRelations = new Set([...additiveBranchRelations, ...additivePeopleRelations, ...additiveBillingRelations]);
const identifier = '"((?:[^"]|"")*)"';
const action = '(NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)';

function unquoteIdentifier(value) {
  return value.replaceAll('""', '"');
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function parseIdentifierList(value, description) {
  const tokens = value.match(/"(?:[^"]|"")*"/g) ?? [];
  const residue = value.replace(/"(?:[^"]|"")*"/g, '').replaceAll(',', '').trim();
  if (residue || tokens.length === 0) throw new Error(`Unsupported ${description} in generated foreign key DDL`);
  return tokens.map((token) => unquoteIdentifier(token.slice(1, -1)));
}

export function parseForeignKeyDdl(sql, sourceLabel = 'SQL') {
  const statementPattern = new RegExp(
    `ALTER\\s+TABLE\\s+${identifier}\\s+ADD\\s+CONSTRAINT\\s+${identifier}` +
      `\\s+FOREIGN\\s+KEY\\s*\\(([^)]*)\\)\\s+REFERENCES\\s+${identifier}` +
      `\\s*\\(([^)]*)\\)\\s+ON\\s+DELETE\\s+${action}` +
      `(?:\\s+ON\\s+UPDATE\\s+${action})?(?:\\s+NOT\\s+VALID)?\\s*;`,
    'gim',
  );
  const constraints = [];
  for (const match of sql.matchAll(statementPattern)) {
    const [, rawSourceTable, rawName, rawSourceColumns, rawTargetTable, rawTargetColumns, onDelete, onUpdate = 'NO ACTION'] = match;
    constraints.push({
      name: unquoteIdentifier(rawName),
      sourceTable: unquoteIdentifier(rawSourceTable),
      sourceColumns: parseIdentifierList(rawSourceColumns, `${sourceLabel} source columns`),
      targetTable: unquoteIdentifier(rawTargetTable),
      targetColumns: parseIdentifierList(rawTargetColumns, `${sourceLabel} target columns`),
      onDelete,
      onUpdate,
    });
  }
  // Prisma creates most historical relations with ALTER TABLE, while hand-
  // written additive migrations may declare foreign keys inside CREATE TABLE.
  // Include those constraints in the same schema-history inventory so the
  // declared FOREIGN KEY count never mistakes a valid table constraint for an
  // unsupported statement.
  const createTablePattern = new RegExp(`CREATE\\s+TABLE\\s+${identifier}\\s*\\(([\\s\\S]*?)\\)\\s*;`, 'gim');
  const inlineForeignKeyPattern = new RegExp(
    `CONSTRAINT\\s+${identifier}\\s+FOREIGN\\s+KEY\\s*\\(([^)]*)\\)\\s+REFERENCES\\s+${identifier}` +
      `\\s*\\(([^)]*)\\)\\s+ON\\s+DELETE\\s+${action}(?:\\s+ON\\s+UPDATE\\s+${action})?\\s*(?=,|$)`,
    'gim',
  );
  for (const tableMatch of sql.matchAll(createTablePattern)) {
    const [, rawSourceTable, tableBody] = tableMatch;
    for (const match of tableBody.matchAll(inlineForeignKeyPattern)) {
      const [, rawName, rawSourceColumns, rawTargetTable, rawTargetColumns, onDelete, onUpdate = 'NO ACTION'] = match;
      constraints.push({
        name: unquoteIdentifier(rawName),
        sourceTable: unquoteIdentifier(rawSourceTable),
        sourceColumns: parseIdentifierList(rawSourceColumns, `${sourceLabel} source columns`),
        targetTable: unquoteIdentifier(rawTargetTable),
        targetColumns: parseIdentifierList(rawTargetColumns, `${sourceLabel} target columns`),
        onDelete,
        onUpdate,
      });
    }
  }
  const declaredCount = [...sql.matchAll(/\bFOREIGN\s+KEY\b/gi)].length;
  if (constraints.length !== declaredCount) {
    throw new Error(`${sourceLabel} contains ${declaredCount - constraints.length} unsupported foreign key statement(s)`);
  }
  return constraints;
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameKey(constraint, { sourceTable, sourceColumns, targetTable, targetColumns }) {
  return constraint.sourceTable === sourceTable && sameList(constraint.sourceColumns, sourceColumns) &&
    constraint.targetTable === targetTable && sameList(constraint.targetColumns, targetColumns);
}

export function buildCompositeTenantConstraintPlan({ schema, targetSql, legacySql, tenantModelNames = TENANT_MODEL_NAMES }) {
  const inventory = validateTenantRelationSchema(schema, tenantModelNames);
  const models = parseModels(schema);
  const tenantModels = new Set(tenantModelNames);
  const desiredConstraints = parseForeignKeyDdl(targetSql, 'Current Prisma schema');
  const legacyConstraints = parseForeignKeyDdl(legacySql, 'Existing migration history');
  const expected = [];

  for (const sourceName of tenantModelNames) {
    const source = models.get(sourceName);
    if (!source) throw new Error(`Tenant model ${sourceName} is missing from Prisma schema`);
    for (const relation of source.declarations) {
      if (!tenantModels.has(relation.type)) continue;
      const sourceFields = parseRelationList(relation.relationAttributes, 'fields');
      const targetFields = parseRelationList(relation.relationAttributes, 'references');
      if (!sourceFields || !targetFields) continue;
      if (sourceFields.length !== 2 || targetFields.length !== 2 || sourceFields[0] !== 'tenantId' ||
          sourceFields[1] === 'tenantId' || targetFields[0] !== 'tenantId' || targetFields[1] !== 'id') {
        throw new Error(`${sourceName}.${relation.name} has an unsupported tenant relation tuple`);
      }
      const target = models.get(relation.type);
      if (!target) throw new Error(`${sourceName}.${relation.name} targets missing model ${relation.type}`);
      const sourceColumns = sourceFields.map((field) => source.fields.get(field));
      const targetColumns = targetFields.map((field) => target.fields.get(field));
      if ([...sourceColumns, ...targetColumns].some((column) => !column)) {
        throw new Error(`${sourceName}.${relation.name} maps a tenant foreign key to an unknown database column`);
      }
      expected.push({
        sourceModel: sourceName,
        relationName: relation.name,
        targetModel: relation.type,
        sourceTable: source.table,
        sourceColumns,
        targetTable: target.table,
        targetColumns,
      });
    }
  }

  if (expected.length !== inventory.tenantRelationCount) {
    throw new Error(`Tenant relation inventory mismatch: schema validator found ${inventory.tenantRelationCount}, generator found ${expected.length}`);
  }

  const planned = expected.map((edge) => {
    const desired = desiredConstraints.filter((constraint) => sameKey(constraint, edge));
    if (desired.length !== 1) {
      throw new Error(`${edge.sourceModel}.${edge.relationName} needs exactly one generated composite foreign key; found ${desired.length}`);
    }
    const existingComposite = legacyConstraints.filter((constraint) => sameKey(constraint, edge));
    if (existingComposite.length > 1) {
      throw new Error(`${edge.sourceModel}.${edge.relationName} has more than one existing composite foreign key`);
    }
    if (existingComposite.length === 1) {
      const [existing] = existingComposite;
      if (existing.name !== desired[0].name || existing.onDelete !== desired[0].onDelete || existing.onUpdate !== desired[0].onUpdate) {
        throw new Error(`${edge.sourceModel}.${edge.relationName} has an existing composite foreign key that differs from the current Prisma schema`);
      }
      return { ...edge, desired: desired[0], legacy: existing, alreadyComposite: true };
    }
    const legacyKey = { ...edge, sourceColumns: edge.sourceColumns.slice(1), targetColumns: edge.targetColumns.slice(1) };
    const legacy = legacyConstraints.filter((constraint) => sameKey(constraint, legacyKey));
    if (legacy.length === 0 && additiveTenantRelations.has(`${edge.sourceModel}.${edge.relationName}`)) {
      return { ...edge, desired: desired[0], legacy: null, alreadyComposite: false, introducedAfterLegacyRollout: true };
    }
    if (legacy.length !== 1) {
      throw new Error(`${edge.sourceModel}.${edge.relationName} needs exactly one existing ID-only foreign key to replace; found ${legacy.length}`);
    }
    return { ...edge, desired: desired[0], legacy: legacy[0], alreadyComposite: false };
  }).sort((left, right) => left.sourceTable.localeCompare(right.sourceTable) || left.desired.name.localeCompare(right.desired.name));

  const plan = planned.filter((edge) => !edge.introducedAfterLegacyRollout);
  const additivePlan = planned.filter((edge) => edge.introducedAfterLegacyRollout);
  const unconsumedAdditiveRelations = tenantModelNames.length === TENANT_MODEL_NAMES.length
    ? [...additiveTenantRelations].filter((key) => !additivePlan.some((edge) => `${edge.sourceModel}.${edge.relationName}` === key))
    : [];
  if (unconsumedAdditiveRelations.length) {
    throw new Error(`Registered additive branch relations are missing from the Prisma schema or migration history: ${unconsumedAdditiveRelations.join(', ')}`);
  }

  const desiredNames = new Set();
  for (const { desired } of plan) {
    if (desiredNames.has(desired.name)) throw new Error(`Generated tenant foreign key name ${desired.name} is not unique`);
    desiredNames.add(desired.name);
  }
  return {
    plan,
    additivePlan,
    additiveBranchPlan: additivePlan.filter((edge) => additiveBranchRelations.has(`${edge.sourceModel}.${edge.relationName}`)),
    additivePeoplePlan: additivePlan.filter((edge) => additivePeopleRelations.has(`${edge.sourceModel}.${edge.relationName}`)),
    additiveBillingPlan: additivePlan.filter((edge) => additiveBillingRelations.has(`${edge.sourceModel}.${edge.relationName}`)),
    tenantModelCount: inventory.tenantModelCount,
    tenantRelationCount: inventory.tenantRelationCount,
  };
}

export function renderCompositeTenantConstraintMigration(plan, additiveBranchPlan = [], additivePeoplePlan = [], additiveBillingPlan = []) {
  const addStatements = [
    '-- Generated from prisma/schema.prisma; do not edit constraint tuples by hand.',
    '-- This phase only installs enforcement; existing rows are validated in the next migration.',
    'BEGIN;',
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL statement_timeout = '1min';",
  ];
  for (const { desired, alreadyComposite } of plan) {
    if (alreadyComposite) continue;
    addStatements.push(
      `ALTER TABLE ${quoteIdentifier(desired.sourceTable)} ADD CONSTRAINT ${quoteIdentifier(desired.name)} ` +
      `FOREIGN KEY (${desired.sourceColumns.map(quoteIdentifier).join(', ')}) ` +
      `REFERENCES ${quoteIdentifier(desired.targetTable)} (${desired.targetColumns.map(quoteIdentifier).join(', ')}) ` +
      `ON DELETE ${desired.onDelete} ON UPDATE ${desired.onUpdate} NOT VALID;`,
    );
  }
  addStatements.push('COMMIT;', '');

  const validateStatements = [
    '-- Generated from prisma/schema.prisma; do not edit constraint tuples by hand.',
    '-- PostgreSQL validates existing rows while allowing ordinary concurrent DML.',
    'BEGIN;',
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL statement_timeout = '30min';",
  ];
  for (const { desired, alreadyComposite } of plan) {
    if (alreadyComposite) continue;
    validateStatements.push(`ALTER TABLE ${quoteIdentifier(desired.sourceTable)} VALIDATE CONSTRAINT ${quoteIdentifier(desired.name)};`);
  }
  validateStatements.push('COMMIT;', '');

  const dropStatements = [
    '-- Generated from prisma/schema.prisma; do not edit constraint tuples by hand.',
    '-- Verify the complete validated composite-FK inventory before removing any legacy FK.',
    'BEGIN;',
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL statement_timeout = '1min';",
  ];
  const expectedComposites = plan.filter(({ alreadyComposite }) => !alreadyComposite).map(({ desired }) => `
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS source_table ON source_table.oid = constraint_row.conrelid
      JOIN pg_namespace AS source_namespace ON source_namespace.oid = source_table.relnamespace
      JOIN pg_class AS target_table ON target_table.oid = constraint_row.confrelid
      JOIN pg_namespace AS target_namespace ON target_namespace.oid = target_table.relnamespace
      CROSS JOIN LATERAL unnest(constraint_row.conkey, constraint_row.confkey)
        WITH ORDINALITY AS key_column(source_attnum, target_attnum, position)
      JOIN pg_attribute AS source_attribute
        ON source_attribute.attrelid = source_table.oid AND source_attribute.attnum = key_column.source_attnum
      JOIN pg_attribute AS target_attribute
        ON target_attribute.attrelid = target_table.oid AND target_attribute.attnum = key_column.target_attnum
      WHERE constraint_row.contype = 'f'
        AND constraint_row.conname = ${quoteLiteral(desired.name)}
        AND source_namespace.nspname = 'public'
        AND source_table.relname = ${quoteLiteral(desired.sourceTable)}
        AND target_namespace.nspname = 'public'
        AND target_table.relname = ${quoteLiteral(desired.targetTable)}
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ${textArray(desired.sourceColumns)}
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ${textArray(desired.targetColumns)}
        AND bool_and(constraint_row.confdeltype = ${quoteLiteral(postgresActionCode(desired.onDelete))})
        AND bool_and(constraint_row.confupdtype = ${quoteLiteral(postgresActionCode(desired.onUpdate))})
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: ${desired.name}';
    END IF;`).join('\n');
  const expectedLegacy = plan.filter(({ alreadyComposite }) => !alreadyComposite).map(({ legacy }) => `
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_row
      JOIN pg_class AS source_table ON source_table.oid = constraint_row.conrelid
      JOIN pg_namespace AS source_namespace ON source_namespace.oid = source_table.relnamespace
      JOIN pg_class AS target_table ON target_table.oid = constraint_row.confrelid
      JOIN pg_namespace AS target_namespace ON target_namespace.oid = target_table.relnamespace
      CROSS JOIN LATERAL unnest(constraint_row.conkey, constraint_row.confkey)
        WITH ORDINALITY AS key_column(source_attnum, target_attnum, position)
      JOIN pg_attribute AS source_attribute
        ON source_attribute.attrelid = source_table.oid AND source_attribute.attnum = key_column.source_attnum
      JOIN pg_attribute AS target_attribute
        ON target_attribute.attrelid = target_table.oid AND target_attribute.attnum = key_column.target_attnum
      WHERE constraint_row.contype = 'f'
        AND constraint_row.conname = ${quoteLiteral(legacy.name)}
        AND source_namespace.nspname = 'public'
        AND source_table.relname = ${quoteLiteral(legacy.sourceTable)}
        AND target_namespace.nspname = 'public'
        AND target_table.relname = ${quoteLiteral(legacy.targetTable)}
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ${textArray(legacy.sourceColumns)}
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ${textArray(legacy.targetColumns)}
        AND bool_and(constraint_row.confdeltype = ${quoteLiteral(postgresActionCode(legacy.onDelete))})
        AND bool_and(constraint_row.confupdtype = ${quoteLiteral(postgresActionCode(legacy.onUpdate))})
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: ${legacy.name}';
    END IF;`).join('\n');
  dropStatements.push(`DO $tenant_fk_phase_c$
BEGIN${expectedComposites}${expectedLegacy}
END
$tenant_fk_phase_c$;`);
  for (const { legacy, alreadyComposite } of plan) {
    if (alreadyComposite) continue;
    dropStatements.push(`ALTER TABLE ${quoteIdentifier(legacy.sourceTable)} DROP CONSTRAINT ${quoteIdentifier(legacy.name)};`);
  }
  dropStatements.push('COMMIT;', '');

  const migrations = [
    { directory: migrationDirectories.add, sql: addStatements.join('\n') },
    { directory: migrationDirectories.validate, sql: validateStatements.join('\n') },
    { directory: migrationDirectories.dropLegacy, sql: dropStatements.join('\n') },
  ];
  if (additiveBranchPlan.length) {
    const additiveAdd = [
      '-- Generated from prisma/schema.prisma and the explicit additive relation registry.',
      '-- These relations were introduced after the original tenant-FK rollout.',
      'BEGIN;',
      "SET LOCAL lock_timeout = '5s';",
      "SET LOCAL statement_timeout = '1min';",
      ...additiveBranchPlan.map(({ desired }) =>
        `ALTER TABLE ${quoteIdentifier(desired.sourceTable)} ADD CONSTRAINT ${quoteIdentifier(desired.name)} ` +
        `FOREIGN KEY (${desired.sourceColumns.map(quoteIdentifier).join(', ')}) ` +
        `REFERENCES ${quoteIdentifier(desired.targetTable)} (${desired.targetColumns.map(quoteIdentifier).join(', ')}) ` +
        `ON DELETE ${desired.onDelete} ON UPDATE ${desired.onUpdate} NOT VALID;`,
      ),
      'COMMIT;',
      '',
    ].join('\n');
    const additiveValidate = [
      '-- Generated from prisma/schema.prisma and the explicit additive relation registry.',
      '-- Validate rows after indexes and the NOT VALID constraints are installed.',
      'BEGIN;',
      "SET LOCAL lock_timeout = '5s';",
      "SET LOCAL statement_timeout = '30min';",
      ...additiveBranchPlan.map(({ desired }) => `ALTER TABLE ${quoteIdentifier(desired.sourceTable)} VALIDATE CONSTRAINT ${quoteIdentifier(desired.name)};`),
      'COMMIT;',
      '',
    ].join('\n');
    migrations.push(
      { directory: additiveBranchMigrationDirectories.add, sql: additiveAdd },
      { directory: additiveBranchMigrationDirectories.validate, sql: additiveValidate },
    );
  }
  if (additivePeoplePlan.length) {
    const peopleAdd = [
      '-- Generated from prisma/schema.prisma and the explicit additive tenant-person relation registry.',
      '-- These relations were introduced with the shared tenant person identity.',
      'BEGIN;',
      "SET LOCAL lock_timeout = '5s';",
      "SET LOCAL statement_timeout = '1min';",
      ...additivePeoplePlan.map(({ desired }) =>
        `ALTER TABLE ${quoteIdentifier(desired.sourceTable)} ADD CONSTRAINT ${quoteIdentifier(desired.name)} ` +
        `FOREIGN KEY (${desired.sourceColumns.map(quoteIdentifier).join(', ')}) ` +
        `REFERENCES ${quoteIdentifier(desired.targetTable)} (${desired.targetColumns.map(quoteIdentifier).join(', ')}) ` +
        `ON DELETE ${desired.onDelete} ON UPDATE ${desired.onUpdate} NOT VALID;`,
      ),
      'COMMIT;',
      '',
    ].join('\n');
    const peopleValidate = [
      '-- Generated from prisma/schema.prisma and the explicit additive tenant-person relation registry.',
      '-- Validate rows after indexes and the NOT VALID constraints are installed.',
      'BEGIN;',
      "SET LOCAL lock_timeout = '5s';",
      "SET LOCAL statement_timeout = '30min';",
      ...additivePeoplePlan.map(({ desired }) => `ALTER TABLE ${quoteIdentifier(desired.sourceTable)} VALIDATE CONSTRAINT ${quoteIdentifier(desired.name)};`),
      'COMMIT;',
      '',
    ].join('\n');
    migrations.push(
      { directory: additivePeopleMigrationDirectories.add, sql: peopleAdd },
      { directory: additivePeopleMigrationDirectories.validate, sql: peopleValidate },
    );
  }
  if (additiveBillingPlan.length) {
    const billingAdd = [
      '-- Generated from prisma/schema.prisma and the explicit additive billing-cycle relation registry.',
      '-- These relations were introduced with generic recurring fee cycles.',
      'BEGIN;',
      "SET LOCAL lock_timeout = '5s';",
      "SET LOCAL statement_timeout = '1min';",
      ...additiveBillingPlan.map(({ desired }) =>
        `ALTER TABLE ${quoteIdentifier(desired.sourceTable)} ADD CONSTRAINT ${quoteIdentifier(desired.name)} ` +
        `FOREIGN KEY (${desired.sourceColumns.map(quoteIdentifier).join(', ')}) ` +
        `REFERENCES ${quoteIdentifier(desired.targetTable)} (${desired.targetColumns.map(quoteIdentifier).join(', ')}) ` +
        `ON DELETE ${desired.onDelete} ON UPDATE ${desired.onUpdate} NOT VALID;`,
      ),
      'COMMIT;',
      '',
    ].join('\n');
    const billingValidate = [
      '-- Generated from prisma/schema.prisma and the explicit additive billing-cycle relation registry.',
      '-- Validate cycle/person and fee-item ownership after constraints are installed.',
      'BEGIN;',
      "SET LOCAL lock_timeout = '5s';",
      "SET LOCAL statement_timeout = '30min';",
      ...additiveBillingPlan.map(({ desired }) => `ALTER TABLE ${quoteIdentifier(desired.sourceTable)} VALIDATE CONSTRAINT ${quoteIdentifier(desired.name)};`),
      'COMMIT;',
      '',
    ].join('\n');
    migrations.push(
      { directory: additiveBillingMigrationDirectories.add, sql: billingAdd },
      { directory: additiveBillingMigrationDirectories.validate, sql: billingValidate },
    );
  }
  return Object.freeze(migrations);
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function textArray(values) {
  return `ARRAY[${values.map(quoteLiteral).join(', ')}]::text[]`;
}

function postgresActionCode(action) {
  return ({
    'NO ACTION': 'a',
    RESTRICT: 'r',
    CASCADE: 'c',
    'SET NULL': 'n',
    'SET DEFAULT': 'd',
  })[action];
}

async function readLegacyMigrationSql() {
  const stages = JSON.parse(await readFile(stageManifestPath, 'utf8'));
  if (stages?.version !== 1 || !Array.isArray(stages.preIndexMigrations) || !Array.isArray(stages.postIndexMigrations)) {
    throw new Error('Migration stage manifest has no valid migration history');
  }
  const generatedConstraintStages = new Set([
    ...Object.values(migrationDirectories),
    ...Object.values(additiveBranchMigrationDirectories),
    ...Object.values(additivePeopleMigrationDirectories),
    ...Object.values(additiveBillingMigrationDirectories),
  ]);
  const historicalMigrations = [...stages.preIndexMigrations, ...stages.postIndexMigrations]
    .filter((directory) => !generatedConstraintStages.has(directory));
  const migrationFiles = await Promise.all(historicalMigrations.map((directory) =>
    readFile(resolve(migrationRoot, directory, 'migration.sql'), 'utf8'),
  ));
  return migrationFiles.join('\n');
}

export async function generateCompositeTenantConstraintMigration() {
  const [{ generatePrismaSchemaSql }, schema, legacySql] = await Promise.all([
    import('./generate-concurrent-index-plan.mjs'),
    readFile(schemaPath, 'utf8'),
    readLegacyMigrationSql(),
  ]);
  const targetSql = await generatePrismaSchemaSql();
  const result = buildCompositeTenantConstraintPlan({ schema, targetSql, legacySql });
  return { ...result, migrations: renderCompositeTenantConstraintMigration(result.plan, result.additiveBranchPlan, result.additivePeoplePlan, result.additiveBillingPlan) };
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const { plan, additiveBranchPlan, additivePeoplePlan, additiveBillingPlan, tenantModelCount, tenantRelationCount, migrations } = await generateCompositeTenantConstraintMigration();
  for (const migration of migrations) {
    const migrationDirectory = resolve(migrationRoot, migration.directory);
    const migrationFile = resolve(migrationDirectory, 'migration.sql');
    const relativeOutput = relative(root, migrationFile);
    if (isAbsolute(relativeOutput) || relativeOutput === '..' || relativeOutput.startsWith(`..${sep}`)) {
      throw new Error('Generated migration output must stay inside the workspace');
    }
    if (checkOnly) {
      const committedSql = await readFile(migrationFile, 'utf8');
      if (committedSql !== migration.sql) throw new Error(`Committed composite tenant-constraint migration is out of date: ${relative(root, migrationFile)}`);
    } else {
      await mkdir(dirname(migrationFile), { recursive: true });
      await writeFile(migrationFile, migration.sql, 'utf8');
    }
  }
  console.log(`Generated ${plan.length} historical, ${additiveBranchPlan.length} branch, ${additivePeoplePlan.length} tenant-person, and ${additiveBillingPlan.length} billing-cycle composite foreign keys for ${tenantModelCount} tenant models and ${tenantRelationCount} relations across ${migrations.length} migrations.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
