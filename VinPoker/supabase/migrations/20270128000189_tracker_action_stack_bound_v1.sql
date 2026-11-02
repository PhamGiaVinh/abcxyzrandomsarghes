-- Stack conservation at the actual action writer boundary, not warn-only Edge.
-- No turn-order, rest, settlement, pricing or historical-row repair.
-- Recovery: contain new writes via reviewed RPC grants; keep the integrity
-- trigger. Any reversal requires a reviewed forward migration, not data rewind.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF current_user<>'postgres'
 OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20270128000189')
 OR to_regprocedure('floor_private.guard_tracker_action_stack189()') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.hand_actions'::regclass AND tgname='trg_guard_tracker_action_stack189')
 OR md5(replace(pg_get_functiondef('public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)'::regprocedure),chr(13),''))<>'9a0c1397480381859a12fbd6b619cd87'
 THEN RAISE EXCEPTION 'tracker_stack189_baseline_drift_or_collision';END IF;
END $$;

CREATE FUNCTION floor_private.guard_tracker_action_stack189()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE frozen_stack bigint; committed bigint; excluded uuid; invalid_legacy boolean;
BEGIN
 -- Serializes INSERT/UPDATE budget reads with the existing hand-locked RPC.
 -- Reparenting takes both parent locks in a stable order.
 IF TG_OP='UPDATE' THEN
  PERFORM 1 FROM public.tournament_hands WHERE id IN(OLD.hand_id,NEW.hand_id) ORDER BY id FOR UPDATE;
  excluded:=OLD.id;
 ELSE
  PERFORM 1 FROM public.tournament_hands WHERE id=NEW.hand_id FOR UPDATE;
 END IF;
 IF coalesce(NEW.action_amount,0)<0 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='tracker_action_negative_amount',CONSTRAINT='tracker_action_stack_bound_v1';
 END IF;
 -- Exact contributing types shared with trackerEngine/potEngine.ts.
 IF NEW.action_type NOT IN('bet','raise','call','all_in','post_sb','post_bb','post_ante') THEN RETURN NEW;END IF;
 SELECT starting_stack INTO frozen_stack FROM public.hand_players
 WHERE hand_id=NEW.hand_id AND player_id=NEW.player_id AND entry_number=NEW.entry_number;
 IF frozen_stack IS NULL OR frozen_stack<0 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='tracker_action_stack_evidence_missing',CONSTRAINT='tracker_action_stack_bound_v1';
 END IF;
 SELECT coalesce(sum(coalesce(a.action_amount,0)::bigint),0),coalesce(bool_or(a.action_amount<0),false)
 INTO committed,invalid_legacy
 FROM public.hand_actions a WHERE a.hand_id=NEW.hand_id AND a.player_id=NEW.player_id
 AND a.entry_number=NEW.entry_number AND (excluded IS NULL OR a.id<>excluded)
 AND a.action_type IN('bet','raise','call','all_in','post_sb','post_bb','post_ante');
 IF invalid_legacy THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='tracker_action_stack_evidence_missing',CONSTRAINT='tracker_action_stack_bound_v1';
 END IF;
 IF committed+coalesce(NEW.action_amount,0)::bigint>frozen_stack THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='tracker_action_stack_exceeded',CONSTRAINT='tracker_action_stack_bound_v1';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION floor_private.guard_tracker_action_stack189() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_guard_tracker_action_stack189 BEFORE INSERT OR UPDATE ON public.hand_actions
FOR EACH ROW EXECUTE FUNCTION floor_private.guard_tracker_action_stack189();

DO $patch$
DECLARE target regprocedure:='public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)'::regprocedure;
 definition text; before_meta jsonb; after_meta jsonb;
 anchor text:='  EXCEPTION WHEN unique_violation THEN';
BEGIN
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
  'acl',proacl::text,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO before_meta FROM pg_proc WHERE oid=target;
 IF before_meta->>'owner'<>'postgres' OR before_meta->>'definer'<>'true'
 OR before_meta->'config' IS DISTINCT FROM '["search_path=public"]'::jsonb
 OR before_meta->>'acl'<>'{postgres=X/postgres,authenticated=X/postgres}' THEN RAISE EXCEPTION 'tracker_stack189_authority_drift';END IF;
 definition:=replace(pg_get_functiondef(target),chr(13),'');
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'tracker_stack189_anchor_drift';END IF;
 definition:=replace(definition,anchor,$catch$  EXCEPTION WHEN check_violation THEN
    IF SQLERRM IN('tracker_action_negative_amount','tracker_action_stack_evidence_missing','tracker_action_stack_exceeded') THEN
      RETURN jsonb_build_object('error',SQLERRM,'trace_id',p_trace_id);
    END IF;
    RAISE;
  WHEN unique_violation THEN$catch$);
 EXECUTE definition;
 SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
  'acl',proacl::text,'defaults',pronargdefaults,'names',proargnames,'args',proargtypes::text,'result',prorettype::text)
 INTO after_meta FROM pg_proc WHERE oid=target;
 IF before_meta IS DISTINCT FROM after_meta OR replace(pg_get_functiondef(target),chr(13),'') IS DISTINCT FROM definition
 THEN RAISE EXCEPTION 'tracker_stack189_postcheck';END IF;
END;
$patch$;
COMMIT;
