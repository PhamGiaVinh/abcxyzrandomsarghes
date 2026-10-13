-- Forward-only. Requires reviewed70 Voice state fence; no manual-authority change.
-- Compensation: restore reviewed pre71 record_hand body in a NEW migration;
-- do not rewind completed hands, seats, chips, events, outcomes or audit.
BEGIN;
DO $migration$
DECLARE
 definition text;
 start_at integer;
 end_at integer;
 before_metadata jsonb;
 after_metadata jsonb;
 signature regprocedure:='public.record_hand(uuid,uuid,integer,timestamp with time zone,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required'; END IF;
 IF md5(replace(pg_get_functiondef(signature),chr(13),''))<>'b3bb09d6a873becb061ea05d6cecd4dd'
 OR md5(replace(pg_get_functiondef('public._tracker_voice_hand_state_version(uuid)'::regprocedure),chr(13),''))<>'f1f8d600607c96653f1ea1c0f950c119'
 OR md5(replace(pg_get_functiondef('public._tracker_voice_assignment_context(uuid,uuid,uuid)'::regprocedure),chr(13),''))<>'96ba904dfcdfaa23dba36b6862aba168'
 OR md5(replace(pg_get_functiondef('public.commit_tracker_voice_finish_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb)'::regprocedure),chr(13),''))<>'3a0ce90325bc229ada7103893de6c3e4' THEN
  RAISE EXCEPTION 'voice_finish_source_or_dependency_drift';
 END IF;
 IF has_function_privilege('service_role',signature,'EXECUTE')
 OR has_function_privilege('authenticated','public.commit_tracker_voice_finish_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb)'::regprocedure,'EXECUTE')
 OR NOT has_function_privilege('service_role','public.commit_tracker_voice_finish_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb)'::regprocedure,'EXECUTE') THEN
  RAISE EXCEPTION 'voice_finish_delegation_acl_drift';
 END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'acl',proacl::text,'config',proconfig,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO before_metadata FROM pg_proc WHERE oid=signature;
 IF before_metadata->>'owner'<>'postgres' OR before_metadata->>'definer'<>'true'
 OR before_metadata->>'acl'<>'{postgres=X/postgres,authenticated=X/postgres}'
 OR before_metadata->'config' IS DISTINCT FROM '["search_path=\"\""]'::jsonb THEN
  RAISE EXCEPTION 'voice_finish_authority_metadata_drift';
 END IF;
 definition:=replace(pg_get_functiondef(signature),chr(13),'');
 start_at:=position('  -- Direct service_role execution remains impossible by ACL.' in definition);
 end_at:=position('  SELECT count(*) INTO v_hand_matches' in definition);
 IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'voice_finish_authority_anchor_missing'; END IF;
 definition:=left(definition,start_at-1)||$authority$
  -- Service-role direct EXECUTE remains revoked. Voice delegated actor authority
  -- is verified against the exact current session/config/epoch/assignment.
  IF v_service_voice_call THEN
    v_finish_context:=public._tracker_voice_assignment_context(p_tournament_id,v_tt.id,v_actor);
    IF COALESCE((v_finish_context->>'ok')::boolean,false) IS NOT TRUE THEN RETURN v_finish_context; END IF;
    IF v_tt.table_session_id IS DISTINCT FROM (v_finish_context->>'table_session_id')::uuid
       OR v_club_id IS DISTINCT FROM (v_finish_context->>'club_id')::uuid THEN
      RETURN jsonb_build_object('ok',false,'error','voice_finish_scope_mismatch');
    END IF;
  END IF;

$authority$||substring(definition from end_at);
 IF position('  v_club_id UUID;' in definition)=0 OR position('AND h.hand_number = p_hand_number' in definition)=0 THEN
  RAISE EXCEPTION 'voice_finish_hand_scope_anchor_missing';
 END IF;
 definition:=replace(definition,'  v_club_id UUID;','  v_club_id UUID;'||chr(10)||'  v_finish_context JSONB;');
 definition:=replace(definition,'AND h.hand_number = p_hand_number','AND (NOT v_service_voice_call OR (h.table_session_id = v_tt.table_session_id AND h.tournament_table_id = v_tt.id))'||chr(10)||'    AND h.hand_number = p_hand_number');
 EXECUTE definition;
 IF md5(replace(pg_get_functiondef(signature),chr(13),''))<>'16006fec6f3b9274581de471a9dc296a' THEN
  RAISE EXCEPTION 'voice_finish_definition_postcheck';
 END IF;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'acl',proacl::text,'config',proconfig,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO after_metadata FROM pg_proc WHERE oid=signature;
 IF before_metadata IS DISTINCT FROM after_metadata THEN RAISE EXCEPTION 'voice_finish_metadata_postcheck'; END IF;
END;
$migration$;
COMMIT;
