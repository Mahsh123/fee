import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateTenantRelationSchema } from './tenant-relation-schema-validator.mjs';

const schemaPath = resolve('prisma/schema.prisma');
const write = process.argv.includes('--write');
const schema = await readFile(schemaPath, 'utf8');
const newline = schema.includes('\r\n') ? '\r\n' : '\n';
const modelMatches = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
const models = new Map(modelMatches.map((match) => [match[1], match[2]]));
const tenantOwned = new Set(
  [...models].filter(([, body]) => /^[ \t]*tenantId[ \t]+String\b/m.test(body)).map(([name]) => name),
);
const report = { tenantModels: tenantOwned.size, compositeRelations: 0, addedTargetKeys: [], addedChildIndexes: [], changedRelations: [] };

function listAttribute(line, attribute) {
  const match = line.match(new RegExp(`${attribute}:\\s*\\[([^\\]]+)\\]`));
  return match ? match[1].split(',').map((field) => field.trim()) : undefined;
}

function hasPrefix(lines, fields, uniqueOnly = false) {
  return lines.some((line) => {
    const match = line.match(/@@(index|unique|id)\s*\(\s*\[([^\]]+)\]/);
    if (!match) return false;
    if (uniqueOnly && match[1] === 'index') return false;
    const indexedFields = match[2].split(',').map((field) => field.trim().split('(')[0].trim());
    return fields.every((field, index) => indexedFields[index] === field);
  });
}

function transformModel(name, body) {
  if (!tenantOwned.has(name)) return body;
  const lines = body.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const relationMatch = lines[index].match(/^([ \t]*)(\w+)[ \t]+(\w+)\??[ \t]+@relation\((.*)\)[ \t]*$/);
    if (!relationMatch || !tenantOwned.has(relationMatch[3])) continue;

    const fields = listAttribute(lines[index], 'fields');
    const references = listAttribute(lines[index], 'references');
    if (!fields || !references) continue;
    if (fields.length !== references.length) throw new Error(`${name}.${relationMatch[2]} has mismatched relation tuples`);

    if (fields[0] === 'tenantId' || references[0] === 'tenantId') {
      if (fields[0] !== 'tenantId' || references[0] !== 'tenantId' || fields.length !== 2 || references.length !== 2 || references[1] !== 'id') {
        throw new Error(`${name}.${relationMatch[2]} has a partial or incorrectly ordered tenant tuple`);
      }
    } else {
      fields.unshift('tenantId');
      references.unshift('tenantId');
      const rewritten = lines[index]
        .replace(/fields:\s*\[[^\]]+\]/, `fields: [${fields.join(', ')}]`)
        .replace(/references:\s*\[[^\]]+\]/, `references: [${references.join(', ')}]`);
      lines[index] = rewritten;
      report.changedRelations.push(`${name}.${relationMatch[2]}`);
    }

    report.compositeRelations += 1;
    const relationFields = listAttribute(lines[index], 'fields');
    if (!hasPrefix(lines, relationFields)) {
      const insertionPoint = lines.findIndex((line) => /^\s*@@map\(/.test(line));
      const insertAt = insertionPoint < 0 ? lines.length - 1 : insertionPoint;
      lines.splice(insertAt, 0, `${relationMatch[1]}@@index([${relationFields.join(', ')}])`);
      report.addedChildIndexes.push(`${name}([${relationFields.join(', ')}])`);
      index += 1;
    }
  }

  if (!hasPrefix(lines, ['tenantId', 'id'], true)) {
    const insertionPoint = lines.findIndex((line) => /^\s*@@map\(/.test(line));
    const insertAt = insertionPoint < 0 ? lines.length - 1 : insertionPoint;
    lines.splice(insertAt, 0, '  @@unique([tenantId, id])');
    report.addedTargetKeys.push(name);
  }

  return lines.join(newline);
}

let output = '';
let cursor = 0;
for (const match of modelMatches) {
  output += schema.slice(cursor, match.index);
  const open = match[0].indexOf('{');
  const close = match[0].lastIndexOf('}');
  const header = match[0].slice(0, open + 1);
  const body = match[0].slice(open + 1, close);
  output += `${header}${transformModel(match[1], body)}}`;
  cursor = match.index + match[0].length;
}
output += schema.slice(cursor);
const validation = validateTenantRelationSchema(output);

if (write) {
  await writeFile(schemaPath, output, 'utf8');
  console.log(`Updated ${schemaPath}: ${report.changedRelations.length} relation tuples, ${report.addedTargetKeys.length} composite keys, ${report.addedChildIndexes.length} child indexes across ${validation.tenantModelCount} tenant models and ${validation.tenantRelationCount} relations.`);
} else {
  console.log(`Validated tenant-equality tuples and indexes across ${validation.tenantModelCount} tenant models and ${validation.tenantRelationCount} relations.`);
}
