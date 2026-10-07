export const DATABASE_CONTROL_TABLES = Object.freeze(['_prisma_migrations', 'app_schema_capabilities']);

export const AUTHENTICATION_READ_MODELS = Object.freeze([
  'Tenant', 'Role', 'Permission', 'UserRole', 'RolePermission',
]);

export const AUTHENTICATION_USER_UPDATE_COLUMNS = Object.freeze([
  'tenantId', 'lastLoginAt', 'failedLoginCount', 'lockedUntil', 'updatedAt',
]);

export const AUTHENTICATION_REFRESH_TOKEN_UPDATE_COLUMNS = Object.freeze(['tenantId', 'revokedAt']);

export function parsePrismaObjectInventory(schemaSource) {
  if (typeof schemaSource !== 'string' || schemaSource.length === 0) throw new Error('Prisma schema source is required');
  const models = new Map();
  const physicalColumns = new Map();
  const automaticUpdateColumns = new Map();
  for (const match of schemaSource.matchAll(/^model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{([\s\S]*?)^\}/gm)) {
    const [, modelName, body] = match;
    const mapping = body.match(/^\s*@@map\("([^"\r\n]+)"\)\s*$/m)?.[1] ?? modelName;
    if (models.has(modelName) || [...models.values()].includes(mapping)) {
      throw new Error(`Prisma schema has a duplicate model or physical table mapping: ${modelName}`);
    }
    models.set(modelName, mapping);
    const columns = new Map();
    const automatic = [];
    for (const line of body.split(/\r?\n/)) {
      const field = line.match(/^\s{2,}([A-Za-z][A-Za-z0-9_]*)\s+[A-Za-z][A-Za-z0-9_]*(?:\?)?(?:\[\])?(.*)$/);
      if (!field) continue;
      const [, fieldName, attributes] = field;
      const physicalName = attributes.match(/@map\("([^"\r\n]+)"\)/)?.[1] ?? fieldName;
      columns.set(fieldName, physicalName);
      if (/@updatedAt\b/.test(attributes)) automatic.push(physicalName);
    }
    physicalColumns.set(modelName, columns);
    automaticUpdateColumns.set(modelName, automatic);
  }
  const enums = [...schemaSource.matchAll(/^enum\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/gm)].map((match) => match[1]);
  if (models.size === 0 || enums.length === 0 || new Set(enums).size !== enums.length) {
    throw new Error('Prisma schema inventory is empty or contains duplicate enums');
  }
  for (const requiredModel of [...AUTHENTICATION_READ_MODELS, 'User', 'RefreshToken', 'AuditLog']) {
    if (!models.has(requiredModel)) throw new Error(`Required authentication ACL model is missing: ${requiredModel}`);
  }
  return { models, enums, physicalColumns, automaticUpdateColumns };
}

export function expectedPublicRelations(inventory, { hasCapabilityTable = false } = {}) {
  return new Set([
    ...inventory.models.values(),
    '_prisma_migrations',
    ...(hasCapabilityTable ? ['app_schema_capabilities'] : []),
  ]);
}
