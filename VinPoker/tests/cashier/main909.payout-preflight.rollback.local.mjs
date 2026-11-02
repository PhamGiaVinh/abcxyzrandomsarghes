import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_MAIN909_LOCAL,'1');
const db='vinpoker_ops_cash115_qualified_c',tour='4cd3af4d-7e1d-4042-855f-04fb6777e580',event='dbb49f8d-7d47-4c2c-afd9-f57062c9971d',actor='675fe35e-60a8-4452-bb90-e79486d54da6',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
const tables=['tournaments','tournament_events','tournament_entries','tournament_seats','tournament_hands','cashier_buyin_movements','tournament_prizes','tournament_close_report','dealer_attendance','dealer_assignments','notifications','chip_inventory_ledger','chip_bank_ledger','tournament_chip_counts','chip_bag','multi_day_final_participations_v1','multi_day_payout_finalizations_v1','multi_day_package_release_v1'];
const digest=list=>`md5(jsonb_build_array(${list.map(t=>`(SELECT jsonb_build_array('${t}',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),''))) FROM ${t} r)`).join(',')})::text)`;
const all=digest([...tables.map(t=>'public.'+t),'public.tournament_prize_payments','floor_private.payout_payment_receipts_v1','private.multi_day_payment_commits_v1']);
const protectedFacts=digest(tables.filter(t=>t!=='multi_day_package_release_v1').map(t=>'public.'+t));
const sql=String.raw`\set ON_ERROR_STOP on
BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='2s';
DO $$BEGIN
 ASSERT current_database()='${db}' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='${tour}' AND status='completed');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id='${tour}');
 ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 WHERE enabled AND '${club}'::uuid=ANY(allowed_club_ids));
 ASSERT (SELECT count(*)=2 AND sum(prize_amount)=900000 FROM public.tournament_prize_payments WHERE tournament_id='c367013a-3ed3-48af-ad48-3915acadc50e');
END $$;
CREATE TEMP TABLE main909_before ON COMMIT DROP AS SELECT ${all} all_facts,${protectedFacts} protected;
SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
DO $$DECLARE source jsonb;place jsonb;r jsonb;key uuid:=gen_random_uuid();BEGIN
 source:=public.get_tournament_payout_recipients('${tour}');
 ASSERT source->>'mode'='multi_day' AND jsonb_array_length(source->'places')=15 AND (source->>'paidTotal')::numeric=0 AND (source->>'owedTotal')::numeric=2500000;
 SELECT x INTO STRICT place FROM jsonb_array_elements(source->'places')x WHERE (x->>'finishedPlace')::integer=1;
 r:=public.record_multi_day_prize_payment_v1('${event}',(place->>'multiDayParticipationId')::uuid,'cash',place->>'confirmationToken',key);
 ASSERT r->>'ok'='false' AND r->>'error'='multi_day_package_release_off',r::text;
 ASSERT public.get_tournament_prize_payment_receipt_v2(key)->>'found'='false';
END $$;
RESET ROLE;
UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY(SELECT DISTINCT x FROM unnest(coalesce(allowed_club_ids,'{}'::uuid[])||ARRAY['${club}'::uuid])x) WHERE id;
SET LOCAL ROLE authenticated;
DO $$DECLARE source jsonb;place jsonb;r jsonb;replay jsonb;receipt jsonb;after_read jsonb;current_place jsonb;key uuid:=gen_random_uuid();BEGIN
 source:=public.get_tournament_payout_recipients('${tour}');
 SELECT x INTO STRICT place FROM jsonb_array_elements(source->'places')x WHERE (x->>'finishedPlace')::integer=1;
 ASSERT (place->>'prizeAmount')::numeric=570000;
 r:=public.record_multi_day_prize_payment_v1('${event}',(place->>'multiDayParticipationId')::uuid,'cash',place->>'confirmationToken',key);
 ASSERT r->>'ok'='true' AND r->>'outcome'='recorded',r::text;
 ASSERT r->>'entry_id'=place->>'entryId' AND r->>'recipient_ref'=place->>'recipientRef' AND (r->>'prize_amount')::numeric=570000;
 replay:=public.record_multi_day_prize_payment_v1('${event}',(place->>'multiDayParticipationId')::uuid,'cash',place->>'confirmationToken',key);
 ASSERT replay=r,'same-key replay changed receipt';
 receipt:=public.get_tournament_prize_payment_receipt_v2(key);
 ASSERT receipt->>'found'='true' AND receipt->'result'=r;
 replay:=public.record_multi_day_prize_payment_v1('${event}',(place->>'multiDayParticipationId')::uuid,'bank',place->>'confirmationToken',key);
 ASSERT replay->>'ok'='false' AND replay->>'error'='request_payload_conflict';
 after_read:=public.get_tournament_payout_recipients('${tour}');
 ASSERT (after_read->>'owedTotal')::numeric=2500000 AND (after_read->>'paidTotal')::numeric=570000 AND (after_read->>'paidCount')::integer=1;
 SELECT x INTO STRICT current_place FROM jsonb_array_elements(after_read->'places')x WHERE (x->>'finishedPlace')::integer=1;
 ASSERT (current_place->>'isPaid')::boolean AND (current_place->>'prizeAmount')::numeric=0 AND (current_place->>'paidAmount')::numeric=570000;
 replay:=public.record_multi_day_prize_payment_v1('${event}',(place->>'multiDayParticipationId')::uuid,'cash',current_place->>'confirmationToken',gen_random_uuid());
 ASSERT replay->>'ok'='false' AND replay->>'error'='no_unpaid_obligation';
END $$;
RESET ROLE;
DO $$BEGIN
 ASSERT (SELECT protected FROM main909_before)=${protectedFacts},'payment changed frozen original journey facts';
 ASSERT (SELECT count(*)=1 AND sum(prize_amount)=570000 FROM public.tournament_prize_payments WHERE tournament_id='${tour}');
END $$;
SELECT all_facts AS baseline FROM main909_before \gset
ROLLBACK;
SELECT jsonb_build_object('database','${db}','tour','${tour}','testedRank',1,'testedAmount',570000,'releaseOffDenied',true,'scopedRelease','ROLLBACK only','allFactsUnchanged',:'baseline'=${all});`;
const out=execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',timeout:30000,maxBuffer:1e6,stdio:['pipe','pipe','pipe']}).trim();
const result=JSON.parse(out);assert.equal(result.allFactsUnchanged,true);
writeFileSync('D:/Quy trình/output/reports/main909-payout-preflight-local-20261026.json',JSON.stringify(result,null,2)+'\n');
console.log('MAIN909_RELEASE_OFF_DENIAL_SCOPED_NATIVE_PAYMENT_RECEIPT_ALL_ROLLBACK_PASS',JSON.stringify(result));
