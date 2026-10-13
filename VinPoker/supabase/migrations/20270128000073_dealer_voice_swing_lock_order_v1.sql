-- Forward fix: lock physical table before operator receipt FK locks session.
-- Deferred Voice mode callback upgrades session at COMMIT. Do not disable it.
-- Preserves receipt replay/conflict policy, rest/payroll and public ABI.
BEGIN;
DO $migration$
DECLARE
 signature regprocedure:='public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure;
 definition text; before_metadata jsonb; after_metadata jsonb;
 anchor text:='  INSERT INTO public.dealer_swing_operator_requests (';
 replacement text:=$order$
  -- Receipt FK acquisition must follow canonical physical-table lock order.
  -- Otherwise Swing holds session KEY SHARE while waiting on Voice's table
  -- lock; Voice's deferred mode resolver then waits upgrading that session.
  PERFORM 1 FROM public.game_tables gt
  WHERE gt.id=p_table_id AND gt.club_id=v_club_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_club_dealer_control(auth.uid(),v_club_id) THEN
    RAISE EXCEPTION 'SWING_OPERATOR_FORBIDDEN';
  END IF;

$order$;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required'; END IF;
 definition:=replace(pg_get_functiondef(signature),chr(13),'');
 IF md5(definition)<>'3f3e35df593064562056326969364bac'
 OR md5(replace(pg_get_functiondef('public._tracker_voice_assignment_context(uuid,uuid,uuid)'::regprocedure),chr(13),''))<>'0a9e1f4e0972015b1554d6cd10f5ee2a'
 OR md5(replace(pg_get_functiondef('public._dealer_swing_assert_exact_context(uuid,uuid,uuid,integer,uuid)'::regprocedure),chr(13),''))<>'f7532f6f5dfb3556a8e7ad71e494a640' THEN RAISE EXCEPTION 'voice_swing73_baseline_drift'; END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'acl',proacl::text,'config',proconfig,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO before_metadata FROM pg_proc WHERE oid=signature;
 IF before_metadata->>'owner'<>'postgres' OR before_metadata->>'definer'<>'true'
 OR before_metadata->>'acl'<>'{postgres=X/postgres,authenticated=X/postgres}'
 OR before_metadata->'config' IS DISTINCT FROM '["search_path=\"\""]'::jsonb THEN RAISE EXCEPTION 'voice_swing73_authority_drift'; END IF;
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'voice_swing73_anchor_drift'; END IF;
 definition:=replace(definition,anchor,replacement||anchor);
 EXECUTE definition;
 IF replace(pg_get_functiondef(signature),chr(13),'') IS DISTINCT FROM definition
 OR md5(definition)<>'a25a91e02d6f2c0399e5aba1086e4acf' THEN RAISE EXCEPTION 'voice_swing73_definition_postcheck'; END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'acl',proacl::text,'config',proconfig,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO after_metadata FROM pg_proc WHERE oid=signature;
 IF before_metadata IS DISTINCT FROM after_metadata THEN RAISE EXCEPTION 'voice_swing73_metadata_postcheck'; END IF;
END;
$migration$;
COMMIT;
