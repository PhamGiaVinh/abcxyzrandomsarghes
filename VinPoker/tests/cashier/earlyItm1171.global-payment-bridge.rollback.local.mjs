import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.VINPOKER_EARLYITM1171_LOCAL,'1');
const attempt=process.env.VINPOKER_EARLYITM1171_ATTEMPT;assert.match(attempt??'',/^[a-z0-9]+$/);
const base='D:/Quy trình/output/reports/earlyitm1171-global-payment-bridge-'+attempt+'-local-20261028';assert.equal(existsSync(base+'.sql'),false);
let sql=readFileSync('D:/Quy trình/output/reports/earlyitm1168-liability-green3-local-20261028.sql','utf8');
const start=sql.indexOf('-- Transaction-private');assert.ok(start>0);
const packageSource=readFileSync('supabase/pending-migrations/20261027172548_multiday_individual_verified_payment_v1.sql','utf8');
const recovery=process.env.VINPOKER_EARLYITM1171_RECOVERY==='1';
const down=recovery?readFileSync('tests/cashier/earlyItm1171.individual-payment.down.sql','utf8'):'';
sql=sql.slice(0,start)+packageSource+'\n'+(recovery?down+'\n'+packageSource+'\n':'')+sql.slice(start);
const anchor=' -- Run after1162 has frozen rank8. All native writes remain in outerROLLBACK.';
assert.equal(sql.split(anchor).length,2);
const before=sql.slice(0,sql.indexOf(anchor));let after=sql.slice(sql.indexOf(anchor));
// A paid recipient is refused earlier by the existing restore payment guard.
// Keep the protected-facts equality assertion after both canonical wrappers.
after=after.replace("RAISE EXCEPTION 'frozen canonical restore not rejected by invariant: % %',wrapper,new_receipt;",
 "ASSERT new_receipt->>'ok'='false' AND new_receipt->>'error'='restore_result_dependency',new_receipt::text;");
// The canonical early paid marker now exists throughout the remaining lifecycle.
after=after.replaceAll('ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=final);',
 'ASSERT (SELECT count(*)=1 AND sum(prize_amount)=100000 FROM public.tournament_prize_payments WHERE tournament_id=final);');
after=after.replaceAll("(complete->>'unpaidObligationVnd')::bigint=800000","(complete->>'unpaidObligationVnd')::bigint=700000");
after=after.replaceAll("(changed->>'unpaidObligationVnd')::numeric=1600000","(changed->>'unpaidObligationVnd')::numeric=1500000");
after=after.replaceAll("(result->>'unpaidObligationVnd')::numeric=800000","(result->>'unpaidObligationVnd')::numeric=700000");
after=after.replace("(item->>'outstanding')::numeric=800000 AND (item->>'paid')::numeric=0",
 "(item->>'outstanding')::numeric=700000 AND (item->>'paid')::numeric=100000");
const priceStart=after.indexOf(' -- Nested negative probe uses the existing owner-only prize configuration');
const priceEnd=after.indexOf(' DECLARE preview jsonb;result jsonb;report jsonb;item jsonb;request uuid:=gen_random_uuid();BEGIN');
assert.ok(priceStart>0&&priceEnd>priceStart);
after=after.slice(0,priceStart)+String.raw`
 -- With an actual paid marker the canonical price writer refuses changes.
 DECLARE proposed jsonb;configuration jsonb;BEGIN
  SELECT jsonb_agg(jsonb_build_object('position',n,'amount',200000) ORDER BY n) INTO proposed FROM generate_series(1,8)n;
  configuration:=public.multi_day_payout_configuration_preview_v1(event,proposed);
  BEGIN
   PERFORM public.multi_day_save_prize_configuration_v1(event,proposed,configuration->>'configurationRevision',configuration->>'rulesVersion',
    configuration->>'fundingRevision',configuration->>'qualificationRevision',configuration->>'payoutInputHash',gen_random_uuid(),'1171 paid price edit must remain denied');
   RAISE EXCEPTION 'paid price configuration unexpectedly changed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'multi_day_configuration_already_finalized_or_paid' THEN RAISE;END IF;END;
  PERFORM set_config('test.e1168.priceDriftDenied','true',true);
 END;
`+after.slice(priceEnd);
const late=" r:=public.record_multi_day_prize_payment_v1(event,p,'cash',md5('LOCAL1161 no final individual rank'),gen_random_uuid());";
assert.equal(after.split(late).length,2);
after=after.replace(late,()=>String.raw`
 DECLARE receipt jsonb;replay jsonb;recipients jsonb;context jsonb;BEGIN
  receipt:=current_setting('test.e1170.result')::jsonb;
  replay:=public.record_multi_day_prize_payment_v1(event,p,'cash',current_setting('test.e1170.originalToken'),current_setting('test.e1170.request')::uuid);
  ASSERT replay=receipt,'early receipt changed after global finalization';
  ASSERT public.get_tournament_prize_payment_receipt_v2(current_setting('test.e1170.request')::uuid)->'result'=receipt;
  recipients:=public.get_tournament_payout_recipients(final);
  ASSERT (recipients->>'owedTotal')::numeric=800000 AND (recipients->>'paidTotal')::numeric=100000
   AND (recipients->>'totalCount')::integer=8 AND (recipients->>'paidCount')::integer=1,recipients::text;
  SELECT x INTO STRICT context FROM jsonb_array_elements(recipients->'places')x WHERE x->>'multiDayParticipationId'=p::text;
  ASSERT (context->>'obligationAmount')::numeric=100000 AND (context->>'paidAmount')::numeric=100000
   AND (context->>'prizeAmount')::numeric=0 AND context->>'isPaid'='true';
  PERFORM set_config('role','none',true);
  ASSERT (SELECT count(*)=1 AND sum(prize_amount)=100000 FROM public.tournament_prize_payments WHERE tournament_id=final);
  ASSERT (SELECT count(*)=1 FROM private.multi_day_individual_payment_commits_v1 WHERE event_id=event);
  ASSERT (SELECT count(*)=0 FROM private.multi_day_payment_commits_v1 WHERE event_id=event);
  SET CONSTRAINTS ALL IMMEDIATE;SET CONSTRAINTS ALL DEFERRED;
  PERFORM set_config('test.e1171',jsonb_build_object('owedVnd',800000,'paidVnd',100000,'unpaidVnd',700000,
   'publicPayments',1,'earlyProofs',1,'globalProofs',0,'earlyRequestReplayAfterGlobalIdentical',true,
   'globalRecipients',recipients,'individualGlobalLinkRetained',true)::text,true);
  PERFORM set_config('role','authenticated',true);
 END;
`+late);
let recoveryProbe='';
if(recovery){
 recoveryProbe=String.raw`
 PERFORM set_config('role','none',true);
 BEGIN
  EXECUTE convert_from(decode('`+Buffer.from(down,'utf8').toString('hex')+String.raw`','hex'),'UTF8');
  RAISE EXCEPTION 'payment history down unexpectedly succeeded';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'individual_payment_history_retained_use_forward_repair' THEN RAISE;END IF;END;
 ASSERT (SELECT count(*)=1 AND sum(prize_amount)=100000 FROM public.tournament_prize_payments WHERE tournament_id=final);
 ASSERT (SELECT count(*)=1 FROM private.multi_day_individual_payment_commits_v1 WHERE event_id=event);
 PERFORM set_config('role','authenticated',true);
 PERFORM set_config('test.e1171.recovery','{"emptyDownReapply":true,"historyDownRefused":true,"paymentPreserved":true}',true);
`;
}
sql=before+readFileSync('tests/cashier/earlyItm1170.payment.extension.sql','utf8')+'\n'+recoveryProbe+after;
const first="SELECT current_setting('test.early1161')::jsonb;";assert.equal(sql.split(first).length,2);
sql=sql.replace(first,()=>"SELECT current_setting('test.e1170')::jsonb;SELECT current_setting('test.e1171')::jsonb;"+first);
if(recovery)sql=sql.replace(first,()=>"SELECT current_setting('test.e1171.recovery')::jsonb;"+first);
// Older observations describe their own zero-payment checks before injection;
// emit only the new authoritative early/global observations and rollback proofs.
sql=sql.replace(/SELECT current_setting\('test\.(?:early116[1234]|e116[678](?:\.final|\.parity)?)'\)::jsonb;/g,'');
const rb='ROLLBACK;\nDO $$ BEGIN ASSERT (SELECT fingerprint FROM d2_789_protected)';
assert.equal(sql.split(rb).length,2);
sql=sql.replace(rb,()=>String.raw`
SELECT jsonb_build_object('candidatePaymentFunctions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(p.prosrc),'definition',pg_get_functiondef(p.oid)) ORDER BY p.oid::regprocedure::text)
 FROM pg_proc p WHERE p.oid IN(
 'private.is_verified_multi_day_payment_v1(public.tournament_prize_payments)'::regprocedure,
 'public.get_multi_day_payout_recipients_v1(uuid)'::regprocedure,
 'public.record_multi_day_prize_payment_v1(uuid,uuid,text,text,uuid)'::regprocedure,
 'private.multi_day_unified_obligation_accounting_v1(uuid)'::regprocedure,
 'private.multi_day_payment_funding_evaluate_v1(uuid,jsonb)'::regprocedure,
 'private.multi_day_payment_verified_funding_v1(uuid)'::regprocedure,
 'private.is_individual_multi_day_payment_v1(public.tournament_prize_payments)'::regprocedure,
 'private.multi_day_individual_payment_state_v1(uuid)'::regprocedure,
 'floor_private.multi_day_individual_payment_context_v1(uuid,uuid)'::regprocedure,
 'floor_private.get_multi_day_individual_payment_recipients_v1(uuid)'::regprocedure,
 'floor_private.record_multi_day_individual_payment_v1(uuid,uuid,text,text,uuid)'::regprocedure)));
`+rb);
sql+=String.raw`
DO $$ BEGIN
 ASSERT to_regclass('private.multi_day_individual_payment_commits_v1') IS NULL;
 ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.is_verified_multi_day_payment_v1(public.tournament_prize_payments)'::regprocedure)='5addc8c68b15fb44b14cd5199c6a404d';
 ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.record_multi_day_prize_payment_v1(uuid,uuid,text,text,uuid)'::regprocedure)='246185b8b596815a5a3bd074fc03e26d';
END $$;
SELECT jsonb_build_object('earlyPaymentCandidateRemoved',true,'paymentBaselineFunctionsRestored',true);
`;
writeFileSync(base+'.sql',sql);
try{
 const raw=execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',timeout:60000,maxBuffer:4e6});
 const observations=raw.split(/\r?\n/).filter(x=>x.startsWith('{')).map(JSON.parse);assert.equal(observations.at(-1).paymentBaselineFunctionsRestored,true);
 writeFileSync(base+'.json',JSON.stringify({kind:'EARLY_PAYMENT_GLOBAL_BRIDGE_NATIVE_OUTER_ROLLBACK',observations,durablyApplied:false,fullR03Accepted:false},null,2));
 console.log('EARLYITM1171_NATIVE_EARLY100K_GLOBAL800K_PAID100K_UNPAID700K_ROLLBACK_PASS');
}catch(e){writeFileSync(base+'.failure.log',String(e.stderr??e.stack));throw e;}
