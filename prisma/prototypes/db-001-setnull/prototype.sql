-- PostgreSQL-only objects for the isolated DB-001 feasibility prototype.
-- Apply after base.sql, which is generated from schema.prisma by Prisma 7.10.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE ROLE db001_owner NOLOGIN;
CREATE ROLE db001_runtime LOGIN PASSWORD 'prototype-only';

CREATE SCHEMA app_private AUTHORIZATION db001_owner;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

ALTER TABLE public."Tenant" OWNER TO db001_owner;
ALTER TABLE public.academic_units OWNER TO db001_owner;
ALTER TABLE public.admission_applications OWNER TO db001_owner;
ALTER TABLE public.admissions OWNER TO db001_owner;
ALTER TABLE public.fee_assignments OWNER TO db001_owner;
ALTER TABLE public.fee_demands OWNER TO db001_owner;
ALTER TABLE public.payment_orders OWNER TO db001_owner;
ALTER TABLE public.payments OWNER TO db001_owner;
ALTER TABLE public.gateway_transactions OWNER TO db001_owner;
ALTER TABLE public.credits OWNER TO db001_owner;
ALTER TABLE public.invoices OWNER TO db001_owner;
ALTER TABLE public.settlements OWNER TO db001_owner;
ALTER TABLE public.audit_chain_heads OWNER TO db001_owner;
ALTER TABLE public.audit_log OWNER TO db001_owner;

CREATE FUNCTION app_private.prevent_tenant_reparenting()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId" THEN
    RAISE EXCEPTION 'tenant ownership is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

ALTER FUNCTION app_private.prevent_tenant_reparenting() OWNER TO db001_owner;
REVOKE ALL ON FUNCTION app_private.prevent_tenant_reparenting() FROM PUBLIC;

CREATE FUNCTION app_private.prevent_tenant_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'tenant identity is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

ALTER FUNCTION app_private.prevent_tenant_identity_change() OWNER TO db001_owner;
REVOKE ALL ON FUNCTION app_private.prevent_tenant_identity_change() FROM PUBLIC;
CREATE TRIGGER tenant_id_immutable BEFORE UPDATE OF id ON public."Tenant" FOR EACH ROW EXECUTE FUNCTION app_private.prevent_tenant_identity_change();

CREATE TRIGGER academic_units_tenant_immutable BEFORE UPDATE OF "tenantId" ON public.academic_units FOR EACH ROW EXECUTE FUNCTION app_private.prevent_tenant_reparenting();
CREATE TRIGGER admission_applications_tenant_immutable BEFORE UPDATE OF "tenantId" ON public.admission_applications FOR EACH ROW EXECUTE FUNCTION app_private.prevent_tenant_reparenting();
CREATE TRIGGER admissions_tenant_immutable BEFORE UPDATE OF "tenantId" ON public.admissions FOR EACH ROW EXECUTE FUNCTION app_private.prevent_tenant_reparenting();
CREATE TRIGGER fee_assignments_tenant_immutable BEFORE UPDATE OF "tenantId" ON public.fee_assignments FOR EACH ROW EXECUTE FUNCTION app_private.prevent_tenant_reparenting();
CREATE TRIGGER fee_demands_tenant_immutable BEFORE UPDATE OF "tenantId" ON public.fee_demands FOR EACH ROW EXECUTE FUNCTION app_private.prevent_tenant_reparenting();
CREATE TRIGGER payment_orders_tenant_immutable BEFORE UPDATE OF "tenantId" ON public.payment_orders FOR EACH ROW EXECUTE FUNCTION app_private.prevent_tenant_reparenting();
CREATE TRIGGER payments_tenant_immutable BEFORE UPDATE OF "tenantId" ON public.payments FOR EACH ROW EXECUTE FUNCTION app_private.prevent_tenant_reparenting();
CREATE TRIGGER gateway_transactions_tenant_immutable BEFORE UPDATE OF "tenantId" ON public.gateway_transactions FOR EACH ROW EXECUTE FUNCTION app_private.prevent_tenant_reparenting();
CREATE TRIGGER credits_tenant_immutable BEFORE UPDATE OF "tenantId" ON public.credits FOR EACH ROW EXECUTE FUNCTION app_private.prevent_tenant_reparenting();
CREATE TRIGGER invoices_tenant_immutable BEFORE UPDATE OF "tenantId" ON public.invoices FOR EACH ROW EXECUTE FUNCTION app_private.prevent_tenant_reparenting();
CREATE TRIGGER settlements_tenant_immutable BEFORE UPDATE OF "tenantId" ON public.settlements FOR EACH ROW EXECUTE FUNCTION app_private.prevent_tenant_reparenting();
CREATE TRIGGER audit_chain_heads_tenant_immutable BEFORE UPDATE OF "tenantId" ON public.audit_chain_heads FOR EACH ROW EXECUTE FUNCTION app_private.prevent_tenant_reparenting();
CREATE TRIGGER audit_log_tenant_immutable BEFORE UPDATE OF "tenantId" ON public.audit_log FOR EACH ROW EXECUTE FUNCTION app_private.prevent_tenant_reparenting();

CREATE FUNCTION app_private.append_event(
  p_tenant uuid,
  p_table text,
  p_entity uuid,
  p_operation text,
  p_before jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app_private, public, pg_temp
AS $function$
DECLARE
  v_sequence bigint;
  v_previous text;
  v_payload text;
  v_hash text;
BEGIN
  SELECT last_sequence + 1, last_hash
    INTO v_sequence, v_previous
    FROM public.audit_chain_heads
   WHERE "tenantId" = p_tenant
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit chain head missing for tenant %', p_tenant USING ERRCODE = '23503';
  END IF;

  v_payload := jsonb_build_object(
    'tenantId', p_tenant,
    'sequence', v_sequence,
    'entityTable', p_table,
    'entityId', p_entity,
    'operation', p_operation,
    'beforeImage', p_before
  )::text;
  v_hash := encode(digest(convert_to(
    'fee-audit-prototype:v1' || E'\n' || p_tenant::text || E'\n' ||
    v_sequence::text || E'\n' || v_previous || E'\n' || v_payload,
    'UTF8'
  ), 'sha256'), 'hex');

  INSERT INTO public.audit_log (
    "tenantId", chain_sequence, entity_table, entity_id, operation,
    before_image, previous_hash, event_hash
  ) VALUES (
    p_tenant, v_sequence, p_table, p_entity, p_operation,
    p_before, v_previous, v_hash
  );

  UPDATE public.audit_chain_heads
     SET last_sequence = v_sequence, last_hash = v_hash
   WHERE "tenantId" = p_tenant;
END
$function$;

ALTER FUNCTION app_private.append_event(uuid, text, uuid, text, jsonb) OWNER TO db001_owner;
REVOKE ALL ON FUNCTION app_private.append_event(uuid, text, uuid, text, jsonb) FROM PUBLIC;

CREATE FUNCTION app_private.provision_audit_head()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app_private, public, pg_temp
AS $function$
BEGIN
  INSERT INTO public.audit_chain_heads ("tenantId") VALUES (NEW.id);
  RETURN NEW;
END
$function$;

ALTER FUNCTION app_private.provision_audit_head() OWNER TO db001_owner;
REVOKE ALL ON FUNCTION app_private.provision_audit_head() FROM PUBLIC;

CREATE TRIGGER tenant_provision_audit_head
AFTER INSERT ON public."Tenant"
FOR EACH ROW EXECUTE FUNCTION app_private.provision_audit_head();

CREATE FUNCTION app_private.detach_before_target_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app_private, public, pg_temp
AS $function$
DECLARE
  v_child record;
  v_before_images jsonb := '[]'::jsonb;
  v_child_table text := TG_ARGV[0];
  v_relation_column text := TG_ARGV[1];
BEGIN
  -- A fixture flag stands in for the production lifecycle/reference predicate.
  -- Production must generate the real condition from its reviewed policy manifest.
  IF NOT OLD.delete_eligible THEN
    RAISE EXCEPTION 'target is not eligible for deletion' USING ERRCODE = '55000';
  END IF;

  -- Lock and snapshot the complete child set before taking the audit-head lock.
  -- This preserves the DB-001 root -> children -> audit-head lock order.
  FOR v_child IN EXECUTE format(
    'SELECT s.id, to_jsonb(s) AS before_image FROM public.%I AS s WHERE s."tenantId" = $1 AND s.%I = $2 ORDER BY s.id FOR UPDATE',
    v_child_table, v_relation_column
  ) USING OLD."tenantId", OLD.id
  LOOP
    v_before_images := v_before_images || jsonb_build_array(v_child.before_image);
  END LOOP;

  -- Trigger arguments are fixed in the migration below, not caller input.
  PERFORM app_private.append_event(OLD."tenantId", TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD));
  FOR v_child IN SELECT value AS before_image FROM jsonb_array_elements(v_before_images)
  LOOP
    PERFORM app_private.append_event(
      OLD."tenantId", v_child_table, (v_child.before_image->>'id')::uuid, 'DETACH', v_child.before_image
    );
  END LOOP;

  EXECUTE format(
    'UPDATE public.%I SET %I = NULL WHERE "tenantId" = $1 AND %I = $2',
    v_child_table, v_relation_column, v_relation_column
  ) USING OLD."tenantId", OLD.id;

  RETURN OLD;
END
$function$;

ALTER FUNCTION app_private.detach_before_target_delete() OWNER TO db001_owner;
REVOKE ALL ON FUNCTION app_private.detach_before_target_delete() FROM PUBLIC;

CREATE TRIGGER academic_unit_parent_detach
BEFORE DELETE ON public.academic_units
FOR EACH ROW EXECUTE FUNCTION app_private.detach_before_target_delete('academic_units', 'parentId');

CREATE TRIGGER admission_application_detach
BEFORE DELETE ON public.admission_applications
FOR EACH ROW EXECUTE FUNCTION app_private.detach_before_target_delete('admissions', 'applicationId');

CREATE TRIGGER fee_assignment_detach
BEFORE DELETE ON public.fee_assignments
FOR EACH ROW EXECUTE FUNCTION app_private.detach_before_target_delete('fee_demands', 'feeAssignmentId');

CREATE TRIGGER payment_credit_detach
BEFORE DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION app_private.detach_before_target_delete('credits', 'paymentId');

CREATE TRIGGER fee_demand_invoice_detach
BEFORE DELETE ON public.fee_demands
FOR EACH ROW EXECUTE FUNCTION app_private.detach_before_target_delete('invoices', 'demandId');

GRANT USAGE ON SCHEMA public TO db001_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public."Tenant", public.academic_units, public.admission_applications,
  public.admissions, public.fee_assignments, public.fee_demands,
  public.payment_orders, public.payments, public.gateway_transactions,
  public.credits, public.invoices, public.settlements
TO db001_runtime;
REVOKE ALL ON public.audit_chain_heads, public.audit_log FROM db001_runtime;
REVOKE ALL ON SCHEMA app_private FROM db001_runtime;
