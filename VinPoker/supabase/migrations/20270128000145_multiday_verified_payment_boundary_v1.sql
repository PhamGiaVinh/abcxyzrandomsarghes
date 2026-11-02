-- CLI candidate20261018120547; local forward145, NOT LIVE.
-- Qualified append-only payments retain their actual place/recipient, including
-- top-ups after approved reversals. Ordinary once-per-place uniqueness remains.
-- This boundary alone exposes NO payment writer and moves NO money.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF current_user<>'postgres'
 OR pg_get_indexdef('public.uq_prize_paid_once'::regclass)<>
  'CREATE UNIQUE INDEX uq_prize_paid_once ON public.tournament_prize_payments USING btree (tournament_id, finished_place) WHERE (status = ''paid''::text)'
 OR (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='private.multi_day_legacy_payout_hold_v1()'::regprocedure)<>'df354384f3db43b4e5c6dd8e3f555ba8'
 THEN RAISE EXCEPTION 'multiday145_dependency_drift';END IF;
END $$;
ALTER TABLE public.tournament_prize_payments ADD COLUMN multi_day_participation_id uuid
 REFERENCES public.multi_day_final_participations_v1(id);
CREATE TABLE private.multi_day_payment_commits_v1 (
 payment_id uuid PRIMARY KEY REFERENCES public.tournament_prize_payments(id) DEFERRABLE INITIALLY DEFERRED,
 event_id uuid NOT NULL REFERENCES public.multi_day_payout_finalizations_v1(event_id),
 participation_id uuid NOT NULL REFERENCES public.multi_day_final_participations_v1(id),
 tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 club_id uuid NOT NULL REFERENCES public.clubs(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 player_id uuid NOT NULL, finished_place integer NOT NULL CHECK(finished_place>0),
 amount_vnd bigint NOT NULL CHECK(amount_vnd>0 AND amount_vnd<=9007199254740991),
 recipient_name text NOT NULL CHECK(length(btrim(recipient_name))>0),
 method text NOT NULL CHECK(method IN('cash','bank','app','other')),
 paid_at timestamptz NOT NULL,
 transaction_id bigint NOT NULL,backend_pid integer NOT NULL,
 action_seq bigint NOT NULL UNIQUE DEFAULT pg_catalog.nextval(
  pg_catalog.pg_get_serial_sequence('public.multi_day_payout_corrections_v1','approval_seq')::regclass),
 previous_revision text NOT NULL CHECK(previous_revision ~ '^[0-9a-f]{32}$'),
 resulting_revision text NOT NULL CHECK(resulting_revision ~ '^[0-9a-f]{32}$')
);
ALTER TABLE private.multi_day_payment_commits_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.multi_day_payment_commits_v1 FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX multi_day_payment_event_seq_v1 ON private.multi_day_payment_commits_v1(event_id,action_seq);
CREATE TRIGGER multi_day_payment_commit_immutable_v1 BEFORE UPDATE OR DELETE ON private.multi_day_payment_commits_v1
 FOR EACH ROW EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();

CREATE FUNCTION private.is_verified_multi_day_payment_v1(row_value public.tournament_prize_payments)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT row_value.multi_day_participation_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM private.multi_day_payment_commits_v1 c
  JOIN public.multi_day_final_participations_v1 p ON p.id=c.participation_id
   AND p.event_id=c.event_id AND p.final_tournament_id=c.tournament_id AND p.player_id=c.player_id
  JOIN public.multi_day_payout_finalizations_v1 f ON f.event_id=c.event_id
   AND f.final_tournament_id=c.tournament_id AND f.club_id=c.club_id
  WHERE c.payment_id=row_value.id AND c.transaction_id=pg_catalog.txid_current()
   AND c.backend_pid=pg_catalog.pg_backend_pid() AND c.actor_id=auth.uid()
   AND row_value.multi_day_participation_id=c.participation_id
   AND row_value.tournament_id=c.tournament_id AND row_value.club_id=c.club_id
   AND row_value.finished_place=c.finished_place AND row_value.prize_amount=c.amount_vnd
   AND row_value.recipient_ref=c.player_id AND row_value.recipient_name=c.recipient_name
   AND row_value.paid_by=c.actor_id AND row_value.paid_at=c.paid_at
   AND row_value.method=c.method AND row_value.status='paid'
   AND row_value.proof_url IS NULL AND row_value.notes IS NULL);
$$;
REVOKE ALL ON FUNCTION private.is_verified_multi_day_payment_v1(public.tournament_prize_payments)
 FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.require_verified_multi_day_payment_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (TG_OP<>'INSERT' AND OLD.multi_day_participation_id IS NOT NULL)
  OR (TG_OP<>'DELETE' AND NEW.multi_day_participation_id IS NOT NULL) THEN
  IF TG_OP='INSERT' AND private.is_verified_multi_day_payment_v1(NEW) THEN RETURN NEW;END IF;
  RAISE EXCEPTION 'verified_multi_day_payment_intent_required' USING ERRCODE='42501';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION private.require_verified_multi_day_payment_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_verified_payment_boundary_v1 BEFORE INSERT OR UPDATE OR DELETE
 ON public.tournament_prize_payments FOR EACH ROW EXECUTE FUNCTION private.require_verified_multi_day_payment_v1();
DO $$
DECLARE target regprocedure:='private.multi_day_legacy_payout_hold_v1()'::regprocedure;
 definition text:=pg_get_functiondef(target);
BEGIN
 -- Allow ONLY an exact private transaction-bound insert. No GUC bypass;
 -- legacy payments, prize edits, updates and deletes retain their hold.
 IF (length(definition)-length(replace(definition,E'BEGIN\n','')))/length(E'BEGIN\n')<>1 THEN RAISE EXCEPTION 'multiday145_guard_anchor_drift';END IF;
 EXECUTE replace(definition,E'BEGIN\n',$new$BEGIN
 IF TG_TABLE_NAME='tournament_prize_payments' AND TG_OP='INSERT' THEN
  IF private.is_verified_multi_day_payment_v1(NEW) THEN RETURN NEW;END IF;
 END IF;
$new$);
END $$;
CREATE UNIQUE INDEX uq_prize_paid_once_ordinary_v1 ON public.tournament_prize_payments(tournament_id,finished_place)
 WHERE status='paid' AND multi_day_participation_id IS NULL;
DROP INDEX public.uq_prize_paid_once;
COMMIT;
