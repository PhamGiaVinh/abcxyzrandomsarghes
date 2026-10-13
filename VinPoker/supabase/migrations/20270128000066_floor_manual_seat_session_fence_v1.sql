-- Manual participation and seating are one server-authoritative transaction.
-- CLI-generated candidate promoted to unused forward catalog66 after source/live
-- reservation checks. No money, issuance, bank, payroll or notification writes.
-- ROLLBACK: forward revoke new APIs and hide the client action. Keep entries,
-- seats, projections and receipts. Do not restore the unfenced legacy writer.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $preflight$
DECLARE r record;
BEGIN
 IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN ('floor_add_manual_player_v1','get_floor_manual_player_receipt_v1')) THEN
   RAISE EXCEPTION 'manual_player_existing_api_drift';
 END IF;
 FOR r IN SELECT * FROM (VALUES
  ('public.floor_assign_player_to_seat(uuid,text,uuid,integer)','f2ec2a8807352462bb1b56f6a6e091ac','search_path=public'),
  ('public.floor_assign_entry_to_seat(uuid,uuid,integer,bigint,uuid)','d7aa29ca2c6b01f3aa3d03b28ce6930b','search_path=""'),
  ('floor_private.floor_table_v3_actor_is_tournament_operator(uuid,uuid)','6da977cdcf751746189b2b46a2a563e5','search_path=""'),
  ('floor_private.floor_table_v3_has_active_hand(uuid,uuid,uuid)','0e0c4427e79013d66330e7ddda414933','search_path=""'),
  ('floor_private.floor_table_v3_lock_receipt(uuid,text,uuid)','7c836d507cbbb1304e3e42dec3ac5b6b','search_path=""'),
  ('floor_private.floor_table_v3_existing_receipt(uuid,text,uuid)','db9fb6c36971b3d83c74b5033a52523e','search_path=""'),
  ('floor_private.floor_table_v3_save_receipt(uuid,text,uuid,text,jsonb)','8af55a87091f15551acff90adce68040','search_path=""')
 ) x(signature,digest,path) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(r.signature)
    AND md5(replace(p.prosrc,chr(13),''))=r.digest AND pg_get_userbyid(p.proowner)='postgres'
    AND p.prosecdef AND p.proconfig=ARRAY[r.path]::text[]) THEN
    RAISE EXCEPTION 'manual_player_dependency_drift: %',r.signature;
  END IF;
 END LOOP;
END $preflight$;

CREATE FUNCTION public.floor_add_manual_player_v1(
 p_tournament_id uuid,p_player_name text,p_tournament_table_id uuid,p_seat_number integer,
 p_table_session_id uuid,p_expected_revision bigint,p_expected_control_epoch bigint,
 p_request_id uuid,p_expected_actor_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
 actor uuid:=auth.uid(); operation constant text:='floor_add_manual_player_v1';
 tour public.tournaments%ROWTYPE; tt public.tournament_tables%ROWTYPE;
 sess public.table_sessions%ROWTYPE; physical uuid; receipt record;
 payload jsonb; result jsonb; entry_uuid uuid; player_uuid uuid; inner_key uuid;
 name text:=nullif(pg_catalog.btrim(p_player_name),''); ticket text; ticket_id uuid;
 attempts integer:=0;
BEGIN
 IF actor IS NULL THEN RETURN jsonb_build_object('ok',false,'error','unauthorized'); END IF;
 IF actor IS DISTINCT FROM p_expected_actor_id THEN RETURN jsonb_build_object('ok',false,'error','ACTOR_CHANGED'); END IF;
 IF p_tournament_id IS NULL OR p_tournament_table_id IS NULL OR p_table_session_id IS NULL
   OR p_expected_revision IS NULL OR p_expected_control_epoch IS NULL OR p_request_id IS NULL
   OR p_seat_number IS NULL OR name IS NULL OR length(name) NOT BETWEEN 2 AND 100
   OR p_expected_revision<0 OR p_expected_control_epoch<0 THEN
   RETURN jsonb_build_object('ok',false,'error','invalid_request');
 END IF;
 SELECT * INTO tour FROM public.tournaments WHERE id=p_tournament_id;
 IF NOT FOUND OR floor_private.floor_table_v3_actor_is_tournament_operator(actor,tour.club_id) IS DISTINCT FROM true THEN
   RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
 END IF;
 payload:=jsonb_build_object('tournament_id',p_tournament_id,'player_name',name,
   'tournament_table_id',p_tournament_table_id,'seat_number',p_seat_number,
   'table_session_id',p_table_session_id,'expected_revision',p_expected_revision,
   'expected_control_epoch',p_expected_control_epoch);
 PERFORM floor_private.floor_table_v3_lock_receipt(actor,operation,p_request_id);
 -- Recheck after the receipt wait, including read/replay authority.
 IF floor_private.floor_table_v3_actor_is_tournament_operator(actor,tour.club_id) IS DISTINCT FROM true THEN
   RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
 END IF;
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,operation,p_request_id);
 IF FOUND THEN
   IF receipt.request_fingerprint IS DISTINCT FROM payload::text THEN
     RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
   END IF;
   RETURN receipt.result;
 END IF;
 -- Same lock order as the canonical Floor core: tournament, physical asset,
 -- exact session, tournament table. No inference from the latest physical session.
 SELECT * INTO tour FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 IF floor_private.floor_table_v3_actor_is_tournament_operator(actor,tour.club_id) IS DISTINCT FROM true THEN
   RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
 END IF;
 IF tour.deleted_at IS NOT NULL OR tour.status IN ('completed','cancelled')
   OR public.is_tournament_registration_closed(tour.id) THEN
   result:=jsonb_build_object('ok',false,'error','tournament_not_open');
 ELSE
   SELECT game_table_id INTO physical FROM public.tournament_tables
     WHERE id=p_tournament_table_id AND tournament_id=tour.id;
   PERFORM 1 FROM public.game_tables WHERE id=physical AND club_id=tour.club_id FOR UPDATE;
   IF NOT FOUND THEN result:=jsonb_build_object('ok',false,'error','invalid_destination_table');
   ELSE
     SELECT * INTO sess FROM public.table_sessions WHERE id=p_table_session_id
       AND game_table_id=physical AND club_id=tour.club_id AND tournament_id=tour.id
       AND session_type='tournament' AND closed_at IS NULL FOR UPDATE;
     IF NOT FOUND THEN result:=jsonb_build_object('ok',false,'error','table_session_mismatch');
     ELSE
       SELECT * INTO tt FROM public.tournament_tables WHERE id=p_tournament_table_id
         AND tournament_id=tour.id AND game_table_id=physical
         AND table_session_id=sess.id AND status='active' FOR UPDATE;
       IF NOT FOUND THEN result:=jsonb_build_object('ok',false,'error','table_session_mismatch');
       ELSIF sess.revision IS DISTINCT FROM p_expected_revision
         OR sess.control_epoch IS DISTINCT FROM p_expected_control_epoch THEN
         result:=jsonb_build_object('ok',false,'error','STALE_STATE');
       ELSIF tt.max_seats NOT IN (8,9) OR p_seat_number NOT BETWEEN 1 AND tt.max_seats THEN
         result:=jsonb_build_object('ok',false,'error','invalid_seat_number');
       ELSIF EXISTS(SELECT 1 FROM public.table_session_seat_locks l
         WHERE l.table_session_id=sess.id AND l.seat_number=p_seat_number AND l.unlocked_at IS NULL) THEN
         result:=jsonb_build_object('ok',false,'error','seat_locked');
       ELSIF floor_private.floor_table_v3_has_active_hand(tour.id,tt.id,sess.id) THEN
         result:=jsonb_build_object('ok',false,'error','table_has_active_hand');
       ELSIF tour.starting_stack IS NULL OR tour.starting_stack<=0 THEN
         result:=jsonb_build_object('ok',false,'error','starting_stack_missing');
       ELSE
         -- Revalidate authority after every context lock before any writes.
         IF floor_private.floor_table_v3_actor_is_tournament_operator(actor,tour.club_id) IS DISTINCT FROM true THEN
           RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
         END IF;
         BEGIN
           player_uuid:=gen_random_uuid();
           INSERT INTO public.tournament_entries(tournament_id,registration_id,player_id,entry_no,
             source,status,current_stack)
           VALUES(tour.id,NULL,player_uuid,1,'manual','registered',tour.starting_stack)
           RETURNING id INTO entry_uuid;
           -- Reuse the canonical tuple/projection/CAS writer after the same
           -- capacity/seat-lock checks as v4, without v4's reversed session lock.
           -- The internal core mutex must not reuse a client-known outer key:
           -- a direct-core caller could hold it while waiting on this tour lock.
           -- Only the outer operation is a public retry/reconciliation identity.
           inner_key:=gen_random_uuid();
           result:=public.floor_assign_entry_to_seat(entry_uuid,tt.id,p_seat_number,p_expected_revision,inner_key);
           IF result->>'ok' IS DISTINCT FROM 'true' THEN
             RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='manual_player_core_rejected';
           END IF;
           UPDATE public.tournament_seats SET player_name=name WHERE id=(result->>'seat_id')::uuid;
           UPDATE public.tournament_entries SET table_id=physical,seat_id=(result->>'seat_id')::uuid,
             seat_number=p_seat_number WHERE id=entry_uuid;
           LOOP
             attempts:=attempts+1;
             ticket:=format('T%s-S%s-%s',tt.table_number,p_seat_number,
               upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)));
             BEGIN
               INSERT INTO public.seat_draw_receipts(tournament_id,registration_id,entry_id,player_id,
                 display_name,table_id,table_number,seat_id,seat_number,receipt_code,
                 qr_payload,draw_type,status,issued_by)
               VALUES(tour.id,NULL,entry_uuid,player_uuid,name,physical,tt.table_number,
                 (result->>'seat_id')::uuid,p_seat_number,ticket,
                 jsonb_build_object('v',1,'receipt_code',ticket,'entry_id',entry_uuid,
                   'tournament_id',tour.id,'player_id',player_uuid,'table_number',tt.table_number,
                   'seat_number',p_seat_number,'source','floor'), 'initial','issued',actor)
               RETURNING id INTO ticket_id;
               EXIT;
             EXCEPTION WHEN unique_violation THEN
               IF attempts>=5 THEN RAISE; END IF;
             END;
           END LOOP;
           INSERT INTO public.seat_assignment_history(tournament_id,entry_id,player_id,to_table_id,
             to_table_number,to_seat_number,reason,draw_type,actor_user_id,metadata)
           VALUES(tour.id,entry_uuid,player_uuid,physical,tt.table_number,p_seat_number,
             'floor_seat_add','initial',actor,jsonb_build_object('source','floor','money',false,
               'tournament_table_id',tt.id,'table_session_id',sess.id,'control_epoch',sess.control_epoch,
               'request_id',p_request_id));
           result:=result||jsonb_build_object('receipt_id',ticket_id,'receipt_code',ticket,
             'display_name',name,'starting_stack',tour.starting_stack,'table_number',tt.table_number,
             'control_epoch',sess.control_epoch);
         EXCEPTION WHEN SQLSTATE 'P0001' THEN
           -- Roll back the new entry AND any partial nested projection on a
           -- business rejection. Unexpected errors abort, never become success.
           IF SQLERRM<>'manual_player_core_rejected' THEN RAISE; END IF;
         END;
       END IF;
     END IF;
   END IF;
 END IF;
 result:=result||jsonb_build_object('actor_id',actor,'request_id',p_request_id,'payload',payload);
 PERFORM floor_private.floor_table_v3_save_receipt(actor,operation,p_request_id,payload::text,result);
 RETURN result;
END $$;
ALTER FUNCTION public.floor_add_manual_player_v1(uuid,text,uuid,integer,uuid,bigint,bigint,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.floor_add_manual_player_v1(uuid,text,uuid,integer,uuid,bigint,bigint,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.floor_add_manual_player_v1(uuid,text,uuid,integer,uuid,bigint,bigint,uuid,uuid) TO authenticated;

-- Reader reconciles unknown responses using the actor-scoped immutable receipt.
-- A missing receipt is not evidence of failure; replay only the exact original intent.
CREATE FUNCTION public.get_floor_manual_player_receipt_v1(
 p_tournament_id uuid,p_request_id uuid,p_expected_actor_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE actor uuid:=auth.uid(); club uuid; receipt record;
BEGIN
 IF actor IS NULL THEN RETURN jsonb_build_object('ok',false,'error','unauthorized'); END IF;
 IF actor IS DISTINCT FROM p_expected_actor_id THEN RETURN jsonb_build_object('ok',false,'error','ACTOR_CHANGED'); END IF;
 IF p_tournament_id IS NULL OR p_request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','invalid_request'); END IF;
 SELECT club_id INTO club FROM public.tournaments WHERE id=p_tournament_id;
 IF floor_private.floor_table_v3_actor_is_tournament_operator(actor,club) IS DISTINCT FROM true THEN
   RETURN jsonb_build_object('ok',false,'error','actor_not_allowed');
 END IF;
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'floor_add_manual_player_v1',p_request_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',true,'status','not_found'); END IF;
 IF receipt.result->'payload'->>'tournament_id' IS DISTINCT FROM p_tournament_id::text THEN
   RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
 END IF;
 RETURN jsonb_build_object('ok',true,'status','resolved','result',receipt.result);
END $$;
ALTER FUNCTION public.get_floor_manual_player_receipt_v1(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_floor_manual_player_receipt_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_floor_manual_player_receipt_v1(uuid,uuid,uuid) TO authenticated;

-- The legacy four-argument seam cannot carry incarnation, CAS or a durable key.
-- Retire its mutation behavior rather than infer current authority for stale tabs.
CREATE OR REPLACE FUNCTION public.floor_assign_player_to_seat(
 p_tournament_id uuid,p_player_name text,p_tournament_table_id uuid,p_seat_number integer
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $$ SELECT jsonb_build_object('ok',false,'error','EXACT_SESSION_REQUIRED',
  'remediation','floor_add_manual_player_v1') $$;
ALTER FUNCTION public.floor_assign_player_to_seat(uuid,text,uuid,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.floor_assign_player_to_seat(uuid,text,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.floor_assign_player_to_seat(uuid,text,uuid,integer) TO authenticated;
COMMIT;
