-- CLI candidate20261015215404. Local forward98; production apply not approved.
-- Expose only a generic current-revision attention state, never private errors.
-- Recovery: forward-restore the pinned definition; preserve queue/history/audit.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $repair$
DECLARE target regprocedure:='public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamptz,uuid)'::regprocedure;
 definition text; acl text; config text[]; owner_id oid;
 seam text:=$seam$ELSE jsonb_build_object('status','pending') END AS result$seam$;
 replacement text:=$replacement$WHEN EXISTS (
        SELECT 1 FROM public.tracker_historical_display_queue attention
        WHERE attention.hand_id = p.id AND attention.source_revision = p.source_revision
          AND attention.status = 'needs_attention'
      ) THEN jsonb_build_object('status','needs_attention')
      ELSE jsonb_build_object('status','pending') END AS result$replacement$;
BEGIN
 definition:=replace(pg_get_functiondef(target),chr(13),'');
 IF current_user<>'postgres' OR md5(definition)<>'ce58ef27d2bb7bee89cae93a837ede48'
 OR (length(definition)-length(replace(definition,seam,'')))/length(seam)<>1 THEN
 RAISE EXCEPTION 'public_history98_definition_drift'; END IF;
 SELECT proacl::text,proconfig,proowner INTO acl,config,owner_id FROM pg_proc WHERE oid=target;
 EXECUTE replace(definition,seam,replacement);
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid=target AND (proacl::text IS DISTINCT FROM acl
 OR proconfig IS DISTINCT FROM config OR proowner IS DISTINCT FROM owner_id)) THEN
 RAISE EXCEPTION 'public_history98_metadata_drift'; END IF;
END;
$repair$;
COMMIT;
