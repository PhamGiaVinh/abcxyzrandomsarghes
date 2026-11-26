-- DRAFT paired with350, the frozen-rule Edge/frontend readers and settlement.
-- Allocate after350; Supabase CLI generated the initial empty file.
-- Rollback: stop new hands; retain350 rules/receipts for in-progress hands.
-- Restore ONLY the saved snapshot function through a reviewed forward migration
-- to stop new cohorts. Retain these validators/readers for every already-started
-- or completed new-rule hand. Never reset its rule or discard ante records.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE TABLE floor_private.tracker_bb_ante_originals351(
 signature text PRIMARY KEY,definition text NOT NULL,original_hash text NOT NULL
);
ALTER TABLE floor_private.tracker_bb_ante_originals351 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.tracker_bb_ante_originals351 FROM PUBLIC,anon,authenticated,service_role;

-- Reuse the existing layer validator with only the BB's dead ante removed.
-- The same ante is removed from the supplied main pot, never from a side pot.
CREATE FUNCTION floor_private.tracker_manual_pots_match350(p_actions jsonb,p_pots jsonb,p_total integer,p_bb uuid)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $fn$
DECLARE ante numeric; wagers jsonb; pots jsonb;
BEGIN
 IF p_bb IS NULL OR jsonb_typeof(p_actions)<>'array' OR jsonb_typeof(p_pots)<>'array' THEN RETURN false;END IF;
 SELECT coalesce(sum(greatest(trunc((a->>'action_amount')::numeric),0)),0) INTO ante
 FROM jsonb_array_elements(p_actions)a WHERE a->>'player_id'=p_bb::text AND a->>'action_type'='post_ante';
 SELECT coalesce(jsonb_agg(a),'[]'::jsonb) INTO wagers FROM jsonb_array_elements(p_actions)a
 WHERE NOT (a->>'player_id'=p_bb::text AND a->>'action_type'='post_ante');
 IF ante>0 AND (jsonb_array_length(p_pots)=0 OR (p_pots->0->>'amount')::numeric<ante) THEN RETURN false;END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY n),'[]'::jsonb) INTO pots FROM (
  SELECT CASE WHEN n=1 THEN jsonb_set(p,'{amount}',to_jsonb((p->>'amount')::numeric-ante)) ELSE p END value,n
  FROM jsonb_array_elements(p_pots) WITH ORDINALITY q(p,n)
 ) adjusted WHERE (value->>'amount')::numeric>0;
 RETURN floor_private.tracker_manual_pots_match_v1(wagers,pots,(p_total-ante)::integer);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN false;
END $fn$;
REVOKE ALL ON FUNCTION floor_private.tracker_manual_pots_match350(jsonb,jsonb,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $payout$
DECLARE definition text;anchor text:=$anchor$IN('bet','raise','call','all_in','post_sb','post_bb','post_ante') THEN$anchor$;
BEGIN
 definition:=replace(pg_get_functiondef('floor_private.tracker_manual_payouts_match_v1(jsonb,jsonb,jsonb)'::regprocedure),chr(13),'');
 IF md5(definition)<>'480840b3cbf7fdea6ae98e3ee3d475e7'
  OR array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'tracker_ante_payout_dependency_drift';END IF;
 definition:=replace(definition,'tracker_manual_payouts_match_v1(','tracker_manual_payouts_match350(');
 definition:=replace(definition,'p_pots jsonb)','p_pots jsonb, p_bb uuid)');
 -- Only the refund ranking changes; gross commitments still debit each stack.
 definition:=replace(definition,anchor,
  $replacement$IN('bet','raise','call','all_in','post_sb','post_bb','post_ante') AND NOT (a->>'player_id'=p_bb::text AND a->>'action_type'='post_ante') THEN$replacement$);
 EXECUTE definition;
END $payout$;
REVOKE ALL ON FUNCTION floor_private.tracker_manual_payouts_match350(jsonb,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;

DO $finish$
DECLARE signature regprocedure:='public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,uuid)'::regprocedure;
 definition text;checks text:=$checks$  IF NOT floor_private.tracker_manual_pots_match_v1(p_actions,COALESCE(p_side_pots,'[]'::jsonb),COALESCE(p_pot_size,0)) THEN
    RETURN jsonb_build_object('ok',false,'error','SIDE_POTS_TAMPERED');
  END IF;
  IF NOT floor_private.tracker_manual_payouts_match_v1(p_actions,p_players,COALESCE(p_side_pots,'[]'::jsonb)) THEN
    RETURN jsonb_build_object('ok',false,'error','PAYOUT_POTS_MISMATCH');
  END IF;$checks$;
 lock_anchor text:='  PERFORM 1 FROM public.hand_players hp WHERE hp.hand_id = v_hand.id FOR UPDATE;';
 replacement text;old_acl aclitem[];old_owner oid;
BEGIN
 SELECT proacl,proowner INTO old_acl,old_owner FROM pg_proc WHERE oid=signature;
 definition:=replace(pg_get_functiondef(signature),chr(13),'');
 IF md5(definition)<>'62ed37150e497f2d17eabfb305df245b'
  OR array_length(string_to_array(definition,checks),1)<>2
  OR array_length(string_to_array(definition,lock_anchor),1)<>2
  OR array_length(string_to_array(definition,'  v_hand RECORD;'),1)<>2
 THEN RAISE EXCEPTION 'tracker_ante_finish_dependency_drift';END IF;
 INSERT INTO floor_private.tracker_bb_ante_originals351 VALUES(signature::text,definition,md5(definition));
 definition:=replace(replace(definition,checks,''),'  v_hand RECORD;','  v_hand RECORD;'||chr(10)||'  v_bb_ante_payer UUID;');
 replacement:=lock_anchor||$new$
  IF v_hand.tracker_big_blind_ante_only THEN
    SELECT hp.player_id INTO STRICT v_bb_ante_payer FROM public.hand_players hp
    WHERE hp.hand_id=v_hand.id AND hp.seat_number=v_hand.tracker_bb_position;
    IF NOT floor_private.tracker_manual_pots_match350(p_actions,COALESCE(p_side_pots,'[]'::jsonb),COALESCE(p_pot_size,0),v_bb_ante_payer) THEN
      RETURN jsonb_build_object('ok',false,'error','SIDE_POTS_TAMPERED');
    END IF;
    IF NOT floor_private.tracker_manual_payouts_match350(p_actions,p_players,COALESCE(p_side_pots,'[]'::jsonb),v_bb_ante_payer) THEN
      RETURN jsonb_build_object('ok',false,'error','PAYOUT_POTS_MISMATCH');
    END IF;
  ELSE
$new$||checks||chr(10)||'  END IF;';
 EXECUTE replace(definition,lock_anchor,replacement);
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid=signature AND (proacl IS DISTINCT FROM old_acl OR proowner IS DISTINCT FROM old_owner)) THEN
  RAISE EXCEPTION 'tracker_ante_finish_privilege_changed';END IF;
END $finish$;

-- The existing access/card visibility checks and current-table callers remain
-- inside the exact original getter. Add only the frozen display rule.
DO $reader$
DECLARE signature regprocedure:='public.get_public_tournament_hand_v2(uuid,uuid)'::regprocedure;
 definition text;anchor text:=$anchor$'ante',h.tracker_bba$anchor$;old_acl aclitem[];
BEGIN
 SELECT proacl INTO old_acl FROM pg_proc WHERE oid=signature;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=signature AND proowner='postgres'::regrole
  AND prosecdef AND prorettype='jsonb'::regtype AND provolatile='s') THEN
  RAISE EXCEPTION 'tracker_ante_public_reader_authority_drift';END IF;
 definition:=replace(pg_get_functiondef(signature),chr(13),'');
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'tracker_ante_public_reader_dependency_drift';END IF;
 INSERT INTO floor_private.tracker_bb_ante_originals351 VALUES(signature::text,definition,md5(definition));
 EXECUTE replace(definition,anchor,anchor||$new$,'bigBlindAnteOnly',h.tracker_big_blind_ante_only$new$);
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid=signature AND proacl IS DISTINCT FROM old_acl) THEN
  RAISE EXCEPTION 'tracker_ante_public_privilege_changed';END IF;
END $reader$;

-- A completed-hand correction rewrites the action stream. It may preserve the
-- already-confirmed forced posts, never change them or create another batch.
DO $correction$
DECLARE signature regprocedure:='public.commit_tournament_settlement_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure;
 definition text;old_acl aclitem[];old_owner oid;
 delete_anchor text:='    DELETE FROM public.hand_actions WHERE hand_id = p_hand_id;';
 changes_anchor text:=$anchor$  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_hand_changes, '[]'::jsonb)) LOOP$anchor$;
BEGIN
 SELECT proacl,proowner INTO old_acl,old_owner FROM pg_proc WHERE oid=signature;
 definition:=replace(pg_get_functiondef(signature),chr(13),'');
 IF md5(definition)<>'b6a5e93807c3ca7117506639536562ad'
  OR array_length(string_to_array(definition,delete_anchor),1)<>2
  OR array_length(string_to_array(definition,changes_anchor),1)<>2
  OR array_length(string_to_array(definition,'  v_item jsonb;'),1)<>2 THEN
  RAISE EXCEPTION 'tracker_ante_correction_dependency_drift';END IF;
 INSERT INTO floor_private.tracker_bb_ante_originals351 VALUES(signature::text,definition,md5(definition));
 definition:=replace(definition,'  v_item jsonb;',$new$  v_item jsonb;
  v_bba_prior_batch text := current_setting('vinpoker.blind_batch_hand',true);$new$);
 definition:=replace(definition,delete_anchor,$new$    IF v_hand.tracker_big_blind_ante_only THEN
      IF (SELECT coalesce(jsonb_agg(jsonb_build_object('player_id',a.player_id,'entry_number',a.entry_number,
        'street',a.street,'action_type',a.action_type,'action_amount',a.action_amount,'action_order',a.action_order)
        ORDER BY a.action_order),'[]'::jsonb) FROM public.hand_actions a WHERE a.hand_id=p_hand_id
        AND a.action_type IN('post_sb','post_bb','post_ante')) IS DISTINCT FROM
       (SELECT coalesce(jsonb_agg(jsonb_build_object('player_id',(a->>'player_id')::uuid,
        'entry_number',coalesce((a->>'entry_number')::integer,1),'street',coalesce(a->>'street','preflop'),
        'action_type',a->>'action_type','action_amount',coalesce((a->>'action_amount')::numeric,0),
        'action_order',(a->>'action_order')::integer) ORDER BY (a->>'action_order')::integer),'[]'::jsonb)
        FROM jsonb_array_elements(p_edit->'actions') a WHERE a->>'action_type' IN('post_sb','post_bb','post_ante')) THEN
        RAISE EXCEPTION 'tracker_blind_correction_requires_frozen_posts';
      END IF;
      PERFORM set_config('vinpoker.blind_batch_hand',p_hand_id::text,true);
    END IF;
$new$||delete_anchor);
 definition:=replace(definition,changes_anchor,
  $new$  PERFORM set_config('vinpoker.blind_batch_hand',coalesce(v_bba_prior_batch,''),true);
$new$||changes_anchor);
 EXECUTE definition;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid=signature AND (proacl IS DISTINCT FROM old_acl OR proowner IS DISTINCT FROM old_owner)) THEN
  RAISE EXCEPTION 'tracker_ante_correction_privilege_changed';END IF;
END $correction$;

-- Activate last, in this same transaction.350 by itself leaves the old frozen
-- rule intact; no new hand can see a half-installed settlement package.
DO $freeze$
DECLARE signature regprocedure:='floor_private.snapshot_tracker_hand_blinds()'::regprocedure;
 definition text;anchor text:='  NEW.tracker_bba := v_level.ante;';old_acl aclitem[];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=signature AND proowner='postgres'::regrole AND prosecdef) THEN
  RAISE EXCEPTION 'tracker_bba_snapshot_authority_mismatch';END IF;
 SELECT proacl INTO old_acl FROM pg_proc WHERE oid=signature;
 definition:=replace(pg_get_functiondef(signature),chr(13),'');
 IF array_length(string_to_array(definition,anchor),1)<>2 THEN RAISE EXCEPTION 'tracker_bba_snapshot_dependency_drift';END IF;
 INSERT INTO floor_private.tracker_bb_ante_originals351 VALUES(signature::text,definition,md5(definition));
 EXECUTE replace(definition,anchor,'  NEW.tracker_bba := v_level.big_blind;'||chr(10)||'  NEW.tracker_big_blind_ante_only := true;');
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid=signature AND proacl IS DISTINCT FROM old_acl) THEN
  RAISE EXCEPTION 'tracker_bba_snapshot_privilege_changed';END IF;
END $freeze$;
COMMIT;
