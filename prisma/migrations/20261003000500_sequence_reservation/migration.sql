-- Number-format snapshots and sequence counters are versioned independently.
-- Existing sequence rows remain version 1 and are never rewritten.
BEGIN;

DO $preflight$
DECLARE
  invalid_settings TEXT;
  invalid_sequences TEXT;
  duplicate_keys TEXT;
BEGIN
  SELECT string_agg("tenantId"::TEXT, ', ')
    INTO invalid_settings
  FROM public.tenant_numbering_settings
  WHERE "padding" < 1 OR "padding" > 12
     OR ("resetAnnually" AND NOT "includeYear")
     OR ("resetAnnually" AND "reset_annually_from" IS NULL);
  IF invalid_settings IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot install sequence reservation: invalid tenant numbering settings require reviewed repair: %', invalid_settings
      USING ERRCODE = '23514';
  END IF;

  SELECT string_agg("id"::TEXT, ', ')
    INTO invalid_sequences
  FROM public.sequences
  WHERE "nextValue" < 1 OR "padding" < 1 OR "padding" > 12 OR length("prefix") < 1 OR length("prefix") > 20;
  IF invalid_sequences IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot install sequence reservation: invalid sequence snapshots require reviewed repair: %', invalid_sequences
      USING ERRCODE = '23514';
  END IF;

  SELECT string_agg(format('%s/%s (%s rows)', grouped."tenantId", grouped."kind", grouped.row_count), ', ')
    INTO duplicate_keys
  FROM (
    SELECT "tenantId", "kind", count(*) AS row_count
    FROM public.sequences
    WHERE "scope" IS NULL
    GROUP BY "tenantId", "kind"
    HAVING count(*) > 1
  ) AS grouped;
  IF duplicate_keys IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot install sequence reservation: duplicate unscoped sequence rows require reviewed reconciliation: %', duplicate_keys
      USING ERRCODE = '23505';
  END IF;
END;
$preflight$;

ALTER TABLE public.tenant_numbering_settings
  ADD COLUMN "formatVersion" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "creditNotePrefix" TEXT NOT NULL DEFAULT 'CRN',
  ADD COLUMN "adjustmentPrefix" TEXT NOT NULL DEFAULT 'ADJ';

ALTER TABLE public.sequences
  ADD COLUMN "formatVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "includeYear" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "periodSegment" TEXT;

ALTER TABLE public.tenant_numbering_settings
  ADD CONSTRAINT "tenant_numbering_settings_version_padding_check"
    CHECK ("formatVersion" > 0 AND "padding" BETWEEN 1 AND 12 AND (NOT "resetAnnually" OR ("includeYear" AND "reset_annually_from" IS NOT NULL)));
ALTER TABLE public.sequences
  ADD CONSTRAINT "sequences_snapshot_counter_check"
    CHECK ("formatVersion" > 0 AND "nextValue" > 0 AND "padding" BETWEEN 1 AND 12 AND length(prefix) BETWEEN 1 AND 20 AND (NOT "resetAnnually" OR "includeYear"));

DROP INDEX public."sequences_tenantId_kind_scope_key";
CREATE UNIQUE INDEX "sequences_tenant_kind_version_null_uq"
  ON public.sequences ("tenantId", "kind", "formatVersion")
  WHERE "scope" IS NULL;
CREATE UNIQUE INDEX "sequences_tenant_kind_scope_version_not_null_uq"
  ON public.sequences ("tenantId", "kind", "scope", "formatVersion")
  WHERE "scope" IS NOT NULL;

GRANT SELECT (
  "tenantId", "formatVersion", "receiptPrefix", "invoicePrefix", "paymentPrefix", "demandPrefix",
  "refundPrefix", "creditNotePrefix", "adjustmentPrefix", "applicationPrefix", "studentPrefix",
  "padding", "includeYear", "separator", "resetAnnually", "reset_annually_from"
) ON public.tenant_numbering_settings TO fee_numbering_owner;
GRANT SELECT (id, "tenantId", kind, "formatVersion", scope, "nextValue") ON public.sequences TO fee_numbering_owner;
GRANT INSERT (
  id, "tenantId", kind, "formatVersion", scope, prefix, "nextValue", padding,
  separator, "resetAnnually", "lastResetPeriod", "includeYear", "periodSegment", "updatedAt"
) ON public.sequences TO fee_numbering_owner;
GRANT UPDATE ("nextValue", "updatedAt") ON public.sequences TO fee_numbering_owner;

SET ROLE fee_numbering_owner;
CREATE FUNCTION app_private.fee_lock_numbering_configuration(p_tenant_id UUID) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $lock$
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required for numbering configuration lock' USING ERRCODE = '22004';
  END IF;
  IF current_setting('fee.current_tenant', TRUE) IS DISTINCT FROM p_tenant_id::TEXT THEN
    RAISE EXCEPTION 'Numbering configuration tenant does not match the transaction tenant context' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('document-numbering:' || p_tenant_id::TEXT, 8675309));
  RETURN TRUE;
END;
$lock$;

CREATE FUNCTION app_private.fee_document_number(
  p_tenant_id UUID,
  p_kind public."SequenceKind",
  p_scope TEXT,
  p_as_of DATE,
  p_consume BOOLEAN
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_format_version INTEGER;
  v_prefix TEXT;
  v_receipt_prefix TEXT;
  v_invoice_prefix TEXT;
  v_payment_prefix TEXT;
  v_demand_prefix TEXT;
  v_refund_prefix TEXT;
  v_credit_note_prefix TEXT;
  v_adjustment_prefix TEXT;
  v_application_prefix TEXT;
  v_student_prefix TEXT;
  v_padding INTEGER;
  v_separator TEXT;
  v_include_year BOOLEAN;
  v_reset_annually BOOLEAN;
  v_reset_from DATE;
  v_scope TEXT;
  v_period TEXT;
  v_period_year INTEGER;
  v_year_segment TEXT;
  v_sequence_id UUID;
  v_existing_next BIGINT;
  v_history_next BIGINT;
  v_counter BIGINT;
  v_counter_text TEXT;
  v_number TEXT;
BEGIN
  IF p_tenant_id IS NULL OR p_kind IS NULL OR p_as_of IS NULL OR p_consume IS NULL THEN
    RAISE EXCEPTION 'Tenant, document kind, date, and reservation mode are required' USING ERRCODE = '22004';
  END IF;
  IF current_setting('fee.current_tenant', TRUE) IS DISTINCT FROM p_tenant_id::TEXT THEN
    RAISE EXCEPTION 'Document numbering tenant does not match the transaction tenant context' USING ERRCODE = '42501';
  END IF;

  IF p_consume THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('document-numbering:' || p_tenant_id::TEXT, 8675309));
  END IF;

  IF p_consume THEN
    SELECT "formatVersion", "receiptPrefix", "invoicePrefix", "paymentPrefix", "demandPrefix",
           "refundPrefix", "creditNotePrefix", "adjustmentPrefix", "applicationPrefix", "studentPrefix", "padding",
           "includeYear", "separator", "resetAnnually", "reset_annually_from"
      INTO v_format_version, v_receipt_prefix, v_invoice_prefix, v_payment_prefix, v_demand_prefix,
           v_refund_prefix, v_credit_note_prefix, v_adjustment_prefix, v_application_prefix, v_student_prefix, v_padding,
           v_include_year, v_separator, v_reset_annually, v_reset_from
    FROM public.tenant_numbering_settings
    WHERE "tenantId" = p_tenant_id;
  ELSE
    SELECT "formatVersion", "receiptPrefix", "invoicePrefix", "paymentPrefix", "demandPrefix",
           "refundPrefix", "creditNotePrefix", "adjustmentPrefix", "applicationPrefix", "studentPrefix", "padding",
           "includeYear", "separator", "resetAnnually", "reset_annually_from"
      INTO v_format_version, v_receipt_prefix, v_invoice_prefix, v_payment_prefix, v_demand_prefix,
           v_refund_prefix, v_credit_note_prefix, v_adjustment_prefix, v_application_prefix, v_student_prefix, v_padding,
           v_include_year, v_separator, v_reset_annually, v_reset_from
    FROM public.tenant_numbering_settings
    WHERE "tenantId" = p_tenant_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant numbering settings are not initialized' USING ERRCODE = '23503';
  END IF;

  -- Select the kind-specific configurable prefix without altering the stored format snapshot.
  CASE p_kind
    WHEN 'RECEIPT' THEN
      v_prefix := v_receipt_prefix;
    WHEN 'INVOICE' THEN
      v_prefix := v_invoice_prefix;
    WHEN 'PAYMENT' THEN
      v_prefix := v_payment_prefix;
    WHEN 'DEMAND' THEN
      v_prefix := v_demand_prefix;
    WHEN 'REFUND' THEN
      v_prefix := v_refund_prefix;
    WHEN 'CREDIT_NOTE' THEN
      v_prefix := v_credit_note_prefix;
    WHEN 'ADJUSTMENT' THEN
      v_prefix := v_adjustment_prefix;
    WHEN 'APPLICATION' THEN
      v_prefix := v_application_prefix;
    WHEN 'STUDENT' THEN
      v_prefix := v_student_prefix;
    ELSE
      RAISE EXCEPTION 'Document kind % has no configured document-number prefix', p_kind USING ERRCODE = '22023';
  END CASE;

  IF v_reset_annually AND NOT v_include_year THEN
    RAISE EXCEPTION 'Annual sequence resets require the financial year in the rendered number' USING ERRCODE = '22023';
  END IF;
  IF v_padding < 1 OR v_padding > 12 OR v_prefix IS NULL OR length(v_prefix) = 0 THEN
    RAISE EXCEPTION 'Tenant numbering settings contain an invalid prefix or padding value' USING ERRCODE = '22023';
  END IF;

  v_period_year := EXTRACT(YEAR FROM p_as_of)::INTEGER;
  IF EXTRACT(MONTH FROM p_as_of)::INTEGER < 4 THEN
    v_period_year := v_period_year - 1;
  END IF;
  v_period := v_period_year::TEXT || '-' || right((v_period_year + 1)::TEXT, 2);
  v_year_segment := CASE WHEN v_include_year THEN v_period ELSE NULL END;
  v_scope := p_scope;
  IF v_scope IS NULL AND v_reset_annually AND v_reset_from IS NOT NULL AND p_as_of >= v_reset_from THEN
    v_scope := v_period;
  END IF;

  IF p_consume THEN
    -- The shared tenant lock serializes reservation with configuration edits.
    SELECT id, "nextValue" INTO v_sequence_id, v_existing_next
    FROM public.sequences
    WHERE "tenantId" = p_tenant_id AND kind = p_kind AND "scope" IS NOT DISTINCT FROM v_scope
      AND "formatVersion" = v_format_version;
  ELSE
    SELECT id, "nextValue" INTO v_sequence_id, v_existing_next
    FROM public.sequences
    WHERE "tenantId" = p_tenant_id AND kind = p_kind AND "scope" IS NOT DISTINCT FROM v_scope
      AND "formatVersion" = v_format_version;
  END IF;

  IF v_reset_annually AND v_reset_from IS NOT NULL AND p_as_of >= v_reset_from AND v_scope = v_period THEN
    SELECT COALESCE(max("nextValue"), 1) INTO v_history_next
    FROM public.sequences
    WHERE "tenantId" = p_tenant_id AND kind = p_kind AND "scope" = v_scope;
  ELSE
    SELECT COALESCE(max("nextValue"), 1) INTO v_history_next
    FROM public.sequences
    WHERE "tenantId" = p_tenant_id AND kind = p_kind;
  END IF;
  v_counter := greatest(COALESCE(v_existing_next, 1), v_history_next);
  v_counter_text := v_counter::TEXT;
  IF length(v_counter_text) < v_padding THEN
    v_counter_text := lpad(v_counter_text, v_padding, '0');
  END IF;
  v_number := concat_ws(v_separator, v_prefix, v_year_segment, v_counter_text);

  IF p_consume THEN
    IF v_sequence_id IS NULL THEN
      INSERT INTO public.sequences (
        id, "tenantId", kind, "formatVersion", scope, prefix, "nextValue", padding,
        separator, "resetAnnually", "lastResetPeriod", "includeYear", "periodSegment", "updatedAt"
      ) VALUES (
        gen_random_uuid(), p_tenant_id, p_kind, v_format_version, v_scope, v_prefix, v_counter + 1,
        v_padding, v_separator, v_reset_annually,
        CASE WHEN v_reset_annually AND v_reset_from IS NOT NULL AND p_as_of >= v_reset_from THEN v_period ELSE NULL END,
        v_include_year, v_year_segment, CURRENT_TIMESTAMP
      );
    ELSE
      UPDATE public.sequences SET "nextValue" = v_counter + 1, "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = v_sequence_id;
    END IF;
  END IF;
  RETURN v_number;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.fee_document_number(UUID, public."SequenceKind", TEXT, DATE, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.fee_lock_numbering_configuration(UUID) FROM PUBLIC;
RESET ROLE;
COMMIT;
