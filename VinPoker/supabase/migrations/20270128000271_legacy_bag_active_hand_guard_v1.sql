-- Close/record share canonical Tracker's tournament-row fence. Historical
-- locked days are not a global play-disable flag; no start-hand policy change.
BEGIN;
DO $$ DECLARE v record; definition text; anchor text;
BEGIN
 FOR v IN SELECT * FROM (VALUES
  ('public.chip_ops_record_bag(uuid,integer,uuid,text,bigint,boolean)','e9902eafee8dd7e62d297a941424b90a'),
  ('public.chip_ops_close_day(uuid,integer,integer,boolean,text)','25c71d3ae0de17f2521627e5fe62d45b')
 ) x(signature,digest) LOOP
  definition:=replace(pg_get_functiondef(to_regprocedure(v.signature)),chr(13),'');
  IF md5(definition) IS DISTINCT FROM v.digest THEN RAISE EXCEPTION 'bag_active_hand_definition_drift: %',v.signature; END IF;
  anchor:='  PERFORM floor_private.lock_chip_bag_day_v1(p_tournament_id,p_day_number);';
  IF cardinality(string_to_array(definition,anchor))<>2 THEN RAISE EXCEPTION 'bag_active_hand_anchor_drift: %',v.signature;END IF;
  definition:=replace(definition,anchor,$guard$
  -- Authorization above precedes acquiring an operational lock. Recheck after
  -- waiting; role revocation must not be bypassed by a queued request.
  PERFORM 1 FROM public.tournaments t
  WHERE t.id=p_tournament_id AND t.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
  IF NOT (COALESCE(public.is_club_owner(v_uid,v_club),false) OR COALESCE(public.is_club_chip_master(v_uid,v_club),false)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;
  IF EXISTS(SELECT 1 FROM public.tournament_hands h WHERE h.tournament_id=p_tournament_id AND h.status='in_progress') THEN
    RETURN jsonb_build_object('error','HAND_IN_PROGRESS');
  END IF;
  PERFORM floor_private.lock_chip_bag_day_v1(p_tournament_id,p_day_number);$guard$);
  EXECUTE definition;
 END LOOP;
END $$;
COMMIT;
