-- Local qualification or separately owner-approved forward rollback only.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $rollback$
DECLARE fn record; changed text;
  addition constant text := $addition$
        'bigBlindAnteOnly', CASE WHEN h.id IS NULL THEN NULL ELSE (to_jsonb(h)->>'tracker_big_blind_ante_only')::boolean END,$addition$;
BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'mini_pot_rollback_owner_required'; END IF;
  SELECT p.*,replace(pg_get_functiondef(p.oid),chr(13),'') definition INTO STRICT fn
    FROM pg_proc p WHERE p.oid='public.get_public_spectator_projection_source_v2(uuid,text,uuid)'::regprocedure;
  IF md5(fn.definition)<>'8fa555adb0cb5f8c34a65d9ca5750893'
    OR fn.proowner<>(SELECT oid FROM pg_roles WHERE rolname='postgres')
  THEN RAISE EXCEPTION 'mini_pot_rollback_preimage_drift'; END IF;
  changed:=replace(fn.definition,addition,'');
  EXECUTE changed;
  IF md5(replace(pg_get_functiondef(fn.oid),chr(13),''))<>'6269d9fc1b2737f30b56a4bcdb42fb79'
    OR EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn.oid AND
      ROW(p.proowner,p.proacl,p.prosecdef,p.provolatile,p.proconfig)
      IS DISTINCT FROM ROW(fn.proowner,fn.proacl,fn.prosecdef,fn.provolatile,fn.proconfig))
  THEN RAISE EXCEPTION 'mini_pot_rollback_postcheck_failed'; END IF;
END $rollback$;
COMMIT;
