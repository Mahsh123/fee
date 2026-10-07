import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateTenantRelationSchema,
  validateTenantRelationSchemaBeforeReferenceMetadata,
} from './tenant-relation-schema-validator.mjs';

function fixture({
  childTenantId = 'tenantId String @db.Uuid',
  childTenantRelation = 'tenant Tenant @relation(fields: [tenantId], references: [id])',
  relationFields = '[tenantId, parentId]',
  relationReferences = '[tenantId, id]',
  parentUnique = '@@unique([tenantId, id])',
  childIndex = '@@index([tenantId, parentId])',
  extra = '',
} = {}) {
  return `
model Tenant {
  id String @id
}
model Parent {
  id String @id
  tenantId String @db.Uuid
  tenant Tenant @relation(fields: [tenantId], references: [id])
  children Child[]
  ${parentUnique}
}
model Child {
  id String @id
  ${childTenantId}
  ${childTenantRelation}
  parentId String?
  parent Parent? @relation(fields: ${relationFields}, references: ${relationReferences}, onDelete: NoAction)
  ${childIndex}
  @@unique([tenantId, id])
}
${extra}
`;
}

test('accepts a tenant-equal composite relation with both indexes', () => {
  assert.deepEqual(validateTenantRelationSchema(fixture(), ['Parent', 'Child']), {
    tenantModelCount: 2,
    tenantRelationCount: 1,
  });
});

test('accepts composite relation attributes spread across multiple lines', () => {
  const schema = fixture({
    relationFields: '\n    [tenantId, parentId]',
    relationReferences: '\n    [tenantId, id]',
  });
  assert.equal(validateTenantRelationSchema(schema, ['Parent', 'Child']).tenantRelationCount, 1);
});

test('rejects an ID-only tenant relation', () => {
  assert.throws(
    () => validateTenantRelationSchema(fixture({ relationFields: '[parentId]', relationReferences: '[id]' }), ['Parent', 'Child']),
    /Child\.parent: expected \[tenantId, relatedId\]/,
  );
});

test('rejects a tenant tuple in the wrong field order', () => {
  assert.throws(
    () => validateTenantRelationSchema(fixture({ relationFields: '[parentId, tenantId]', relationReferences: '[id, tenantId]' }), ['Parent', 'Child']),
    /Child\.parent: expected \[tenantId, relatedId\]/,
  );
});

test('rejects a multiline ID-only relation before scalar-reference metadata generation', () => {
  // Even when Child.parentId is otherwise eligible for scalar-reference metadata,
  // it is still a declared Prisma relation and must carry the tenant key.
  const schema = fixture({
    relationFields: '\n    [parentId]',
    relationReferences: '\n    [id]',
  });
  assert.throws(
    () => validateTenantRelationSchema(schema, ['Parent', 'Child']),
    /Child\.parent: expected \[tenantId, relatedId\]/,
  );
});

test('rejects a multiline ID-only relation before a manifest can classify its field as a scalar reference', () => {
  const schema = fixture({
    relationFields: '\n    [parentId]',
    relationReferences: '\n    [id]',
  });
  const manifest = { references: { Child: { parentId: 'Parent' } } };
  assert.throws(
    () => validateTenantRelationSchemaBeforeReferenceMetadata(schema, manifest, ['Parent', 'Child']),
    /Child\.parent: expected \[tenantId, relatedId\]/,
  );
});

test('ignores parentheses in relation comments before scalar-reference classification', () => {
  const schema = `
model Tenant {
  id String @id
}
model Parent {
  id String @id
  tenantId String @db.Uuid
  tenant Tenant @relation(fields: [tenantId], references: [id])
  children Child[]
  badChildren Child[] @relation("bad")
  @@unique([tenantId, id])
}
model Child {
  id String @id
  tenantId String @db.Uuid
  tenant Tenant @relation(fields: [tenantId], references: [id])
  parentId String?
  parent Parent? @relation(fields: [tenantId, parentId], references: [tenantId, id])
  badParentId String?
  badParent Parent? @relation("bad", // ) is comment text, not relation syntax
    fields: [badParentId],
    references: [id]
  )
  @@index([tenantId, parentId])
  @@unique([tenantId, id])
}
`;
  const manifest = { references: { Child: { badParentId: 'Parent' } } };
  assert.throws(
    () => validateTenantRelationSchemaBeforeReferenceMetadata(schema, manifest, ['Parent', 'Child']),
    /Child\.badParent: expected \[tenantId, relatedId\]/,
  );
});

test('rejects a declared tenant model without its tenantId scalar', () => {
  assert.throws(
    () => validateTenantRelationSchema(fixture({ childTenantId: 'ownerId String @db.Uuid' }), ['Parent', 'Child']),
    /Child: tenant model is missing tenantId/,
  );
});

test('rejects a tenant model without its direct Tenant relation', () => {
  assert.throws(
    () => validateTenantRelationSchema(fixture({ childTenantRelation: '' }), ['Parent', 'Child']),
    /Child: missing tenantId -> Tenant.id relation/,
  );
});

test('rejects an implicit many-to-many relation between tenant-owned models', () => {
  const schema = `
model Tenant {
  id String @id
}
model Parent {
  id String @id
  tenantId String
  tenant Tenant @relation(fields: [tenantId], references: [id])
  children Child[]
  @@unique([tenantId, id])
}
model Child {
  id String @id
  tenantId String
  tenant Tenant @relation(fields: [tenantId], references: [id])
  parents Parent[]
  @@unique([tenantId, id])
}
`;
  assert.throws(
    () => validateTenantRelationSchema(schema, ['Parent', 'Child']),
    /implicit many-to-many tenant relation has no explicit composite join table/,
  );
});

test('rejects a missing target composite unique key', () => {
  assert.throws(
    () => validateTenantRelationSchema(fixture({ parentUnique: '' }), ['Parent', 'Child']),
    /Parent: missing unique \(tenantId, id\)/,
  );
});

test('rejects a missing child-side tenant relation index', () => {
  assert.throws(
    () => validateTenantRelationSchema(fixture({ childIndex: '' }), ['Parent', 'Child']),
    /Child\.parent: missing child index prefix/,
  );
});

test('rejects tenant-owned models omitted from the model manifest', () => {
  assert.throws(
    () => validateTenantRelationSchema(fixture({ extra: 'model AddedLater {\n  id String @id\n  tenantId String\n}' }), ['Parent', 'Child']),
    /AddedLater: tenant-owned model is not classified/,
  );
});

test('rejects a tenant model listed in the manifest but missing from schema', () => {
  assert.throws(
    () => validateTenantRelationSchema(fixture(), ['Parent', 'Child', 'MissingModel']),
    /MissingModel: tenant model is missing from Prisma schema/,
  );
});
