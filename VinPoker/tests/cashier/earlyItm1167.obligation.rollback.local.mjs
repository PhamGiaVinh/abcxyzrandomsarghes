import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.VINPOKER_EARLYITM1167_LOCAL,'1');
const shortfall=process.env.VINPOKER_EARLYITM1167_SHORTFALL==='1';
const base='D:/Quy trình/output/reports/earlyitm1167-obligation-'+(shortfall?'shortfall2':'commit2')+'-local-20261027';assert.equal(existsSync(base+'.sql'),false);
let sql=readFileSync('D:/Quy trình/output/reports/earlyitm1166-funding-source-attempt2-local-20261028.sql','utf8');
const start='-- Transaction-private business qualification only, not persistent gate activation.';assert.equal(sql.split(start).length,2);
sql=sql.replace(start,()=>readFileSync('supabase/pending-migrations/20261027164129_multiday_individual_obligation_commit_v1.sql','utf8')+'\n'+start);
const cut=sql.indexOf(' DECLARE funding jsonb;quote jsonb;BEGIN');assert.ok(cut>0);
if(shortfall){sql=sql.slice(0,cut);const seed='SELECT final,n,12.5,100000 FROM generate_series(1,8)n;';assert.equal(sql.split(seed).length,2);sql=sql.replace(seed,()=>seed.replace('12.5,100000','12.5,300000'));}
const extension=String.raw`
 DECLARE preview jsonb;result jsonb;retained jsonb;request uuid:=gen_random_uuid();BEGIN
  preview:=public.get_multi_day_individual_obligation_preview_v1(event,p);
  IF (preview->'budget'->>'requiredShortfallVnd')::numeric>0 THEN
   ASSERT preview->>'state'='REQUIRED_SHORTFALL' AND (preview->'budget'->>'requiredTotalVnd')::numeric=2400000;
   ASSERT (preview->'budget'->>'fundedVnd')::numeric=1600000;
   BEGIN
    PERFORM public.confirm_multi_day_individual_obligation_v1(event,p,preview->'quote'->>'quoteHash',preview->'funding'->>'sourceInputHash',preview->'budget'->>'budgetHash',request);
    RAISE EXCEPTION 'individual amount affordable but whole field underfunded was accepted';
   EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'individual_obligation_shortfall_unfunded' THEN RAISE;END IF;END;
   ASSERT public.get_multi_day_individual_obligation_receipt_v1(event,request)->>'outcome'='not_found';
   PERFORM set_config('role','none',true);
   ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_individual_obligations_v1 WHERE event_id=event);
   ASSERT NOT EXISTS(SELECT 1 FROM private.multi_day_individual_obligation_requests_v1 WHERE event_id=event);
   PERFORM set_config('test.e1167',jsonb_build_object('shortfallDenied',true,'fundedVnd',1600000,'requiredTotalVnd',2400000,'obligations',0,'receipts',0,'payments',0)::text,true);
  ELSE
   ASSERT preview->>'state'='READY_TO_CONFIRM' AND (preview->'budget'->>'requiredTotalVnd')::numeric=800000;
   BEGIN
    PERFORM public.confirm_multi_day_individual_obligation_v1(event,p,md5('stale quote'),preview->'funding'->>'sourceInputHash',preview->'budget'->>'budgetHash',request);
    RAISE EXCEPTION 'stale quote accepted';
   EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'individual_obligation_source_changed' THEN RAISE;END IF;END;
   BEGIN
    PERFORM public.confirm_multi_day_individual_obligation_v1(event,p,preview->'quote'->>'quoteHash',md5('stale source'),preview->'budget'->>'budgetHash',request);
    RAISE EXCEPTION 'stale source accepted';
   EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'individual_obligation_source_changed' THEN RAISE;END IF;END;
   BEGIN
    PERFORM public.confirm_multi_day_individual_obligation_v1(event,p,preview->'quote'->>'quoteHash',preview->'funding'->>'sourceInputHash',md5('stale budget'),request);
    RAISE EXCEPTION 'stale budget accepted';
   EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'individual_obligation_source_changed' THEN RAISE;END IF;END;
   result:=public.confirm_multi_day_individual_obligation_v1(event,p,preview->'quote'->>'quoteHash',preview->'funding'->>'sourceInputHash',preview->'budget'->>'budgetHash',request);
   ASSERT result->>'outcome'='recorded' AND (result->'obligation'->>'amount_vnd')::numeric=100000;
   ASSERT public.confirm_multi_day_individual_obligation_v1(event,p,preview->'quote'->>'quoteHash',preview->'funding'->>'sourceInputHash',preview->'budget'->>'budgetHash',request)=result;
   ASSERT public.get_multi_day_individual_obligation_receipt_v1(event,request)->'receipt'=result;
   PERFORM set_config('test.e1167.request',request::text,true);PERFORM set_config('test.e1167.receipt',result::text,true);
   BEGIN
    PERFORM public.confirm_multi_day_individual_obligation_v1(event,p,md5('changed payload'),preview->'funding'->>'sourceInputHash',preview->'budget'->>'budgetHash',request);
    RAISE EXCEPTION 'changed request payload accepted';
   EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'IDEMPOTENCY_CONFLICT' THEN RAISE;END IF;END;
   retained:=public.confirm_multi_day_individual_obligation_v1(event,p,preview->'quote'->>'quoteHash',preview->'funding'->>'sourceInputHash',preview->'budget'->>'budgetHash',gen_random_uuid());
   ASSERT retained->>'outcome'='already_finalized' AND retained->'obligation'=result->'obligation';
   PERFORM set_config('role','none',true);
   ASSERT (SELECT count(*)=1 AND sum(amount_vnd)=100000 FROM private.multi_day_individual_obligations_v1 WHERE event_id=event);
   ASSERT (SELECT count(*)=2 FROM private.multi_day_individual_obligation_requests_v1 WHERE event_id=event);
   BEGIN UPDATE private.multi_day_individual_obligations_v1 SET amount_vnd=1 WHERE participation_id=p;
    RAISE EXCEPTION 'immutable obligation changed';EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_qualification_immutable';END;
   ASSERT NOT EXISTS(SELECT 1 FROM public.tournament_prize_payments WHERE tournament_id=final);
   PERFORM set_config('test.e1167',jsonb_build_object('obligations',1,'amountVnd',100000,'fullBudgetVnd',800000,'fundedVnd',1600000,
    'requestReceipts',2,'sameRequestReplayIdentical',true,'secondRequestNoDuplicate',true,'immutable',true,'payments',0)::text,true);
  END IF;
  PERFORM set_config('role','authenticated',true);
 END;
`;
if(shortfall){sql+=extension+"END $$;SELECT current_setting('test.e1167')::jsonb;ROLLBACK;DO $$ BEGIN ASSERT (SELECT fingerprint FROM d2_789_protected)=pg_temp.d2_789_fingerprint();ASSERT to_regclass('private.multi_day_individual_obligations_v1') IS NULL;END $$;SELECT jsonb_build_object('unchangedGroups',41,'candidateRemoved',true);";}
else{const anchor=' DECLARE funding jsonb;quote jsonb;BEGIN';assert.equal(sql.split(anchor).length,2);sql=sql.replace(anchor,()=>extension+anchor);sql=sql.replace("SELECT current_setting('test.early1164')::jsonb;",()=>"SELECT current_setting('test.early1164')::jsonb;SELECT current_setting('test.e1167')::jsonb;");
 const late=" r:=public.record_multi_day_prize_payment_v1(event,p,'cash',md5('LOCAL1161 no final individual rank'),gen_random_uuid());";assert.equal(sql.split(late).length,2);
 sql=sql.replace(late,()=>" ASSERT public.get_multi_day_individual_obligation_receipt_v1(event,current_setting('test.e1167.request')::uuid)->'receipt'=current_setting('test.e1167.receipt')::jsonb,'retained obligation receipt changed after canonical close';\n"+late);
}
sql=sql.replace("SELECT jsonb_build_object('rollbackProtectedGroups',41,'unchanged',true,'candidateRemoved',true,'closeReportsUnchanged',true,'baselineFunctionsRestored',true);",()=>"DO $$ BEGIN ASSERT to_regclass('private.multi_day_individual_obligations_v1') IS NULL;ASSERT to_regclass('private.multi_day_individual_obligation_requests_v1') IS NULL;ASSERT to_regprocedure('public.confirm_multi_day_individual_obligation_v1(uuid,uuid,text,text,text,uuid)') IS NULL;END $$;SELECT jsonb_build_object('rollbackProtectedGroups',41,'unchanged',true,'candidateRemoved',true,'closeReportsUnchanged',true,'baselineFunctionsRestored',true,'obligationObjectsRemoved',true);");
writeFileSync(base+'.sql',sql);
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const raw=execFileSync('wsl',args,{input:sql,encoding:'utf8',timeout:60000,maxBuffer:4e6});
const observations=raw.split(/\r?\n/).filter(x=>x.startsWith('{')).map(JSON.parse);assert.equal(observations.at(-1).candidateRemoved,true);
writeFileSync(base+'.json',JSON.stringify({kind:'INDIVIDUAL_OBLIGATION_COMMIT_OR_FULL_BUDGET_SHORTFALL_OUTER_ROLLBACK_NO_PAYMENT',shortfall,observations,durablyApplied:false,fullR03Accepted:false},null,2)+'\n');
console.log('EARLYITM1167_'+(shortfall?'WHOLE_BUDGET_SHORTFALL_DENIED':'OBLIGATION_COMMIT_REPLAY_RECEIPT_NO_DUPLICATE')+'_ROLLBACK_PASS_NOT_PAYMENT');
