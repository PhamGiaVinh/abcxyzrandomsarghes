-- Hand withdrawal clears live/replay immediately without invalidating unrelated
-- ranking/payout/clock. Old clients still receive the full visibility hint.
-- Recovery: restore the two captured definitions by guarded forward SQL;
-- preserve queues, source, contributions and the global HUD access watermark.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN
 IF md5(replace(pg_get_functiondef('tracker_analytics_v1.broadcast_withdrawal_v1()'::regprocedure),chr(13),''))<>'80d94877352e8ad4bb86c3ffd6fa9c4e'
 OR md5(replace(pg_get_functiondef('public.flush_public_spectator_broadcast_v2(integer)'::regprocedure),chr(13),''))<>'ef1f388d4fe77907a1133e1f35df6604' THEN
  RAISE EXCEPTION 'HUD hand withdrawal preimage differs';
 END IF;
END $guard$;
DO $rewrite$ DECLARE body text; target text; BEGIN
 body:=replace(pg_get_functiondef('tracker_analytics_v1.broadcast_withdrawal_v1()'::regprocedure),chr(13),'');
 target:='queue_broadcast_v1(row.tournament_id,''visibility'',pg_current_xact_id()::text)';
 IF (length(body)-length(replace(body,target,'')))/length(target)<>1 THEN RAISE EXCEPTION 'hand withdrawal rewrite differs'; END IF;
 EXECUTE replace(body,target,'queue_broadcast_v1(row.tournament_id,''hand_visibility'',pg_current_xact_id()::text)');
 body:=replace(pg_get_functiondef('public.flush_public_spectator_broadcast_v2(integer)'::regprocedure),chr(13),'');
 target:='jsonb_build_object(''tournamentId'',row.tournament_id,''components'',components,''revisions'',revisions)';
 IF (length(body)-length(replace(body,target,'')))/length(target)<>1 THEN RAISE EXCEPTION 'hand broadcast rewrite differs'; END IF;
 -- Keep the old visibility component on the wire for older clients. The extra
 -- boolean is true only when no full-tour withdrawal is in the same batch.
 EXECUTE replace(body,target,$payload$jsonb_build_object('tournamentId',row.tournament_id,
   'components',CASE WHEN components ? 'hand_visibility' THEN
     (SELECT jsonb_agg(DISTINCT CASE WHEN c='hand_visibility' THEN 'visibility' ELSE c END)
      FROM jsonb_array_elements_text(components) c) ELSE components END,
   'revisions',revisions,
   'handVisibilityOnly',(components ? 'hand_visibility') AND NOT (components ? 'visibility')
     AND NOT EXISTS(SELECT 1 FROM spectator_projection_v2.broadcast_pending_v1 pending
       WHERE pending.tournament_id=row.tournament_id AND pending.component='visibility'))$payload$);
END $rewrite$;
COMMIT;
