-- Preserve membership across sparse/physically grouped source participants.
-- Explicit LIMIT1 keyset reads avoid EXISTS choosing a sequential startup plan.
-- Invalid parent/tour candidates are skipped, never accepted or truncated.
-- Rollback: tests/publicHud/identity-keyset.forward-rollback.sql.
BEGIN;
DO $$ BEGIN
 IF md5(replace(pg_get_functiondef('tracker_analytics_v1.public_context(uuid,uuid)'::regprocedure),chr(13),''))<>'d72e037647d90f1470ae73c47ac4f8ad' THEN RAISE EXCEPTION 'HUD identity keyset preimage differs';END IF;
END $$;
CREATE OR REPLACE FUNCTION tracker_analytics_v1.public_context(p_tournament uuid,p_player uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE ranking jsonb; identity jsonb; candidate_hand uuid; previous_hand uuid;
BEGIN
  -- Same public tournament gate as the existing viewer snapshot. An operator
  -- bearer never widens this projection's anonymous/public scope.
  IF NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id=p_tournament AND deleted_at IS NULL) THEN RETURN NULL; END IF;
  SELECT p.payload INTO ranking FROM spectator_projection_v2.publications p
    WHERE p.tournament_id=p_tournament AND p.component='ranking';
  SELECT r INTO identity FROM jsonb_array_elements(coalesce(ranking->'items','[]'::jsonb)) r WHERE r->>'playerId'=p_player::text LIMIT 1;
  IF identity IS NULL THEN
    LOOP
      IF previous_hand IS NULL THEN
        SELECT hp.hand_id INTO candidate_hand FROM public.hand_players hp
          WHERE hp.player_id=p_player AND hp.tournament_id=p_tournament AND hp.hand_id IS NOT NULL
          ORDER BY hp.hand_id LIMIT 1;
      ELSE
        SELECT hp.hand_id INTO candidate_hand FROM public.hand_players hp
          WHERE hp.player_id=p_player AND hp.tournament_id=p_tournament AND hp.hand_id>previous_hand
          ORDER BY hp.hand_id LIMIT 1;
      END IF;
      IF candidate_hand IS NULL THEN RETURN NULL; END IF;
      IF EXISTS(SELECT 1 FROM public.tournament_hands h WHERE h.id=candidate_hand AND h.tournament_id=p_tournament) THEN EXIT; END IF;
      previous_hand:=candidate_hand;
    END LOOP;
    SELECT jsonb_build_object('name',hp.player_name,'avatarUrl',hp.avatar_url) INTO identity
      FROM tracker_analytics_v1.hand_contributions c JOIN public.hand_players hp ON hp.hand_id=c.hand_id AND hp.player_id=c.player_id
      WHERE c.player_id=p_player AND c.tournament_id=p_tournament
      ORDER BY c.played_at DESC NULLS LAST,c.hand_id DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object('name',coalesce(identity->>'name','Người chơi'),'avatarUrl',identity->'avatarUrl');
END $$;
COMMIT;
