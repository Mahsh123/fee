import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TENANT_MODEL_NAMES } from './tenant-model-manifest.mjs';
import {
  parseModelFields,
  parseRelationList,
  validateTenantRelationSchema,
} from './tenant-relation-schema-validator.mjs';
import { validateConcurrentIndexPlan } from './concurrent-index-runner.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(root, 'prisma/schema.prisma');
const outputArgumentIndex = process.argv.indexOf('--output');
const onlyIndexArgumentIndex = process.argv.indexOf('--only-index');
const outputPath = resolve(root, outputArgumentIndex >= 0
  ? process.argv[outputArgumentIndex + 1] ?? '.tmp/tenant-relation-index-plan.json'
  : '.tmp/tenant-relation-index-plan.json');

function unquotePrismaString(value) {
  return value.replaceAll('\\"', '"').replaceAll('\\\\', '\\');
}

function mappedIdentifier(body, attribute, fallback) {
  const prefix = attribute.startsWith('@@') ? `^[ \\t]*${attribute}` : `${attribute}`;
  const match = body.match(new RegExp(`${prefix}\\s*\\(\\s*"((?:\\\\.|[^"])*)"\\s*\\)`, 'm'));
  return match ? unquotePrismaString(match[1]) : fallback;
}

export function parseModels(schema) {
  return new Map([...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map((match) => {
    const [, name, body] = match;
    const fields = new Map(parseModelFields(body).map((field) => [
      field.name,
      mappedIdentifier(field.attributes, '@map', field.name),
    ]));
    return [name, {
      table: mappedIdentifier(body, '@@map', name),
      fields,
      declarations: parseModelFields(body),
    }];
  }));
}

function splitSqlList(value) {
  const items = [];
  let current = '';
  let quoted = false;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      current += character;
      if (character === '"' && value[index + 1] === '"') {
        current += value[index + 1];
        index += 1;
      } else if (character === '"') {
        quoted = false;
      }
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  if (quoted || depth !== 0) return undefined;
  if (current.trim()) items.push(current.trim());
  return items;
}

function parseSimpleIdentifier(value) {
  const match = value.match(/^"((?:[^"]|"")*)"$/);
  return match ? match[1].replaceAll('""', '"') : undefined;
}

function parseIndexPredicate(value) {
  if (value === undefined) return undefined;
  const compact = value.trim().replace(/^\((.*)\)$/s, '$1').trim();
  const identifier = '"((?:""|[^"])*)"';
  const nullMatch = compact.match(new RegExp(`^${identifier}\\s+IS\\s+(NOT\\s+)?NULL$`, 'i'));
  if (nullMatch) return { column: nullMatch[1].replaceAll('""', '"'), isNull: !nullMatch[2] };
  const booleanMatch = compact.match(new RegExp(`^${identifier}\\s*=\\s*(TRUE|FALSE)$`, 'i'));
  if (booleanMatch) return { column: booleanMatch[1].replaceAll('""', '"'), equals: booleanMatch[2].toLowerCase() === 'true' };
  return null;
}

export function parseGeneratedIndexes(sql) {
  const indexes = [];
  for (const line of sql.split(/\r?\n/)) {
    const match = line.trim().match(/^CREATE\s+(UNIQUE\s+)?INDEX\s+"((?:[^"]|"")*)"\s+ON\s+"((?:[^"]|"")*)"\s*\((.*?)\)(?:\s+WHERE\s+(.+?))?;$/i);
    if (!match) continue;
    const [, unique, rawName, rawTable, rawColumns, rawPredicate] = match;
    const columnTokens = splitSqlList(rawColumns);
    if (!columnTokens) throw new Error(`Could not parse Prisma-generated index ${rawName}`);
    const columns = columnTokens.map(parseSimpleIdentifier);
    const where = parseIndexPredicate(rawPredicate);
    indexes.push({
      schema: 'public',
      table: rawTable.replaceAll('""', '"'),
      indexName: rawName.replaceAll('""', '"'),
      columns,
      unique: Boolean(unique),
      ...(rawPredicate === undefined ? {} : { where }),
    });
  }
  return indexes;
}

export function generateTenantCompositeIndexPlan({ schema, schemaSql, tenantModelNames = TENANT_MODEL_NAMES, indexNames }) {
  const inventory = validateTenantRelationSchema(schema, tenantModelNames);
  const models = parseModels(schema);
  const tenantModels = new Set(tenantModelNames);
  const generatedIndexes = parseGeneratedIndexes(schemaSql);
  const requirements = [];

  for (const modelName of tenantModelNames) {
    const model = models.get(modelName);
    if (!model) throw new Error(`Tenant model ${modelName} is missing from Prisma schema`);
    const tenantColumn = model.fields.get('tenantId');
    const idColumn = model.fields.get('id');
    if (!tenantColumn || !idColumn) throw new Error(`${modelName} is missing tenantId/id scalar metadata`);
    requirements.push({ model: modelName, table: model.table, columns: [tenantColumn, idColumn], unique: true, kind: 'target-key' });

    for (const relation of model.declarations) {
      if (!tenantModels.has(relation.type)) continue;
      const fields = parseRelationList(relation.relationAttributes, 'fields');
      const references = parseRelationList(relation.relationAttributes, 'references');
      if (!fields || !references) continue;
      if (fields.length !== 2 || references.length !== 2 || fields[0] !== 'tenantId' || fields[1] === 'tenantId') {
        throw new Error(`${modelName}.${relation.name} has an unsupported tenant relation tuple`);
      }
      const columns = fields.map((field) => model.fields.get(field));
      if (columns.some((column) => !column)) throw new Error(`${modelName}.${relation.name} refers to an unknown scalar column`);
      requirements.push({ model: modelName, table: model.table, columns, unique: false, kind: 'child-reference', relation: relation.name });
    }
  }

  const chosen = new Map();
  for (const requirement of requirements) {
    const candidates = generatedIndexes
      .filter((index) => index.table === requirement.table)
      .filter((index) => requirement.kind === 'target-key'
        ? index.unique && index.where === undefined && index.columns.length === requirement.columns.length && requirement.columns.every((column, offset) => index.columns[offset] === column)
        : index.columns.length >= requirement.columns.length && requirement.columns.every((column, offset) => index.columns[offset] === column))
      .filter((index) => index.columns.every((column) => typeof column === 'string'))
      .filter((index) => index.where === undefined);
    candidates.sort((left, right) => left.columns.length - right.columns.length || left.indexName.localeCompare(right.indexName));
    const index = candidates[0];
    if (!index) {
      const edge = requirement.relation ? `${requirement.model}.${requirement.relation}` : requirement.model;
      throw new Error(`Prisma-generated DDL has no supported index for ${edge} (${requirement.columns.join(', ')})`);
    }
    chosen.set(index.indexName, index);
  }

  let plannedIndexes = [...chosen.values()];
  if (indexNames !== undefined) {
    const selections = Array.isArray(indexNames) ? indexNames.map((selection) =>
      typeof selection === 'string'
        ? { indexName: selection, schemaIndexName: selection }
        : { indexName: selection?.indexName, schemaIndexName: selection?.schemaIndexName ?? selection?.indexName }) : [];
    if (!selections.length
      || selections.some(({ indexName, schemaIndexName }) => typeof indexName !== 'string'
        || !/^[a-zA-Z_][a-zA-Z0-9_$]{0,62}$/.test(indexName)
        || typeof schemaIndexName !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_$]{0,62}$/.test(schemaIndexName))
      || new Set(selections.map(({ indexName }) => indexName)).size !== selections.length) {
      throw new Error('--only-index must name one or more distinct PostgreSQL index identifiers');
    }
    const byName = new Map(chosen);
    plannedIndexes = selections.map(({ indexName, schemaIndexName }) => {
      const candidate = byName.get(schemaIndexName) ?? generatedIndexes.find((index) => index.indexName === schemaIndexName);
      if (!candidate || generatedIndexes.filter((index) => index.indexName === schemaIndexName).length > 1) {
        throw new Error(`Requested index is absent or ambiguous in Prisma-generated DDL: ${schemaIndexName}`);
      }
      return { ...candidate, indexName };
    });
    for (const { indexName, schemaIndexName } of selections) {
      if (indexName === schemaIndexName) continue;
      if (generatedIndexes.filter((index) => index.indexName === schemaIndexName).length !== 1) {
        throw new Error(`Requested index is absent or ambiguous in Prisma-generated DDL: ${schemaIndexName}`);
      }
    }
  }
  const canonical = validateConcurrentIndexPlan({
    version: 1,
    name: indexNames === undefined ? 'tenant-relation-equality-indexes' : 'schema-derived-index-barrier',
    indexes: plannedIndexes,
  });
  return {
    plan: { version: canonical.version, name: canonical.name, indexes: canonical.indexes },
    stageChecksum: canonical.checksum,
    tenantModelCount: inventory.tenantModelCount,
    tenantRelationCount: inventory.tenantRelationCount,
    indexCount: canonical.indexes.length,
  };
}

export async function generatePrismaSchemaSql() {
  const temporaryRoot = resolve(root, '.tmp');
  await mkdir(temporaryRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'prisma-index-plan-'));
  const outputFile = join(temporaryDirectory, 'schema.sql');
  const relativeTemporaryPath = relative(root, temporaryDirectory);
  if (isAbsolute(relativeTemporaryPath) || relativeTemporaryPath === '..' || relativeTemporaryPath.startsWith(`..${sep}`)) {
    throw new Error('Prisma DDL output directory must stay inside the workspace');
  }
  try {
    const prismaEntrypoint = resolve(root, 'node_modules/prisma/build/index.js');
    const relativeOutputFile = relative(root, outputFile).replaceAll('\\', '/');
    const childEnvironment = Object.fromEntries(Object.entries({
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      MIGRATION_DATABASE_URL: process.env.MIGRATION_DATABASE_URL ?? 'postgresql://fee_plan_generator:unused@127.0.0.1:5432/fee_plan',
    }).filter(([, value]) => typeof value === 'string'));
    execFileSync(process.execPath, [
      prismaEntrypoint,
      'migrate', 'diff', '--from-empty', '--to-schema', schemaPath, '--script', '--output', relativeOutputFile,
    ], { cwd: root, encoding: 'utf8', env: childEnvironment, stdio: ['ignore', 'pipe', 'inherit'] });
    return await readFile(outputFile, 'utf8');
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  let indexNames;
  if (onlyIndexArgumentIndex >= 0) {
    const rawIndexNames = process.argv[onlyIndexArgumentIndex + 1];
    if (!rawIndexNames) throw new Error('--only-index requires a comma-separated list of index names');
    indexNames = rawIndexNames.split(',').map((selection) => {
      const parts = selection.split('=').map((part) => part.trim());
      if (parts.length === 1) return parts[0];
      if (parts.length === 2) return { indexName: parts[0], schemaIndexName: parts[1] };
      return { indexName: '', schemaIndexName: '' };
    });
  }
  const schema = await readFile(schemaPath, 'utf8');
  const schemaSql = await generatePrismaSchemaSql();
  const generated = generateTenantCompositeIndexPlan({ schema, schemaSql, indexNames });
  const relativeOutput = relative(root, outputPath);
  if (isAbsolute(relativeOutput) || relativeOutput === '..' || relativeOutput.startsWith(`..${sep}`)) {
    throw new Error('Generated plan output must stay inside the workspace');
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(generated.plan, null, 2)}\n`, 'utf8');
  console.log(`Generated ${generated.indexCount} tenant relation indexes for ${generated.tenantModelCount} models and ${generated.tenantRelationCount} relations (stage ${generated.stageChecksum.slice(0, 12)}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
