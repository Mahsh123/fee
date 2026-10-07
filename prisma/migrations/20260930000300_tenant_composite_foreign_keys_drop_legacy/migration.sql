-- Generated from prisma/schema.prisma; do not edit constraint tuples by hand.
-- Verify the complete validated composite-FK inventory before removing any legacy FK.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '1min';
DO $tenant_fk_phase_c$
BEGIN
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
        AND constraint_row.conname = 'academic_units_tenantId_parentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'academic_units'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'academic_units'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'parentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'a')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: academic_units_tenantId_parentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'admissions_tenantId_applicationId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'admissions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'admission_applications'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'applicationId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'a')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: admissions_tenantId_applicationId_fkey';
    END IF;

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
        AND constraint_row.conname = 'benefit_assignments_tenantId_concessionId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'benefit_assignments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'concessions'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'concessionId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: benefit_assignments_tenantId_concessionId_fkey';
    END IF;

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
        AND constraint_row.conname = 'benefit_assignments_tenantId_discountId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'benefit_assignments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'discounts'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'discountId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: benefit_assignments_tenantId_discountId_fkey';
    END IF;

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
        AND constraint_row.conname = 'benefit_assignments_tenantId_scholarshipId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'benefit_assignments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'scholarships'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'scholarshipId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: benefit_assignments_tenantId_scholarshipId_fkey';
    END IF;

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
        AND constraint_row.conname = 'benefit_assignments_tenantId_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'benefit_assignments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: benefit_assignments_tenantId_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'benefit_assignments_tenantId_waiverId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'benefit_assignments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'waivers'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'waiverId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: benefit_assignments_tenantId_waiverId_fkey';
    END IF;

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
        AND constraint_row.conname = 'credit_allocations_tenantId_creditId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'credit_allocations'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'credits'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'creditId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: credit_allocations_tenantId_creditId_fkey';
    END IF;

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
        AND constraint_row.conname = 'credit_allocations_tenantId_demandItemId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'credit_allocations'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_demand_items'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'demandItemId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: credit_allocations_tenantId_demandItemId_fkey';
    END IF;

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
        AND constraint_row.conname = 'credits_tenantId_paymentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'credits'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'payments'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'paymentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'a')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: credits_tenantId_paymentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'credits_tenantId_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'credits'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: credits_tenantId_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_assignments_tenantId_feeStructureId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_assignments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_structures'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'feeStructureId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: fee_assignments_tenantId_feeStructureId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_assignments_tenantId_feeStructureVersionId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_assignments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_structure_versions'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'feeStructureVersionId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: fee_assignments_tenantId_feeStructureVersionId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_demand_item_adjustments_tenantId_demandItemId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_demand_item_adjustments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_demand_items'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'demandItemId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: fee_demand_item_adjustments_tenantId_demandItemId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_demand_items_tenantId_demandId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_demand_items'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_demands'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'demandId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: fee_demand_items_tenantId_demandId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_demands_tenantId_feeAssignmentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_demands'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_assignments'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'feeAssignmentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'a')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: fee_demands_tenantId_feeAssignmentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_demands_tenantId_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_demands'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: fee_demands_tenantId_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_overrides_tenantId_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_overrides'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: fee_overrides_tenantId_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_policy_actions_tenantId_policyVersionId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_policy_actions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_policy_versions'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'policyVersionId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: fee_policy_actions_tenantId_policyVersionId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_policy_conditions_tenantId_policyVersionId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_policy_conditions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_policy_versions'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'policyVersionId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: fee_policy_conditions_tenantId_policyVersionId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_policy_scopes_tenantId_policyVersionId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_policy_scopes'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_policy_versions'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'policyVersionId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: fee_policy_scopes_tenantId_policyVersionId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_policy_versions_tenantId_policyId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_policy_versions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_policies'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'policyId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: fee_policy_versions_tenantId_policyId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_structure_items_tenantId_feeStructureVersionId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_structure_items'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_structure_versions'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'feeStructureVersionId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: fee_structure_items_tenantId_feeStructureVersionId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_structure_items_tenantId_feeTypeId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_structure_items'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_types'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'feeTypeId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: fee_structure_items_tenantId_feeTypeId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_structure_versions_tenantId_feeStructureId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_structure_versions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_structures'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'feeStructureId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: fee_structure_versions_tenantId_feeStructureId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_type_versions_tenantId_feeTypeId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_type_versions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_types'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'feeTypeId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: fee_type_versions_tenantId_feeTypeId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_types_tenantId_categoryId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_types'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_categories'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'categoryId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: fee_types_tenantId_categoryId_fkey';
    END IF;

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
        AND constraint_row.conname = 'gateway_transactions_tenantId_paymentOrderId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'gateway_transactions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'payment_orders'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'paymentOrderId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'a')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: gateway_transactions_tenantId_paymentOrderId_fkey';
    END IF;

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
        AND constraint_row.conname = 'gateway_transactions_tenantId_settlementId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'gateway_transactions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'settlements'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'settlementId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'a')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: gateway_transactions_tenantId_settlementId_fkey';
    END IF;

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
        AND constraint_row.conname = 'installment_items_tenantId_installmentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'installment_items'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'installments'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'installmentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: installment_items_tenantId_installmentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'installment_rule_items_tenantId_feeStructureItemId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'installment_rule_items'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_structure_items'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'feeStructureItemId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: installment_rule_items_tenantId_feeStructureItemId_fkey';
    END IF;

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
        AND constraint_row.conname = 'installments_tenantId_demandId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'installments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_demands'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'demandId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: installments_tenantId_demandId_fkey';
    END IF;

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
        AND constraint_row.conname = 'invoice_lines_tenantId_invoiceId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'invoice_lines'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'invoices'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'invoiceId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: invoice_lines_tenantId_invoiceId_fkey';
    END IF;

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
        AND constraint_row.conname = 'invoices_tenantId_demandId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'invoices'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_demands'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'demandId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'a')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: invoices_tenantId_demandId_fkey';
    END IF;

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
        AND constraint_row.conname = 'late_fee_accruals_tenantId_demandId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'late_fee_accruals'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_demands'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'demandId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: late_fee_accruals_tenantId_demandId_fkey';
    END IF;

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
        AND constraint_row.conname = 'ledger_entries_tenantId_accountId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'ledger_entries'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'ledger_accounts'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'accountId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: ledger_entries_tenantId_accountId_fkey';
    END IF;

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
        AND constraint_row.conname = 'ledger_entries_tenantId_paymentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'ledger_entries'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'payments'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'paymentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: ledger_entries_tenantId_paymentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'payment_allocations_tenantId_demandItemId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'payment_allocations'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_demand_items'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'demandItemId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: payment_allocations_tenantId_demandItemId_fkey';
    END IF;

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
        AND constraint_row.conname = 'payment_allocations_tenantId_paymentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'payment_allocations'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'payments'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'paymentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: payment_allocations_tenantId_paymentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'payments_tenantId_paymentOrderId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'payments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'payment_orders'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'paymentOrderId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'a')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: payments_tenantId_paymentOrderId_fkey';
    END IF;

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
        AND constraint_row.conname = 'payments_tenantId_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'payments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: payments_tenantId_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'receipt_lines_tenantId_receiptId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'receipt_lines'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'receipts'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'receiptId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: receipt_lines_tenantId_receiptId_fkey';
    END IF;

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
        AND constraint_row.conname = 'receipts_tenantId_paymentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'receipts'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'payments'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'paymentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: receipts_tenantId_paymentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'receipts_tenantId_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'receipts'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: receipts_tenantId_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'reconciliation_records_tenantId_settlementId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'reconciliation_records'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'settlements'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'settlementId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: reconciliation_records_tenantId_settlementId_fkey';
    END IF;

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
        AND constraint_row.conname = 'refresh_tokens_tenantId_userId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'refresh_tokens'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'users'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'userId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: refresh_tokens_tenantId_userId_fkey';
    END IF;

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
        AND constraint_row.conname = 'refunds_tenantId_paymentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'refunds'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'payments'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'paymentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: refunds_tenantId_paymentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'role_permissions_tenantId_roleId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'role_permissions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'roles'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'roleId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: role_permissions_tenantId_roleId_fkey';
    END IF;

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
        AND constraint_row.conname = 'student_custom_attributes_tenantId_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'student_custom_attributes'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: student_custom_attributes_tenantId_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'student_group_members_tenantId_groupId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'student_group_members'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'student_groups'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'groupId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: student_group_members_tenantId_groupId_fkey';
    END IF;

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
        AND constraint_row.conname = 'student_group_members_tenantId_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'student_group_members'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: student_group_members_tenantId_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'student_guardians_tenantId_guardianId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'student_guardians'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'guardians'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'guardianId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: student_guardians_tenantId_guardianId_fkey';
    END IF;

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
        AND constraint_row.conname = 'student_guardians_tenantId_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'student_guardians'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: student_guardians_tenantId_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'student_unit_memberships_tenantId_academicUnitId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'student_unit_memberships'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'academic_units'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'academicUnitId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: student_unit_memberships_tenantId_academicUnitId_fkey';
    END IF;

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
        AND constraint_row.conname = 'student_unit_memberships_tenantId_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'student_unit_memberships'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: student_unit_memberships_tenantId_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'user_roles_tenantId_roleId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'user_roles'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'roles'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'roleId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: user_roles_tenantId_roleId_fkey';
    END IF;

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
        AND constraint_row.conname = 'user_roles_tenantId_userId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'user_roles'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'users'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'userId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['tenantId', 'id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
        AND bool_and(constraint_row.convalidated)
    ) THEN
      RAISE EXCEPTION 'Expected validated composite tenant foreign key is missing or differs: user_roles_tenantId_userId_fkey';
    END IF;
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
        AND constraint_row.conname = 'academic_units_parentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'academic_units'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'academic_units'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['parentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'n')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: academic_units_parentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'admissions_applicationId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'admissions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'admission_applications'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['applicationId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'n')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: admissions_applicationId_fkey';
    END IF;

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
        AND constraint_row.conname = 'benefit_assignments_concessionId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'benefit_assignments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'concessions'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['concessionId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: benefit_assignments_concessionId_fkey';
    END IF;

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
        AND constraint_row.conname = 'benefit_assignments_discountId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'benefit_assignments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'discounts'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['discountId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: benefit_assignments_discountId_fkey';
    END IF;

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
        AND constraint_row.conname = 'benefit_assignments_scholarshipId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'benefit_assignments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'scholarships'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['scholarshipId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: benefit_assignments_scholarshipId_fkey';
    END IF;

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
        AND constraint_row.conname = 'benefit_assignments_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'benefit_assignments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: benefit_assignments_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'benefit_assignments_waiverId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'benefit_assignments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'waivers'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['waiverId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: benefit_assignments_waiverId_fkey';
    END IF;

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
        AND constraint_row.conname = 'credit_allocations_creditId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'credit_allocations'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'credits'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['creditId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: credit_allocations_creditId_fkey';
    END IF;

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
        AND constraint_row.conname = 'credit_allocations_demandItemId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'credit_allocations'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_demand_items'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['demandItemId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: credit_allocations_demandItemId_fkey';
    END IF;

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
        AND constraint_row.conname = 'credits_paymentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'credits'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'payments'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['paymentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'n')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: credits_paymentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'credits_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'credits'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: credits_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_assignments_feeStructureId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_assignments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_structures'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['feeStructureId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: fee_assignments_feeStructureId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_assignments_feeStructureVersionId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_assignments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_structure_versions'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['feeStructureVersionId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: fee_assignments_feeStructureVersionId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_demand_item_adjustments_demandItemId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_demand_item_adjustments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_demand_items'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['demandItemId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: fee_demand_item_adjustments_demandItemId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_demand_items_demandId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_demand_items'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_demands'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['demandId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: fee_demand_items_demandId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_demands_feeAssignmentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_demands'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_assignments'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['feeAssignmentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'n')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: fee_demands_feeAssignmentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_demands_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_demands'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: fee_demands_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_overrides_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_overrides'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: fee_overrides_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_policy_actions_policyVersionId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_policy_actions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_policy_versions'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['policyVersionId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: fee_policy_actions_policyVersionId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_policy_conditions_policyVersionId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_policy_conditions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_policy_versions'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['policyVersionId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: fee_policy_conditions_policyVersionId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_policy_scopes_policyVersionId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_policy_scopes'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_policy_versions'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['policyVersionId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: fee_policy_scopes_policyVersionId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_policy_versions_policyId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_policy_versions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_policies'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['policyId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: fee_policy_versions_policyId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_structure_items_feeStructureVersionId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_structure_items'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_structure_versions'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['feeStructureVersionId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: fee_structure_items_feeStructureVersionId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_structure_items_feeTypeId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_structure_items'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_types'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['feeTypeId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: fee_structure_items_feeTypeId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_structure_versions_feeStructureId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_structure_versions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_structures'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['feeStructureId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: fee_structure_versions_feeStructureId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_type_versions_feeTypeId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_type_versions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_types'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['feeTypeId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: fee_type_versions_feeTypeId_fkey';
    END IF;

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
        AND constraint_row.conname = 'fee_types_categoryId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'fee_types'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_categories'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['categoryId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: fee_types_categoryId_fkey';
    END IF;

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
        AND constraint_row.conname = 'gateway_transactions_paymentOrderId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'gateway_transactions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'payment_orders'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['paymentOrderId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'n')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: gateway_transactions_paymentOrderId_fkey';
    END IF;

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
        AND constraint_row.conname = 'gateway_transactions_settlementId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'gateway_transactions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'settlements'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['settlementId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'n')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: gateway_transactions_settlementId_fkey';
    END IF;

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
        AND constraint_row.conname = 'installment_items_installmentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'installment_items'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'installments'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['installmentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: installment_items_installmentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'installment_rule_items_feeStructureItemId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'installment_rule_items'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_structure_items'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['feeStructureItemId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: installment_rule_items_feeStructureItemId_fkey';
    END IF;

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
        AND constraint_row.conname = 'installments_demandId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'installments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_demands'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['demandId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: installments_demandId_fkey';
    END IF;

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
        AND constraint_row.conname = 'invoice_lines_invoiceId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'invoice_lines'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'invoices'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['invoiceId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: invoice_lines_invoiceId_fkey';
    END IF;

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
        AND constraint_row.conname = 'invoices_demandId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'invoices'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_demands'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['demandId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'n')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: invoices_demandId_fkey';
    END IF;

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
        AND constraint_row.conname = 'late_fee_accruals_demandId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'late_fee_accruals'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_demands'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['demandId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: late_fee_accruals_demandId_fkey';
    END IF;

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
        AND constraint_row.conname = 'ledger_entries_accountId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'ledger_entries'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'ledger_accounts'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['accountId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: ledger_entries_accountId_fkey';
    END IF;

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
        AND constraint_row.conname = 'ledger_entries_paymentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'ledger_entries'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'payments'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['paymentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: ledger_entries_paymentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'payment_allocations_demandItemId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'payment_allocations'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'fee_demand_items'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['demandItemId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: payment_allocations_demandItemId_fkey';
    END IF;

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
        AND constraint_row.conname = 'payment_allocations_paymentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'payment_allocations'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'payments'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['paymentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: payment_allocations_paymentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'payments_paymentOrderId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'payments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'payment_orders'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['paymentOrderId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'n')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: payments_paymentOrderId_fkey';
    END IF;

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
        AND constraint_row.conname = 'payments_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'payments'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: payments_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'receipt_lines_receiptId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'receipt_lines'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'receipts'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['receiptId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: receipt_lines_receiptId_fkey';
    END IF;

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
        AND constraint_row.conname = 'receipts_paymentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'receipts'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'payments'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['paymentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: receipts_paymentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'receipts_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'receipts'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: receipts_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'reconciliation_records_settlementId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'reconciliation_records'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'settlements'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['settlementId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: reconciliation_records_settlementId_fkey';
    END IF;

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
        AND constraint_row.conname = 'refresh_tokens_userId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'refresh_tokens'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'users'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['userId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: refresh_tokens_userId_fkey';
    END IF;

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
        AND constraint_row.conname = 'refunds_paymentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'refunds'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'payments'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['paymentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'r')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: refunds_paymentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'role_permissions_roleId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'role_permissions'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'roles'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['roleId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: role_permissions_roleId_fkey';
    END IF;

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
        AND constraint_row.conname = 'student_custom_attributes_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'student_custom_attributes'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: student_custom_attributes_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'student_group_members_groupId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'student_group_members'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'student_groups'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['groupId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: student_group_members_groupId_fkey';
    END IF;

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
        AND constraint_row.conname = 'student_group_members_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'student_group_members'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: student_group_members_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'student_guardians_guardianId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'student_guardians'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'guardians'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['guardianId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: student_guardians_guardianId_fkey';
    END IF;

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
        AND constraint_row.conname = 'student_guardians_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'student_guardians'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: student_guardians_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'student_unit_memberships_academicUnitId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'student_unit_memberships'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'academic_units'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['academicUnitId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: student_unit_memberships_academicUnitId_fkey';
    END IF;

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
        AND constraint_row.conname = 'student_unit_memberships_studentId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'student_unit_memberships'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'students'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['studentId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: student_unit_memberships_studentId_fkey';
    END IF;

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
        AND constraint_row.conname = 'user_roles_roleId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'user_roles'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'roles'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['roleId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: user_roles_roleId_fkey';
    END IF;

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
        AND constraint_row.conname = 'user_roles_userId_fkey'
        AND source_namespace.nspname = 'public'
        AND source_table.relname = 'user_roles'
        AND target_namespace.nspname = 'public'
        AND target_table.relname = 'users'
      GROUP BY constraint_row.oid, source_table.relname, target_table.relname
      HAVING array_agg(source_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['userId']::text[]
        AND array_agg(target_attribute.attname ORDER BY key_column.position)::text[] = ARRAY['id']::text[]
        AND bool_and(constraint_row.confdeltype = 'c')
        AND bool_and(constraint_row.confupdtype = 'c')
    ) THEN
      RAISE EXCEPTION 'Expected legacy tenant foreign key is missing or differs: user_roles_userId_fkey';
    END IF;
END
$tenant_fk_phase_c$;
ALTER TABLE "academic_units" DROP CONSTRAINT "academic_units_parentId_fkey";
ALTER TABLE "admissions" DROP CONSTRAINT "admissions_applicationId_fkey";
ALTER TABLE "benefit_assignments" DROP CONSTRAINT "benefit_assignments_concessionId_fkey";
ALTER TABLE "benefit_assignments" DROP CONSTRAINT "benefit_assignments_discountId_fkey";
ALTER TABLE "benefit_assignments" DROP CONSTRAINT "benefit_assignments_scholarshipId_fkey";
ALTER TABLE "benefit_assignments" DROP CONSTRAINT "benefit_assignments_studentId_fkey";
ALTER TABLE "benefit_assignments" DROP CONSTRAINT "benefit_assignments_waiverId_fkey";
ALTER TABLE "credit_allocations" DROP CONSTRAINT "credit_allocations_creditId_fkey";
ALTER TABLE "credit_allocations" DROP CONSTRAINT "credit_allocations_demandItemId_fkey";
ALTER TABLE "credits" DROP CONSTRAINT "credits_paymentId_fkey";
ALTER TABLE "credits" DROP CONSTRAINT "credits_studentId_fkey";
ALTER TABLE "fee_assignments" DROP CONSTRAINT "fee_assignments_feeStructureId_fkey";
ALTER TABLE "fee_assignments" DROP CONSTRAINT "fee_assignments_feeStructureVersionId_fkey";
ALTER TABLE "fee_demand_item_adjustments" DROP CONSTRAINT "fee_demand_item_adjustments_demandItemId_fkey";
ALTER TABLE "fee_demand_items" DROP CONSTRAINT "fee_demand_items_demandId_fkey";
ALTER TABLE "fee_demands" DROP CONSTRAINT "fee_demands_feeAssignmentId_fkey";
ALTER TABLE "fee_demands" DROP CONSTRAINT "fee_demands_studentId_fkey";
ALTER TABLE "fee_overrides" DROP CONSTRAINT "fee_overrides_studentId_fkey";
ALTER TABLE "fee_policy_actions" DROP CONSTRAINT "fee_policy_actions_policyVersionId_fkey";
ALTER TABLE "fee_policy_conditions" DROP CONSTRAINT "fee_policy_conditions_policyVersionId_fkey";
ALTER TABLE "fee_policy_scopes" DROP CONSTRAINT "fee_policy_scopes_policyVersionId_fkey";
ALTER TABLE "fee_policy_versions" DROP CONSTRAINT "fee_policy_versions_policyId_fkey";
ALTER TABLE "fee_structure_items" DROP CONSTRAINT "fee_structure_items_feeStructureVersionId_fkey";
ALTER TABLE "fee_structure_items" DROP CONSTRAINT "fee_structure_items_feeTypeId_fkey";
ALTER TABLE "fee_structure_versions" DROP CONSTRAINT "fee_structure_versions_feeStructureId_fkey";
ALTER TABLE "fee_type_versions" DROP CONSTRAINT "fee_type_versions_feeTypeId_fkey";
ALTER TABLE "fee_types" DROP CONSTRAINT "fee_types_categoryId_fkey";
ALTER TABLE "gateway_transactions" DROP CONSTRAINT "gateway_transactions_paymentOrderId_fkey";
ALTER TABLE "gateway_transactions" DROP CONSTRAINT "gateway_transactions_settlementId_fkey";
ALTER TABLE "installment_items" DROP CONSTRAINT "installment_items_installmentId_fkey";
ALTER TABLE "installment_rule_items" DROP CONSTRAINT "installment_rule_items_feeStructureItemId_fkey";
ALTER TABLE "installments" DROP CONSTRAINT "installments_demandId_fkey";
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_invoiceId_fkey";
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_demandId_fkey";
ALTER TABLE "late_fee_accruals" DROP CONSTRAINT "late_fee_accruals_demandId_fkey";
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_accountId_fkey";
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_paymentId_fkey";
ALTER TABLE "payment_allocations" DROP CONSTRAINT "payment_allocations_demandItemId_fkey";
ALTER TABLE "payment_allocations" DROP CONSTRAINT "payment_allocations_paymentId_fkey";
ALTER TABLE "payments" DROP CONSTRAINT "payments_paymentOrderId_fkey";
ALTER TABLE "payments" DROP CONSTRAINT "payments_studentId_fkey";
ALTER TABLE "receipt_lines" DROP CONSTRAINT "receipt_lines_receiptId_fkey";
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_paymentId_fkey";
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_studentId_fkey";
ALTER TABLE "reconciliation_records" DROP CONSTRAINT "reconciliation_records_settlementId_fkey";
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_userId_fkey";
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_paymentId_fkey";
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_roleId_fkey";
ALTER TABLE "student_custom_attributes" DROP CONSTRAINT "student_custom_attributes_studentId_fkey";
ALTER TABLE "student_group_members" DROP CONSTRAINT "student_group_members_groupId_fkey";
ALTER TABLE "student_group_members" DROP CONSTRAINT "student_group_members_studentId_fkey";
ALTER TABLE "student_guardians" DROP CONSTRAINT "student_guardians_guardianId_fkey";
ALTER TABLE "student_guardians" DROP CONSTRAINT "student_guardians_studentId_fkey";
ALTER TABLE "student_unit_memberships" DROP CONSTRAINT "student_unit_memberships_academicUnitId_fkey";
ALTER TABLE "student_unit_memberships" DROP CONSTRAINT "student_unit_memberships_studentId_fkey";
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_roleId_fkey";
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_userId_fkey";
COMMIT;
