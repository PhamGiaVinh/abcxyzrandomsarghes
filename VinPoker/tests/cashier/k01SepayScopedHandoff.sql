\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'vinpoker_ops_k01' THEN
    RAISE EXCEPTION 'Expected disposable K01 database';
  END IF;
END $$;
\i supabase/pending-migrations/20261119094202_sepay_cashier_settlement_scope_v1.sql

DO $fixture$
DECLARE
  actor_a uuid := gen_random_uuid();
  actor_b uuid := gen_random_uuid();
  club_a uuid := gen_random_uuid();
  club_b uuid := gen_random_uuid();
  transfer_a uuid := gen_random_uuid();
  transfer_b uuid := gen_random_uuid();
  conflicted uuid := gen_random_uuid();
  account_a text := '990016870001';
  account_b text := '990016870002';
BEGIN
  INSERT INTO auth.users(id) VALUES (actor_a), (actor_b);
  INSERT INTO public.profiles(user_id, display_name) VALUES (actor_a, 'K01 TEST A'), (actor_b, 'K01 TEST B');
  INSERT INTO public.clubs(id,owner_id,name,region,status)
    VALUES (club_a,actor_a,'K01 club A','TEST','approved'), (club_b,actor_b,'K01 club B','TEST','approved');
  INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,is_active)
    VALUES (club_a,'LOCAL TEST BANK',account_a,'TEST A',true), (club_b,'LOCAL TEST BANK',account_b,'TEST B',true);
  INSERT INTO public.bank_transactions(id,provider,provider_txn_id,account_number,club_id,amount,transfer_type,content,status,api_verified_at,raw_payload)
    VALUES (transfer_a,'sepay','local-'||transfer_a,account_a,club_a,80000,'in','TEST A','unmatched', now(),'{}'),
           (transfer_b,'sepay','local-'||transfer_b,account_b,club_b,150000,'in','TEST B','matched', now(),'{}'),
           (conflicted,'sepay','local-'||conflicted,account_b,club_a,90000,'in','conflicting tenant','unmatched', now(),'{}');

  ASSERT NOT has_function_privilege('anon', 'public.sepay_cashier_settlement_scope_v1(uuid,uuid,text,int)', 'EXECUTE');
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', actor_b::text, true);
  ASSERT (SELECT count(*) FROM public.sepay_cashier_settlement_scope_v1(club_b,transfer_b,'actionable',1)
    WHERE club_id=club_b AND bank_transaction_id=transfer_b AND bt_status='matched' AND amount=150000) = 1;
  ASSERT NOT EXISTS (SELECT 1 FROM public.sepay_cashier_settlement_scope_v1(club_b,transfer_a));
  ASSERT NOT EXISTS (SELECT 1 FROM public.sepay_cashier_settlement_scope_v1(club_b,conflicted));
  BEGIN
    PERFORM public.sepay_cashier_settlement_scope_v1(club_a,transfer_a);
    RAISE EXCEPTION 'Cross-club scope was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', actor_a::text, true);
  ASSERT (SELECT count(*) FROM public.sepay_cashier_settlement_scope_v1(club_a)
    WHERE bank_transaction_id=transfer_a AND reg_match_count=0) = 1;
END
$fixture$;
ROLLBACK;
