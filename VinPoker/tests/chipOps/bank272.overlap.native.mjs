import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
assert.equal(process.env.VINPOKER_NATIVE_DB_TEST,'1');
assert.ok(process.argv.slice(2).every(arg=>arg==='--verify'));
const verifyOnly=process.argv.includes('--verify');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=(input)=>execFileSync('wsl',args,{input,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql(`SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();`),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
const f=JSON.parse(sql(`SELECT fixture FROM floor_private.bank272_fixture;`));
assert.equal(f.club,'e2720000-0000-4000-8000-000000000010');
if(!verifyOnly)assert.equal(sql(`SELECT count(*) FROM public.chip_bank_ledger WHERE club_id='${f.club}';`),'0','do not rerun/reset a retained overlap canary');
assert.equal(sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'bank272-%';`),'0');
const authenticate=`SELECT set_config('request.jwt.claim.sub','${f.actor}',true);SELECT set_config('request.jwt.claim.role','authenticated',true);SELECT set_config('request.jwt.claims','{"sub":"${f.actor}","role":"authenticated"}',true);SET LOCAL ROLE authenticated;`;
const call=(count,version,key)=>`SELECT public.chip_ops_bank_adjust_v2('${f.club}','${f.denom}','thu',${count},'${f.tour}',${version},'${key}','${f.actor}');`;
const worker=()=>{
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.setEncoding('utf8').on('data',part=>{out+=part;});child.stderr.setEncoding('utf8').on('data',part=>{err+=part;});
 const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve(out):reject(new Error(`bank272 worker exit${code}: ${err}`)));});
 completion.catch(()=>{});return {child,completion,output:()=>out};
};
const waitFor=async(check,label)=>{
 for(let i=0;i<60;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,100));}
 throw new Error('BANK272_WAIT_FAILED:'+label);
};
const overlap=async(firstSql,secondSql,tag)=>{
 const first=worker();let second;let released=false;
 try{
  first.child.stdin.write(`BEGIN;SET LOCAL application_name='bank272-${tag}-first';${authenticate}${firstSql}SELECT 'BANK272_HOLDER_READY';\n`);
  await waitFor(()=>first.output().includes('BANK272_HOLDER_READY'),'first receipt before release');
  second=worker();second.child.stdin.end(`BEGIN;SET LOCAL application_name='bank272-${tag}-second';${authenticate}${secondSql}COMMIT;`);
  await waitFor(()=>sql(`SELECT count(*) FROM pg_stat_activity w JOIN pg_stat_activity h
    ON h.pid=ANY(pg_blocking_pids(w.pid)) WHERE w.application_name='bank272-${tag}-second'
    AND h.application_name='bank272-${tag}-first' AND w.wait_event_type='Lock';`)==='1','actual pg_blocking_pids overlap');
  console.log(`BANK272_${tag}_ACTUAL_BLOCKING_CONFIRMED`);
  first.child.stdin.end('COMMIT;\n');released=true;
  const [a,b]=await Promise.all([first.completion,second.completion]);
  const receipt=output=>output.split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).find(value=>value.outcome);
  return [receipt(a),receipt(b)];
 }finally{
  if(!released){first.child.stdin.end('ROLLBACK;\n');await first.completion.catch(()=>{});if(second)await second.completion.catch(()=>{});}
 }
};
let same=[],cas=[];
if(!verifyOnly){
same=await overlap(call(12,0,'bank272-same'),call(12,0,'bank272-same'),'SAME_KEY');
assert.equal(same[0].outcome,'applied');assert.equal(same[1].outcome,'applied');
assert.equal(same[1].idempotent,true);
for(const field of ['actor_id','request_id','ledger_id'])assert.equal(same[0][field],same[1][field]);
assert.deepEqual(same[0].payload,same[1].payload);assert.deepEqual(same[0].result,same[1].result);
assert.equal(sql(`SELECT count(*) FROM public.chip_bank_ledger WHERE idempotency_key='bank272-same';`),'1');
assert.equal(sql(`SELECT on_hand_count||':'||version FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${f.denom}';`),'12:1');
console.log('BANK272_CONCURRENT_SAME_KEY_ONE_LEDGER_SAME_RECEIPT_PASS');
cas=await overlap(call(1,1,'bank272-cas-first'),call(2,1,'bank272-cas-second'),'CAS');
assert.equal(cas[0].outcome,'applied');assert.equal(cas[1].outcome,'rejected');assert.equal(cas[1].error,'race_lost');
assert.equal(sql(`SELECT on_hand_count||':'||version FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${f.denom}';`),'13:2');
assert.equal(sql(`SELECT count(*) FROM public.chip_bank_ledger WHERE club_id='${f.club}';`),'2');
assert.equal(sql(`SELECT count(*) FROM floor_private.chip_mutation_receipts WHERE actor_id='${f.actor}' AND operation='bank_adjust_v2';`),'3');
console.log('BANK272_CONCURRENT_STALE_VERSION_REJECT_DURABLE_NO_EXTRA_LEDGER_PASS');
}
assert.equal(sql(`SELECT on_hand_count||':'||version FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${f.denom}';`),'13:2');
assert.equal(sql(`SELECT count(*) FROM public.chip_bank_ledger WHERE club_id='${f.club}';`),'2');
assert.equal(sql(`SELECT count(*) FROM floor_private.chip_mutation_receipts WHERE actor_id='${f.actor}' AND operation='bank_adjust_v2';`),'3');
const receipts=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('key',r.request_key,'outcome',r.result->>'outcome',
 'error',r.result->>'error','ledger',r.result->>'ledger_id','payload',r.payload) ORDER BY r.request_key)
 FROM floor_private.chip_mutation_receipts r WHERE r.actor_id='${f.actor}';`));
assert.deepEqual(receipts.map(x=>[x.key,x.outcome,x.error]),[
 ['bank272-cas-first','applied',null],['bank272-cas-second','rejected','race_lost'],['bank272-same','applied',null]]);
assert.equal(sql(`SELECT count(*) FROM floor_private.chip_mutation_receipts r JOIN public.chip_bank_ledger l ON l.id=(r.result->>'ledger_id')::uuid
 WHERE r.actor_id='${f.actor}' AND l.actor=r.actor_id AND l.idempotency_key=r.request_key AND l.club_id='${f.club}'
 AND l.denomination_id='${f.denom}' AND l.count=(r.payload->>'count')::bigint AND l.tournament_id='${f.tour}'
 AND l.details->'expected_version'=r.payload->'expected_version';`),'2');
const actual=sql(`SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id,denomination_id) FROM public.chip_bank x WHERE club_id<>'${f.club}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x WHERE club_id<>'${f.club}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY actor_id,request_key) FROM floor_private.chip_mutation_receipts x WHERE actor_id NOT IN('${f.actor}','${f.otherActor}'))
 )::text);`);
assert.equal(actual,sql(`SELECT baseline FROM floor_private.bank272_fixture;`));
assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`),'0');
assert.equal(sql(`SELECT coalesce((SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${f.club}'),false);`),'f');
if(verifyOnly)console.log('BANK272_RETAINED_RECEIPT_BANK_LEDGER_READ_ONLY_POSTCHECK_PASS_NO_NEW_WRITES');
console.log('BANK272_OTHER_SCOPE_BANK_CHIP_CASH_PAYOUT_RECEIPTS_UNCHANGED_AUTO_OFF_PASS');
console.log(JSON.stringify({fixture:f,bank:{count:13,version:2},ledger:2,receipts,verifiedReadOnly:verifyOnly,sameKey:same.map(x=>({request:x.request_id,ledger:x.ledger_id})),cas:cas.map(x=>({request:x.request_id,outcome:x.outcome,error:x.error}))}));
