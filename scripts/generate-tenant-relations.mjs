import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TENANT_REFERENCE_MANIFEST } from './tenant-reference-manifest.mjs';
import {
  parseModelFields,
  parseRelationList,
  validateTenantRelationSchemaBeforeReferenceMetadata,
} from './tenant-relation-schema-validator.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(root, 'prisma/schema.prisma');
const outputPath = resolve(root, 'packages/database/src/tenant-relations.generated.ts');
const schema = await readFile(schemaPath, 'utf8');
const relationInventory = validateTenantRelationSchemaBeforeReferenceMetadata(schema, TENANT_REFERENCE_MANIFEST);
const models = new Map();
const enums = new Map();

for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  const [, name, body] = match;
  const tenantOwned = /^[ \t]*tenantId[ \t]+String\b/m.test(body);
  models.set(name, { body, tenantOwned });
}
for (const match of schema.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  const [, name, body] = match;
  enums.set(name, new Set(body.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[A-Z][A-Z0-9_]*$/.test(line))));
}

const targetsByModel = {};
const declaredRelationFields = new Set();
const classifications = new Map();

function fieldDeclaration(body, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`^[ \\t]*${escaped}[ \\t]+([A-Za-z][A-Za-z0-9_]*)(\\[\\])?(\\?)?(?:[ \\t]+([^\\n]*))?$`, 'm'));
  if (!match) return undefined;
  return { type: match[1], isArray: !!match[2], optional: !!match[3], attributes: match[4] ?? '' };
}

function normalizeTarget(value) {
  return typeof value === 'string' ? { model: value, field: 'id' } : value;
}

function validateTarget(sourceModel, sourceField, targetValue) {
  const { model: targetModel, field: targetField = 'id' } = normalizeTarget(targetValue);
  const target = models.get(targetModel);
  if (!target?.tenantOwned) {
    throw new Error(`${sourceModel}.${sourceField} target ${targetModel} is not a tenant-owned model`);
  }
  const targetDeclaration = fieldDeclaration(target.body, targetField);
  if (!targetDeclaration || targetDeclaration.type !== 'String' || targetDeclaration.isArray || !targetDeclaration.attributes.includes('@db.Uuid')) {
    throw new Error(`${sourceModel}.${sourceField} target field ${targetModel}.${targetField} is not a scalar UUID`);
  }
  return { model: targetModel, field: targetField };
}

function normalizedTargetList(value, sourceModel, sourceField) {
  const values = Array.isArray(value) ? value : [value];
  if (values.length !== 1) {
    throw new Error(`${sourceModel}.${sourceField} must use one target per discriminator value to prevent cross-model UUID collisions`);
  }
  return values.map((target) => validateTarget(sourceModel, sourceField, target));
}

function normalizeRule(sourceModel, sourceField, value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'discriminator' in value) {
    const { discriminator, defaultValue, values } = value;
    const declaration = fieldDeclaration(models.get(sourceModel).body, discriminator);
    if (!declaration || declaration.isArray) throw new Error(`${sourceModel}.${sourceField} discriminator ${discriminator} is not a scalar field`);

    let expandedValues = values;
    if (values === '@tenantModels') {
      expandedValues = Object.fromEntries([...models.entries()].filter(([, model]) => model.tenantOwned).map(([name]) => [name, name]));
    }
    if (!expandedValues || typeof expandedValues !== 'object' || Array.isArray(expandedValues) || Object.keys(expandedValues).length === 0) {
      throw new Error(`${sourceModel}.${sourceField} needs an explicit discriminator map`);
    }

    const normalized = {};
    for (const [discriminatorValue, target] of Object.entries(expandedValues)) {
      if (declaration.type !== 'String' && !enums.get(declaration.type)?.has(discriminatorValue)) {
        throw new Error(`${sourceModel}.${sourceField} discriminator value ${discriminatorValue} is not a ${declaration.type} value`);
      }
      normalized[discriminatorValue] = normalizedTargetList(target, sourceModel, sourceField);
    }
    if (defaultValue !== undefined) {
      if (declaration.type !== 'String' && !enums.get(declaration.type)?.has(defaultValue)) {
        throw new Error(`${sourceModel}.${sourceField} default discriminator ${defaultValue} is not a ${declaration.type} value`);
      }
      if (!normalized[defaultValue]) throw new Error(`${sourceModel}.${sourceField} default discriminator ${defaultValue} has no target mapping`);
    }
    return { discriminator, ...(defaultValue === undefined ? {} : { defaultValue }), values: normalized };
  }

  return normalizedTargetList(value, sourceModel, sourceField);
}

function setRule(sourceModel, sourceField, value) {
  targetsByModel[sourceModel] ??= {};
  if (targetsByModel[sourceModel][sourceField]) throw new Error(`Duplicate tenant-reference mapping for ${sourceModel}.${sourceField}`);
  targetsByModel[sourceModel][sourceField] = value;
}

function addManifestReference(sourceModel, sourceField, value, allowNonUuid = false) {
  const source = models.get(sourceModel);
  const declaration = source && fieldDeclaration(source.body, sourceField);
  if (!source?.tenantOwned || !declaration) throw new Error(`Reference manifest field ${sourceModel}.${sourceField} is not a field on a tenant-owned model`);
  if (!allowNonUuid && !declaration.attributes.includes('@db.Uuid')) {
    throw new Error(`Reference manifest field ${sourceModel}.${sourceField} is not a UUID scalar`);
  }
  if (declaration.isArray && !declaration.attributes.includes('@db.Uuid')) {
    throw new Error(`Reference manifest array ${sourceModel}.${sourceField} is not a UUID array`);
  }
  const key = `${sourceModel}.${sourceField}`;
  if (declaredRelationFields.has(key)) throw new Error(`${key} is already represented by a Prisma relation; remove it from the reference manifest`);
  setRule(sourceModel, sourceField, normalizeRule(sourceModel, sourceField, value));
  classifications.set(key, 'reference');
}

for (const [sourceModel, source] of models) {
  if (!source.tenantOwned) continue;

  const relationFields = parseModelFields(source.body);
  const tenantRelation = relationFields.some((field) =>
    field.type === 'Tenant' &&
    parseRelationList(field.relationAttributes, 'fields')?.includes('tenantId') &&
    parseRelationList(field.relationAttributes, 'references')?.includes('id'),
  );
  if (!tenantRelation) throw new Error(`${sourceModel} is tenant-owned but has no tenantId -> Tenant.id relation`);

  for (const relation of relationFields) {
    const targetModel = relation.type;
    if (!models.has(targetModel)) continue;
    const fields = parseRelationList(relation.relationAttributes, 'fields')?.join(',');
    const references = parseRelationList(relation.relationAttributes, 'references')?.join(',');
    if (!fields || !references) continue;

    const sourceFields = fields.split(',').map((field) => field.trim());
    const targetFields = references.split(',').map((field) => field.trim());
    if (sourceFields.length !== targetFields.length) throw new Error(`Relation field mismatch in ${sourceModel} -> ${targetModel}`);

    for (let index = 0; index < sourceFields.length; index += 1) {
      const sourceField = sourceFields[index];
      const targetField = targetFields[index];
      if (sourceField === 'tenantId' && targetField === 'tenantId') continue;
      declaredRelationFields.add(`${sourceModel}.${sourceField}`);
      if (!models.get(targetModel)?.tenantOwned) continue;
      if (sourceField === 'tenantId' || targetField !== 'id') {
        throw new Error(`Unsupported tenant relation ${sourceModel}.${sourceField} -> ${targetModel}.${targetField}`);
      }
      setRule(sourceModel, sourceField, [validateTarget(sourceModel, sourceField, { model: targetModel, field: targetField })]);
      classifications.set(`${sourceModel}.${sourceField}`, 'reference');
    }
  }
}

for (const [sourceModel, fields] of Object.entries(TENANT_REFERENCE_MANIFEST.references)) {
  for (const [field, value] of Object.entries(fields)) addManifestReference(sourceModel, field, value);
}
const unclassified = [];
for (const [sourceModel, source] of models) {
  if (!source.tenantOwned) continue;
  for (const fieldMatch of source.body.matchAll(/^[ \t]*(\w+)[ \t]+String(\[\])?\??[ \t]+([^\n]*)/gm)) {
    const [, field, , attributes] = fieldMatch;
    if (!attributes.includes('@db.Uuid') || field === 'id' || field === 'tenantId') continue;
    const key = `${sourceModel}.${field}`;
    if (declaredRelationFields.has(key) || classifications.has(key)) continue;
    if (Object.hasOwn(TENANT_REFERENCE_MANIFEST.opaque, key)) {
      if (TENANT_REFERENCE_MANIFEST.opaque[key].trim().length < 20) throw new Error(`${key} needs a meaningful opaque-field reason`);
      classifications.set(key, 'opaque');
      continue;
    }
    unclassified.push(key);
  }
}

for (const [sourceModel, fields] of Object.entries(TENANT_REFERENCE_MANIFEST.references)) {
  for (const field of Object.keys(fields)) {
    const declaration = fieldDeclaration(models.get(sourceModel)?.body ?? '', field);
    if (!declaration || !declaration.attributes.includes('@db.Uuid')) throw new Error(`Invalid reference manifest field ${sourceModel}.${field}`);
  }
}
for (const key of Object.keys(TENANT_REFERENCE_MANIFEST.opaque)) {
  if (!classifications.has(key)) throw new Error(`Opaque manifest field ${key} is not an unmodeled tenant-owned UUID scalar`);
}
for (const [key, reason] of Object.entries(TENANT_REFERENCE_MANIFEST.nonUuidOpaque)) {
  const separator = key.indexOf('.');
  const sourceModel = key.slice(0, separator);
  const field = key.slice(separator + 1);
  const source = models.get(sourceModel);
  const declaration = source && fieldDeclaration(source.body, field);
  if (!source?.tenantOwned || !declaration || declaration.type !== 'String' || declaration.attributes.includes('@db.Uuid')) {
    throw new Error(`Non-UUID opaque manifest field ${key} is not a tenant-owned string field`);
  }
  if (reason.trim().length < 20) throw new Error(`${key} needs a meaningful non-UUID opaque-field reason`);
}
if (unclassified.length > 0) {
  throw new Error(`Unclassified tenant-owned UUID fields:\n${unclassified.map((field) => `  - ${field}`).join('\n')}`);
}

const ordered = Object.fromEntries(
  Object.entries(targetsByModel)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([model, targets]) => [model, Object.fromEntries(Object.entries(targets).sort(([left], [right]) => left.localeCompare(right)))]),
);
const output = [
  '/** Generated from prisma/schema.prisma and the explicit reference manifest. Do not edit manually. */',
  `export type TenantReferenceTarget = { model: string; field: string };`,
  `export type TenantReferenceRule = readonly TenantReferenceTarget[] | { discriminator: string; defaultValue?: string; values: Readonly<Record<string, readonly TenantReferenceTarget[]>> };`,
  `export const TENANT_FOREIGN_KEY_TARGETS: Readonly<Record<string, Readonly<Record<string, TenantReferenceRule>>>> = ${JSON.stringify(ordered, null, 2)};`,
  `export const TENANT_OPAQUE_UUID_FIELDS: Readonly<Record<string, string>> = ${JSON.stringify(TENANT_REFERENCE_MANIFEST.opaque, null, 2)};`,
  `export const TENANT_OPAQUE_NON_UUID_FIELDS: Readonly<Record<string, string>> = ${JSON.stringify(TENANT_REFERENCE_MANIFEST.nonUuidOpaque, null, 2)};`,
  '',
].join('\n');

await writeFile(outputPath, output, 'utf8');
const manifestFieldCount = [...classifications.keys()].filter((key) => !declaredRelationFields.has(key)).length;
console.log(`Generated tenant reference metadata for ${Object.keys(ordered).length} models and ${relationInventory.tenantRelationCount} composite relations; classified ${manifestFieldCount} non-relational reference fields.`);
