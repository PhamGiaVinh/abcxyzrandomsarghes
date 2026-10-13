-- Forward-only shared card implementation and immutable Voice context fences.
-- No card/ledger/data repair, policy, role membership, flag or notification change.
-- Rollback: reviewed new compensating migration restores pre-70 definitions/ACLs;
-- revoke new shared helpers before restoring originals. Never rewind card/audit rows.
BEGIN;
DO $migration$
DECLARE
 item record;
 function_oid oid;
 definition text;
 original_definition text;
 original_body text;
 original_authority text;
 helper_name text;
 payload_name text;
 start_at integer;
 end_at integer;
 anchor text;
 metadata jsonb;
 before_metadata jsonb:='{}'::jsonb;
 expected_definitions jsonb:='{}'::jsonb;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'reviewed_postgres_owner_required'; END IF;
 FOR item IN SELECT * FROM (VALUES
  ('public.update_community_cards(uuid,jsonb,uuid)','fad65f1d894c364249dd51f25ac06dde',false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.show_hole_cards(uuid,jsonb,uuid)','320f5edc67f9ac874b89684d872447c3',false,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.commit_tracker_voice_board_v0(uuid,text,text)','a2690a56143d9cce0210e66c13e2763a',true,'{postgres=X/postgres,authenticated=X/postgres}'),
  ('public.commit_tracker_voice_hole_cards_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb)','d065ca95f25b40a7783e647a57019e40',true,'{postgres=X/postgres,service_role=X/postgres}'),
  ('public._tracker_voice_hand_state_version(uuid)','02fb54cede4cf42423abe72271375a8b',false,'{postgres=X/postgres}')
 ) AS pins(signature,digest,definer,acl) LOOP
  function_oid:=item.signature::regprocedure;
  SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,
   'config',to_jsonb(proconfig),'acl',proacl::text,'defaults',pronargdefaults,
   'names',to_jsonb(proargnames),'args',proargtypes::text,'result',prorettype::text)
  INTO metadata FROM pg_proc WHERE oid=function_oid;
  IF md5(replace(pg_get_functiondef(function_oid),chr(13),''))<>item.digest
  OR metadata->>'owner'<>'postgres' OR (metadata->>'definer')::boolean IS DISTINCT FROM item.definer
  OR metadata->'config' IS DISTINCT FROM '["search_path=public"]'::jsonb
  OR metadata->>'acl' IS DISTINCT FROM item.acl THEN
   RAISE EXCEPTION 'voice_card_precondition_drift: %',item.signature;
  END IF;
  before_metadata:=jsonb_set(before_metadata,ARRAY[item.signature],metadata);
 END LOOP;
 IF md5(replace(pg_get_functiondef('public._tracker_voice_assignment_context(uuid,uuid,uuid)'::regprocedure),chr(13),''))<>'96ba904dfcdfaa23dba36b6862aba168'
 OR md5(replace(pg_get_functiondef('public.is_club_tracker(uuid,uuid)'::regprocedure),chr(13),''))<>'754a878cd17019d6cb0b27aad6a10e84'
 OR to_regprocedure('public._tracker_card_board_source_v1(uuid,jsonb,uuid,boolean)') IS NOT NULL
 OR to_regprocedure('public._tracker_card_hole_source_v1(uuid,jsonb,uuid,boolean)') IS NOT NULL THEN
  RAISE EXCEPTION 'voice_card_dependency_or_helper_collision';
 END IF;

 FOR item IN SELECT * FROM (VALUES
  ('update_community_cards','_tracker_card_board_source_v1','p_community_cards'),
  ('show_hole_cards','_tracker_card_hole_source_v1','p_player_hole_cards')
 ) AS sources(core,helper,payload) LOOP
  helper_name:=item.helper; payload_name:=item.payload;
  function_oid:=format('public.%I(uuid,jsonb,uuid)',item.core)::regprocedure;
  original_definition:=replace(pg_get_functiondef(function_oid),chr(13),'');
  SELECT replace(prosrc,chr(13),'') INTO original_body FROM pg_proc WHERE oid=function_oid;
  definition:=original_definition;
  start_at:=position('  IF NOT public.is_club_tracker' in definition);
  end_at:=position('  IF v_hand.status' in definition);
  IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'card_authority_anchor_missing'; END IF;
  original_authority:=substring(definition from start_at for end_at-start_at);
  definition:=left(definition,start_at-1)||$authority$
  IF p_voice THEN
    v_context:=public._tracker_voice_assignment_context(v_hand.tournament_id,v_hand.table_id,v_actor);
    IF COALESCE((v_context->>'ok')::boolean,false) IS NOT TRUE THEN RETURN v_context; END IF;
    IF v_hand.table_session_id IS DISTINCT FROM (v_context->>'table_session_id')::uuid THEN
      RETURN jsonb_build_object('ok',false,'error','hand_scope_mismatch');
    END IF;
  ELSE
$authority$||original_authority||'  END IF;'||chr(10)||substring(definition from end_at);
  anchor:=format('FUNCTION public.%I(p_hand_id uuid, %I jsonb, p_user_id uuid DEFAULT NULL::uuid)',item.core,payload_name);
  IF position(anchor in definition)=0 THEN RAISE EXCEPTION 'card_signature_anchor_missing'; END IF;
  definition:=replace(definition,anchor,format('FUNCTION public.%I(p_hand_id uuid, %I jsonb, p_user_id uuid, p_voice boolean)',helper_name,payload_name));
  definition:=replace(definition,'  v_hand RECORD;','  v_hand RECORD;'||chr(10)||'  v_context JSONB;');
  definition:=replace(definition,'h.tournament_id, h.table_id,','h.tournament_id, h.table_id, h.table_session_id,');
  start_at:=position(chr(10)||'BEGIN'||chr(10) in definition);
  IF start_at=0 THEN RAISE EXCEPTION 'card_body_anchor_missing'; END IF;
  definition:=left(definition,start_at+6)||'  IF p_voice IS NULL OR (p_voice AND current_user <> ''postgres'') THEN RETURN jsonb_build_object(''ok'',false,''error'',''voice_delegation_required''); END IF;'||chr(10)||substring(definition from start_at+7);
  definition:=replace(definition,'SET search_path TO ''public''','SET search_path TO ''''');
  EXECUTE definition;
  expected_definitions:=jsonb_set(expected_definitions,ARRAY[format('public.%I(uuid,jsonb,uuid,boolean)',helper_name)],to_jsonb(md5(definition)));
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(uuid,jsonb,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role',helper_name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(uuid,jsonb,uuid,boolean) TO authenticated',helper_name);
  -- Preserve original name, owner, invoker posture, defaults, search_path and ACL.
  definition:=replace(original_definition,original_body,chr(10)||'BEGIN'||chr(10)||format('  RETURN public.%I(p_hand_id,%I,p_user_id,false);',helper_name,payload_name)||chr(10)||'END;'||chr(10));
  EXECUTE definition;
  expected_definitions:=jsonb_set(expected_definitions,ARRAY[format('public.%I(uuid,jsonb,uuid)',item.core)],to_jsonb(md5(definition)));
 END LOOP;

 definition:=replace(pg_get_functiondef('public.commit_tracker_voice_board_v0(uuid,text,text)'::regprocedure),chr(13),'');
 anchor:='public.update_community_cards(v_root.hand_id, v_cards, v_actor)';
 IF position(anchor in definition)=0 THEN RAISE EXCEPTION 'voice_board_call_anchor_missing'; END IF;
 definition:=replace(definition,anchor,'public._tracker_card_board_source_v1(v_root.hand_id, v_cards, v_actor, true)');
 anchor:='  IF COALESCE((v_assignment->>''ok'')::BOOLEAN, false) IS NOT TRUE THEN RETURN v_assignment; END IF;';
 IF position(anchor in definition)=0 THEN RAISE EXCEPTION 'voice_board_context_anchor_missing'; END IF;
 definition:=replace(definition,anchor,anchor||$fence$
  IF v_root.assignment_id IS DISTINCT FROM (v_assignment->>'assignment_id')::uuid
     OR v_root.dealer_id IS DISTINCT FROM (v_assignment->>'dealer_id')::uuid
     OR v_root.physical_table_id IS DISTINCT FROM (v_assignment->>'physical_table_id')::uuid
     OR v_root.club_id IS DISTINCT FROM (v_assignment->>'club_id')::uuid THEN
    RETURN jsonb_build_object('ok',false,'error','voice_assignment_changed');
  END IF;
$fence$);
 EXECUTE definition;
 expected_definitions:=jsonb_set(expected_definitions,ARRAY['public.commit_tracker_voice_board_v0(uuid,text,text)'],to_jsonb(md5(definition)));
 definition:=replace(pg_get_functiondef('public.commit_tracker_voice_hole_cards_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb)'::regprocedure),chr(13),'');
 anchor:='public.show_hole_cards(';
 IF position(anchor in definition)=0 OR position('    p_actor_user_id'||chr(10)||'  );' in definition)=0 THEN RAISE EXCEPTION 'voice_hole_call_anchor_missing'; END IF;
 definition:=replace(definition,anchor,'public._tracker_card_hole_source_v1(');
 definition:=replace(definition,'    p_actor_user_id'||chr(10)||'  );','    p_actor_user_id, true'||chr(10)||'  );');
 EXECUTE definition;
 expected_definitions:=jsonb_set(expected_definitions,ARRAY['public.commit_tracker_voice_hole_cards_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb)'],to_jsonb(md5(definition)));

 definition:=replace(pg_get_functiondef('public._tracker_voice_hand_state_version(uuid)'::regprocedure),chr(13),'');
 anchor:='    ''players'', COALESCE((';
 IF position(anchor in definition)=0 THEN RAISE EXCEPTION 'voice_state_anchor_missing'; END IF;
 definition:=replace(definition,anchor,$state$
    'operational_context', jsonb_build_object(
      'hand_session_id', h.table_session_id,
      'current_table', (SELECT jsonb_build_object(
        'session_id', tt.table_session_id, 'physical_table_id', tt.game_table_id,
        'table_status', tt.status, 'epoch', ts.control_epoch,
        'mode', ts.control_mode, 'closed_at', ts.closed_at,
        'assignments', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'assignment_id', da.id, 'dealer_id', da.dealer_id)
          ORDER BY da.id),'[]'::jsonb)
          FROM public.dealer_assignments da WHERE da.table_id=tt.game_table_id
          AND da.table_session_id=tt.table_session_id AND da.status='assigned' AND da.released_at IS NULL))
        FROM public.tournament_tables tt
        JOIN public.table_sessions ts ON ts.id=tt.table_session_id
        WHERE tt.id=h.table_id AND tt.tournament_id=h.tournament_id)),
$state$||anchor);
 EXECUTE definition;
 expected_definitions:=jsonb_set(expected_definitions,ARRAY['public._tracker_voice_hand_state_version(uuid)'],to_jsonb(md5(definition)));

 FOR item IN SELECT key,value FROM jsonb_each_text(expected_definitions) LOOP
  IF md5(replace(pg_get_functiondef(item.key::regprocedure),chr(13),''))<>item.value THEN RAISE EXCEPTION 'voice_card_definition_postcheck: %',item.key; END IF;
 END LOOP;
 FOR item IN SELECT key,value FROM jsonb_each(before_metadata) LOOP
  SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,
   'config',to_jsonb(proconfig),'acl',proacl::text,'defaults',pronargdefaults,
   'names',to_jsonb(proargnames),'args',proargtypes::text,'result',prorettype::text)
  INTO metadata FROM pg_proc WHERE oid=item.key::regprocedure;
  IF metadata IS DISTINCT FROM item.value THEN RAISE EXCEPTION 'voice_card_metadata_postcheck: %',item.key; END IF;
 END LOOP;
 FOREACH helper_name IN ARRAY ARRAY['_tracker_card_board_source_v1','_tracker_card_hole_source_v1'] LOOP
  function_oid:=format('public.%I(uuid,jsonb,uuid,boolean)',helper_name)::regprocedure;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=function_oid AND NOT prosecdef AND pg_get_userbyid(proowner)='postgres' AND pronargdefaults=0 AND proconfig=ARRAY['search_path=""']::text[])
  OR NOT has_function_privilege('authenticated',function_oid,'EXECUTE')
  OR EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=function_oid AND (a.grantee NOT IN ('postgres'::regrole::oid,'authenticated'::regrole::oid) OR a.grantor<>'postgres'::regrole::oid OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
   RAISE EXCEPTION 'voice_shared_helper_acl_postcheck: %',helper_name;
  END IF;
 END LOOP;
END;
$migration$;
COMMIT;
