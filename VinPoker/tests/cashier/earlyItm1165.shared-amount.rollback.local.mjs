import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.VINPOKER_EARLYITM1165_LOCAL,'1');
const base='D:/Quy trình/output/reports/earlyitm1165-shared-amount-attempt2-local-20261028';assert.equal(existsSync(base+'.sql'),false);
let sql=readFileSync('D:/Quy trình/output/reports/earlyitm1162-individual-rank-executed-attempt6-local-20261027.sql','utf8');
const preview=String.raw`
DO $preview$ DECLARE r jsonb;BEGIN
 PERFORM set_config('request.jwt.claim.sub','675fe35e-60a8-4452-bb90-e79486d54da6',true);
 PERFORM set_config('request.jwt.claims','{"sub":"675fe35e-60a8-4452-bb90-e79486d54da6","role":"authenticated"}',true);
 PERFORM set_config('role','authenticated',true);
 r:=public.multi_day_payout_configuration_preview_v1('dbb49f8d-7d47-4c2c-afd9-f57062c9971d',
 '[{"position":1,"amount":110000},{"position":2,"amount":110000},{"position":3,"amount":110000},{"position":4,"amount":110000}]'::jsonb);
 PERFORM set_config('role','none',true);
 IF current_setting('test.e1165.before',true) IS NULL OR current_setting('test.e1165.before',true)='' THEN
  PERFORM set_config('test.e1165.before',r::text,true);
 ELSE
  ASSERT r=current_setting('test.e1165.before')::jsonb,'canonical complete payout preview changed';
  PERFORM set_config('test.e1165.parity',jsonb_build_object('equal',true,'obligations',jsonb_array_length(r->'obligations'),
   'totalVnd',(r->>'paidPlayerVnd')::numeric+(r->>'unpaidObligationVnd')::numeric,'state',r->>'state')::text,true);
 END IF;
END $preview$;
`;
const start='-- Transaction-private business qualification only, not persistent gate activation.';assert.equal(sql.split(start).length,2);
const allow="UPDATE public.multi_day_package_release_v1 SET enabled=true,allowed_club_ids=ARRAY(SELECT DISTINCT x FROM unnest(coalesce(allowed_club_ids,'{}'::uuid[])||ARRAY['a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'::uuid])x) WHERE id;\n";
sql=sql.replace(start,()=>allow+preview+readFileSync('supabase/pending-migrations/20261027162130_multiday_shared_obligation_amount_v1.sql','utf8')+'\n'+preview+start);
const seed=' UPDATE public.tournaments SET event_id=event WHERE id=final;';assert.equal(sql.split(seed).length,2);
sql=sql.replace(seed,()=>seed+"\n INSERT INTO public.tournament_prizes(tournament_id,position,percentage,amount) SELECT final,n,12.5,100000 FROM generate_series(1,8)n; -- Explicit synthetic TEST prize configuration before any flight ends.\n");
const anchor=" r:=public.record_multi_day_prize_payment_v1(event,p,'cash',md5('LOCAL1161 no final individual rank'),gen_random_uuid());";assert.equal(sql.split(anchor).length,2);
sql=sql.replace(anchor,()=>String.raw`
 PERFORM set_config('role','none',true);
 ASSERT private.multi_day_obligation_amount_v1(0,0,0)=0;
 ASSERT private.multi_day_obligation_amount_v1(80,100,20)=120;
 ASSERT private.multi_day_obligation_amount_v1(150,100,20)=170;
 ASSERT private.multi_day_obligation_amount_v1(9007199254740991,0,0)=9007199254740991;
 BEGIN PERFORM private.multi_day_obligation_amount_v1(9007199254740991,0,1);RAISE EXCEPTION 'overflow accepted';
 EXCEPTION WHEN numeric_value_out_of_range THEN ASSERT SQLERRM='multi_day_payout_amount_overflow';END;
 FOREACH amount_before IN ARRAY ARRAY[-1::numeric,0.5::numeric,'NaN'::numeric] LOOP
  BEGIN PERFORM private.multi_day_obligation_amount_v1(amount_before,0,0);RAISE EXCEPTION 'invalid money accepted';
  EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_payout_fractional_or_invalid_obligation';END;
 END LOOP;
 BEGIN PERFORM private.multi_day_obligation_amount_v1(NULL,0,0);RAISE EXCEPTION 'null amount accepted';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_payout_fractional_or_invalid_obligation';END;
 snap:=private.multi_day_individual_obligation_quote_v1(p);
 ASSERT snap->>'entryId'=seeded_entry::text AND (snap->>'rank')::integer=8 AND (snap->>'totalVnd')::numeric=100000,snap::text;
 ASSERT snap->>'fundingState'='NOT_VERIFIED' AND snap->>'obligationPersistence'='NOT_PERFORMED' AND snap->>'paymentExecution'='NOT_PERFORMED';
 BEGIN PERFORM private.multi_day_individual_obligation_quote_v1(gen_random_uuid());RAISE EXCEPTION 'unconfirmed individual quoted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'individual_obligation_final_rank_required' THEN RAISE;END IF;END;
 PERFORM set_config('test.e1165.quote',snap::text,true);
 PERFORM set_config('role','authenticated',true);
`+anchor);
sql=sql.replace("SELECT current_setting('test.early1162')::jsonb;",()=>"SELECT current_setting('test.early1162')::jsonb;SELECT current_setting('test.e1165.parity')::jsonb;SELECT current_setting('test.e1165.quote')::jsonb;");
sql=sql.replace("SELECT jsonb_build_object('rollbackProtectedGroups',41,'unchanged',true,'candidateRemoved',true);",()=>"DO $$ BEGIN ASSERT to_regprocedure('private.multi_day_obligation_amount_v1(numeric,numeric,numeric)') IS NULL;ASSERT to_regprocedure('private.multi_day_individual_obligation_quote_v1(uuid)') IS NULL;ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.multi_day_payout_evaluate_v2(uuid,jsonb)'::regprocedure)='a75c2bfc3d7bf05d5ee05d830bda38dc';END $$;SELECT jsonb_build_object('rollbackProtectedGroups',41,'unchanged',true,'candidateRemoved',true,'evaluatorRestored',true);");
writeFileSync(base+'.sql',sql);
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const raw=execFileSync('wsl',args,{input:sql,encoding:'utf8',timeout:60000,maxBuffer:4e6});
const observations=raw.split(/\r?\n/).filter(x=>x.startsWith('{')).map(JSON.parse);assert.equal(observations.at(-1).evaluatorRestored,true);
writeFileSync(base+'.json',JSON.stringify({kind:'SHARED_CANONICAL_OBLIGATION_MATH_AND_INTERNAL_UNFUNDED_QUOTE_NOT_EARLY_PAYMENT',observations,durablyApplied:false,fullR03Accepted:false},null,2)+'\n');
console.log('EARLYITM1165_COMPLETE_PREVIEW_PARITY_SHARED_AMOUNT_INTERNAL_QUOTE_ROLLBACK_PASS_NOT_FUNDING_OR_PAYMENT');
