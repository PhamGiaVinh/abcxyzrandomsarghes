-- Pre-activation rollback only. Once a v2 hand exists, retain its reader and
-- database fence and disable new BBA deals in the producer.
BEGIN;

LOCK TABLE public.online_poker_config IN SHARE MODE NOWAIT;
LOCK TABLE public.online_poker_hands IN ACCESS EXCLUSIVE MODE NOWAIT;

DO $$
BEGIN
  IF public.op_is_enabled() OR EXISTS (
    SELECT 1 FROM public.online_poker_hands WHERE status IN ('dealing','betting')
  ) THEN
    RAISE EXCEPTION 'online poker must be disabled and idle';
  END IF;
  IF EXISTS (SELECT 1 FROM public.online_poker_hands WHERE state_schema_version = 2) THEN
    RAISE EXCEPTION 'version-2 hand history requires the BBA fence and reader';
  END IF;
END;
$$;

DROP TRIGGER trg_op_preserve_bba_hand_state ON public.online_poker_hands;
DROP FUNCTION public.op_preserve_bba_hand_state();

COMMIT;
