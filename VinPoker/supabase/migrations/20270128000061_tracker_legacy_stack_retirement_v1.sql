-- LS01: obsolete player-only writes bypass exact-session roster integrity.
-- Supported stack edits remain on set_tracker_table_roster_seat_v2 unchanged.
-- No data repair/deletion. Rollback: forward fix; reinstating old definitions
-- reopens projection and active-hand corruption. Preserve pre-apply snapshots.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
 IF md5(replace(pg_get_functiondef('public.update_stack(uuid,uuid,integer,integer)'::regprocedure),chr(13),''))
 IS DISTINCT FROM 'b364161d7c5feab57691094af3be8aa3'
 OR md5(replace(pg_get_functiondef('public.bulk_update_stacks(uuid,jsonb)'::regprocedure),chr(13),''))
 IS DISTINCT FROM '8ddbdde2a6ea88050b44d275dd76ebad'
 THEN RAISE EXCEPTION 'legacy_stack_definition_drift'; END IF;
 IF md5(replace(pg_get_functiondef('public.set_tracker_table_roster_seat_v2(uuid,uuid,uuid,bigint,uuid,integer,text,integer,uuid,boolean,text,text)'::regprocedure),chr(13),''))
 IS DISTINCT FROM 'a04bbb425ed15913bd8ee2368256f25a'
 OR NOT has_function_privilege('authenticated',
 'public.set_tracker_table_roster_seat_v2(uuid,uuid,uuid,bigint,uuid,integer,text,integer,uuid,boolean,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'canonical_stack_writer_drift'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.update_stack(
 p_tournament_id uuid,p_player_id uuid,p_entry_number integer,p_chip_count integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 RETURN pg_catalog.jsonb_build_object('status','error','error','LEGACY_STACK_WRITE_RETIRED',
 'message','Edit stack through the canonical exact-session Tracker roster.');
END;
$$;
CREATE OR REPLACE FUNCTION public.bulk_update_stacks(p_tournament_id uuid,p_updates jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
 RETURN pg_catalog.jsonb_build_object('status','error','error','LEGACY_STACK_WRITE_RETIRED',
 'message','Edit stack through the canonical exact-session Tracker roster.');
END;
$$;
REVOKE ALL ON FUNCTION public.update_stack(uuid,uuid,integer,integer),public.bulk_update_stacks(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.update_stack(uuid,uuid,integer,integer),public.bulk_update_stacks(uuid,jsonb) TO authenticated;
COMMIT;
