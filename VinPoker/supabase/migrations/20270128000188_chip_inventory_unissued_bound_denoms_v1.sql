-- Include zero-count denominations of the exact bound set as color-up targets.
-- No synthetic issuance/ledger rows. Historical counted denominations stay in
-- the projection so conservation is not hidden after a binding change.
-- Recovery: contain color-up writes via their existing grants/feature gate;
-- preserve ledger and receipts. Do not undo inventory with destructive writes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE target regprocedure:='public.chip_ops_current_denom_counts(uuid)'::regprocedure;
 definition text; before_meta jsonb; after_meta jsonb;
 anchor text:='WHERE d.club_id=club AND (i.denomination_id IS NOT NULL OR g.denomination_id IS NOT NULL);';
 replacement text:='WHERE d.club_id=club AND (i.denomination_id IS NOT NULL OR g.denomination_id IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.tournament_chip_set binding
      WHERE binding.tournament_id=p_tournament_id AND binding.club_id=club AND binding.chip_set_id=d.chip_set_id));';
BEGIN
 IF current_user<>'postgres'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000188')
 OR md5(replace(pg_get_functiondef(target),chr(13),''))<>'59b711dea028057e3e7851a1d91e9dd1' THEN
  RAISE EXCEPTION 'chip_unissued188_baseline_drift_or_collision';END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
  'acl',proacl::text,'volatility',provolatile,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO before_meta FROM pg_proc WHERE oid=target;
 IF before_meta->>'owner'<>'postgres' OR before_meta->>'definer'<>'true'
 OR before_meta->'config' IS DISTINCT FROM '["search_path=\"\""]'::jsonb
 OR before_meta->>'acl'<>'{postgres=X/postgres,authenticated=X/postgres}' THEN RAISE EXCEPTION 'chip_unissued188_authority_drift';END IF;
 definition:=replace(pg_get_functiondef(target),chr(13),'');
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'chip_unissued188_anchor_drift';END IF;
 definition:=replace(definition,anchor,replacement);
 EXECUTE definition;
 IF replace(pg_get_functiondef(target),chr(13),'') IS DISTINCT FROM definition THEN RAISE EXCEPTION 'chip_unissued188_definition_postcheck';END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
  'acl',proacl::text,'volatility',provolatile,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO after_meta FROM pg_proc WHERE oid=target;
 IF before_meta IS DISTINCT FROM after_meta THEN RAISE EXCEPTION 'chip_unissued188_metadata_changed';END IF;
END;
$patch$;
COMMIT;
