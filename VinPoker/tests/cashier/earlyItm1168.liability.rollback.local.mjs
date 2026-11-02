import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.VINPOKER_EARLYITM1168_LOCAL,'1');
const candidate=process.env.VINPOKER_EARLYITM1168_CANDIDATE==='1';
const base='D:/Quy trình/output/reports/earlyitm1168-liability-'+(candidate?'green3':'red3')+'-local-20261028';assert.equal(existsSync(base+'.sql'),false);
let sql=readFileSync('D:/Quy trình/output/reports/earlyitm1167-obligation-commit2-local-20261027.sql','utf8');
const start='-- Transaction-private business qualification only, not persistent gate activation.';assert.equal(sql.split(start).length,2);
if(candidate)sql=sql.replace(start,()=>readFileSync('supabase/pending-migrations/20261027170011_multiday_individual_global_liability_link_v1.sql','utf8')+'\n'+start);
const seed=' UPDATE public.tournaments SET event_id=event WHERE id=final;';assert.equal(sql.split(seed).length,2);
sql=sql.replace(seed,()=>seed+"\n UPDATE public.tournaments SET start_time=clock_timestamp() WHERE id=final; -- Explicit TEST tour setup; retain canonical report period predicate.\n");
const early=' DECLARE funding jsonb;quote jsonb;BEGIN';assert.equal(sql.split(early).length,2);
sql=sql.replace(early,()=>String.raw`
 DECLARE report jsonb;item jsonb;BEGIN
  report:=public.get_club_payout_liability_v2('2000-01-01','2100-12-31',club);
  SELECT x INTO STRICT item FROM jsonb_array_elements(report->'perTournament')x WHERE x->>'tournamentId'=final::text;
  RAISE NOTICE '1168 early liability: %',item;
  ASSERT (item->>'owed')::numeric=100000 AND item->>'hasFinishedPlace'='true','early debt missing from canonical liability';
  ASSERT item->>'liabilityScope'='INDIVIDUAL' AND item->>'isPartial'='true';
  PERFORM set_config('test.e1168.earlyClubOwed',report->>'owedTotal',true);
  PERFORM set_config('test.e1168.earlyRow',item::text,true);
 END;
`+early);
const late=" r:=public.record_multi_day_prize_payment_v1(event,p,'cash',md5('LOCAL1161 no final individual rank'),gen_random_uuid());";assert.equal(sql.split(late).length,2);
if(candidate){const beforeFinal=" ASSERT public.get_multi_day_individual_obligation_receipt_v1(event,current_setting('test.e1167.request')::uuid)->'receipt'=current_setting('test.e1167.receipt')::jsonb,'retained obligation receipt changed after canonical close';";assert.equal(sql.split(beforeFinal).length,2);sql=sql.replace(beforeFinal,()=>beforeFinal+'\n'+readFileSync('tests/cashier/earlyItm1168.price-drift.extension.sql','utf8'));}
sql=sql.replace(late,()=>String.raw`
 DECLARE preview jsonb;result jsonb;report jsonb;item jsonb;request uuid:=gen_random_uuid();BEGIN
  preview:=public.multi_day_payout_preview_v1(event);
  result:=public.multi_day_finalize_payout_v1(event,preview->>'rulesVersion',preview->>'fundingRevision',preview->>'qualificationRevision',preview->>'payoutInputHash',request);
  ASSERT result->>'state'='FINALIZED_OBLIGATIONS' AND (result->>'unpaidObligationVnd')::numeric=800000,result::text;
  PERFORM set_config('role','none',true);
  ASSERT (SELECT jsonb_array_length(source_snapshot->'individualObligations')=1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=event);
  ASSERT (SELECT count(*)=1 AND sum(amount_vnd)=100000 FROM private.multi_day_individual_obligations_v1 WHERE event_id=event);
  PERFORM set_config('role','authenticated',true);
  report:=public.get_club_payout_liability_v2('2000-01-01','2100-12-31',club);
  SELECT x INTO STRICT item FROM jsonb_array_elements(report->'perTournament')x WHERE x->>'tournamentId'=final::text;
  ASSERT (item->>'owed')::numeric=800000 AND (item->>'outstanding')::numeric=800000 AND (item->>'paid')::numeric=0,item::text;
  ASSERT item->>'liabilityScope'='GLOBAL' AND item->>'isPartial'='false';
  ASSERT (report->>'owedTotal')::numeric=(current_setting('test.e1168.earlyClubOwed'))::numeric+700000,'individual debt counted twice';
  result:=public.multi_day_finalize_payout_v1(event,preview->>'rulesVersion',preview->>'fundingRevision',preview->>'qualificationRevision',preview->>'payoutInputHash',request);
  ASSERT result->>'idempotent'='true';
  PERFORM set_config('test.e1168.final',jsonb_build_object('earlyRow',current_setting('test.e1168.earlyRow')::jsonb,'globalRow',item,
   'clubOwedDelta',700000,'individualHistoryRows',1,'individualHistoryAmountVnd',100000,'linkedOnce',true,'payments',0,
   'canonicalPriceDriftDenied',(current_setting('test.e1168.priceDriftDenied'))::boolean)::text,true);
 END;
`+late);
sql=sql.replace("r->>'error'='multi_day_obligations_not_finalized'",()=>"r->>'error'='payout_confirmation_stale'");
sql=sql.replace(' ASSERT NOT EXISTS(SELECT 1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=event);',()=>" ASSERT (SELECT count(*)=1 FROM public.multi_day_payout_finalizations_v1 WHERE event_id=event);");
sql=sql.replace("SELECT current_setting('test.early1164')::jsonb;",()=>"SELECT current_setting('test.early1164')::jsonb;SELECT current_setting('test.e1168.final')::jsonb;");
if(candidate)sql=sql.replace('ROLLBACK;\nDO $$ BEGIN ASSERT (SELECT fingerprint FROM d2_789_protected)',()=>"SELECT jsonb_object_agg(p.oid::regprocedure::text,md5(p.prosrc)) FROM pg_proc p WHERE p.oid IN('public.multi_day_finalize_payout_v1(uuid,text,text,text,text,uuid)'::regprocedure,'public.get_club_payout_liability(timestamptz,timestamptz,uuid)'::regprocedure,'private.reconcile_multi_day_individual_obligations_v1(uuid,jsonb)'::regprocedure,'private.multi_day_unified_obligation_accounting_v1(uuid)'::regprocedure);\nROLLBACK;\nDO $$ BEGIN ASSERT (SELECT fingerprint FROM d2_789_protected)");
const snapshot='CREATE TEMP TABLE d2_789_protected AS SELECT pg_temp.d2_789_fingerprint() fingerprint;';
sql=sql.replace(snapshot,()=>snapshot+"CREATE TEMP TABLE early1168_protected AS SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.event_id) FROM public.multi_day_payout_finalizations_v1 x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.actor_id,x.request_id) FROM floor_private.payout_payment_receipts_v1 x))::text) hash;");
const tail="SELECT jsonb_build_object('rollbackProtectedGroups',41,'unchanged',true,'candidateRemoved',true,'closeReportsUnchanged',true,'baselineFunctionsRestored',true,'obligationObjectsRemoved',true);";assert.equal(sql.split(tail).length,2);
sql=sql.replace(tail,()=>"DO $$ BEGIN ASSERT (SELECT hash FROM early1168_protected)= (SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.event_id) FROM public.multi_day_payout_finalizations_v1 x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.actor_id,x.request_id) FROM floor_private.payout_payment_receipts_v1 x))::text));ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_club_payout_liability(timestamptz,timestamptz,uuid)'::regprocedure)='c14f988d9940615ddfb76774b191ba97';ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.multi_day_finalize_payout_v1(uuid,text,text,text,text,uuid)'::regprocedure)='924ff3f29f94d8f962d703d384b46c1b';END $$;"+tail);
writeFileSync(base+'.sql',sql);
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const raw=execFileSync('wsl',args,{input:sql,encoding:'utf8',timeout:60000,maxBuffer:4e6});
const observations=raw.split(/\r?\n/).filter(x=>x.startsWith('{')).map(JSON.parse);assert.equal(observations.at(-1).candidateRemoved,true);
writeFileSync(base+'.json',JSON.stringify({kind:'INDIVIDUAL_GLOBAL_LIABILITY_RECONCILIATION_CANONICAL_READ_OUTER_ROLLBACK',observations,durablyApplied:false,fullR03Accepted:false},null,2)+'\n');
console.log('EARLYITM1168_CANONICAL_LIABILITY100_TO_GLOBAL800_NOT900_ROLLBACK_PASS_NOT_EARLY_PAYMENT');
