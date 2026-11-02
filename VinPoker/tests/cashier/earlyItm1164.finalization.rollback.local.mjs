import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.VINPOKER_EARLYITM1164_LOCAL,'1');
const apply=process.env.VINPOKER_EARLYITM1164_CANDIDATE==='1';
const base='D:/Quy trình/output/reports/earlyitm1164-finalization-'+(apply?'green3':'red7')+'-local-20261027';assert.equal(existsSync(base+'.sql'),false);
let sql=readFileSync('D:/Quy trình/output/reports/earlyitm1163-lifecycle-local-20261027.sql','utf8');
const anchor=" r:=public.record_multi_day_prize_payment_v1(event,p,'cash',md5('LOCAL1161 no final individual rank'),gen_random_uuid());";assert.equal(sql.split(anchor).length,2);
const settingsAnchor='-- Transaction-private business qualification only, not persistent gate activation.';
sql=sql.replace(settingsAnchor,()=>"INSERT INTO public.club_settings(club_id,player_history_enabled,auto_swing_enabled) VALUES('c0d7785d-5bd4-48ca-9014-8611a274382d',false,false) ON CONFLICT(club_id) DO UPDATE SET player_history_enabled=false;\n"+settingsAnchor);
sql=sql.replace(anchor,()=>readFileSync('tests/cashier/earlyItm1164.finalization.extension.sql','utf8')+'\n'+anchor);
sql=sql.replace("IF SQLERRM<>'individual_rank_frozen_conflict' THEN RAISE;END IF;",()=>"IF SQLERRM NOT IN('individual_rank_frozen_conflict','individual_rank_chronology_mismatch') THEN RAISE;END IF;");
if(apply){const start='-- Transaction-private business qualification only, not persistent gate activation.';assert.equal(sql.split(start).length,2);sql=sql.replace(start,()=>readFileSync('supabase/pending-migrations/20261027160743_multiday_individual_results_finalization_v1.sql','utf8')+'\n'+start);}
sql=sql.replace("count(*) FILTER(WHERE status='busted')=2 AND count(finished_place)=0",()=>"count(*) FILTER(WHERE status='busted')=7 AND count(finished_place)=8");
sql=sql.replace("'survivors',6,'busted',2",()=>"'survivors',1,'busted',7");
sql=sql.replace("SELECT current_setting('test.early1163')::jsonb;",()=>"SELECT current_setting('test.early1163')::jsonb;SELECT current_setting('test.early1164')::jsonb;");
sql=sql.replace('CREATE TEMP TABLE d2_789_protected AS SELECT pg_temp.d2_789_fingerprint() fingerprint;',()=>"CREATE TEMP TABLE d2_789_protected AS SELECT pg_temp.d2_789_fingerprint() fingerprint;CREATE TEMP TABLE early1164_close_protected AS SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY x.id)::text) hash FROM public.tournament_close_report x;");
if(apply){
 sql=sql.replace('ROLLBACK;\nDO $$ BEGIN ASSERT (SELECT fingerprint FROM d2_789_protected)',()=>"SELECT jsonb_object_agg(p.oid::regprocedure::text,md5(p.prosrc)) FROM pg_proc p WHERE p.oid IN('public.finalize_tournament_results(uuid)'::regprocedure,'floor_private.felt_official_results_close_status_v1(uuid)'::regprocedure,'private.multi_day_individual_close_state_v1(uuid)'::regprocedure,'private.finalize_multi_day_individual_results_v1(uuid)'::regprocedure);\nROLLBACK;\nDO $$ BEGIN ASSERT (SELECT fingerprint FROM d2_789_protected)");
 sql=sql.replace("SELECT jsonb_build_object('rollbackProtectedGroups',41,'unchanged',true,'candidateRemoved',true);",()=>"DO $$ BEGIN ASSERT to_regprocedure('private.multi_day_individual_close_state_v1(uuid)') IS NULL;ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.finalize_tournament_results(uuid)'::regprocedure)='6dbe0cca5584570defa8c07acc5693c5';ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='floor_private.felt_official_results_close_status_v1(uuid)'::regprocedure)='8c4d35c69aba350d436f6f9ae43ff29e';ASSERT (SELECT hash FROM early1164_close_protected) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY x.id)::text) FROM public.tournament_close_report x);END $$;SELECT jsonb_build_object('rollbackProtectedGroups',41,'unchanged',true,'candidateRemoved',true,'closeReportsUnchanged',true,'baselineFunctionsRestored',true);");
}
writeFileSync(base+'.sql',sql);
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const raw=execFileSync('wsl',args,{input:sql,encoding:'utf8',timeout:60000,maxBuffer:4e6});
const observations=raw.split(/\r?\n/).filter(x=>x.startsWith('{')).map(JSON.parse);assert.equal(observations.at(-1).candidateRemoved,true);
writeFileSync(base+'.json',JSON.stringify({kind:'INDIVIDUAL_TO_WHOLE_RESULT_FINALIZATION_OUTER_ROLLBACK',observations,durablyApplied:false,fullR03Accepted:false},null,2)+'\n');
console.log('EARLYITM1164_FINALIZATION_ROLLBACK_PASS_NOT_EARLY_PAYMENT');
