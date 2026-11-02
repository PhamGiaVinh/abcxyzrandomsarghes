-- SOURCE/LOCAL ONLY. CLI generated20261016222123; forward catalog slot126.
-- Resolve display from the exact canonical participation, including historical
-- manual seats. No identity inference, backfill, money or ranking changes.
-- Recovery: restore pinned4804052d7f5303a2e869cbf700127f13 helper in a reviewed
-- forward migration. Preserve payments, receipts and display history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'payout126_owner_required'; END IF;
 IF md5(replace(pg_get_functiondef('floor_private.payout_place_context_v1(uuid,integer)'::regprocedure),chr(13),''))
   <>'4804052d7f5303a2e869cbf700127f13' THEN RAISE EXCEPTION 'payout126_context_drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p
   WHERE p.oid=to_regprocedure('floor_private.tournament_entry_display_v1(uuid,uuid,uuid,integer)')
   AND p.prosecdef AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=""']::text[])
 THEN RAISE EXCEPTION 'payout126_display_dependency'; END IF;
END;$$;
CREATE OR REPLACE FUNCTION floor_private.payout_place_context_v1(p_tournament_id uuid, p_finished_place integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
 item public.tournament_entries; amount numeric; recipient uuid; name text;
 context jsonb; n bigint;
BEGIN
 SELECT count(*) INTO n FROM public.tournament_entries
 WHERE tournament_id=p_tournament_id AND finished_place=p_finished_place;
 IF n=0 THEN RETURN jsonb_build_object('ok',false,'error','place_not_finalized'); END IF;
 IF n<>1 THEN RETURN jsonb_build_object('ok',false,'error','place_ambiguous'); END IF;
 SELECT * INTO STRICT item FROM public.tournament_entries
 WHERE tournament_id=p_tournament_id AND finished_place=p_finished_place;
 SELECT count(*),min(tp.amount) INTO n,amount FROM public.tournament_prizes tp
 WHERE tp.tournament_id=p_tournament_id AND tp.position=p_finished_place;
 IF n=0 THEN RETURN jsonb_build_object('ok',false,'error','place_not_in_money'); END IF;
 IF n<>1 OR amount IS NULL OR amount<0 THEN RETURN jsonb_build_object('ok',false,'error','prize_invalid'); END IF;
 recipient:=COALESCE(item.member_id,item.player_id);
 IF recipient IS NULL THEN RETURN jsonb_build_object('ok',false,'error','recipient_missing'); END IF;
 SELECT COALESCE((SELECT NULLIF(btrim(cm.full_name),'') FROM public.club_members cm WHERE cm.id=item.member_id),
   (SELECT NULLIF(btrim(p.display_name),'') FROM public.profiles p WHERE p.user_id=item.player_id),
   NULLIF(btrim(floor_private.tournament_entry_display_v1(item.id,item.player_id,item.tournament_id,item.entry_no)->>'player_name'),''),
   'Khách') INTO name;
 context:=jsonb_build_object('entryId',item.id,'recipientRef',recipient,'recipientName',name,
   'finishedPlace',p_finished_place,'prizeAmount',amount,'tournamentId',p_tournament_id);
 RETURN context||jsonb_build_object('ok',true,'confirmationToken',md5(context::text));
END;
$function$;
COMMIT;
