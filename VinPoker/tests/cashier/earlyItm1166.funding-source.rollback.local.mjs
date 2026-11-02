import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.VINPOKER_EARLYITM1166_LOCAL,'1');
const base='D:/Quy trình/output/reports/earlyitm1166-funding-source-attempt2-local-20261028';assert.equal(existsSync(base+'.sql'),false);
let sql=readFileSync('D:/Quy trình/output/reports/earlyitm1164-finalization-green3-local-20261027.sql','utf8');
const start='-- Transaction-private business qualification only, not persistent gate activation.';assert.equal(sql.split(start).length,2);
sql=sql.replace(start,()=>readFileSync('supabase/pending-migrations/20261027162130_multiday_shared_obligation_amount_v1.sql','utf8')+'\n'+readFileSync('supabase/pending-migrations/20261027162844_multiday_verified_funding_projection_v1.sql','utf8')+'\n'+start);
const seed=' UPDATE public.tournaments SET event_id=event WHERE id=final;';assert.equal(sql.split(seed).length,2);
sql=sql.replace(seed,()=>seed+"\n INSERT INTO public.tournament_prizes(tournament_id,position,percentage,amount) SELECT final,n,12.5,100000 FROM generate_series(1,8)n; -- Synthetic TEST configuration before any flight ends.\n");
const early=" RAISE NOTICE 'EARLYITM1162_INDIVIDUAL_RANK8_CONFIRMED_REPLAY_RECOVERY_RESTORE_RERANK_DENIED_NOT_PAYMENT_PASS';";assert.equal(sql.split(early).length,2);
sql=sql.replace(early,()=>early+String.raw`
 DECLARE funding jsonb;quote jsonb;BEGIN
  PERFORM set_config('role','none',true);
  funding:=private.multi_day_verified_funding_source_v1(event);
  quote:=private.multi_day_individual_obligation_quote_v1(p);
  ASSERT funding->>'state'='INCOMING_SOURCE_VERIFIED' AND (funding->>'directPoolVnd')::bigint=1600000,funding::text;
  ASSERT (funding->>'feesVnd')::bigint=0 AND (funding->>'recordedOverlayVnd')::bigint=0;
  ASSERT jsonb_array_length(funding->'sourceSnapshot'->'registrations')=16;
  ASSERT (quote->>'totalVnd')::numeric=100000 AND quote->>'fundingState'='NOT_VERIFIED';
  ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_entries WHERE tournament_id=final AND finished_place IS NOT NULL);
  PERFORM set_config('test.e1166.early',funding::text,true);
  PERFORM set_config('role','authenticated',true);
 END;
`);
const late=" r:=public.record_multi_day_prize_payment_v1(event,p,'cash',md5('LOCAL1161 no final individual rank'),gen_random_uuid());";assert.equal(sql.split(late).length,2);
sql=sql.replace(late,()=>String.raw`
 DECLARE funding jsonb;complete jsonb;early jsonb;key text;BEGIN
  complete:=public.multi_day_payout_preview_v1(event);
  PERFORM set_config('role','none',true);
  funding:=private.multi_day_verified_funding_source_v1(event);early:=current_setting('test.e1166.early')::jsonb;
  ASSERT funding=early,'source funding changed solely with result finalization';
  FOREACH key IN ARRAY ARRAY['rulesVersion','fundingRevision','qualificationRevision','directPoolVnd','transferPoolVnd','feesVnd','recordedOverlayVnd','itmPlaces'] LOOP
   ASSERT funding->key=complete->key,'funding vs canonical preview mismatch: '||key;
  END LOOP;
  ASSERT funding->'sourceSnapshot'->'registrations'=complete->'sourceSnapshot'->'registrations';
  ASSERT funding->'sourceSnapshot'->'bankProof'=complete->'sourceSnapshot'->'bankProof';
  ASSERT funding->'prizePositions'=complete->'sourceSnapshot'->'prizePositions';
  ASSERT (complete->>'unpaidObligationVnd')::bigint=800000;
  PERFORM set_config('test.e1166.parity',jsonb_build_object('earlyLateSourceIdentical',true,'canonicalPreviewSourceFieldsIdentical',true,
   'registrations',16,'directPoolVnd',1600000,'feesVnd',0,'overlayVnd',0,'fullUnpaidVnd',800000,'earlyOfficialRanks',0,
   'earlyFrozenIndividualRanks',1,'obligationPersistence','NOT_PERFORMED','paymentExecution','NOT_PERFORMED')::text,true);
  PERFORM set_config('role','authenticated',true);
 END;
`+late);
sql=sql.replace("SELECT current_setting('test.early1164')::jsonb;",()=>"SELECT current_setting('test.early1164')::jsonb;SELECT current_setting('test.e1166.parity')::jsonb;");
const tail="SELECT jsonb_build_object('rollbackProtectedGroups',41,'unchanged',true,'candidateRemoved',true,'closeReportsUnchanged',true,'baselineFunctionsRestored',true);";assert.equal(sql.split(tail).length,2);
sql=sql.replace(tail,()=>"DO $$ BEGIN ASSERT to_regprocedure('private.multi_day_funding_evaluate_v1(uuid,jsonb)') IS NULL;ASSERT to_regprocedure('private.multi_day_verified_funding_source_v1(uuid)') IS NULL;ASSERT to_regprocedure('private.multi_day_obligation_amount_v1(numeric,numeric,numeric)') IS NULL;ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.multi_day_payout_evaluate_v2(uuid,jsonb)'::regprocedure)='a75c2bfc3d7bf05d5ee05d830bda38dc';END $$;"+tail);
writeFileSync(base+'.sql',sql);
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const raw=execFileSync('wsl',args,{input:sql,encoding:'utf8',timeout:60000,maxBuffer:4e6});
const observations=raw.split(/\r?\n/).filter(x=>x.startsWith('{')).map(JSON.parse);assert.equal(observations.at(-1).candidateRemoved,true);
writeFileSync(base+'.json',JSON.stringify({kind:'EARLY_CANONICAL_INCOMING_FUNDING_PROJECTION_PARITY_NOT_OBLIGATION_OR_PAYMENT',observations,durablyApplied:false,fullR03Accepted:false},null,2)+'\n');
console.log('EARLYITM1166_EARLY_LATE_CANONICAL_FUNDING_PARITY_ROLLBACK_PASS_NOT_PAYMENT');
