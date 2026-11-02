import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.VINPOKER_EARLYITM1166_MISSING_PRIZE_LOCAL,'1');
const base='D:/Quy trình/output/reports/earlyitm1166-missing-prize-local-20261028';assert.equal(existsSync(base+'.sql'),false);
let sql=readFileSync('D:/Quy trình/output/reports/earlyitm1166-funding-source-attempt2-local-20261028.sql','utf8');
const cut=sql.indexOf(' DECLARE funding jsonb;quote jsonb;BEGIN');assert.ok(cut>0);
sql=sql.slice(0,cut);
const seed='SELECT final,n,12.5,100000 FROM generate_series(1,8)n;';assert.equal(sql.split(seed).length,2);sql=sql.replace(seed,()=>seed.replace('(1,8)','(1,7)'));
const snapshot='CREATE TEMP TABLE d2_789_protected AS SELECT pg_temp.d2_789_fingerprint() fingerprint;';assert.equal(sql.split(snapshot).length,2);
sql=sql.replace(snapshot,()=>snapshot+"CREATE TEMP TABLE early1166_prizes_protected AS SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY x.id)::text) hash FROM public.tournament_prizes x;");
sql+=String.raw`
 PERFORM set_config('role','none',true);
 BEGIN
  PERFORM private.multi_day_verified_funding_source_v1(event);
  RAISE EXCEPTION 'missing ITM prize was classified as verified funding';
 EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='multi_day_payout_rank_amount_missing',SQLERRM;END;
 RAISE NOTICE 'EARLYITM1166_MISSING_PERSISTED_ITM_PRIZE_DENIED_NOT_ZERO';
END $$;
SELECT jsonb_build_object('missingPersistedItmPrizeDenied',true,'payments',0,'obligationPersistence','NOT_PERFORMED');
SELECT jsonb_object_agg(p.oid::regprocedure::text,md5(p.prosrc)) FROM pg_proc p
 WHERE p.oid IN('private.multi_day_funding_evaluate_v1(uuid,jsonb)'::regprocedure,'private.multi_day_verified_funding_source_v1(uuid)'::regprocedure);
ROLLBACK;
DO $$ BEGIN
 ASSERT (SELECT fingerprint FROM d2_789_protected)=pg_temp.d2_789_fingerprint();
 ASSERT (SELECT hash FROM early1166_prizes_protected) IS NOT DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY x.id)::text) FROM public.tournament_prizes x);
 ASSERT to_regprocedure('private.multi_day_verified_funding_source_v1(uuid)') IS NULL;
 ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.multi_day_payout_evaluate_v2(uuid,jsonb)'::regprocedure)='a75c2bfc3d7bf05d5ee05d830bda38dc';
END $$;
SELECT jsonb_build_object('unchangedGroups',41,'completePrizesUnchanged',true,'newHelpersRemoved',true,'evaluatorRestored',true);
`;
writeFileSync(base+'.sql',sql);
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const raw=execFileSync('wsl',args,{input:sql,encoding:'utf8',timeout:60000,maxBuffer:4e6});
const observations=raw.split(/\r?\n/).filter(x=>x.startsWith('{')).map(JSON.parse);assert.equal(observations.at(-1).completePrizesUnchanged,true);
writeFileSync(base+'.json',JSON.stringify({kind:'MISSING_PERSISTED_ITM_PRIZE_NOT_VERIFIED_FUNDING_OUTER_ROLLBACK',observations,durablyApplied:false,fullR03Accepted:false},null,2)+'\n');
console.log('EARLYITM1166_MISSING_PRIZE_DENIED_AND_COMPLETE_PRIZE_ROLLBACK_PASS');
