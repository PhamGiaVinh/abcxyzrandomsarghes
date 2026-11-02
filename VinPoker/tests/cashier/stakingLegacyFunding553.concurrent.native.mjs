// Retained LOCAL synthetic ledger/receipt. No bank/provider request; do not erase audit.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.VINPOKER_NATIVE_DB_TEST,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=input=>execFileSync('wsl',args,{input,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
const ids={deal:randomUUID(),actor:randomUUID()};
console.log('LEGACY553_RETAINED_LOCAL_MANIFEST',JSON.stringify(ids));
const protectedFacts=()=>sql(`SELECT md5(jsonb_build_array(
 ${['staking_deals','staking_purchases','staking_release_requests','escrow_transactions','staking_audit_logs','staking_legacy_funding_receipts_v1'].map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x WHERE ${t==='staking_deals'?'id':'deal_id'} IS DISTINCT FROM '${ids.deal}'::uuid)`).join(',')},
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_ledger x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.notifications x WHERE data->>'deal_id' IS DISTINCT FROM '${ids.deal}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.user_roles x WHERE user_id<>'${ids.actor}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.profiles x WHERE user_id<>'${ids.actor}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournaments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x)
 )::text);`);
const before=protectedFacts();
sql(`BEGIN;
 INSERT INTO auth.users(id) VALUES('${ids.actor}');
 INSERT INTO public.user_roles(user_id,role) VALUES('${ids.actor}','super_admin');
 INSERT INTO public.staking_deals(id,player_id,backer_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status)
 SELECT '${ids.deal}','${ids.actor}','${ids.actor}',id,'LOCAL553 retained concurrency TEST',now(),'LOCAL ONLY',10,1,1000000,'committed' FROM public.clubs ORDER BY id LIMIT 1;
 COMMIT;`);
function session(){
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.setEncoding('utf8').on('data',s=>{out+=s;});child.stderr.setEncoding('utf8').on('data',s=>{err+=s;});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(err)));});done.catch(()=>{});
 return {child,done,output:()=>out};
}
const a=session(),b=session();let committed=false;
const call=`public.commit_staking_legacy_funding_v1('${ids.actor}','${ids.deal}','LOCAL553',100000,'https://local.invalid/proof','LOCAL TEST')`;
try{
 a.child.stdin.write(`BEGIN;SET LOCAL application_name='legacy553-A';SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.sub='';SET LOCAL ROLE service_role;
 SELECT ${call};SELECT 'LEGACY553_A_HOLDS';\n`);
 for(let i=0;i<50&&!a.output().includes('LEGACY553_A_HOLDS');i++)await new Promise(r=>setTimeout(r,100));
 assert.ok(a.output().includes('LEGACY553_A_HOLDS'),'first funding must hold its uncommitted row lock');
 b.child.stdin.write(`BEGIN;SET LOCAL application_name='legacy553-B';SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.sub='';SET LOCAL ROLE service_role;
 SELECT ${call};SELECT 'LEGACY553_B_REPLAY';COMMIT;\n`);
 let blocked=false;
 for(let i=0;i<50&&!blocked;i++){
  blocked=sql("SELECT count(*) FROM pg_stat_activity b WHERE b.application_name='legacy553-B' AND b.wait_event_type='Lock' AND EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.application_name='legacy553-A' AND a.pid=ANY(pg_blocking_pids(b.pid)));")==='1';
  if(!blocked)await new Promise(r=>setTimeout(r,100));
 }
 assert.ok(blocked,'must observe B blocked on actual A, not sequential calls');
 a.child.stdin.end('COMMIT;\n');await a.done;committed=true;
 b.child.stdin.end();await b.done;
 assert.ok(b.output().includes('LEGACY553_B_REPLAY'));
 const receipt=output=>JSON.parse(output.split(/\r?\n/).find(line=>line.startsWith('{')));
 assert.deepEqual(receipt(b.output()),receipt(a.output()));
 const facts=JSON.parse(sql(`SELECT jsonb_build_object(
 'status',(SELECT status FROM public.staking_deals WHERE id='${ids.deal}'),
 'fund_count',(SELECT count(*) FROM public.escrow_transactions WHERE deal_id='${ids.deal}' AND transaction_type='fund_lock'),
 'fund_vnd',(SELECT sum(amount_vnd) FROM public.escrow_transactions WHERE deal_id='${ids.deal}' AND transaction_type='fund_lock'),
 'audits',(SELECT count(*) FROM public.staking_audit_logs WHERE deal_id='${ids.deal}' AND action='funded'),
 'receipts',(SELECT count(*) FROM public.staking_legacy_funding_receipts_v1 WHERE deal_id='${ids.deal}'),
 'purchases',(SELECT count(*) FROM public.staking_purchases WHERE deal_id='${ids.deal}'));`));
 assert.deepEqual(facts,{status:'locked',fund_count:1,fund_vnd:100000,audits:1,receipts:1,purchases:0});
 assert.equal(protectedFacts(),before,'unrelated money/roles/notices/tournaments/entries/seats changed');
 console.log('LEGACY553_TRUE_TWO_SESSION_REPLAY_CONSERVATION_PASS',JSON.stringify(facts));
}finally{
 if(!a.child.stdin.writableEnded)a.child.stdin.end('ROLLBACK;\n');
 if(!b.child.stdin.writableEnded)b.child.stdin.end('ROLLBACK;\n');
 await Promise.allSettled([a.done,b.done]);
 sql(`DELETE FROM public.user_roles WHERE user_id='${ids.actor}' AND role='super_admin';`);
 assert.equal(protectedFacts(),before);
 console.log('LEGACY553_RETAINED_AUDIT_ACTOR_PRIVILEGE_REVOKED',JSON.stringify({...ids,committed}));
}
