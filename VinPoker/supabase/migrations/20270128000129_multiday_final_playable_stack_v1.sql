-- LOCAL/SOURCE ONLY. CLI candidate20261016222827, forward slot129.
-- Materialize qualified playable stack, NOT denomination stock or a buy-in.
-- Recovery: suspend seating, forward restore pinned128 writer; preserve facts.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE
 target regprocedure:='public.multi_day_seat_final_v1(uuid,uuid,uuid,integer,integer,uuid)'::regprocedure;
 definition text:=replace(pg_get_functiondef(target),chr(13),'');
 needle text:=$old$ INSERT INTO public.seat_draw_receipts(id,tournament_id,entry_id,player_id,display_name,$old$;
 replacement text:=$new$ INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count)
 VALUES(v_final.id,p_player_id,1,v_stack::integer)
 ON CONFLICT(tournament_id,player_id,entry_number) DO NOTHING;
 PERFORM 1 FROM public.tournament_chip_counts c
 WHERE c.tournament_id=v_final.id AND c.player_id=p_player_id
   AND c.entry_number=1 AND c.chip_count=v_stack FOR UPDATE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'multi_day_final_chip_projection_mismatch' USING ERRCODE='23514';
 END IF;
 INSERT INTO public.seat_draw_receipts(id,tournament_id,entry_id,player_id,display_name,$new$;
BEGIN
 IF current_user<>'postgres' OR md5(definition)<>'8f4757e0b3ae77afd219dd10ab7db348' THEN
   RAISE EXCEPTION 'multiday129_catalog_drift'; END IF;
 IF length(definition)-length(replace(definition,needle,''))<>length(needle) THEN
   RAISE EXCEPTION 'multiday129_anchor_drift'; END IF;
 EXECUTE replace(definition,needle,replacement);
END $patch$;
COMMIT;
