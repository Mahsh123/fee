import { TENANT_MODEL_NAMES } from './tenant-model-manifest.mjs';

function parseModels(schema) {
  return new Map([...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map((match) => [match[1], match[2]]));
}

function closingParenthesis(source, openIndex) {
  let depth = 1;
  let inString = false;
  let escaped = false;
  for (let index = openIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      if (index >= source.length) throw new Error('Unclosed comment in @relation(...) declaration');
      index += 1;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '(') depth += 1;
    else if (character === ')' && --depth === 0) return index;
  }
  throw new Error('Unclosed @relation(...) declaration in Prisma model');
}

export function parseModelFields(body) {
  const fields = [];
  const fieldPattern = /^[ \t]*(\w+)[ \t]+(\w+)(\[\])?(\?)?(?:[ \t]+([^\r\n]*))?/gm;
  for (const match of body.matchAll(fieldPattern)) {
    const tail = match[5] ?? '';
    const marker = tail.indexOf('@relation');
    let relationAttributes;
    if (marker >= 0) {
      const tailOffset = match[0].lastIndexOf(tail);
      const relationStart = match.index + tailOffset + marker;
      const openIndex = body.indexOf('(', relationStart + '@relation'.length);
      if (openIndex < 0 || !/^@relation\s*$/.test(body.slice(relationStart, openIndex))) {
        throw new Error(`Malformed @relation declaration for model field ${match[1]}`);
      }
      const closeIndex = closingParenthesis(body, openIndex);
      relationAttributes = body.slice(openIndex + 1, closeIndex);
    }
    fields.push({
      name: match[1],
      type: match[2],
      isList: Boolean(match[3]),
      isOptional: Boolean(match[4]),
      attributes: tail,
      relationAttributes,
    });
  }
  return fields;
}

export function parseRelationList(attributes, name) {
  if (attributes === undefined) return undefined;
  const match = attributes.match(new RegExp(`${name}:\\s*\\[([^\\]]+)\\]`));
  return match ? match[1].split(',').map((value) => value.trim()) : undefined;
}

function hasIndexPrefix(body, expected) {
  return body.split(/\r?\n/).some((line) => {
    const match = line.match(/@@(?:index|unique|id)\s*\(\s*\[([^\]]+)\]/);
    if (!match) return false;
    const fields = match[1].split(',').map((value) => value.trim().split('(')[0].trim());
    return expected.every((field, index) => fields[index] === field);
  });
}

function hasUniqueKey(body, expected) {
  return body.split(/\r?\n/).some((line) => {
    const match = line.match(/@@(unique|id)\s*\(\s*\[([^\]]+)\]/);
    if (!match) return false;
    const fields = match[2].split(',').map((value) => value.trim());
    return fields.length === expected.length && expected.every((field, index) => fields[index] === field);
  });
}

export function validateTenantRelationSchema(schema, tenantModelNames = TENANT_MODEL_NAMES) {
  const models = parseModels(schema);
  const tenantNames = new Set(tenantModelNames);
  const failures = [];

  for (const name of tenantNames) {
    const body = models.get(name);
    if (!body) {
      failures.push(`${name}: tenant model is missing from Prisma schema`);
      continue;
    }
    if (!/^[ \t]*tenantId[ \t]+String\b/m.test(body)) {
      failures.push(`${name}: tenant model is missing tenantId`);
      continue;
    }
    if (!hasUniqueKey(body, ['tenantId', 'id'])) failures.push(`${name}: missing unique (tenantId, id)`);
    const hasTenantRelation = parseModelFields(body).some((field) => {
      if (field.type !== 'Tenant' || field.relationAttributes === undefined) return false;
      return parseRelationList(field.relationAttributes, 'fields')?.join(',') === 'tenantId' &&
        parseRelationList(field.relationAttributes, 'references')?.join(',') === 'id';
    });
    if (!hasTenantRelation) failures.push(`${name}: missing tenantId -> Tenant.id relation`);
  }

  for (const [name, body] of models) {
    const declaresTenantId = /^[ \t]*tenantId[ \t]+String\b/m.test(body);
    if (declaresTenantId && !tenantNames.has(name)) failures.push(`${name}: tenant-owned model is not classified in tenant-model-manifest.mjs`);
    if (!tenantNames.has(name)) continue;

    for (const field of parseModelFields(body)) {
      if (!tenantNames.has(field.type)) continue;
      const targetBody = models.get(field.type);
      if (!targetBody) {
        failures.push(`${name}.${field.name}: target tenant model ${field.type} is missing from Prisma schema`);
        continue;
      }
      const fields = parseRelationList(field.relationAttributes, 'fields');
      const references = parseRelationList(field.relationAttributes, 'references');

      if (!fields && !references) {
        const inverse = parseModelFields(targetBody).filter((targetField) => targetField.type === name);
        const inverseCompositeRelation = inverse.some((targetField) =>
          parseRelationList(targetField.relationAttributes, 'fields') &&
          parseRelationList(targetField.relationAttributes, 'references'),
        );
        const inverseList = inverse.some((targetField) => targetField.isList &&
          !parseRelationList(targetField.relationAttributes, 'fields') &&
          !parseRelationList(targetField.relationAttributes, 'references') &&
          !(name === field.type && targetField.name === field.name),
        );
        if (field.isList && inverseList) {
          failures.push(`${name}.${field.name}: implicit many-to-many tenant relation has no explicit composite join table`);
        } else if (!inverseCompositeRelation) {
          failures.push(`${name}.${field.name}: tenant relation has no explicit composite foreign-key side`);
        }
        continue;
      }

      if (!fields || !references || field.isList || fields.length !== 2 || fields[0] !== 'tenantId' ||
          references.length !== 2 || references[0] !== 'tenantId' || references[1] !== 'id') {
        failures.push(`${name}.${field.name}: expected [tenantId, relatedId] -> [tenantId, id]`);
        continue;
      }
      if (!hasIndexPrefix(body, fields)) failures.push(`${name}.${field.name}: missing child index prefix (${fields.join(', ')})`);
      if (!hasUniqueKey(models.get(field.type), ['tenantId', 'id'])) {
        failures.push(`${name}.${field.name}: target ${field.type} has no unique (tenantId, id)`);
      }
    }
  }

  if (failures.length) throw new Error(`Tenant relation schema validation failed:\n${failures.join('\n')}`);
  let relationCount = 0;
  for (const name of tenantNames) {
    for (const field of parseModelFields(models.get(name))) {
      if (tenantNames.has(field.type) && parseRelationList(field.relationAttributes, 'fields')) relationCount += 1;
    }
  }
  return { tenantModelCount: tenantNames.size, tenantRelationCount: relationCount };
}

export function validateTenantRelationSchemaBeforeReferenceMetadata(schema, referenceManifest, tenantModelNames = TENANT_MODEL_NAMES) {
  const inventory = validateTenantRelationSchema(schema, tenantModelNames);
  const models = parseModels(schema);
  const tenantNames = new Set(tenantModelNames);
  const relationFields = new Set();

  for (const name of tenantNames) {
    const body = models.get(name);
    if (!body) continue;
    for (const field of parseModelFields(body)) {
      if (!tenantNames.has(field.type)) continue;
      for (const sourceField of parseRelationList(field.relationAttributes, 'fields') ?? []) {
        if (sourceField !== 'tenantId') relationFields.add(`${name}.${sourceField}`);
      }
    }
  }

  const duplicateFields = [];
  for (const [model, fields] of Object.entries(referenceManifest?.references ?? {})) {
    for (const field of Object.keys(fields)) {
      if (relationFields.has(`${model}.${field}`)) duplicateFields.push(`${model}.${field}`);
    }
  }
  if (duplicateFields.length) {
    throw new Error(`Relation fields cannot be classified as scalar tenant references: ${duplicateFields.join(', ')}`);
  }
  return inventory;
}
