-- Database-owned signed audit append boundary. This installs the reusable
-- primitives and tenant-head provisioning trigger, but does not activate the
-- v2 capability marker or revoke the legacy bridge privileges. Cutover remains
-- a separate deployment step after verifier keys, verifier, and ACL sync exist.
BEGIN;

REVOKE UPDATE ON TABLE public.audit_chain_heads FROM fee_audit_owner;
GRANT UPDATE ("lastSequence", "lastHash", "legacySnapshotHash", "updatedAt") ON TABLE public.audit_chain_heads TO fee_audit_owner;

SET ROLE fee_audit_owner;

CREATE FUNCTION app_private.fee_audit_canonical_json(p_value JSONB) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $canonical$
DECLARE
  v_kind TEXT;
  v_text TEXT;
BEGIN
  IF p_value IS NULL THEN
    RETURN 'null';
  END IF;
  v_kind := pg_catalog.jsonb_typeof(p_value);
  IF v_kind = 'object' THEN
    SELECT '{' || COALESCE(pg_catalog.string_agg(
      pg_catalog.to_jsonb(pair.key)::TEXT || ':' || app_private.fee_audit_canonical_json(pair.value),
      ',' ORDER BY pair.key COLLATE "C"
    ), '') || '}'
      INTO v_text
      FROM pg_catalog.jsonb_each(p_value) AS pair(key, value);
    RETURN v_text;
  ELSIF v_kind = 'array' THEN
    SELECT '[' || COALESCE(pg_catalog.string_agg(
      app_private.fee_audit_canonical_json(element.value),
      ',' ORDER BY element.ordinality
    ), '') || ']'
      INTO v_text
      FROM pg_catalog.jsonb_array_elements(p_value) WITH ORDINALITY AS element(value, ordinality);
    RETURN v_text;
  ELSIF v_kind = 'string' THEN
    RETURN pg_catalog.to_json(p_value #>> '{}')::TEXT;
  ELSIF v_kind = 'number' THEN
    RETURN pg_catalog.trim_scale((p_value #>> '{}')::NUMERIC)::TEXT;
  END IF;
  RETURN p_value::TEXT;
END;
$canonical$;

CREATE FUNCTION app_private.fee_audit_append_core(p_envelope JSONB) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $append_core$
DECLARE
  v_tenant_id UUID;
  v_actor_id UUID;
  v_nonce UUID;
  v_head public.audit_chain_heads%ROWTYPE;
  v_sequence BIGINT;
  v_previous_hash TEXT;
  v_created_at TIMESTAMP(3) WITHOUT TIME ZONE;
  v_payload JSONB;
  v_canonical_payload TEXT;
  v_hash TEXT;
  v_audit_id UUID := pg_catalog.gen_random_uuid();
  v_actor_roles TEXT[];
BEGIN
  v_tenant_id := (p_envelope ->> 'tenantId')::UUID;
  v_actor_id := NULLIF(p_envelope ->> 'actorId', '')::UUID;
  v_nonce := (p_envelope ->> 'nonce')::UUID;
  IF pg_catalog.current_setting('fee.current_tenant', TRUE) IS DISTINCT FROM v_tenant_id::TEXT THEN
    RAISE EXCEPTION 'Audit tenant does not match the transaction context' USING ERRCODE = '42501';
  END IF;
  IF v_nonce IS NULL THEN
    RAISE EXCEPTION 'Audit append nonce is required' USING ERRCODE = '22004';
  END IF;

  SELECT * INTO v_head
    FROM public.audit_chain_heads
    WHERE "tenantId" = v_tenant_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit chain head is missing for tenant %', v_tenant_id USING ERRCODE = '23503';
  END IF;

  v_sequence := v_head."lastSequence" + 1;
  v_previous_hash := COALESCE(v_head."lastHash", v_head."legacySnapshotHash", 'GENESIS');
  v_created_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  SELECT COALESCE(pg_catalog.array_agg(role.value #>> '{}' ORDER BY role.ordinality), ARRAY[]::TEXT[])
    INTO v_actor_roles
    FROM pg_catalog.jsonb_array_elements(p_envelope #> '{context,actorRoles}') WITH ORDINALITY AS role(value, ordinality);

  v_payload := pg_catalog.jsonb_build_object(
    'id', v_audit_id,
    'tenantId', v_tenant_id,
    'actorId', v_actor_id,
    'actorType', p_envelope ->> 'actorType',
    'actorEmail', p_envelope #>> '{context,actorEmail}',
    'actorRoles', pg_catalog.to_jsonb(v_actor_roles),
    'action', p_envelope ->> 'action',
    'entityType', p_envelope ->> 'entityType',
    'entityId', p_envelope ->> 'entityId',
    'entityRef', p_envelope #>> '{context,entityRef}',
    'before', p_envelope #> '{payload,before}',
    'after', p_envelope #> '{payload,after}',
    'diff', p_envelope #> '{payload,diff}',
    'reason', p_envelope -> 'reason',
    'requestId', p_envelope -> 'requestId',
    'ipAddress', p_envelope #> '{context,ipAddress}',
    'userAgent', p_envelope #> '{context,userAgent}',
    'severity', p_envelope #>> '{context,severity}',
    'hashVersion', 2,
    'chainSequence', v_sequence,
    'appendNonce', v_nonce,
    'prevHash', v_previous_hash,
    'createdAt', pg_catalog.to_char(v_created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  v_canonical_payload := app_private.fee_audit_canonical_json(v_payload);
  v_hash := pg_catalog.encode(
    app_private.digest(
      pg_catalog.convert_to(
        'fee-audit:v2' || pg_catalog.chr(10) || v_tenant_id::TEXT || pg_catalog.chr(10) ||
        v_sequence::TEXT || pg_catalog.chr(10) || v_previous_hash || pg_catalog.chr(10) || v_canonical_payload,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.audit_logs (
    id, "tenantId", "actorId", "actorType", "actorEmail", "actorRoles", action, "entityType", "entityId",
    "entityRef", before, after, diff, reason, "requestId", "ipAddress", "userAgent", severity,
    "prevHash", hash, "hashVersion", "chainSequence", "appendNonce", "canonicalPayload", "createdAt"
  ) VALUES (
    v_audit_id, v_tenant_id, v_actor_id, p_envelope ->> 'actorType',
    p_envelope #>> '{context,actorEmail}', v_actor_roles, p_envelope ->> 'action',
    p_envelope ->> 'entityType', p_envelope ->> 'entityId', p_envelope #>> '{context,entityRef}',
    p_envelope #> '{payload,before}', p_envelope #> '{payload,after}', p_envelope #> '{payload,diff}',
    p_envelope ->> 'reason', p_envelope ->> 'requestId', p_envelope #>> '{context,ipAddress}',
    p_envelope #>> '{context,userAgent}', p_envelope #>> '{context,severity}',
    v_previous_hash, v_hash, 2, v_sequence, v_nonce, v_canonical_payload, v_created_at
  );

  UPDATE public.audit_chain_heads
     SET "lastSequence" = v_sequence,
         "lastHash" = v_hash,
         "updatedAt" = v_created_at
   WHERE id = v_head.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit chain head changed during append' USING ERRCODE = '40001';
  END IF;
  RETURN v_audit_id;
END;
$append_core$;

CREATE FUNCTION app_private.fee_audit_append_api(p_envelope JSONB, p_signature BYTEA) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $append_api$
DECLARE
  v_tenant_id UUID;
  v_actor_id UUID;
  v_nonce UUID;
  v_request_id TEXT;
  v_key_version INTEGER;
  v_key BYTEA;
  v_expected BYTEA;
  v_difference INTEGER := 0;
  v_index INTEGER;
  v_issued_at TIMESTAMP(3) WITHOUT TIME ZONE;
  v_expires_at TIMESTAMP(3) WITHOUT TIME ZONE;
  v_now TIMESTAMP(3) WITHOUT TIME ZONE;
  v_head_id UUID;
  v_keys TEXT[];
  v_nested_keys TEXT[];
  v_audit_id UUID;
BEGIN
  IF p_envelope IS NULL OR pg_catalog.jsonb_typeof(p_envelope) <> 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_envelope)) <> 14 THEN
    RAISE EXCEPTION 'Audit envelope schema is invalid' USING ERRCODE = '22023';
  END IF;
  v_keys := ARRAY(SELECT object_key.key FROM pg_catalog.jsonb_object_keys(p_envelope) AS object_key(key) ORDER BY object_key.key COLLATE "C");
  IF v_keys IS DISTINCT FROM ARRAY[
    'action','actorId','actorType','context','entityId','entityType','expiresAt','issuedAt',
    'keyVersion','nonce','payload','reason','requestId','tenantId'
  ]::TEXT[] THEN
    RAISE EXCEPTION 'Audit envelope fields are invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_typeof(p_envelope -> 'context') <> 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_envelope -> 'context')) <> 6 OR
     pg_catalog.jsonb_typeof(p_envelope -> 'payload') <> 'object' OR
     (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_envelope -> 'payload')) <> 3 THEN
    RAISE EXCEPTION 'Audit envelope context or payload schema is invalid' USING ERRCODE = '22023';
  END IF;
  v_nested_keys := ARRAY(SELECT object_key.key FROM pg_catalog.jsonb_object_keys(p_envelope -> 'context') AS object_key(key) ORDER BY object_key.key COLLATE "C");
  IF v_nested_keys IS DISTINCT FROM ARRAY['actorEmail','actorRoles','entityRef','ipAddress','severity','userAgent']::TEXT[] THEN
    RAISE EXCEPTION 'Audit context fields are invalid' USING ERRCODE = '22023';
  END IF;
  v_nested_keys := ARRAY(SELECT object_key.key FROM pg_catalog.jsonb_object_keys(p_envelope -> 'payload') AS object_key(key) ORDER BY object_key.key COLLATE "C");
  IF v_nested_keys IS DISTINCT FROM ARRAY['after','before','diff']::TEXT[] THEN
    RAISE EXCEPTION 'Audit payload fields are invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_typeof(p_envelope -> 'tenantId') <> 'string' OR
     pg_catalog.jsonb_typeof(p_envelope -> 'actorType') <> 'string' OR
     pg_catalog.jsonb_typeof(p_envelope -> 'action') <> 'string' OR
     pg_catalog.jsonb_typeof(p_envelope -> 'entityType') <> 'string' OR
     pg_catalog.jsonb_typeof(p_envelope -> 'nonce') <> 'string' OR
     pg_catalog.jsonb_typeof(p_envelope -> 'issuedAt') <> 'string' OR
     pg_catalog.jsonb_typeof(p_envelope -> 'expiresAt') <> 'string' OR
     pg_catalog.jsonb_typeof(p_envelope -> 'keyVersion') <> 'number' OR
     (p_envelope ->> 'keyVersion') !~ '^[1-9][0-9]*$' OR
     length(p_envelope ->> 'action') NOT BETWEEN 1 AND 160 OR
     length(p_envelope ->> 'entityType') NOT BETWEEN 1 AND 160 OR
     length(p_envelope ->> 'actorType') NOT BETWEEN 1 AND 40 OR
     pg_catalog.jsonb_typeof(p_envelope #> '{context,actorRoles}') <> 'array' OR
     (p_envelope #>> '{context,severity}') NOT IN ('INFO','WARN','CRITICAL') THEN
    RAISE EXCEPTION 'Audit envelope values are invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_envelope #> '{context,actorRoles}') AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) <> 'string'
  ) THEN
    RAISE EXCEPTION 'Audit actor roles must be strings' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      (p_envelope -> 'actorId'), (p_envelope -> 'entityId'), (p_envelope -> 'reason'), (p_envelope -> 'requestId'),
      (p_envelope #> '{context,actorEmail}'), (p_envelope #> '{context,entityRef}'),
      (p_envelope #> '{context,ipAddress}'), (p_envelope #> '{context,userAgent}')
    ) AS optional_value(value)
    WHERE pg_catalog.jsonb_typeof(optional_value.value) NOT IN ('string','null')
  ) THEN
    RAISE EXCEPTION 'Optional audit envelope values must be strings or null' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      (p_envelope -> 'actorId'), (p_envelope -> 'entityId'), (p_envelope -> 'reason'), (p_envelope -> 'requestId'),
      (p_envelope #> '{context,actorEmail}'), (p_envelope #> '{context,entityRef}'),
      (p_envelope #> '{context,ipAddress}'), (p_envelope #> '{context,userAgent}')
    ) AS optional_value(value)
    WHERE pg_catalog.jsonb_typeof(optional_value.value) = 'string' AND length(optional_value.value #>> '{}') > 2048
  ) THEN
    RAISE EXCEPTION 'Audit envelope string exceeds its maximum length' USING ERRCODE = '22023';
  END IF;
  IF p_signature IS NULL OR pg_catalog.octet_length(p_signature) <> 32 THEN
    RAISE EXCEPTION 'Audit signature length is invalid' USING ERRCODE = '22023';
  END IF;

  v_tenant_id := (p_envelope ->> 'tenantId')::UUID;
  v_actor_id := NULLIF(p_envelope ->> 'actorId', '')::UUID;
  v_nonce := (p_envelope ->> 'nonce')::UUID;
  v_request_id := p_envelope ->> 'requestId';
  v_key_version := (p_envelope ->> 'keyVersion')::INTEGER;
  v_issued_at := (p_envelope ->> 'issuedAt')::TIMESTAMPTZ AT TIME ZONE 'UTC';
  v_expires_at := (p_envelope ->> 'expiresAt')::TIMESTAMPTZ AT TIME ZONE 'UTC';

  IF pg_catalog.current_setting('fee.current_tenant', TRUE) IS DISTINCT FROM v_tenant_id::TEXT OR
     NULLIF(pg_catalog.current_setting('fee.current_actor_id', TRUE), '') IS DISTINCT FROM v_actor_id::TEXT OR
     NULLIF(pg_catalog.current_setting('fee.current_request_id', TRUE), '') IS DISTINCT FROM v_request_id THEN
    RAISE EXCEPTION 'Audit envelope does not match authenticated transaction context' USING ERRCODE = '42501';
  END IF;

  -- Acquire the tenant serialization point before checking envelope time. A
  -- request that expires while waiting for another writer is rejected.
  SELECT id INTO v_head_id
    FROM public.audit_chain_heads
    WHERE "tenantId" = v_tenant_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit chain head is missing for tenant %', v_tenant_id USING ERRCODE = '23503';
  END IF;
  v_now := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  IF v_expires_at <= v_issued_at OR v_expires_at - v_issued_at > INTERVAL '30 seconds' OR
     v_issued_at > v_now + INTERVAL '5 seconds' OR v_expires_at <= v_now OR
     v_issued_at < v_now - INTERVAL '35 seconds' THEN
    RAISE EXCEPTION 'Audit envelope validity window has expired or is invalid' USING ERRCODE = '42501';
  END IF;

  SELECT "keyMaterial" INTO v_key
    FROM public.audit_signing_keys
    WHERE "keyVersion" = v_key_version
      AND "notBefore" <= v_issued_at
      AND ("notAfter" IS NULL OR "notAfter" >= v_issued_at)
      AND ("retiredAt" IS NULL OR "retiredAt" >= v_issued_at);
  IF NOT FOUND OR pg_catalog.octet_length(v_key) <> 32 THEN
    RAISE EXCEPTION 'Audit signing key is unavailable for this envelope' USING ERRCODE = '42501';
  END IF;
  v_expected := app_private.hmac(
    pg_catalog.convert_to('fee-audit-api:v2' || pg_catalog.chr(10) || app_private.fee_audit_canonical_json(p_envelope), 'UTF8'),
    v_key,
    'sha256'
  );
  IF pg_catalog.octet_length(v_expected) <> pg_catalog.octet_length(p_signature) THEN
    RAISE EXCEPTION 'Audit signature is invalid' USING ERRCODE = '42501';
  END IF;
  FOR v_index IN 0..31 LOOP
    v_difference := v_difference | (pg_catalog.get_byte(v_expected, v_index) # pg_catalog.get_byte(p_signature, v_index));
  END LOOP;
  IF v_difference <> 0 THEN
    RAISE EXCEPTION 'Audit signature is invalid' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_request_nonces (
    id, "tenantId", "requestNonce", "signingKeyVersion", "transactionId", "issuedAt", "expiresAt", "claimedAt"
  ) VALUES (
    pg_catalog.gen_random_uuid(), v_tenant_id, v_nonce, v_key_version,
    pg_catalog.txid_current(), v_issued_at, v_expires_at, pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
  );

  v_audit_id := app_private.fee_audit_append_core(p_envelope);
  RETURN v_audit_id;
END;
$append_api$;

CREATE FUNCTION app_private.fee_audit_legacy_snapshot_hash(p_tenant_id UUID) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $legacy_snapshot$
DECLARE
  v_row RECORD;
  v_hash TEXT;
BEGIN
  FOR v_row IN
    SELECT id, "tenantId", "actorId", "actorType", "actorEmail", "actorRoles", action, "entityType", "entityId",
           "entityRef", before, after, diff, reason, "requestId", "ipAddress", "userAgent", severity,
           "prevHash", hash, "createdAt"
      FROM public.audit_logs
     WHERE "tenantId" = p_tenant_id AND "hashVersion" = 1
     ORDER BY "createdAt", id
  LOOP
    v_hash := pg_catalog.encode(
      app_private.digest(
        pg_catalog.convert_to(
          'fee-audit:legacy-snapshot:v1' || pg_catalog.chr(10) || p_tenant_id::TEXT || pg_catalog.chr(10) ||
          COALESCE(v_hash, 'GENESIS') || pg_catalog.chr(10) ||
          app_private.fee_audit_canonical_json(pg_catalog.jsonb_build_object(
          'id', v_row.id, 'tenantId', v_row."tenantId", 'actorId', v_row."actorId",
            'hashVersion', v_row."hashVersion", 'chainSequence', v_row."chainSequence",
            'appendNonce', v_row."appendNonce", 'canonicalPayload', v_row."canonicalPayload",
            'actorType', v_row."actorType", 'actorEmail', v_row."actorEmail", 'actorRoles', pg_catalog.to_jsonb(v_row."actorRoles"),
            'action', v_row.action, 'entityType', v_row."entityType", 'entityId', v_row."entityId", 'entityRef', v_row."entityRef",
            'before', v_row.before, 'after', v_row.after, 'diff', v_row.diff, 'reason', v_row.reason,
            'requestId', v_row."requestId", 'ipAddress', v_row."ipAddress", 'userAgent', v_row."userAgent",
            'severity', v_row.severity, 'prevHash', v_row."prevHash", 'hash', v_row.hash,
            'createdAt', pg_catalog.to_char(v_row."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          )),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
  END LOOP;
  RETURN v_hash;
END;
$legacy_snapshot$;

CREATE FUNCTION app_private.fee_audit_anchor_legacy_snapshots() RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $anchor_legacy$
DECLARE
  v_head RECORD;
  v_snapshot_hash TEXT;
  v_count INTEGER := 0;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(4605253, 1095058482) THEN
    RAISE EXCEPTION 'Audit cutover requires the exclusive audit lock' USING ERRCODE = '55P03';
  END IF;
  FOR v_head IN
    SELECT id, "tenantId", "lastSequence", "lastHash", "legacySnapshotHash"
      FROM public.audit_chain_heads
     ORDER BY "tenantId"
     FOR UPDATE
  LOOP
    IF v_head."lastSequence" <> 0 OR v_head."lastHash" IS NOT NULL THEN
      RAISE EXCEPTION 'Tenant % already has v2 audit entries', v_head."tenantId" USING ERRCODE = '55000';
    END IF;
    v_snapshot_hash := app_private.fee_audit_legacy_snapshot_hash(v_head."tenantId");
    IF v_head."legacySnapshotHash" IS NOT NULL AND v_head."legacySnapshotHash" IS DISTINCT FROM v_snapshot_hash THEN
      RAISE EXCEPTION 'Tenant % has a conflicting legacy audit anchor', v_head."tenantId" USING ERRCODE = '55000';
    END IF;
    UPDATE public.audit_chain_heads
       SET "legacySnapshotHash" = v_snapshot_hash,
           "updatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
     WHERE id = v_head.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$anchor_legacy$;

CREATE FUNCTION app_private.fee_audit_verify_tenant(p_tenant_id UUID, p_limit INTEGER DEFAULT 5000) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $verify$
DECLARE
  v_head public.audit_chain_heads%ROWTYPE;
  v_row RECORD;
  v_legacy_count BIGINT := 0;
  v_v2_count BIGINT := 0;
  v_checked BIGINT := 0;
  v_expected_previous TEXT;
  v_expected_hash TEXT;
  v_expected_payload TEXT;
  v_snapshot_hash TEXT;
  v_broken_at TEXT;
  v_limited BOOLEAN := FALSE;
  v_intact BOOLEAN := TRUE;
  v_now_count BIGINT;
BEGIN
  IF p_tenant_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100000 THEN
    RAISE EXCEPTION 'Audit verification tenant or limit is invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.current_setting('fee.current_tenant', TRUE) IS DISTINCT FROM p_tenant_id::TEXT THEN
    RAISE EXCEPTION 'Audit verification tenant does not match transaction context' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_head FROM public.audit_chain_heads WHERE "tenantId" = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit chain head is missing for tenant %', p_tenant_id USING ERRCODE = '23503';
  END IF;

  SELECT pg_catalog.count(*) INTO v_legacy_count
    FROM public.audit_logs WHERE "tenantId" = p_tenant_id AND "hashVersion" = 1;
  v_snapshot_hash := app_private.fee_audit_legacy_snapshot_hash(p_tenant_id);
  IF (v_legacy_count > 0 AND (v_head."legacySnapshotHash" IS NULL OR v_head."legacySnapshotHash" IS DISTINCT FROM v_snapshot_hash)) OR
     (v_legacy_count = 0 AND v_head."legacySnapshotHash" IS NOT NULL) THEN
    v_intact := FALSE;
    v_broken_at := (SELECT id::TEXT FROM public.audit_logs WHERE "tenantId" = p_tenant_id AND "hashVersion" = 1 ORDER BY "createdAt", id LIMIT 1);
  END IF;

  v_expected_previous := NULL;
  FOR v_row IN
    SELECT id, "tenantId", "actorId", action, "entityType", "entityId", before, after, reason, "requestId", "createdAt", "prevHash", hash
      FROM public.audit_logs
     WHERE "tenantId" = p_tenant_id AND "hashVersion" = 1
     ORDER BY "createdAt", id
  LOOP
    v_checked := v_checked + 1;
    v_expected_payload := app_private.fee_audit_canonical_json(pg_catalog.jsonb_build_object(
      'tenantId', v_row."tenantId", 'actorId', v_row."actorId", 'action', v_row.action,
      'entityType', v_row."entityType", 'entityId', v_row."entityId", 'before', v_row.before,
      'after', v_row.after, 'reason', v_row.reason, 'requestId', v_row."requestId",
      'recordedAt', pg_catalog.to_char(v_row."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ));
    v_expected_hash := pg_catalog.encode(app_private.digest(
      pg_catalog.convert_to(COALESCE(v_expected_previous, 'genesis') || ':' || v_expected_payload, 'UTF8'), 'sha256'), 'hex');
    IF v_row."prevHash" IS DISTINCT FROM v_expected_previous OR v_row.hash IS DISTINCT FROM v_expected_hash THEN
      v_intact := FALSE;
      v_broken_at := COALESCE(v_broken_at, v_row.id::TEXT);
      EXIT;
    END IF;
    v_expected_previous := v_row.hash;
  END LOOP;

  v_expected_previous := COALESCE(v_head."legacySnapshotHash", 'GENESIS');
  FOR v_row IN
    SELECT id, "tenantId", "actorId", "actorType", "actorEmail", "actorRoles", action, "entityType", "entityId",
           "entityRef", before, after, diff, reason, "requestId", "ipAddress", "userAgent", severity,
           "createdAt", "prevHash", hash, "chainSequence", "appendNonce", "canonicalPayload"
      FROM public.audit_logs
     WHERE "tenantId" = p_tenant_id AND "hashVersion" = 2
     ORDER BY "chainSequence"
     LIMIT p_limit + 1
  LOOP
    IF v_v2_count >= p_limit THEN
      v_limited := TRUE;
      v_intact := FALSE;
      v_broken_at := COALESCE(v_broken_at, v_row.id::TEXT);
      EXIT;
    END IF;
    v_v2_count := v_v2_count + 1;
    v_checked := v_checked + 1;
    v_expected_payload := app_private.fee_audit_canonical_json(pg_catalog.jsonb_build_object(
      'id', v_row.id, 'tenantId', v_row."tenantId", 'actorId', v_row."actorId", 'actorType', v_row."actorType",
      'actorEmail', v_row."actorEmail", 'actorRoles', pg_catalog.to_jsonb(v_row."actorRoles"),
      'action', v_row.action, 'entityType', v_row."entityType", 'entityId', v_row."entityId", 'entityRef', v_row."entityRef",
      'before', v_row.before, 'after', v_row.after, 'diff', v_row.diff, 'reason', v_row.reason,
      'requestId', v_row."requestId", 'ipAddress', v_row."ipAddress", 'userAgent', v_row."userAgent",
      'severity', v_row.severity, 'hashVersion', 2, 'chainSequence', v_row."chainSequence",
      'appendNonce', v_row."appendNonce", 'prevHash', v_row."prevHash",
      'createdAt', pg_catalog.to_char(v_row."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ));
    v_expected_hash := pg_catalog.encode(app_private.digest(pg_catalog.convert_to(
      'fee-audit:v2' || pg_catalog.chr(10) || p_tenant_id::TEXT || pg_catalog.chr(10) ||
      v_row."chainSequence"::TEXT || pg_catalog.chr(10) || v_expected_previous || pg_catalog.chr(10) || v_expected_payload,
      'UTF8'), 'sha256'), 'hex');
    IF v_row."chainSequence" <> v_v2_count OR v_row."prevHash" IS DISTINCT FROM v_expected_previous OR
       v_row."canonicalPayload" IS DISTINCT FROM v_expected_payload OR v_row.hash IS DISTINCT FROM v_expected_hash THEN
      v_intact := FALSE;
      v_broken_at := COALESCE(v_broken_at, v_row.id::TEXT);
      EXIT;
    END IF;
    v_expected_previous := v_row.hash;
  END LOOP;

  IF NOT v_limited THEN
    SELECT pg_catalog.count(*) INTO v_now_count
      FROM public.audit_logs WHERE "tenantId" = p_tenant_id AND "hashVersion" = 2;
    IF v_now_count <> v_head."lastSequence" OR v_v2_count <> v_head."lastSequence" OR
       (v_head."lastSequence" = 0 AND v_head."lastHash" IS NOT NULL) OR
       (v_head."lastSequence" > 0 AND v_head."lastHash" IS DISTINCT FROM v_expected_previous) THEN
      v_intact := FALSE;
      v_broken_at := COALESCE(v_broken_at, 'head');
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'intact', v_intact, 'checked', v_checked, 'legacyChecked', v_legacy_count,
    'version2Checked', v_v2_count, 'limited', v_limited, 'brokenAt', v_broken_at
  );
END;
$verify$;

CREATE FUNCTION app_private.fee_audit_read_tenant(
  p_tenant_id UUID,
  p_id UUID,
  p_filter JSONB,
  p_offset INTEGER,
  p_limit INTEGER,
  p_sort JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $read_audit$
DECLARE
  v_allowed_keys TEXT[];
  v_item JSONB;
  v_items JSONB;
  v_total BIGINT;
  v_sort_length INTEGER;
  v_from TIMESTAMP(3) WITHOUT TIME ZONE;
  v_to TIMESTAMP(3) WITHOUT TIME ZONE;
  v_entity_type TEXT;
  v_action TEXT;
  v_search TEXT;
BEGIN
  IF p_tenant_id IS NULL OR p_filter IS NULL OR pg_catalog.jsonb_typeof(p_filter) <> 'object' OR
     p_offset IS NULL OR p_offset < 0 OR p_offset > 1000000 OR
     p_limit IS NULL OR p_limit < 1 OR p_limit > 100 OR
     p_sort IS NULL OR pg_catalog.jsonb_typeof(p_sort) <> 'array' THEN
    RAISE EXCEPTION 'Audit read parameters are invalid' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.current_setting('fee.current_tenant', TRUE) IS DISTINCT FROM p_tenant_id::TEXT THEN
    RAISE EXCEPTION 'Audit read tenant does not match transaction context' USING ERRCODE = '42501';
  END IF;
  v_allowed_keys := ARRAY(SELECT object_key.key FROM pg_catalog.jsonb_object_keys(p_filter) AS object_key(key) ORDER BY object_key.key COLLATE "C");
  IF v_allowed_keys IS DISTINCT FROM ARRAY['action','entityType','from','search','to']::TEXT[] OR EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_each(p_filter) AS filter(key, value)
    WHERE filter.value <> 'null'::JSONB AND pg_catalog.jsonb_typeof(filter.value) <> 'string'
  ) THEN
    RAISE EXCEPTION 'Audit read filters are invalid' USING ERRCODE = '22023';
  END IF;
  v_sort_length := pg_catalog.jsonb_array_length(p_sort);
  IF v_sort_length < 1 OR v_sort_length > 4 OR EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_sort) AS sort_item(value)
    WHERE pg_catalog.jsonb_typeof(sort_item.value) <> 'object' OR
      (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(sort_item.value)) <> 2 OR
      (SELECT ARRAY(SELECT object_key.key FROM pg_catalog.jsonb_object_keys(sort_item.value) AS object_key(key) ORDER BY object_key.key COLLATE "C"))
        IS DISTINCT FROM ARRAY['direction','field']::TEXT[] OR
      COALESCE(sort_item.value ->> 'field' NOT IN ('createdAt','action','entityType','severity'), TRUE) OR
      COALESCE(sort_item.value ->> 'direction' NOT IN ('asc','desc'), TRUE)
  ) THEN
    RAISE EXCEPTION 'Audit sort specification is invalid' USING ERRCODE = '22023';
  END IF;
  v_entity_type := NULLIF(pg_catalog.btrim(p_filter ->> 'entityType'), '');
  v_action := NULLIF(pg_catalog.btrim(p_filter ->> 'action'), '');
  v_search := NULLIF(pg_catalog.btrim(p_filter ->> 'search'), '');
  IF length(COALESCE(v_entity_type,'')) > 120 OR length(COALESCE(v_action,'')) > 120 OR length(COALESCE(v_search,'')) > 200 THEN
    RAISE EXCEPTION 'Audit read filter exceeds its maximum length' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(p_filter ->> 'from','') IS NOT NULL THEN
    v_from := (p_filter ->> 'from')::TIMESTAMPTZ AT TIME ZONE 'UTC';
  END IF;
  IF NULLIF(p_filter ->> 'to','') IS NOT NULL THEN
    v_to := (p_filter ->> 'to')::TIMESTAMPTZ AT TIME ZONE 'UTC';
  END IF;
  IF v_from IS NOT NULL AND v_to IS NOT NULL AND v_from >= v_to THEN
    RAISE EXCEPTION 'Audit read date range is invalid' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT pg_catalog.jsonb_build_object(
      'id', entry.id, 'tenantId', entry."tenantId", 'actorId', entry."actorId", 'actorType', entry."actorType",
      'actorEmail', entry."actorEmail", 'actorRoles', pg_catalog.to_jsonb(entry."actorRoles"), 'action', entry.action,
      'entityType', entry."entityType", 'entityId', entry."entityId", 'entityRef', entry."entityRef",
      'before', entry.before, 'after', entry.after, 'diff', entry.diff, 'reason', entry.reason,
      'requestId', entry."requestId", 'ipAddress', entry."ipAddress", 'userAgent', entry."userAgent",
      'severity', entry.severity, 'prevHash', entry."prevHash", 'hash', entry.hash,
      'hashVersion', entry."hashVersion", 'chainSequence', entry."chainSequence", 'appendNonce', entry."appendNonce",
      'canonicalPayload', entry."canonicalPayload",
      'createdAt', pg_catalog.to_char(entry."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) INTO v_item
    FROM public.audit_logs AS entry
    WHERE entry."tenantId" = p_tenant_id AND entry.id = p_id;
    RETURN pg_catalog.jsonb_build_object('item', v_item);
  END IF;

  SELECT pg_catalog.count(*) INTO v_total
    FROM public.audit_logs AS entry
   WHERE entry."tenantId" = p_tenant_id
     AND (v_entity_type IS NULL OR entry."entityType" = v_entity_type)
     AND (v_action IS NULL OR entry.action = v_action)
     AND (v_from IS NULL OR entry."createdAt" >= v_from)
     AND (v_to IS NULL OR entry."createdAt" < v_to)
     AND (v_search IS NULL OR
       pg_catalog.strpos(pg_catalog.lower(entry.action), pg_catalog.lower(v_search)) > 0 OR
       pg_catalog.strpos(pg_catalog.lower(entry."entityType"), pg_catalog.lower(v_search)) > 0 OR
       pg_catalog.strpos(pg_catalog.lower(COALESCE(entry."entityRef",'')), pg_catalog.lower(v_search)) > 0 OR
       pg_catalog.strpos(pg_catalog.lower(COALESCE(entry."actorEmail",'')), pg_catalog.lower(v_search)) > 0);
  SELECT COALESCE(pg_catalog.jsonb_agg(page.item), '[]'::JSONB) INTO v_items
    FROM (
      SELECT pg_catalog.jsonb_build_object(
        'id', entry.id, 'actorId', entry."actorId", 'actorType', entry."actorType", 'actorEmail', entry."actorEmail",
        'actorRoles', pg_catalog.to_jsonb(entry."actorRoles"), 'action', entry.action, 'entityType', entry."entityType",
        'entityId', entry."entityId", 'entityRef', entry."entityRef", 'reason', entry.reason, 'requestId', entry."requestId",
        'severity', entry.severity, 'prevHash', entry."prevHash", 'hash', entry.hash,
        'createdAt', pg_catalog.to_char(entry."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ) AS item
      FROM public.audit_logs AS entry
      WHERE entry."tenantId" = p_tenant_id
        AND (v_entity_type IS NULL OR entry."entityType" = v_entity_type)
        AND (v_action IS NULL OR entry.action = v_action)
        AND (v_from IS NULL OR entry."createdAt" >= v_from)
        AND (v_to IS NULL OR entry."createdAt" < v_to)
        AND (v_search IS NULL OR
          pg_catalog.strpos(pg_catalog.lower(entry.action), pg_catalog.lower(v_search)) > 0 OR
          pg_catalog.strpos(pg_catalog.lower(entry."entityType"), pg_catalog.lower(v_search)) > 0 OR
          pg_catalog.strpos(pg_catalog.lower(COALESCE(entry."entityRef",'')), pg_catalog.lower(v_search)) > 0 OR
          pg_catalog.strpos(pg_catalog.lower(COALESCE(entry."actorEmail",'')), pg_catalog.lower(v_search)) > 0)
      ORDER BY
        CASE WHEN p_sort -> 0 ->> 'field' = 'createdAt' AND p_sort -> 0 ->> 'direction' = 'asc' THEN entry."createdAt" END ASC,
        CASE WHEN p_sort -> 0 ->> 'field' = 'createdAt' AND p_sort -> 0 ->> 'direction' = 'desc' THEN entry."createdAt" END DESC,
        CASE WHEN p_sort -> 0 ->> 'field' = 'action' AND p_sort -> 0 ->> 'direction' = 'asc' THEN entry.action END ASC,
        CASE WHEN p_sort -> 0 ->> 'field' = 'action' AND p_sort -> 0 ->> 'direction' = 'desc' THEN entry.action END DESC,
        CASE WHEN p_sort -> 0 ->> 'field' = 'entityType' AND p_sort -> 0 ->> 'direction' = 'asc' THEN entry."entityType" END ASC,
        CASE WHEN p_sort -> 0 ->> 'field' = 'entityType' AND p_sort -> 0 ->> 'direction' = 'desc' THEN entry."entityType" END DESC,
        CASE WHEN p_sort -> 0 ->> 'field' = 'severity' AND p_sort -> 0 ->> 'direction' = 'asc' THEN entry.severity END ASC,
        CASE WHEN p_sort -> 0 ->> 'field' = 'severity' AND p_sort -> 0 ->> 'direction' = 'desc' THEN entry.severity END DESC,
        CASE WHEN p_sort -> 1 ->> 'field' = 'createdAt' AND p_sort -> 1 ->> 'direction' = 'asc' THEN entry."createdAt" END ASC,
        CASE WHEN p_sort -> 1 ->> 'field' = 'createdAt' AND p_sort -> 1 ->> 'direction' = 'desc' THEN entry."createdAt" END DESC,
        CASE WHEN p_sort -> 1 ->> 'field' = 'action' AND p_sort -> 1 ->> 'direction' = 'asc' THEN entry.action END ASC,
        CASE WHEN p_sort -> 1 ->> 'field' = 'action' AND p_sort -> 1 ->> 'direction' = 'desc' THEN entry.action END DESC,
        CASE WHEN p_sort -> 1 ->> 'field' = 'entityType' AND p_sort -> 1 ->> 'direction' = 'asc' THEN entry."entityType" END ASC,
        CASE WHEN p_sort -> 1 ->> 'field' = 'entityType' AND p_sort -> 1 ->> 'direction' = 'desc' THEN entry."entityType" END DESC,
        CASE WHEN p_sort -> 1 ->> 'field' = 'severity' AND p_sort -> 1 ->> 'direction' = 'asc' THEN entry.severity END ASC,
        CASE WHEN p_sort -> 1 ->> 'field' = 'severity' AND p_sort -> 1 ->> 'direction' = 'desc' THEN entry.severity END DESC,
        CASE WHEN p_sort -> 2 ->> 'field' = 'createdAt' AND p_sort -> 2 ->> 'direction' = 'asc' THEN entry."createdAt" END ASC,
        CASE WHEN p_sort -> 2 ->> 'field' = 'createdAt' AND p_sort -> 2 ->> 'direction' = 'desc' THEN entry."createdAt" END DESC,
        CASE WHEN p_sort -> 2 ->> 'field' = 'action' AND p_sort -> 2 ->> 'direction' = 'asc' THEN entry.action END ASC,
        CASE WHEN p_sort -> 2 ->> 'field' = 'action' AND p_sort -> 2 ->> 'direction' = 'desc' THEN entry.action END DESC,
        CASE WHEN p_sort -> 2 ->> 'field' = 'entityType' AND p_sort -> 2 ->> 'direction' = 'asc' THEN entry."entityType" END ASC,
        CASE WHEN p_sort -> 2 ->> 'field' = 'entityType' AND p_sort -> 2 ->> 'direction' = 'desc' THEN entry."entityType" END DESC,
        CASE WHEN p_sort -> 2 ->> 'field' = 'severity' AND p_sort -> 2 ->> 'direction' = 'asc' THEN entry.severity END ASC,
        CASE WHEN p_sort -> 2 ->> 'field' = 'severity' AND p_sort -> 2 ->> 'direction' = 'desc' THEN entry.severity END DESC,
        CASE WHEN p_sort -> 3 ->> 'field' = 'createdAt' AND p_sort -> 3 ->> 'direction' = 'asc' THEN entry."createdAt" END ASC,
        CASE WHEN p_sort -> 3 ->> 'field' = 'createdAt' AND p_sort -> 3 ->> 'direction' = 'desc' THEN entry."createdAt" END DESC,
        CASE WHEN p_sort -> 3 ->> 'field' = 'action' AND p_sort -> 3 ->> 'direction' = 'asc' THEN entry.action END ASC,
        CASE WHEN p_sort -> 3 ->> 'field' = 'action' AND p_sort -> 3 ->> 'direction' = 'desc' THEN entry.action END DESC,
        CASE WHEN p_sort -> 3 ->> 'field' = 'entityType' AND p_sort -> 3 ->> 'direction' = 'asc' THEN entry."entityType" END ASC,
        CASE WHEN p_sort -> 3 ->> 'field' = 'entityType' AND p_sort -> 3 ->> 'direction' = 'desc' THEN entry."entityType" END DESC,
        CASE WHEN p_sort -> 3 ->> 'field' = 'severity' AND p_sort -> 3 ->> 'direction' = 'asc' THEN entry.severity END ASC,
        CASE WHEN p_sort -> 3 ->> 'field' = 'severity' AND p_sort -> 3 ->> 'direction' = 'desc' THEN entry.severity END DESC,
        entry.id ASC
      OFFSET p_offset LIMIT p_limit
    ) AS page;
  RETURN pg_catalog.jsonb_build_object('items', v_items, 'total', v_total);
END;
$read_audit$;

CREATE FUNCTION app_private.fee_audit_provision_tenant_head() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $provision_head$
BEGIN
  INSERT INTO public.audit_chain_heads (id, "tenantId", "lastSequence", "lastHash", "legacySnapshotHash", "createdAt", "updatedAt")
  VALUES (pg_catalog.gen_random_uuid(), NEW.id, 0, NULL, NULL,
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC', pg_catalog.clock_timestamp() AT TIME ZONE 'UTC');
  RETURN NEW;
END;
$provision_head$;

REVOKE ALL ON FUNCTION app_private.fee_audit_canonical_json(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.fee_audit_append_core(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.fee_audit_append_api(JSONB, BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.fee_audit_legacy_snapshot_hash(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.fee_audit_anchor_legacy_snapshots() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.fee_audit_verify_tenant(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.fee_audit_read_tenant(UUID, UUID, JSONB, INTEGER, INTEGER, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.fee_audit_provision_tenant_head() FROM PUBLIC;
RESET ROLE;
GRANT INSERT ON TABLE public.audit_signing_keys TO fee_audit_owner;
GRANT TRIGGER ON TABLE public.tenants TO fee_audit_owner;
SET ROLE fee_audit_owner;
CREATE TRIGGER tenants_audit_head_after_insert
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION app_private.fee_audit_provision_tenant_head();
RESET ROLE;
REVOKE TRIGGER ON TABLE public.tenants FROM fee_audit_owner;

COMMIT;
