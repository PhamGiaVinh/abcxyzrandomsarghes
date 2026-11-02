import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.VINPOKER_EARLYITM1163_RECOVERY_LOCAL,'1');
const base='D:/Quy trình/output/reports/earlyitm1163-recovery-local-20261027';assert.equal(existsSync(base+'.json'),false);assert.equal(existsSync(base+'.sql'),false);
let sql=readFileSync('D:/Quy trình/output/reports/earlyitm1163-lifecycle-local-20261027.sql','utf8');
const up=readFileSync('supabase/pending-migrations/20261027155124_multiday_individual_rank_confirmation_v1.sql','utf8');
const down=readFileSync('tests/cashier/earlyItm1162.individual-rank.down.sql','utf8');
assert.equal(sql.split(up).length,2);sql=sql.replace(up,()=>up+'\n'+down+'\n'+up);
const anchor=" r:=public.record_multi_day_prize_payment_v1(event,p,'cash',md5('LOCAL1161 no final individual rank'),gen_random_uuid());";assert.equal(sql.split(anchor).length,2);
sql=sql.replace(anchor,()=>`
 PERFORM set_config('role','none',true);
 BEGIN
  EXECUTE $history_down$${down}$history_down$;
  RAISE EXCEPTION 'recovery discarded confirmed history';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'individual_rank_recovery_history_retained_use_forward_repair' THEN RAISE;END IF;
 END;
 ASSERT (SELECT count(*)=2 FROM private.multi_day_individual_results_v1 WHERE event_id=event);
 ASSERT (SELECT count(*)=2 FROM private.multi_day_individual_rank_requests_v1 WHERE event_id=event);
 PERFORM set_config('role','authenticated',true);
 RAISE NOTICE 'EARLYITM1163_EMPTY_DOWN_REAPPLY_AND_HISTORY_DOWN_REFUSAL_QUALIFIED';
`+anchor);
writeFileSync(base+'.sql',sql);
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const raw=execFileSync('wsl',args,{input:sql,encoding:'utf8',timeout:60000,maxBuffer:4e6});
const observations=raw.split(/\r?\n/).filter(x=>x.startsWith('{')).map(JSON.parse);assert.equal(observations.at(-1).candidateRemoved,true);
writeFileSync(base+'.json',JSON.stringify({kind:'EMPTY_CODE_RECOVERY_AND_RETAINED_HISTORY_REFUSAL_OUTER_ROLLBACK',emptyDownReapply:true,retainedHistoryDownRefused:true,observations,durablyApplied:false,fullR03Accepted:false},null,2)+'\n');
console.log('EARLYITM1163_RECOVERY_REHEARSAL_ROLLBACK_PASS_NOT_PAYMENT');
