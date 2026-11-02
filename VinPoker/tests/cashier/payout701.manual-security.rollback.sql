\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');
 ASSERT NOT has_function_privilege('authenticated','floor_private.save_tournament_prizes_legacy_v2(uuid,jsonb,text)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.save_tournament_prizes_v3(uuid,jsonb,text,uuid,uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.save_tournament_prizes_v3(uuid,jsonb,text,uuid,uuid,uuid)','EXECUTE');
 ASSERT NOT EXISTS(SELECT 1 FROM public.club_cashiers WHERE club_id='7f3c6f90-3667-4c8c-9a00-6f00da680d84' AND user_id='675fe35e-60a8-4452-bb90-e79486d54da6');
END $$;
CREATE TEMP TABLE manual701_before ON COMMIT DROP AS
SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournaments r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_payout_runs r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prizes r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prize_payments r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_entries r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,request_id) FROM floor_private.payout_manual_edit_receipts_v1 r))::text) fingerprint;
SAVEPOINT business;
SET LOCAL request.jwt.claim.sub='40b8f243-bf3b-4aaa-962b-db788380207c';
SET LOCAL ROLE authenticated;
DO $$ DECLARE key uuid:=gen_random_uuid();response jsonb;receipt jsonb;blocked boolean:=false;BEGIN
 response:=public.cancel_tournament_payout_edit_v1('6a7fb4a3-8b46-44be-a71a-ca12a052ee08','[{"position":1,"amount":300000}]','LOCAL701 cancel',
  '379600a2-fd2d-4e6d-8004-b52b3d681740',key,auth.uid());
 ASSERT response->>'status'='cancelled';
 ASSERT public.save_tournament_prizes_v3('6a7fb4a3-8b46-44be-a71a-ca12a052ee08','[{"position":1,"amount":300000}]','LOCAL701 cancel',
  '379600a2-fd2d-4e6d-8004-b52b3d681740',key,auth.uid())=response;
 receipt:=public.get_tournament_payout_edit_receipt_v1('6a7fb4a3-8b46-44be-a71a-ca12a052ee08',key,auth.uid());
 ASSERT receipt->>'status'='found' AND receipt->'result'=response AND receipt->'intent'->'rows'='[{"position":1,"amount":300000}]'::jsonb;
 ASSERT EXISTS(SELECT 1 FROM public.tournament_payout_runs WHERE id='379600a2-fd2d-4e6d-8004-b52b3d681740' AND status='applied');
 BEGIN
  PERFORM public.cancel_tournament_payout_edit_v1('6a7fb4a3-8b46-44be-a71a-ca12a052ee08','[{"position":1,"amount":300000}]','changed reason',
   '379600a2-fd2d-4e6d-8004-b52b3d681740',key,auth.uid());
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%PAYOUT_EDIT_REQUEST_CONFLICT%' THEN blocked:=true;ELSE RAISE;END IF;END;
 ASSERT blocked;
 blocked:=false;
 BEGIN PERFORM public.save_tournament_prizes_v2('6a7fb4a3-8b46-44be-a71a-ca12a052ee08','[{"position":1,"amount":300000}]','legacy bypass');
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%PAYOUT_EDIT_REQUEST_CONTEXT_REQUIRED%' THEN blocked:=true;ELSE RAISE;END IF;END;
 ASSERT blocked;
 BEGIN PERFORM 1 FROM floor_private.payout_manual_edit_receipts_v1;RAISE EXCEPTION 'private receipt table exposed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK TO business;
SET LOCAL request.jwt.claim.sub='40b8f243-bf3b-4aaa-962b-db788380207c';SET LOCAL ROLE authenticated;
DO $$ DECLARE key uuid:=gen_random_uuid();saved jsonb;BEGIN
 saved:=public.save_tournament_prizes_v3('6a7fb4a3-8b46-44be-a71a-ca12a052ee08','[{"position":1,"amount":300000}]','LOCAL701 saved',
  '379600a2-fd2d-4e6d-8004-b52b3d681740',key,auth.uid());
 ASSERT saved->>'status'='saved' AND (saved->>'run_id')::uuid<>'379600a2-fd2d-4e6d-8004-b52b3d681740'::uuid;
 ASSERT public.cancel_tournament_payout_edit_v1('6a7fb4a3-8b46-44be-a71a-ca12a052ee08','[{"position":1,"amount":300000}]','LOCAL701 saved',
  '379600a2-fd2d-4e6d-8004-b52b3d681740',key,auth.uid())=saved;
 ASSERT public.get_tournament_payout_edit_receipt_v1('6a7fb4a3-8b46-44be-a71a-ca12a052ee08',key,auth.uid())->'result'=saved;
END $$;
RESET ROLE;
ROLLBACK TO business;
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL ROLE authenticated;
DO $$ DECLARE blocked boolean:=false;BEGIN
 BEGIN PERFORM public.get_tournament_payout_edit_receipt_v1('6a7fb4a3-8b46-44be-a71a-ca12a052ee08',gen_random_uuid(),auth.uid());
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%NOT_AUTHORIZED%' THEN blocked:=true;ELSE RAISE;END IF;END;ASSERT blocked;
 blocked:=false;
 BEGIN PERFORM public.save_tournament_prizes_v3('6a7fb4a3-8b46-44be-a71a-ca12a052ee08','[{"position":1,"amount":300000}]','outsider',
  '379600a2-fd2d-4e6d-8004-b52b3d681740',gen_random_uuid(),auth.uid());
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%NOT_AUTHORIZED%' THEN blocked:=true;ELSE RAISE;END IF;END;ASSERT blocked;
END $$;
RESET ROLE;
INSERT INTO public.club_cashiers(club_id,user_id) VALUES('7f3c6f90-3667-4c8c-9a00-6f00da680d84','675fe35e-60a8-4452-bb90-e79486d54da6');
SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';SET LOCAL ROLE authenticated;
DO $$ DECLARE saved jsonb;blocked boolean:=false;BEGIN
 BEGIN PERFORM public.save_tournament_prizes_v3('6a7fb4a3-8b46-44be-a71a-ca12a052ee08','[{"position":1,"amount":300000}]','LOCAL702 wrong actor',
  '379600a2-fd2d-4e6d-8004-b52b3d681740',gen_random_uuid(),'40b8f243-bf3b-4aaa-962b-db788380207c');
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%PAYOUT_EDIT_ACTOR_MISMATCH%' THEN blocked:=true;ELSE RAISE;END IF;END;
 ASSERT blocked;
 blocked:=false;
 BEGIN PERFORM public.cancel_tournament_payout_edit_v1('6a7fb4a3-8b46-44be-a71a-ca12a052ee08','[{"position":1,"amount":300000}]','LOCAL702 wrong actor',
  '379600a2-fd2d-4e6d-8004-b52b3d681740',gen_random_uuid(),'40b8f243-bf3b-4aaa-962b-db788380207c');
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%PAYOUT_EDIT_ACTOR_MISMATCH%' THEN blocked:=true;ELSE RAISE;END IF;END;
 ASSERT blocked;
 blocked:=false;
 BEGIN PERFORM public.get_tournament_payout_edit_receipt_v1('6a7fb4a3-8b46-44be-a71a-ca12a052ee08',gen_random_uuid(),'40b8f243-bf3b-4aaa-962b-db788380207c');
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%PAYOUT_EDIT_ACTOR_MISMATCH%' THEN blocked:=true;ELSE RAISE;END IF;END;
 ASSERT blocked;
 saved:=public.save_tournament_prizes_v3('6a7fb4a3-8b46-44be-a71a-ca12a052ee08','[{"position":1,"amount":300000}]','LOCAL701 cashier rollback',
  '379600a2-fd2d-4e6d-8004-b52b3d681740','e7010000-0000-4000-8000-000000000001',auth.uid());
 ASSERT saved->>'status'='saved';
 ASSERT public.get_tournament_payout_edit_receipt_v1('6a7fb4a3-8b46-44be-a71a-ca12a052ee08','e7010000-0000-4000-8000-000000000001',auth.uid())->'result'=saved;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='40b8f243-bf3b-4aaa-962b-db788380207c';SET LOCAL ROLE authenticated;
DO $$ BEGIN ASSERT public.get_tournament_payout_edit_receipt_v1('6a7fb4a3-8b46-44be-a71a-ca12a052ee08','e7010000-0000-4000-8000-000000000001',auth.uid())->>'status'='not_found';END $$;
RESET ROLE;
ROLLBACK TO business;
-- Canonical TEST ledger payment inside rollback only, no real transfer/provider.
SET LOCAL request.jwt.claim.sub='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';SET LOCAL ROLE authenticated;
DO $$ DECLARE recipients jsonb;token text;payment jsonb;blocked boolean:=false;BEGIN
 recipients:=public.get_tournament_payout_recipients('c367013a-3ed3-48af-ad48-3915acadc50e');
 SELECT p->>'confirmationToken' INTO STRICT token FROM jsonb_array_elements(recipients->'places') p WHERE p->>'finishedPlace'='1';
 payment:=public.record_tournament_prize_payment_v2('c367013a-3ed3-48af-ad48-3915acadc50e',1,'cash',token,gen_random_uuid());
 -- Canonical payment returns outcome (not status); also verify the actual amount.
 ASSERT (payment->>'ok')::boolean AND payment->>'outcome'='recorded' AND (payment->>'prize_amount')::numeric=700000;
 BEGIN PERFORM public.save_tournament_prizes_v3('c367013a-3ed3-48af-ad48-3915acadc50e','[{"position":1,"amount":600000},{"position":2,"amount":300000}]','LOCAL701 paid guard rollback',
  'deb73d84-4bdd-46a2-9b31-527de3b30163',gen_random_uuid(),auth.uid());
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%PAYOUT_EDIT_PAYMENT_DEPENDENCY%' THEN blocked:=true;ELSE RAISE;END IF;END;
 ASSERT blocked;
END $$;
RESET ROLE;
ROLLBACK TO business;
CREATE FUNCTION pg_temp.fail_manual_receipt701() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'LOCAL701_RECEIPT_INSERT_FAULT';END $$;
CREATE TRIGGER fail_manual_receipt701 BEFORE INSERT ON floor_private.payout_manual_edit_receipts_v1
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_manual_receipt701();
SET LOCAL request.jwt.claim.sub='40b8f243-bf3b-4aaa-962b-db788380207c';SET LOCAL ROLE authenticated;
DO $$ DECLARE blocked boolean:=false;BEGIN
 BEGIN PERFORM public.save_tournament_prizes_v3('6a7fb4a3-8b46-44be-a71a-ca12a052ee08','[{"position":1,"amount":200000},{"position":2,"amount":100000}]','LOCAL701 receipt insert failure',
  '379600a2-fd2d-4e6d-8004-b52b3d681740',gen_random_uuid(),auth.uid());
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%LOCAL701_RECEIPT_INSERT_FAULT%' THEN blocked:=true;ELSE RAISE;END IF;END;
 ASSERT blocked;
 ASSERT (SELECT count(*)=1 FROM public.tournament_payout_runs WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08');
 ASSERT EXISTS(SELECT 1 FROM public.tournament_payout_runs WHERE id='379600a2-fd2d-4e6d-8004-b52b3d681740' AND status='applied');
 ASSERT (SELECT jsonb_agg(jsonb_build_array(position,amount) ORDER BY position)='[[1,300000]]'::jsonb FROM public.tournament_prizes WHERE tournament_id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08');
END $$;
RESET ROLE;
ROLLBACK TO business;
DO $$ BEGIN
 ASSERT (SELECT fingerprint FROM manual701_before)=md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournaments r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_payout_runs r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prizes r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_prize_payments r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_entries r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.cashier_buyin_movements r),
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY actor_id,request_id) FROM floor_private.payout_manual_edit_receipts_v1 r))::text);
 ASSERT NOT EXISTS(SELECT 1 FROM public.club_cashiers WHERE club_id='7f3c6f90-3667-4c8c-9a00-6f00da680d84' AND user_id='675fe35e-60a8-4452-bb90-e79486d54da6');
END $$;
ROLLBACK;
SELECT 'PAYOUT701_OWNER_CASHIER_OUTSIDER_PRIVATE_ACL_CANCEL_LATE_SAVE_PAID_GUARD_ALL_ROLLBACK_PASS';
