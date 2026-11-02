import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.VINPOKER_EARLYITM1177_LOCAL,'1');
const attempt=process.env.VINPOKER_EARLYITM1177_EMPTY_ATTEMPT;assert.match(attempt??'',/^[a-z0-9]+$/);
const base='D:/Quy trình/output/reports/earlyitm1177-read-empty-recovery-'+attempt+'-local-20261028';assert.equal(existsSync(base+'.sql'),false);
const previous=readFileSync('D:/Quy trình/output/reports/earlyitm1171-global-payment-bridge-6-local-20261028.sql','utf8');
const index=previous.indexOf('-- Transaction-private');assert.ok(index>0);
const source=readFileSync('supabase/pending-migrations/20261027184903_multiday_individual_obligation_read_state_v1.sql','utf8');
const down=readFileSync('tests/cashier/earlyItm1177.obligation-read.down.sql','utf8');
const tail=previous.slice(previous.indexOf('ROLLBACK;\nDO $$ BEGIN ASSERT (SELECT fingerprint FROM d2_789_protected)'));assert.ok(tail.startsWith('ROLLBACK;'));
const sql=previous.slice(0,index)+source+'\n'+down+String.raw`
DO $$ BEGIN ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_multi_day_individual_rank_review_v1(uuid)'::regprocedure)='ce66aaafa982d8f705df1ef58234f740';END $$;
`+source+String.raw`
SELECT jsonb_build_object('emptyReadDownReapply',true,'owedHistoryRows',(SELECT count(*) FROM private.multi_day_individual_obligations_v1));
`+tail+String.raw`
DO $$ BEGIN ASSERT to_regprocedure('public.get_multi_day_individual_rank_review_v1(uuid)') IS NULL;END $$;
`;
writeFileSync(base+'.sql',sql);
try{
 const raw=execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',timeout:30000,maxBuffer:4e6,stdio:['pipe','pipe','pipe']});
 writeFileSync(base+'.raw.log',raw);
 const observations=raw.split(/\r?\n/).filter(x=>x.startsWith('{')).map(JSON.parse);assert.equal(observations[0].emptyReadDownReapply,true);assert.equal(observations[0].owedHistoryRows,0);assert.equal(observations.find(x=>x.rollbackProtectedGroups===41).unchanged,true);assert.equal(observations.at(-1).paymentBaselineFunctionsRestored,true);
 writeFileSync(base+'.json',JSON.stringify({kind:'EMPTY_INDIVIDUAL_OBLIGATION_READ_DOWN_REAPPLY_NATIVE_ROLLBACK',observations,durablyApplied:false},null,2));console.log('EARLYITM1177_EMPTY_READ_DOWN_REAPPLY_ORIGINAL_FACTS_ROLLBACK_PASS');
}catch(error){writeFileSync(base+'.failure.log',String(error.stderr??error.stack));throw error;}
