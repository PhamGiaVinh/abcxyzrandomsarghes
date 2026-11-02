-- Exact already browser-finished/worker-verified hand; no fixture rewrite.
BEGIN;
SET LOCAL statement_timeout='10s';
GRANT USAGE ON SCHEMA auth TO authenticated;
DO $$
BEGIN
  ASSERT current_database()='vinpoker_ops_cash115_qualified_c';
  ASSERT EXISTS(SELECT 1 FROM public.tournament_hands h JOIN public.tournament_settlement_outcomes o ON o.hand_id=h.id
    AND o.source_revision=h.source_revision AND o.status='verified' AND o.verification_scope='historical_display'
    WHERE h.id='83d02eb2-8f65-4172-a94f-fa34c322e271' AND h.tournament_id='829e61fe-0ac8-4ced-950d-ab76cb8dadc5'
      AND h.status='completed' AND h.source_revision>1),'exact verified source required';
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a364de8e-06b1-4428-a20d-ac614ec406e5',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"a364de8e-06b1-4428-a20d-ac614ec406e5"}',true);
DO $$
DECLARE original bigint;changed int;
BEGIN
  SELECT source_revision INTO STRICT original FROM public.tournament_hands WHERE id='83d02eb2-8f65-4172-a94f-fa34c322e271';
  BEGIN
    UPDATE public.tournament_hands SET source_revision=original-1 WHERE id='83d02eb2-8f65-4172-a94f-fa34c322e271';
    GET DIAGNOSTICS changed=ROW_COUNT;
    ASSERT changed=1,'actor UPDATE did not reach source fence';
    RAISE EXCEPTION 'HISTORY_REVISION_ROLLBACK_ALLOWED';
  EXCEPTION WHEN check_violation THEN NULL;END;
  ASSERT (SELECT source_revision FROM public.tournament_hands WHERE id='83d02eb2-8f65-4172-a94f-fa34c322e271')=original;
  UPDATE public.tournament_hands SET source_revision=original+1 WHERE id='83d02eb2-8f65-4172-a94f-fa34c322e271';
  ASSERT (SELECT source_revision FROM public.tournament_hands WHERE id='83d02eb2-8f65-4172-a94f-fa34c322e271')=original+1,'legitimate revision advance blocked';
END $$;
RESET ROLE;
DO $$
BEGIN
  ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_settlement_outcomes WHERE hand_id='83d02eb2-8f65-4172-a94f-fa34c322e271' AND status='verified'),'advance retained verified proof';
  ASSERT EXISTS(SELECT 1 FROM public.tracker_historical_display_queue q JOIN public.tournament_hands h
    ON h.id=q.hand_id AND h.source_revision=q.source_revision WHERE h.id='83d02eb2-8f65-4172-a94f-fa34c322e271'
    AND q.status='pending'),'advance did not enqueue current generation';
END $$;
ROLLBACK;
