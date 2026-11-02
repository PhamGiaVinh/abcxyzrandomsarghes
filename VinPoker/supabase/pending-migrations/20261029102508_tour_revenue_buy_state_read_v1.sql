-- Pending LOCAL candidate. Legacy terminal tours with no registration marker
-- are not open for buy, and have no reconstructed official financial snapshot.
-- Read-only state correction: no history/marker/snapshot writes or backfill.
-- Rollback: forward restore both exact raw function definitions saved below.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $patch$
DECLARE h record; f record; a record; hd text; fd text; function_oid oid;
 old_state text:=$old$  'registrationClosedAt',t.registration_closed_at,'provisional',true,$old$;
 new_state text:=$new$  'registrationClosedAt',t.registration_closed_at,'provisional',true,
  'buyState',CASE WHEN t.registration_closed_at IS NOT NULL THEN 'closed'
    WHEN t.status IN ('completed','cancelled') OR t.live_status='finished' THEN 'terminal'
    ELSE 'open' END,$new$;
 old_declare text:='DECLARE club uuid; closed_at timestamptz; saved';
 new_declare text:='DECLARE club uuid; closed_at timestamptz; v_tour_status text; v_live_status text; saved';
 old_select text:=' SELECT t.club_id,t.registration_closed_at INTO club,closed_at FROM public.tournaments t WHERE t.id=p_tournament_id;';
 new_select text:=' SELECT t.club_id,t.registration_closed_at,t.status,t.live_status INTO club,closed_at,v_tour_status,v_live_status FROM public.tournaments t WHERE t.id=p_tournament_id;';
 old_open text:=$old$ IF closed_at IS NULL THEN RETURN jsonb_build_object('status','buy_open','canExport',false); END IF;$old$;
 new_open text:=$new$ IF closed_at IS NULL THEN RETURN jsonb_build_object('status',
   CASE WHEN v_tour_status IN ('completed','cancelled') OR v_live_status='finished'
     THEN 'snapshot_missing' ELSE 'buy_open' END,'canExport',false); END IF;$new$;
BEGIN
 SELECT p.*,pg_get_functiondef(p.oid) AS definition INTO STRICT h FROM pg_proc p
 WHERE oid='floor_private.tour_revenue_live_source_v1(uuid)'::regprocedure;
 SELECT p.*,pg_get_functiondef(p.oid) AS definition INTO STRICT f FROM pg_proc p
 WHERE oid='public.get_tour_revenue_buy_close_v1(uuid)'::regprocedure;
 IF current_user<>'postgres' OR md5(h.prosrc)<>'8e1643276e7e3efe7f151cd62504b129'
 OR md5(f.prosrc)<>'7cad37450d50b62fa64dd99e11971fa3'
 OR pg_get_userbyid(h.proowner)<>'postgres' OR pg_get_userbyid(f.proowner)<>'postgres'
 OR to_regclass('floor_private.tour_revenue_buy_state_definition_backup_v1') IS NOT NULL THEN
  RAISE EXCEPTION 'tour_revenue_buy_state_dependency_drift_or_collision';END IF;
 hd:=replace(h.definition,chr(13),'');fd:=replace(f.definition,chr(13),'');
 IF cardinality(string_to_array(hd,old_state))<>2
 OR cardinality(string_to_array(fd,old_declare))<>2
 OR cardinality(string_to_array(fd,old_select))<>2
 OR cardinality(string_to_array(fd,old_open))<>2 THEN
  RAISE EXCEPTION 'tour_revenue_buy_state_anchor_drift';END IF;
 CREATE TABLE floor_private.tour_revenue_buy_state_definition_backup_v1(
  signature text PRIMARY KEY,definition text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
 ALTER TABLE floor_private.tour_revenue_buy_state_definition_backup_v1 ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON floor_private.tour_revenue_buy_state_definition_backup_v1 FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.tour_revenue_buy_state_definition_backup_v1(signature,definition)
 VALUES('floor_private.tour_revenue_live_source_v1(uuid)',h.definition),
  ('public.get_tour_revenue_buy_close_v1(uuid)',f.definition);
 EXECUTE replace(hd,old_state,new_state);
 EXECUTE replace(replace(replace(fd,old_declare,new_declare),old_select,new_select),old_open,new_open);
 FOREACH function_oid IN ARRAY ARRAY[h.oid,f.oid] LOOP
  SELECT * INTO STRICT a FROM pg_proc WHERE oid=function_oid;
  IF a.oid=h.oid THEN
   IF a.proacl IS DISTINCT FROM h.proacl OR a.proowner<>h.proowner OR a.prosecdef IS DISTINCT FROM h.prosecdef
    OR a.provolatile IS DISTINCT FROM h.provolatile OR a.proconfig IS DISTINCT FROM h.proconfig THEN
    RAISE EXCEPTION 'tour_revenue_buy_state_helper_metadata_changed';END IF;
  ELSE
   IF a.proacl IS DISTINCT FROM f.proacl OR a.proowner<>f.proowner OR a.prosecdef IS DISTINCT FROM f.prosecdef
    OR a.provolatile IS DISTINCT FROM f.provolatile OR a.proconfig IS DISTINCT FROM f.proconfig THEN
    RAISE EXCEPTION 'tour_revenue_buy_state_reader_metadata_changed';END IF;
  END IF;
 END LOOP;
END $patch$;
COMMIT;
