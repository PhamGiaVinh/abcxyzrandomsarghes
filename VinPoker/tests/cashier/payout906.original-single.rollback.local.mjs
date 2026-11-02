import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_PAYOUT906_LOCAL,'1');
const databases=['vinpoker_ops_cash115_qualified_c','vinpoker_ranking860_local'];
const tour='c367013a-3ed3-48af-ad48-3915acadc50e',actor='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
const tables=['tournaments','tournament_events','tournament_entries','tournament_seats','tournament_hands','hand_players','hand_actions','cashier_buyin_movements','tournament_prizes','tournament_close_report','dealer_attendance','dealer_assignments','notifications','chip_inventory_ledger','chip_bank_ledger','tournament_chip_counts','stack_template_issuance'];
const fingerprint=list=>`md5(jsonb_build_array(${list.map(t=>`(SELECT jsonb_build_array('${t}',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),''))) FROM public.${t} r)`).join(',')})::text)`;
const allFacts=`md5(jsonb_build_array(${fingerprint([...tables,'tournament_prize_payments'])},(SELECT md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) FROM floor_private.payout_payment_receipts_v1 r))::text)`;
const results=[];
for(const db of databases){
 const text=String.raw`\set ON_ERROR_STOP on
 BEGIN;
 SET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='2s';
 DO $$BEGIN
 ASSERT current_database()='${db}' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
 ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
 ASSERT NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname IN('pg_net','pg_cron'));
 ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='${tour}' AND status='completed');
 ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id='${tour}');
 END $$;
 CREATE TEMP TABLE payout906_before ON COMMIT DROP AS SELECT ${allFacts} all_facts,${fingerprint(tables)} protected;
 SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
 DO $$DECLARE source jsonb;place jsonb;r jsonb;replay jsonb;receipt jsonb;updated jsonb;request uuid:=gen_random_uuid();second uuid:=gen_random_uuid();BEGIN
 source:=public.get_tournament_payout_recipients('${tour}');
 ASSERT jsonb_array_length(source->'places')=2 AND (source->>'owedTotal')::numeric=900000 AND (source->>'paidTotal')::numeric=0;
 SELECT x INTO STRICT place FROM jsonb_array_elements(source->'places')x WHERE (x->>'finishedPlace')::integer=2;
 ASSERT (place->>'prizeAmount')::numeric=200000 AND NOT (place->>'isPaid')::boolean;
 r:=public.record_tournament_prize_payment_v2('${tour}',2,'cash',place->>'confirmationToken',request);
 ASSERT r->>'ok'='true' AND r->>'outcome'='recorded',r::text;
 ASSERT r->>'entry_id'=place->>'entryId' AND r->>'recipient_ref'=place->>'recipientRef' AND (r->>'prize_amount')::numeric=200000;
 replay:=public.record_tournament_prize_payment_v2('${tour}',2,'cash',place->>'confirmationToken',request);
 ASSERT replay=r,'same-key replay changed receipt';
 receipt:=public.get_tournament_prize_payment_receipt_v2(request);
 ASSERT receipt->>'found'='true' AND receipt->'result'=r AND receipt->>'actor_id'='${actor}';
 replay:=public.record_tournament_prize_payment_v2('${tour}',2,'bank',place->>'confirmationToken',request);
 ASSERT replay->>'ok'='false' AND replay->>'error'='request_payload_conflict';
 replay:=public.record_tournament_prize_payment_v2('${tour}',2,'cash',place->>'confirmationToken',second);
 ASSERT replay->>'outcome'='already_paid' AND replay->>'payment_id'=r->>'payment_id';
 updated:=public.get_tournament_payout_recipients('${tour}');
 ASSERT (updated->>'owedTotal')::numeric=900000 AND (updated->>'paidTotal')::numeric=200000 AND (updated->>'paidCount')::integer=1;
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(updated->'places')x WHERE (x->>'finishedPlace')::integer=2 AND (x->>'isPaid')::boolean);
 END $$;
 RESET ROLE;
 DO $$BEGIN
 ASSERT (SELECT count(*)=1 AND sum(prize_amount)=200000 FROM public.tournament_prize_payments WHERE tournament_id='${tour}' AND status='paid');
 ASSERT (SELECT protected FROM payout906_before)=${fingerprint(tables)},'payout changed unrelated original journey facts';
 END $$;
 -- Save only proof digest outside the rolled-back transaction in this psql session.
 SELECT all_facts AS baseline FROM payout906_before \gset
 ROLLBACK;
 SELECT jsonb_build_object('database','${db}','allFactsUnchanged',:'baseline'=${allFacts},'tour','${tour}','testedPlace',2,'testedAmount',200000,'transaction','ROLLBACK');`;
 const out=execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8',timeout:30000,maxBuffer:1e6,stdio:['pipe','pipe','pipe']}).trim();
 const result=JSON.parse(out);assert.equal(result.allFactsUnchanged,true);results.push(result);
}
writeFileSync('D:/Quy trình/output/reports/payout906-original-single-rollback-local-20261026.json',JSON.stringify({scope:'original Single244 canonical payment and exact-key recovery; rollback only',results},null,2)+'\n');
console.log('PAYOUT906_ORIGINAL_SINGLE_RECORD_REPLAY_RECEIPT_CONFLICT_ALREADYPAID_ALL_ROLLBACK_PASS',JSON.stringify(results));
