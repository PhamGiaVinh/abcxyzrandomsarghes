-- Native read projections plus actual payment/replay/reversal/repayment writers.
DO $$DECLARE c record;r jsonb; BEGIN
 FOR c IN SELECT DISTINCT t.club_id,cl.owner_id FROM public.tournaments t JOIN public.clubs cl ON cl.id=t.club_id WHERE cl.owner_id IS NOT NULL LOOP
  PERFORM set_config('request.jwt.claim.sub',c.owner_id::text,true);
  r:=public.get_owner_player_financial_report_v1(c.club_id);
  ASSERT r->>'clubId'=c.club_id::text;
 END LOOP;
 ASSERT NOT has_function_privilege('anon','public.get_owner_player_financial_report_v1(uuid,uuid,text,integer,integer)','execute');
 ASSERT NOT has_function_privilege('authenticated','private.club_customer_financial_facts_v1(uuid)','execute');
END $$;
-- Synthetic isolated receipt fixtures exercise aggregation without disabling
-- any production guards or mutating existing immutable receipts/prices.
DO $$DECLARE tour uuid:='f2766bdd-5c30-4dee-bb3e-812f32d37172';club uuid;actor uuid;
 player uuid:=gen_random_uuid();member uuid:=gen_random_uuid();reg uuid:=gen_random_uuid();shift uuid;refund uuid:=gen_random_uuid();r jsonb;s jsonb; BEGIN
 SELECT t.club_id,c.owner_id INTO STRICT club,actor FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id WHERE t.id=tour;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 INSERT INTO auth.users(id) VALUES(player);
 INSERT INTO public.club_members(id,club_id,member_card_id,full_name,player_user_id) VALUES(member,club,'LOCAL-'||member,'LOCAL finance receipt TEST',player);
 INSERT INTO public.tournament_registrations(id,tournament_id,player_id,club_id,buy_in,total_pay,reference_code,price_snapshot)
 VALUES(reg,tour,player,club,100000,110000,'LOCAL-FINANCE-'||reg,
  '{"buy_in":100000,"rake":10000,"service_fee":0,"platform_fee":0,"total_pay":110000}');
 SELECT id INTO shift FROM public.cashier_till_shifts WHERE club_id=club AND closed_at IS NULL;
 IF shift IS NULL THEN INSERT INTO public.cashier_till_shifts(club_id,opening_cash,opened_by) VALUES(club,0,actor) RETURNING id INTO shift;END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 r:=public.get_owner_player_financial_report_v1(club,member);s:=r->'selected';
 ASSERT (s->>'cost')::numeric=0 AND s->>'roi' IS NULL,s::text;
 INSERT INTO public.cashier_buyin_movements(club_id,tournament_id,registration_id,shift_id,direction,method,purpose,amount,applied_amount,actor_id,idempotency_key)
 VALUES(club,tour,reg,shift,'in','cash','buyin',60000,60000,actor,'LOCAL-FINANCE-1-'||reg);
 r:=public.get_owner_player_financial_report_v1(club,member);s:=r->'selected';
 ASSERT (s->>'cost')::numeric=60000 AND s->>'rake' IS NULL AND (s->>'roi')::numeric=-100,s::text;
 INSERT INTO public.cashier_buyin_movements(club_id,tournament_id,registration_id,shift_id,direction,method,purpose,amount,applied_amount,actor_id,idempotency_key)
 VALUES(club,tour,reg,shift,'in','cash','buyin',50000,50000,actor,'LOCAL-FINANCE-2-'||reg);
 r:=public.get_owner_player_financial_report_v1(club,member);s:=r->'selected';
 ASSERT (s->>'cost')::numeric=110000 AND (s->>'rake')::numeric=10000 AND (s->>'profit')::numeric=-110000 AND (s->>'roi')::numeric=-100,s::text;
 ASSERT (s->>'paidBuys')::integer=1 AND (s->>'visits')::integer=1 AND (s->>'averageSpend')::numeric=110000;
 ASSERT jsonb_array_length(r->'history')=1 AND jsonb_array_length(r->'history'->0->'movements')=2,'receipt join multiplied cost';
 INSERT INTO public.cashier_refund_requests(id,club_id,tournament_id,registration_id,amount,status,reason,requested_by,paid_by,paid_at)
 VALUES(refund,club,tour,reg,110000,'paid','LOCAL fixture refund',actor,actor,now());
 INSERT INTO public.cashier_buyin_movements(club_id,tournament_id,registration_id,shift_id,refund_id,direction,method,purpose,amount,applied_amount,actor_id,idempotency_key)
 VALUES(club,tour,reg,shift,refund,'out','cash','refund',110000,110000,actor,'LOCAL-FINANCE-REFUND-'||reg);
 r:=public.get_owner_player_financial_report_v1(club,member);s:=r->'selected';
 ASSERT (s->>'cost')::numeric=0 AND (s->>'rake')::numeric=0 AND (s->>'profit')::numeric=0 AND s->>'roi' IS NULL,s::text;
 -- Missing legacy evidence must never become a zero-cost ROI windfall.
 UPDATE public.tournament_registrations SET status='cancelled' WHERE id=reg;
 INSERT INTO public.tournament_registrations(tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status)
 VALUES(tour,player,club,100000,100000,'LOCAL-LEGACY-'||reg,'confirmed');
 r:=public.get_owner_player_financial_report_v1(club,member);s:=r->'selected';
 ASSERT s->>'cost' IS NULL AND s->>'profit' IS NULL AND s->>'roi' IS NULL AND (s->>'unavailableCount')::integer=1,s::text;
 PERFORM set_config('request.jwt.claim.sub',player::text,true);
 INSERT INTO public.club_cashiers(club_id,user_id) VALUES(club,player);
 BEGIN PERFORM public.get_owner_player_financial_report_v1(club);RAISE EXCEPTION 'cashier private finance accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
DO $$DECLARE tour uuid:='f2766bdd-5c30-4dee-bb3e-812f32d37172';club uuid;actor uuid;person jsonb;paid jsonb;r jsonb;who uuid;before_total numeric;req uuid:=gen_random_uuid(); BEGIN
 SELECT t.club_id,c.owner_id INTO STRICT club,actor FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id WHERE t.id=tour;
 SELECT player_id INTO STRICT who FROM public.tournament_entries WHERE tournament_id=tour AND finished_place=1;
 before_total:=(public.get_public_player_paid_winnings_v1(who)->>'totalWinnings')::numeric;
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 BEGIN PERFORM public.get_owner_player_financial_report_v1(club);RAISE EXCEPTION 'outsider accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 SELECT value INTO STRICT person FROM jsonb_array_elements(public.get_tournament_payout_recipients(tour)->'places') WHERE value->>'finishedPlace'='1';
 PERFORM set_config('role','authenticated',true);
 paid:=public.record_tournament_prize_payment_v2(tour,1,'cash',person->>'confirmationToken',req);
 ASSERT paid->>'ok'='true',paid::text;
 ASSERT public.record_tournament_prize_payment_v2(tour,1,'cash',person->>'confirmationToken',req)=paid;
 PERFORM set_config('role','none',true);
 r:=public.get_public_player_paid_winnings_v1(who);
 ASSERT (r->>'totalWinnings')::numeric=before_total+200000,r::text;
 r:=public.get_owner_player_financial_report_v1(club);
 ASSERT jsonb_array_length(r->'customers')>0;
END $$;
DO $$DECLARE event uuid:='30eb935c-8ba6-43ab-a6a6-0c0934f71570';tour uuid:='6f0ebd0d-505b-4151-a8a9-bfe5b58ce34f';
 club uuid;actor uuid;who uuid;person jsonb;paid jsonb;r jsonb;state jsonb;reversal uuid:=gen_random_uuid();baseline numeric; BEGIN
 SELECT f.club_id,c.owner_id INTO STRICT club,actor FROM public.multi_day_payout_finalizations_v1 f JOIN public.clubs c ON c.id=f.club_id WHERE f.event_id=event;
 INSERT INTO public.multi_day_package_release_v1(id,enabled,allowed_club_ids) VALUES(true,true,ARRAY[club]) ON CONFLICT(id) DO UPDATE SET enabled=true,allowed_club_ids=excluded.allowed_club_ids;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor)::text,true);
 person:=public.get_multi_day_payout_recipients_v1(event)->'places'->0;who:=(person->>'recipientRef')::uuid;
 baseline:=(public.get_public_player_paid_winnings_v1(who)->>'totalWinnings')::numeric;
 PERFORM set_config('role','authenticated',true);
 paid:=public.record_multi_day_prize_payment_v1(event,(person->>'multiDayParticipationId')::uuid,'cash',person->>'confirmationToken',gen_random_uuid());
 ASSERT paid->>'ok'='true',paid::text;
 r:=public.get_public_player_paid_winnings_v1(who);ASSERT (r->>'totalWinnings')::numeric=baseline+300000,r::text;
 state:=public.multi_day_payout_postfinal_state_v1(event);
 r:=public.multi_day_request_payout_correction_v1(event,'PAYMENT_REVERSAL',(person->>'multiDayParticipationId')::uuid,(paid->>'payment_id')::uuid,-300000,state->>'revision','TEST reverse winnings','LOCAL-TEST',reversal);
 ASSERT r->>'state'='PENDING_APPROVAL',r::text;
 r:=public.multi_day_approve_payout_correction_v1(reversal,gen_random_uuid());ASSERT r->>'ok'='true',r::text;
 r:=public.get_public_player_paid_winnings_v1(who);ASSERT (r->>'totalWinnings')::numeric=baseline,r::text;
 r:=public.get_owner_player_financial_report_v1(club);
 person:=public.get_multi_day_payout_recipients_v1(event)->'places'->0;
 r:=public.record_multi_day_prize_payment_v1(event,(person->>'multiDayParticipationId')::uuid,'cash',person->>'confirmationToken',gen_random_uuid());ASSERT r->>'ok'='true',r::text;
 r:=public.get_public_player_paid_winnings_v1(who);ASSERT (r->>'totalWinnings')::numeric=baseline+300000,r::text;
 r:=public.get_owner_player_financial_report_v1(club);
 PERFORM set_config('role','none',true);
 ASSERT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE id=(paid->>'payment_id')::uuid AND prize_amount=300000 AND status='paid');
END $$;
