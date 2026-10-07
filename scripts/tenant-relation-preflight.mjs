import { TENANT_MODEL_NAMES } from './tenant-model-manifest.mjs';
import {
  parseModelFields,
  parseRelationList,
  validateTenantRelationSchema,
} from './tenant-relation-schema-validator.mjs';

function parseModels(schema) {
  return new Map([...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map((match) => [match[1], match[2]]));
}

function parsePrismaString(match) {
  return match ? JSON.parse(match[1]) : undefined;
}

function stripPrismaComments(source) {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      result += ' ';
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      if (index >= source.length) throw new Error('Unclosed comment in Prisma field attributes');
      index += 1;
      result += ' ';
      continue;
    }
    result += character;
  }
  return result;
}

function modelDatabaseLocation(modelName, body) {
  const map = body.match(/^\s*@@map\s*\(\s*("(?:\\.|[^"\\])*")\s*\)/m);
  const schema = body.match(/^\s*@@schema\s*\(\s*("(?:\\.|[^"\\])*")\s*\)/m);
  return {
    table: parsePrismaString(map) ?? modelName,
    schema: parsePrismaString(schema) ?? 'public',
  };
}

function fieldDatabaseName(field) {
  const attributes = stripPrismaComments(field.attributes);
  const map = attributes.match(/@map\s*\(\s*("(?:\\.|[^"\\])*")\s*\)/);
  return parsePrismaString(map) ?? field.name;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function buildTenantRelationInventory(schema, tenantModelNames = TENANT_MODEL_NAMES) {
  validateTenantRelationSchema(schema, tenantModelNames);
  const models = parseModels(schema);
  const tenantNames = new Set(tenantModelNames);
  const fieldsByModel = new Map([...models].map(([name, body]) => [name, parseModelFields(body)]));
  const locations = new Map([...models].map(([name, body]) => [name, modelDatabaseLocation(name, body)]));
  const relations = [];

  for (const sourceModel of tenantNames) {
    const sourceFields = fieldsByModel.get(sourceModel) ?? [];
    const sourceByName = new Map(sourceFields.map((field) => [field.name, field]));
    for (const relation of sourceFields) {
      if (!tenantNames.has(relation.type)) continue;
      const relationFields = parseRelationList(relation.relationAttributes, 'fields');
      const relationReferences = parseRelationList(relation.relationAttributes, 'references');
      if (!relationFields || !relationReferences) continue;

      const sourceTenant = sourceByName.get(relationFields[0]);
      const sourceReference = sourceByName.get(relationFields[1]);
      const targetFields = fieldsByModel.get(relation.type) ?? [];
      const targetByName = new Map(targetFields.map((field) => [field.name, field]));
      const targetTenant = targetByName.get(relationReferences[0]);
      const targetReference = targetByName.get(relationReferences[1]);
      const sourceId = sourceByName.get('id');
      if (!sourceTenant || !sourceReference || !targetTenant || !targetReference || !sourceId) {
        throw new Error(`Unable to map tenant relation ${sourceModel}.${relation.name} to database columns`);
      }

      relations.push({
        sourceModel,
        sourceRelation: relation.name,
        sourceSchema: locations.get(sourceModel).schema,
        sourceTable: locations.get(sourceModel).table,
        sourceIdColumn: fieldDatabaseName(sourceId),
        sourceTenantColumn: fieldDatabaseName(sourceTenant),
        sourceReferenceColumn: fieldDatabaseName(sourceReference),
        targetModel: relation.type,
        targetSchema: locations.get(relation.type).schema,
        targetTable: locations.get(relation.type).table,
        targetIdColumn: fieldDatabaseName(targetReference),
        targetTenantColumn: fieldDatabaseName(targetTenant),
      });
    }
  }
  return relations;
}

export function buildTenantRelationViolationQuery(relation, limitParameter = '$1') {
  const source = `${quoteIdentifier(relation.sourceSchema)}.${quoteIdentifier(relation.sourceTable)}`;
  const target = `${quoteIdentifier(relation.targetSchema)}.${quoteIdentifier(relation.targetTable)}`;
  return `SELECT
  s.${quoteIdentifier(relation.sourceIdColumn)}::text AS source_id,
  s.${quoteIdentifier(relation.sourceReferenceColumn)}::text AS target_id,
  CASE WHEN t.${quoteIdentifier(relation.targetIdColumn)} IS NULL THEN 'orphan' ELSE 'cross_tenant' END AS violation
FROM ${source} AS s
LEFT JOIN ${target} AS t
  ON t.${quoteIdentifier(relation.targetIdColumn)} = s.${quoteIdentifier(relation.sourceReferenceColumn)}
WHERE s.${quoteIdentifier(relation.sourceReferenceColumn)} IS NOT NULL
  AND (t.${quoteIdentifier(relation.targetIdColumn)} IS NULL
    OR s.${quoteIdentifier(relation.sourceTenantColumn)} IS DISTINCT FROM t.${quoteIdentifier(relation.targetTenantColumn)})
ORDER BY s.${quoteIdentifier(relation.sourceIdColumn)}::text
LIMIT ${limitParameter}`;
}

export class TenantRelationPreflightError extends Error {
  constructor(findings) {
    const details = findings.flatMap(({ relation, rows, hasMore }) => [
      ...rows.map((row) =>
        `${relation.sourceModel}.${relation.sourceRelation} ${row.violation}: source id=${row.source_id}; target id=${row.target_id}`,
      ),
      ...(hasMore ? [`${relation.sourceModel}.${relation.sourceRelation}: additional violating rows omitted`] : []),
    ]);
    super(`Tenant relation preflight found invalid references:\n${details.join('\n')}`);
    this.name = 'TenantRelationPreflightError';
    this.findings = findings;
  }
}

export async function runTenantRelationPreflight(client, relations, { sampleLimit = 10 } = {}) {
  if (!Number.isInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 100) {
    throw new RangeError('sampleLimit must be an integer from 1 through 100');
  }

  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const findings = [];
  try {
    for (const relation of relations) {
      const result = await client.query(buildTenantRelationViolationQuery(relation), [sampleLimit + 1]);
      if (result.rows.length) {
        findings.push({
          relation,
          rows: result.rows.slice(0, sampleLimit),
          hasMore: result.rows.length > sampleLimit,
        });
      }
    }
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the preflight query error; the caller will discard the connection.
    }
    throw error;
  }
  await client.query('ROLLBACK');

  if (findings.length) throw new TenantRelationPreflightError(findings);
  return { checkedRelations: relations.length, sampleLimit };
}
