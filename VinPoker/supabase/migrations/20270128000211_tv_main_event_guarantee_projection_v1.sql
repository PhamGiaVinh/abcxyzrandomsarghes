BEGIN;
-- Read-only metadata addition. Never copy event GTD into a flight's prize pool.
DO $migration$
DECLARE definition text; anchor text:=
 $anchor$ RETURN payload||jsonb_build_object('re_entries',counts->'re_entries','participation_counts',counts);$anchor$;
BEGIN
 definition:=pg_get_functiondef('public.get_tv_display_state_v4(text,boolean)'::regprocedure);
 IF md5(definition)<>'2923e291fa01da3dca8adbc8991a8a89' THEN
  RAISE EXCEPTION 'tv_main_event211_definition_drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
  AND table_name='tournament_events' AND column_name='guarantee_amount') THEN
  RAISE EXCEPTION 'tv_main_event211_requires210'; END IF;
 IF position(anchor in definition)=0 THEN RAISE EXCEPTION 'tv_main_event211_anchor_missing'; END IF;
 definition:=replace(definition,anchor,$replacement$
 -- Token, display assignment and exact tournament/club were checked above.
 -- Only the event linked to this tournament may contribute shared metadata.
 payload:=payload||jsonb_build_object('main_event',(
  SELECT jsonb_build_object('id',e.id,'name',e.name,'guarantee_amount',e.guarantee_amount)
  FROM public.tournaments t JOIN public.tournament_events e ON e.id=t.event_id AND e.club_id=t.club_id
  WHERE t.id=d.assigned_tournament_id AND t.club_id=d.club_id AND t.deleted_at IS NULL));
 RETURN payload||jsonb_build_object('re_entries',counts->'re_entries','participation_counts',counts);$replacement$);
 EXECUTE definition;
END $migration$;
-- CREATE OR REPLACE preserves the reviewed owner and grants. Assert, don't widen.
DO $$ BEGIN
 ASSERT has_function_privilege('anon','public.get_tv_display_state_v4(text,boolean)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public.get_tv_display_state_v4(text,boolean)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.get_tv_display_state_v4(text,boolean)','EXECUTE');
END $$;
COMMIT;
