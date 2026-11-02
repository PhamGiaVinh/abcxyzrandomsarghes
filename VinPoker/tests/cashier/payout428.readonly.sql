BEGIN READ ONLY;
DO $$ BEGIN
 ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
END $$;
SELECT set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.get_tournament_payout_recipients('4cd3af4d-7e1d-4042-855f-04fb6777e580');
 ASSERT r->>'mode'='multi_day' AND r->>'eventId'='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
 ASSERT (r->>'totalCount')::int=15 AND (r->>'paidCount')::int=0;
 ASSERT (r->>'owedTotal')::bigint=2500000 AND (r->>'paidTotal')::bigint=0;
 ASSERT r#>>'{places,0,recipientName}'='Linked Main Event 180 TEST player 2';
 ASSERT (r#>>'{places,0,finishedPlace}')::int=1 AND (r#>>'{places,0,prizeAmount}')::bigint=570000;
 ASSERT (SELECT sum((p->>'obligationAmount')::bigint) FROM jsonb_array_elements(r->'places') p)=2500000;
 ASSERT (SELECT count(DISTINCT p->>'entryId') FROM jsonb_array_elements(r->'places') p)=15;
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'places') p WHERE nullif(btrim(p->>'recipientName'),'') IS NULL);
 RAISE NOTICE 'PAYOUT428_NATIVE15_NAMES_2500000_UNPAID_UI_FIRST_MATCH';
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id='4cd3af4d-7e1d-4042-855f-04fb6777e580');
END $$;
ROLLBACK;
