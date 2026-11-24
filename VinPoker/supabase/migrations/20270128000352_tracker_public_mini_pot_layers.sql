-- Public projection metadata only. No hand, action, stack or settlement writes.
-- Owner-gated follow-up: do not include in the already-approved350/351 run.
-- ROLLBACK: a reviewed forward migration must reverse this exact added key,
-- assert the restored definition hash6269d9fc1b2737f30b56a4bcdb42fb79,
-- preserve metadata and retain frontend aggregate-only compatibility.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $projection$
DECLARE fn record; changed text; after_metadata record;
  anchor constant text := $anchor$'ante', CASE WHEN h.id IS NULL THEN current_level.ante ELSE h.tracker_bba END,$anchor$;
  addition constant text := $addition$
        'bigBlindAnteOnly', CASE WHEN h.id IS NULL THEN NULL ELSE (to_jsonb(h)->>'tracker_big_blind_ante_only')::boolean END,$addition$;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'mini_pot_projection_owner_required'; END IF;
  SELECT p.*, replace(pg_get_functiondef(p.oid),chr(13),'') AS definition INTO STRICT fn
  FROM pg_proc p WHERE p.oid='public.get_public_spectator_projection_source_v2(uuid,text,uuid)'::regprocedure;
  IF md5(fn.definition)<>'6269d9fc1b2737f30b56a4bcdb42fb79'
    OR fn.proowner<>(SELECT oid FROM pg_roles WHERE rolname='postgres')
    OR NOT fn.prosecdef OR fn.provolatile<>'s'
    OR array_length(string_to_array(fn.definition,anchor),1)<>2
  THEN RAISE EXCEPTION 'mini_pot_projection_preimage_drift'; END IF;
  changed := replace(fn.definition,anchor,anchor || addition);
  EXECUTE changed;
  SELECT p.proowner,p.proacl,p.prosecdef,p.provolatile,p.proconfig INTO STRICT after_metadata
  FROM pg_proc p WHERE p.oid=fn.oid;
  IF ROW(after_metadata.proowner,after_metadata.proacl,after_metadata.prosecdef,after_metadata.provolatile,after_metadata.proconfig)
    IS DISTINCT FROM ROW(fn.proowner,fn.proacl,fn.prosecdef,fn.provolatile,fn.proconfig)
  THEN RAISE EXCEPTION 'mini_pot_projection_metadata_drift'; END IF;
END
$projection$;
COMMIT;
