\set ON_ERROR_STOP on
BEGIN;
\ir scope.seed.sql
INSERT INTO public.tournament_series(id,club_id,name,start_date,end_date) VALUES
 ('17980000-0000-4000-8000-000000000061','17980000-0000-4000-8000-000000000001','Expense TEST series A','2026-11-25','2026-11-26'),
 ('17980000-0000-4000-8000-000000000062','17980000-0000-4000-8000-000000000002','Expense TEST series B','2026-11-25','2026-11-26');
INSERT INTO public.tournaments(id,club_id,name,status,live_status) VALUES
 ('17980000-0000-4000-8000-000000000071','17980000-0000-4000-8000-000000000001','Expense TEST tour A','upcoming','registering'),
 ('17980000-0000-4000-8000-000000000072','17980000-0000-4000-8000-000000000002','Expense TEST tour B','upcoming','registering');
INSERT INTO public.club_expenses(id,club_id,category,amount_vnd,incurred_at,entered_by,description) VALUES
 ('17980000-0000-4000-8000-000000000081','17980000-0000-4000-8000-000000000001','misc',100000,now(),'17980000-0000-4000-8000-000000000011','TEST original A'),
 ('17980000-0000-4000-8000-000000000082','17980000-0000-4000-8000-000000000002','misc',100000,now(),'17980000-0000-4000-8000-000000000022','TEST original B');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='17980000-0000-4000-8000-000000000033';
DO $test$
DECLARE
  receipt jsonb; repeated jsonb; mutation jsonb; intent jsonb; changes jsonb;
  before_rows jsonb; after_rows jsonb; caught text;
  club constant uuid := '17980000-0000-4000-8000-000000000001';
BEGIN
  receipt := public.record_club_expense(
    p_club_id=>club,p_category=>'misc',p_amount_vnd=>-5000,p_incurred_at=>'2026-11-25T10:00:00Z',
    p_description=>'TEST valid adjustment',p_adjusts_id=>'17980000-0000-4000-8000-000000000081',
    p_tournament_id=>'17980000-0000-4000-8000-000000000071',p_series_id=>'17980000-0000-4000-8000-000000000061',
    p_idempotency_key=>'expense-candidate-valid');
  IF receipt->>'status' IS DISTINCT FROM 'ok' OR receipt->>'idempotent' IS DISTINCT FROM 'false'
    OR receipt->>'expense_id' IS NULL THEN RAISE EXCEPTION 'valid_same_club_adjustment_failed'; END IF;
  repeated := public.record_club_expense(
    p_club_id=>club,p_category=>'misc',p_amount_vnd=>-5000,p_incurred_at=>'2026-11-25T10:00:00Z',
    p_description=>'TEST valid adjustment',p_adjusts_id=>'17980000-0000-4000-8000-000000000081',
    p_tournament_id=>'17980000-0000-4000-8000-000000000071',p_series_id=>'17980000-0000-4000-8000-000000000061',
    p_idempotency_key=>'expense-candidate-valid');
  IF repeated->>'expense_id' IS DISTINCT FROM receipt->>'expense_id'
    OR repeated->>'idempotent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'same_intent_retry_changed'; END IF;
  SELECT jsonb_agg(to_jsonb(e) ORDER BY id) INTO before_rows FROM public.club_expenses e;
  -- Accessible rows include every A row; rejected intents must leave them exact.
  FOR changes IN SELECT value FROM jsonb_array_elements('[
    {"adjusts":"17980000-0000-4000-8000-000000000082"},
    {"adjusts":"17980000-0000-4000-8000-000000000099"},
    {"tour":"17980000-0000-4000-8000-000000000072"},
    {"tour":"17980000-0000-4000-8000-000000000099"},
    {"series":"17980000-0000-4000-8000-000000000062"},
    {"series":"17980000-0000-4000-8000-000000000099"}
  ]'::jsonb)
  LOOP
    BEGIN
      PERFORM public.record_club_expense(p_club_id=>club,p_category=>'misc',p_amount_vnd=>-100,
        p_incurred_at=>'2026-11-25T10:00:00Z',p_description=>'TEST rejected scope',
        p_adjusts_id=>(changes->>'adjusts')::uuid,p_tournament_id=>(changes->>'tour')::uuid,
        p_series_id=>(changes->>'series')::uuid,p_idempotency_key=>'expense-candidate-invalid-scope');
      RAISE EXCEPTION 'invalid_reference_was_accepted';
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS caught=MESSAGE_TEXT;
      IF caught IS DISTINCT FROM 'expense_reference_scope_invalid' THEN RAISE; END IF;
    END;
  END LOOP;
  intent := jsonb_build_object('amount',-5000,'category','misc','description','TEST valid adjustment',
    'incurred','2026-11-25T10:00:00Z','status','unpaid','source',NULL,'attachment',NULL,
    'tour','17980000-0000-4000-8000-000000000071','series','17980000-0000-4000-8000-000000000061',
    'adjusts','17980000-0000-4000-8000-000000000081');
  FOR changes IN SELECT value FROM jsonb_array_elements('[
    {"amount":-6000},{"category":"rent"},{"description":"TEST changed"},
    {"incurred":"2026-11-26T10:00:00Z"},{"status":"paid"},{"source":"cash"},
    {"attachment":"https://example.invalid/test-receipt"},{"tour":null},
    {"series":null},{"adjusts":null}
  ]'::jsonb)
  LOOP
    mutation := intent || changes;
    BEGIN
      PERFORM public.record_club_expense(club,(mutation->>'category')::public.expense_category,
        (mutation->>'amount')::bigint,(mutation->>'incurred')::timestamptz,mutation->>'description',
        mutation->>'status',mutation->>'source',(mutation->>'tour')::uuid,(mutation->>'series')::uuid,
        mutation->>'attachment',(mutation->>'adjusts')::uuid,'expense-candidate-valid');
      RAISE EXCEPTION 'conflicting_intent_was_accepted';
    EXCEPTION WHEN invalid_parameter_value THEN
      GET STACKED DIAGNOSTICS caught=MESSAGE_TEXT;
      IF caught IS DISTINCT FROM 'expense_idempotency_conflict' THEN RAISE; END IF;
    END;
  END LOOP;
  SELECT jsonb_agg(to_jsonb(e) ORDER BY id) INTO after_rows FROM public.club_expenses e;
  IF after_rows IS DISTINCT FROM before_rows THEN RAISE EXCEPTION 'rejected_intent_changed_expenses'; END IF;
END
$test$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.club_expenses) <> 3 THEN RAISE EXCEPTION 'unexpected_expense_row_count'; END IF;
  IF NOT EXISTS(SELECT FROM public.club_expenses WHERE id='17980000-0000-4000-8000-000000000082'
    AND amount_vnd=100000 AND description='TEST original B') THEN RAISE EXCEPTION 'other_club_expense_changed'; END IF;
END $$;
DELETE FROM public.club_accountants WHERE user_id='17980000-0000-4000-8000-000000000033';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.record_club_expense('17980000-0000-4000-8000-000000000001','misc',100,
      now(),'TEST revoked','unpaid',NULL,NULL,NULL,NULL,NULL,'expense-candidate-revoked');
    RAISE EXCEPTION 'revoked_accountant_was_accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'CANDIDATE_EXPENSE_SCOPE_IDEMPOTENCY_REVOCATION_PASS' AS result;
