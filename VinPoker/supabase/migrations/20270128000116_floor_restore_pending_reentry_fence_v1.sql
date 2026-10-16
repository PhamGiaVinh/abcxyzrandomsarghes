-- CLI candidate20261016095008, catalog116. LOCAL ONLY, NOT RELEASED.
-- Pending re-entry is already a dependent payment intent. Preserve it and
-- require explicit resolution before restoring its busted source entry.
-- Recovery is reviewed forward restoration with restore disabled; do not
-- cancel registrations, refund money or rewrite entry history automatically.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE target regprocedure:='floor_private.restore_busted_player_to_seat(uuid,uuid,integer,bigint,bigint,uuid,uuid)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),'');
 needle text:=$old$  IF EXISTS(SELECT 1 FROM public.tournament_entries later_entry
    WHERE later_entry.tournament_id=v_tournament.id AND later_entry.player_id=v_entry.player_id
      AND later_entry.entry_no>v_entry.entry_no AND later_entry.status<>'cancelled') THEN$old$;
 replacement text;
BEGIN
 IF current_user<>'postgres' OR md5(definition)<>'9918b112e18e6c516b4ffe338eabf83f'
 OR to_regprocedure('public.cashier_create_app_reentry_v1(uuid,uuid)') IS NULL
 OR md5(replace(pg_get_functiondef('public.cashier_create_app_reentry_v1(uuid,uuid)'::regprocedure),chr(13),''))<>'45f01d53a1dc2953f744ab462dba7d86' THEN
  RAISE EXCEPTION 'restore116_catalog_or_dependency_drift';END IF;
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
  RAISE EXCEPTION 'restore116_dependency_anchor_drift';END IF;
 -- Both restore and canonical re-entry creation hold the same tournament lock
 -- before checking/writing participation state. Do not add an inverted row lock.
 replacement:=$new$  IF EXISTS(SELECT 1 FROM public.tournament_registrations reentry
    WHERE reentry.source_entry_id=v_entry.id AND reentry.status IN ('pending','confirmed'))
   OR EXISTS(SELECT 1 FROM public.tournament_entries later_entry
    WHERE later_entry.tournament_id=v_tournament.id AND later_entry.player_id=v_entry.player_id
      AND later_entry.entry_no>v_entry.entry_no AND later_entry.status<>'cancelled') THEN$new$;
 EXECUTE replace(definition,needle,replacement);
END;
$patch$;
COMMIT;
