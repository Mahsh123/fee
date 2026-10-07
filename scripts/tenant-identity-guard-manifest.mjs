import { createHash } from 'node:crypto';
import { parseModels } from './generate-concurrent-index-plan.mjs';
import { TENANT_MODEL_NAMES } from './tenant-model-manifest.mjs';
import { validateTenantRelationSchema } from './tenant-relation-schema-validator.mjs';

export const IDENTITY_GUARD_FUNCTION = Object.freeze({
  schema: 'public',
  name: 'fee_prevent_identity_reassignment',
  argumentTypes: [],
});

function stableTriggerName(tableName, columnName) {
  const digest = createHash('sha256').update(tableName + '\0' + columnName).digest('hex').slice(0, 12);
  return 'fee_identity_' + digest;
}

export function buildTenantIdentityGuardManifest(schema, tenantModelNames = TENANT_MODEL_NAMES) {
  validateTenantRelationSchema(schema, tenantModelNames);
  const models = parseModels(schema);
  const root = models.get('Tenant');
  if (!root) throw new Error('Tenant root model is missing from the Prisma schema');
  const rootIdColumn = root.fields.get('id');
  if (!rootIdColumn) throw new Error('Tenant root model is missing its id column');

  const triggers = [{
    modelName: 'Tenant',
    table: root.table,
    column: rootIdColumn,
    triggerName: stableTriggerName(root.table, rootIdColumn),
  }];
  for (const modelName of tenantModelNames) {
    const model = models.get(modelName);
    if (!model) throw new Error('Tenant model is missing from the Prisma schema: ' + modelName);
    const tenantColumn = model.fields.get('tenantId');
    if (!tenantColumn) throw new Error(modelName + ' is missing its mapped tenantId column');
    triggers.push({
      modelName,
      table: model.table,
      column: tenantColumn,
      triggerName: stableTriggerName(model.table, tenantColumn),
    });
  }

  const triggerNames = new Set();
  for (const trigger of triggers) {
    if (triggerNames.has(trigger.triggerName)) throw new Error('Tenant identity guard trigger name collision');
    triggerNames.add(trigger.triggerName);
  }
  return Object.freeze({
    function: IDENTITY_GUARD_FUNCTION,
    triggers: Object.freeze(triggers.map((trigger) => Object.freeze(trigger))),
  });
}
