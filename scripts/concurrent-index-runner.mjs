import { createHash, randomUUID } from 'node:crypto';

const IDENTIFIER_MAX_BYTES = 63;
const INDEX_METHOD = 'btree';
const SQL_KEYWORDS = new Set(['CREATE', 'UNIQUE', 'INDEX', 'ON', 'USING', 'WHERE', 'IS', 'NOT', 'NULL', 'TRUE', 'FALSE']);

export class ConcurrentIndexBuildError extends Error {
  constructor(code, message, { indexName, cause } = {}) {
    super(message, { cause });
    this.name = 'ConcurrentIndexBuildError';
    this.code = code;
    this.indexName = indexName;
  }
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function validateIdentifier(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new TypeError(`${label} must be a non-empty PostgreSQL identifier`);
  }
  if (Buffer.byteLength(value, 'utf8') > IDENTIFIER_MAX_BYTES) {
    throw new TypeError(`${label} exceeds PostgreSQL's 63-byte identifier limit`);
  }
  return value;
}

function normalizeWhere(where) {
  if (where === undefined) return undefined;
  if (!where || typeof where !== 'object' || Array.isArray(where) || typeof where.column !== 'string') {
    throw new TypeError('where must be { column, isNull } or { column, equals }');
  }
  const hasIsNull = typeof where.isNull === 'boolean';
  const hasEquals = typeof where.equals === 'boolean';
  if (hasIsNull === hasEquals || ('isNull' in where && !hasIsNull) || ('equals' in where && !hasEquals)) {
    throw new TypeError('where must be exactly { column, isNull: boolean } or { column, equals: boolean }');
  }
  const column = validateIdentifier(where.column, 'where.column');
  return hasIsNull ? { column, isNull: where.isNull } : { column, equals: where.equals };
}

function normalizeIndexSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError('Each index definition must be an object');
  const schema = validateIdentifier(spec.schema ?? 'public', 'schema');
  const table = validateIdentifier(spec.table, 'table');
  const indexName = validateIdentifier(spec.indexName, 'indexName');
  if (!Array.isArray(spec.columns) || spec.columns.length === 0) throw new TypeError(`${indexName}: columns must be a non-empty array`);
  const columns = spec.columns.map((column) => validateIdentifier(column, `${indexName}.column`));
  if (new Set(columns).size !== columns.length) throw new TypeError(`${indexName}: duplicate key columns are not allowed`);
  if (spec.unique !== undefined && typeof spec.unique !== 'boolean') throw new TypeError(`${indexName}: unique must be boolean`);
  if (spec.method !== undefined && spec.method !== INDEX_METHOD) throw new TypeError(`${indexName}: only the ${INDEX_METHOD} access method is supported`);

  const where = normalizeWhere(spec.where);
  return Object.freeze({
    schema,
    table,
    indexName,
    columns: Object.freeze(columns),
    unique: spec.unique ?? false,
    method: INDEX_METHOD,
    ...(where ? { where: Object.freeze(where) } : {}),
  });
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validateConcurrentIndexPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || plan.version !== 1) {
    throw new TypeError('Index plan must be an object with version 1');
  }
  if (typeof plan.name !== 'string' || !plan.name.trim() || plan.name.length > 128) {
    throw new TypeError('Index plan name must contain 1 to 128 characters');
  }
  if (!Array.isArray(plan.indexes) || plan.indexes.length === 0) throw new TypeError('Index plan must contain at least one index');

  const indexes = plan.indexes.map(normalizeIndexSpec).sort((left, right) =>
    `${left.schema}.${left.indexName}`.localeCompare(`${right.schema}.${right.indexName}`),
  );
  const names = new Set();
  for (const index of indexes) {
    // The journal key does not include schema, so one plan must use globally unique names.
    if (names.has(index.indexName)) throw new TypeError(`Index name ${index.indexName} appears more than once in one plan`);
    names.add(index.indexName);
  }

  const canonical = { version: 1, name: plan.name.trim(), indexes };
  const canonicalText = stableJson(canonical);
  return Object.freeze({ ...canonical, checksum: sha256(canonicalText), canonicalText });
}

export function renderCreateIndexSql(index) {
  const spec = normalizeIndexSpec(index);
  const unique = spec.unique ? 'UNIQUE ' : '';
  const columns = spec.columns.map(quoteIdentifier).join(', ');
  const predicate = spec.where
    ? ` WHERE ${quoteIdentifier(spec.where.column)}${'isNull' in spec.where ? ` IS ${spec.where.isNull ? '' : 'NOT '}NULL` : ` = ${spec.where.equals ? 'TRUE' : 'FALSE'}`}`
    : '';
  return `CREATE ${unique}INDEX CONCURRENTLY ${quoteIdentifier(spec.indexName)} ON ${quoteIdentifier(spec.schema)}.${quoteIdentifier(spec.table)} USING ${spec.method} (${columns})${predicate}`;
}

export function renderDropIndexSql(index) {
  const spec = normalizeIndexSpec(index);
  return `DROP INDEX CONCURRENTLY ${quoteIdentifier(spec.schema)}.${quoteIdentifier(spec.indexName)}`;
}

export function renderIndexDefinition(index) {
  const spec = normalizeIndexSpec(index);
  const unique = spec.unique ? 'UNIQUE ' : '';
  const columns = spec.columns.map(quoteIdentifier).join(', ');
  const predicate = spec.where
    ? ` WHERE (${quoteIdentifier(spec.where.column)}${'isNull' in spec.where ? ` IS ${spec.where.isNull ? '' : 'NOT '}NULL` : ` = ${spec.where.equals ? 'TRUE' : 'FALSE'}`})`
    : '';
  return `CREATE ${unique}INDEX ${quoteIdentifier(spec.indexName)} ON ${quoteIdentifier(spec.schema)}.${quoteIdentifier(spec.table)} USING ${spec.method} (${columns})${predicate}`;
}

function normalizePredicate(value) {
  if (value == null) return undefined;
  const compact = String(value).trim().replace(/^\((.*)\)$/s, '$1').trim();
  const identifier = '(?:"((?:""|[^"])*)"|([A-Za-z_][A-Za-z0-9_$]*))';
  const nullMatch = compact.match(new RegExp(`^${identifier}\\s+IS\\s+(NOT\\s+)?NULL$`, 'i'));
  if (nullMatch) {
    const column = nullMatch[1] ? nullMatch[1].replaceAll('""', '"') : nullMatch[2].toLowerCase();
    return { column, isNull: !nullMatch[3] };
  }
  const booleanMatch = compact.match(new RegExp(`^${identifier}\\s*=\\s*(TRUE|FALSE)$`, 'i'));
  if (booleanMatch) {
    const column = booleanMatch[1] ? booleanMatch[1].replaceAll('""', '"') : booleanMatch[2].toLowerCase();
    return { column, equals: booleanMatch[3].toLowerCase() === 'true' };
  }
  return null;
}

function simpleIdentifier(value) {
  if (typeof value !== 'string') return undefined;
  const quoted = value.match(/^"((?:[^"]|"")+)"$/);
  if (quoted) return quoted[1].replaceAll('""', '"');
  if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)) return value.toLowerCase();
  return undefined;
}

function definitionTokens(value) {
  const tokens = [];
  for (let index = 0; index < value.length;) {
    const character = value[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '"') {
      let identifier = '';
      index += 1;
      let closed = false;
      while (index < value.length) {
        if (value[index] === '"' && value[index + 1] === '"') {
          identifier += '"';
          index += 2;
        } else if (value[index] === '"') {
          index += 1;
          closed = true;
          break;
        } else {
          identifier += value[index];
          index += 1;
        }
      }
      if (!closed) return undefined;
      tokens.push(`identifier:${identifier === identifier.toLowerCase() ? identifier.toLowerCase() : identifier}`);
      continue;
    }
    const word = value.slice(index).match(/^[A-Za-z_][A-Za-z0-9_$]*/)?.[0];
    if (word) {
      const upper = word.toUpperCase();
      tokens.push(SQL_KEYWORDS.has(upper) ? `keyword:${upper}` : `identifier:${word.toLowerCase()}`);
      index += word.length;
      continue;
    }
    if ('().,;='.includes(character)) {
      tokens.push(`punctuation:${character}`);
      index += 1;
      continue;
    }
    return undefined;
  }

  return tokens;
}

function normalizeIndexDefinition(value, schema) {
  const tokens = definitionTokens(value);
  if (!tokens) return undefined;
  const onIndex = tokens.indexOf('keyword:ON');
  if (onIndex >= 0 && tokens[onIndex + 1] === `identifier:${schema.toLowerCase()}` && tokens[onIndex + 2] === 'punctuation:.') {
    tokens.splice(onIndex + 1, 2);
  }
  return tokens.join('|');
}

function catalogDifferences(row, index) {
  const differences = [];
  if (row.table_schema !== index.schema) differences.push('table_schema');
  if (row.table_name !== index.table) differences.push('table_name');
  if (row.access_method !== index.method) differences.push('access_method');
  if (row.indisunique !== index.unique) differences.push('unique');
  if (row.indisprimary || row.indisexclusion) differences.push('constraint_kind');
  if (index.unique && !row.indimmediate) differences.push('deferrable_unique');
  if (Number(row.indnatts) !== index.columns.length || Number(row.indnkeyatts) !== index.columns.length) differences.push('column_count');
  if (row.reloptions !== null && row.reloptions !== undefined) differences.push('storage_options');
  if (Number(row.reltablespace) !== 0) differences.push('tablespace');
  if (row.indnullsnotdistinct) differences.push('nulls_not_distinct');

  const actualColumns = Array.isArray(row.key_definitions) ? row.key_definitions.map(simpleIdentifier) : [];
  if (actualColumns.length !== index.columns.length || actualColumns.some((column, offset) => column !== index.columns[offset])) {
    differences.push('key_definition');
  }

  const actualWhere = normalizePredicate(row.predicate);
  if (index.where) {
    if (!actualWhere || actualWhere.column !== index.where.column
      || actualWhere.isNull !== index.where.isNull || actualWhere.equals !== index.where.equals) differences.push('predicate');
  } else if (row.predicate !== null && row.predicate !== undefined) {
    differences.push('predicate');
  }
  if (normalizeIndexDefinition(row.definition ?? '', index.schema) !== normalizeIndexDefinition(renderIndexDefinition(index), index.schema)) {
    differences.push('pg_get_indexdef');
  }
  return differences;
}

async function readCatalogIndex(client, index) {
  const result = await client.query(
    `SELECT
       table_ns.nspname AS table_schema,
       table_class.relname AS table_name,
       access_method.amname AS access_method,
       index_meta.indisunique,
       index_meta.indimmediate,
       index_meta.indisvalid,
       index_meta.indisready,
       index_meta.indisprimary,
       index_meta.indisexclusion,
       index_meta.indnatts,
       index_meta.indnkeyatts,
       index_meta.indnullsnotdistinct,
       index_class.reloptions,
       index_class.reltablespace,
       pg_get_expr(index_meta.indpred, index_meta.indrelid, true) AS predicate,
       ARRAY(
         SELECT pg_get_indexdef(index_meta.indexrelid, key_position.position, true)
         FROM generate_series(1, index_meta.indnkeyatts) AS key_position(position)
         ORDER BY key_position.position
       ) AS key_definitions,
       pg_get_indexdef(index_meta.indexrelid) AS definition
     FROM pg_class AS index_class
     JOIN pg_namespace AS index_ns ON index_ns.oid = index_class.relnamespace
     JOIN pg_index AS index_meta ON index_meta.indexrelid = index_class.oid
     JOIN pg_class AS table_class ON table_class.oid = index_meta.indrelid
     JOIN pg_namespace AS table_ns ON table_ns.oid = table_class.relnamespace
     JOIN pg_am AS access_method ON access_method.oid = index_class.relam
     WHERE index_class.relkind = 'i'
       AND index_ns.nspname = $1
       AND index_class.relname = $2`,
    [index.schema, index.indexName],
  );
  return result.rows[0] ?? null;
}

function journalTable(schema) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier('schema_index_builds')}`;
}

async function latestJournalAttempt(client, schema, stageChecksum, indexName) {
  const result = await client.query(
    `SELECT id, attempt, state, "definitionHash", definition
     FROM ${journalTable(schema)}
     WHERE "stageChecksum" = $1 AND "indexName" = $2
     ORDER BY attempt DESC
     LIMIT 1`,
    [stageChecksum, indexName],
  );
  return result.rows[0] ?? null;
}

async function markJournal(client, schema, id, state, errorCode = null) {
  await client.query(
    `UPDATE ${journalTable(schema)}
     SET state = $2::${quoteIdentifier(schema)}.${quoteIdentifier('SchemaIndexBuildState')}, "completedAt" = clock_timestamp(), "errorCode" = $3
     WHERE id = $1`,
    [id, state, errorCode],
  );
}

async function startJournalAttempt(client, schema, plan, index, attempt, state = 'RUNNING') {
  const id = randomUUID();
  await client.query(
    `INSERT INTO ${journalTable(schema)}
       (id, "stageChecksum", "indexName", "definitionHash", definition, attempt, state)
     VALUES ($1, $2, $3, $4, $5, $6, $7::${quoteIdentifier(schema)}.${quoteIdentifier('SchemaIndexBuildState')})`,
    [id, plan.checksum, index.indexName, concurrentIndexDefinitionHash(index), renderIndexDefinition(index), attempt, state],
  );
  return id;
}

export function concurrentIndexDefinitionHash(index) {
  return sha256(stableJson(normalizeIndexSpec(index)));
}

function advisoryLockKey(index) {
  const digest = createHash('sha256').update(`${index.schema}\0${index.indexName}`, 'utf8').digest();
  return digest.readBigInt64BE(0).toString();
}

async function acquireIndexLock(client, index) {
  await client.query('SELECT pg_advisory_lock($1::bigint)', [advisoryLockKey(index)]);
}

async function releaseIndexLock(client, index) {
  await client.query('SELECT pg_advisory_unlock($1::bigint)', [advisoryLockKey(index)]);
}

function indexFailureCode(error) {
  if (typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) return error.code;
  return 'INDEX_BUILD_FAILED';
}

function conflictError(index, differences) {
  return new ConcurrentIndexBuildError(
    'INDEX_DEFINITION_CONFLICT',
    `Index ${index.schema}.${index.indexName} exists with a different definition (${differences.join(', ')})`,
    { indexName: index.indexName },
  );
}

async function buildOneIndex(client, journalSchema, plan, index) {
  const prior = await latestJournalAttempt(client, journalSchema, plan.checksum, index.indexName);
  let catalog = await readCatalogIndex(client, index);

  if (prior && (String(prior.definitionHash).trim() !== concurrentIndexDefinitionHash(index) || prior.definition !== renderIndexDefinition(index))) {
    if (prior.state === 'RUNNING') await markJournal(client, journalSchema, prior.id, 'FAILED', 'JOURNAL_DEFINITION_CONFLICT');
    throw new ConcurrentIndexBuildError(
      'JOURNAL_DEFINITION_CONFLICT',
      `Journaled definition for ${index.schema}.${index.indexName} does not match the current plan`,
      { indexName: index.indexName },
    );
  }

  if (catalog) {
    const differences = catalogDifferences(catalog, index);
    if (differences.length) {
      if (prior?.state === 'RUNNING') await markJournal(client, journalSchema, prior.id, 'FAILED', 'INDEX_DEFINITION_CONFLICT');
      throw conflictError(index, differences);
    }
    if (catalog.indisvalid && catalog.indisready) {
      if (prior?.state === 'SUCCEEDED') return { indexName: index.indexName, status: 'already_succeeded' };
      if (prior?.state === 'RUNNING') {
        await markJournal(client, journalSchema, prior.id, 'SUCCEEDED');
        return { indexName: index.indexName, status: 'recovered_after_ddl' };
      }
      const attempt = (prior?.attempt ?? 0) + 1;
      const id = await startJournalAttempt(client, journalSchema, plan, index, attempt);
      await markJournal(client, journalSchema, id, 'SUCCEEDED');
      return { indexName: index.indexName, status: 'adopted' };
    }
  }

  if (prior?.state === 'RUNNING') await markJournal(client, journalSchema, prior.id, 'FAILED', 'INTERRUPTED');
  const attempt = (prior?.attempt ?? 0) + 1;
  const id = await startJournalAttempt(client, journalSchema, plan, index, attempt);

  try {
    if (catalog) {
      await client.query(renderDropIndexSql(index));
      catalog = await readCatalogIndex(client, index);
      if (catalog) {
        throw new ConcurrentIndexBuildError(
          'INVALID_INDEX_REMAINS',
          `Invalid index ${index.schema}.${index.indexName} remained after concurrent drop`,
          { indexName: index.indexName },
        );
      }
    }

    await client.query(renderCreateIndexSql(index));
    catalog = await readCatalogIndex(client, index);
    if (!catalog) {
      throw new ConcurrentIndexBuildError('INDEX_MISSING_AFTER_BUILD', `Index ${index.schema}.${index.indexName} is missing after build`, { indexName: index.indexName });
    }
    const differences = catalogDifferences(catalog, index);
    if (differences.length) throw conflictError(index, differences);
    if (!catalog.indisvalid || !catalog.indisready) {
      throw new ConcurrentIndexBuildError('INDEX_NOT_VALID', `Index ${index.schema}.${index.indexName} is not valid and ready`, { indexName: index.indexName });
    }

    await markJournal(client, journalSchema, id, 'SUCCEEDED');
    return { indexName: index.indexName, status: 'built' };
  } catch (error) {
    await markJournal(client, journalSchema, id, 'FAILED', error instanceof ConcurrentIndexBuildError ? error.code : indexFailureCode(error));
    if (error instanceof ConcurrentIndexBuildError) throw error;
    throw new ConcurrentIndexBuildError(
      indexFailureCode(error),
      `Concurrent index build failed for ${index.schema}.${index.indexName}`,
      { indexName: index.indexName },
    );
  }
}

export async function runConcurrentIndexPlan(client, inputPlan, { journalSchema = 'public' } = {}) {
  const plan = validateConcurrentIndexPlan(inputPlan);
  validateIdentifier(journalSchema, 'journalSchema');

  await assertAutocommitConnection(client);

  const results = [];
  for (const index of plan.indexes) {
    await acquireIndexLock(client, index);
    try {
      results.push(await buildOneIndex(client, journalSchema, plan, index));
    } finally {
      await releaseIndexLock(client, index);
    }
  }
  return { stageChecksum: plan.checksum, results };
}

async function assertAutocommitConnection(client) {
  const lockKey = createHash('sha256').update(`fee-index-autocommit:${randomUUID()}`, 'utf8').digest().readBigInt64BE(0).toString();
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_locks
       WHERE pid = pg_backend_pid()
         AND locktype = 'advisory'
         AND granted
         AND objsubid = 1
         AND classid::bigint = (($1::bigint >> 32) & 4294967295)
         AND objid::bigint = ($1::bigint & 4294967295)
     ) AS transaction_lock_held`,
    [lockKey],
  );
  if (result.rows[0]?.transaction_lock_held) {
    throw new ConcurrentIndexBuildError(
      'TRANSACTION_CONTEXT',
      'Concurrent index runner requires an idle autocommit PostgreSQL connection',
    );
  }
}
