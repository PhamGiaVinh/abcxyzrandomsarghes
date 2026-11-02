import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.VINPOKER_EARLYITM1170_LOCAL,'1');
const candidate=process.env.VINPOKER_EARLYITM1170_CANDIDATE==='1';
const attempt=process.env.VINPOKER_EARLYITM1170_ATTEMPT;assert.match(attempt??'',/^[a-z0-9]+$/);
const base='D:/Quy trình/output/reports/earlyitm1170-payment-'+(candidate?'green':'red')+attempt+'-local-20261028';assert.equal(existsSync(base+'.sql'),false);
let sql=readFileSync('D:/Quy trình/output/reports/earlyitm1168-liability-green3-local-20261028.sql','utf8');
const start=sql.indexOf('-- Transaction-private');assert.ok(start>0);
if(candidate)sql=sql.slice(0,start)+readFileSync('supabase/pending-migrations/20261027172548_multiday_individual_verified_payment_v1.sql','utf8')+'\n'+sql.slice(start);
const cut=' -- Run after1162 has frozen rank8. All native writes remain in outerROLLBACK.';assert.equal(sql.split(cut).length,2);
const rollback=sql.slice(sql.indexOf('ROLLBACK;\nDO $$ BEGIN ASSERT (SELECT fingerprint FROM d2_789_protected)'));assert.ok(rollback.startsWith('ROLLBACK;'));
sql=sql.slice(0,sql.indexOf(cut))+readFileSync('tests/cashier/earlyItm1170.payment.extension.sql','utf8')+'\nEND $$;\nSELECT current_setting(\'test.e1170\')::jsonb;\n'+rollback;
sql+=String.raw`
DO $$ BEGIN
 ASSERT to_regclass('private.multi_day_individual_payment_commits_v1') IS NULL;
 ASSERT to_regprocedure('private.multi_day_payment_funding_evaluate_v1(uuid,jsonb)') IS NULL;
 ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.is_verified_multi_day_payment_v1(public.tournament_prize_payments)'::regprocedure)='5addc8c68b15fb44b14cd5199c6a404d';
 ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_multi_day_payout_recipients_v1(uuid)'::regprocedure)='6bf6ef281658df191077a369808abf18';
 ASSERT (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.record_multi_day_prize_payment_v1(uuid,uuid,text,text,uuid)'::regprocedure)='246185b8b596815a5a3bd074fc03e26d';
END $$;
SELECT jsonb_build_object('earlyPaymentCandidateRemoved',true,'paymentBaselineFunctionsRestored',true);
`;
writeFileSync(base+'.sql',sql);
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
try{
 const raw=execFileSync('wsl',args,{input:sql,encoding:'utf8',timeout:60000,maxBuffer:4e6});
 const observations=raw.split(/\r?\n/).filter(x=>x.startsWith('{')).map(JSON.parse);assert.equal(observations.at(-1).paymentBaselineFunctionsRestored,true);
 writeFileSync(base+'.json',JSON.stringify({kind:'EARLY_ITM_PAYMENT_NATIVE_OUTER_ROLLBACK',observations,durablyApplied:false,fullR03Accepted:false},null,2));
 console.log('EARLYITM1170_EARLY_PAYMENT_NATIVE_ROLLBACK_PASS_NOT_FULL_JOURNEY');
}catch(e){writeFileSync(base+'.failure.log',String(e.stderr??e.stack));throw e;}
