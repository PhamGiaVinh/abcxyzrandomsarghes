// Retained, audited LOCAL TEST reservation; no funding/payment or provider dispatch.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.VINPOKER_NATIVE_DB_TEST,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=input=>execFileSync('wsl',args,{input,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
const ids={deal:randomUUID(),buyer:randomUUID(),buyer2:randomUUID(),player:randomUUID(),bank:randomUUID(),request:randomUUID(),request2:randomUUID()};
const club=sql('SELECT id FROM public.clubs ORDER BY id LIMIT 1;');
console.log('COMMIT510_RETAINED_TEST_MANIFEST',JSON.stringify(ids));
const users=[ids.buyer,ids.buyer2,ids.player].map(x=>`'${x}'`).join(',');
const protectedFacts=()=>sql(`SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_deals x WHERE id<>'${ids.deal}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_purchases x WHERE deal_id<>'${ids.deal}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_audit_logs x WHERE deal_id IS DISTINCT FROM '${ids.deal}'::uuid),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.notifications x WHERE data->>'deal_id' IS DISTINCT FROM '${ids.deal}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY actor_id,request_id) FROM public.staking_purchase_receipts_v1 x WHERE deal_id<>'${ids.deal}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.profiles x WHERE user_id NOT IN(${users})),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.platform_bank_accounts x WHERE id<>'${ids.bank}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.escrow_transactions x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.staking_ledger x))::text);`);
const before=protectedFacts();
sql(`BEGIN;
 INSERT INTO auth.users(id) VALUES('${ids.buyer}'),('${ids.buyer2}'),('${ids.player}');
 INSERT INTO public.profiles(user_id,display_name,bank_name,bank_account_number,bank_account_holder)
 VALUES('${ids.buyer}','LOCAL510 ${ids.buyer}','LOCAL','LOCAL_ONLY','TEST'),('${ids.buyer2}','LOCAL510 ${ids.buyer2}','LOCAL','LOCAL_ONLY','TEST');
 INSERT INTO public.platform_bank_accounts(id,bank_name,account_number,account_holder,account_type,is_active,club_id)
 VALUES('${ids.bank}','LOCAL510','LOCAL_ONLY','TEST','escrow',true,'${club}');
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status,admin_review_status)
 VALUES('${ids.deal}','${ids.player}','${club}','LOCAL510 retained concurrency TEST',now(),'LOCAL ONLY',10,1,1000000,'listing','approved');COMMIT;`);
function session(){
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.setEncoding('utf8').on('data',s=>{out+=s;});child.stderr.setEncoding('utf8').on('data',s=>{err+=s;});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(err)));});done.catch(()=>{});
 return {child,done,output:()=>out};
}
const a=session(),b=session();let committed=false;
try{
 a.child.stdin.write(`BEGIN;SET LOCAL application_name='staking510-A';SET LOCAL statement_timeout='10s';SET LOCAL ROLE service_role;
 SELECT public.commit_staking_purchase_v1('${ids.buyer}','${ids.request}','${ids.deal}',10);SELECT 'COMMIT510_A_HOLDS';\n`);
 for(let i=0;i<50&&!a.output().includes('COMMIT510_A_HOLDS');i++)await new Promise(r=>setTimeout(r,100));
 assert.ok(a.output().includes('COMMIT510_A_HOLDS'),'first purchase must hold uncommitted parent row');
 b.child.stdin.write(`BEGIN;SET LOCAL application_name='staking510-B';SET LOCAL statement_timeout='10s';SET LOCAL ROLE service_role;
 DO $$ BEGIN
  BEGIN PERFORM public.commit_staking_purchase_v1('${ids.buyer2}','${ids.request2}','${ids.deal}',10);
   RAISE EXCEPTION 'COMMIT510_OVERSELL_ALLOWED';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'staking_purchase_state_conflict' THEN RAISE;END IF;END;
 END $$;SELECT 'COMMIT510_B_REJECTED';ROLLBACK;\n`);
 let blocked=false;
 for(let i=0;i<50&&!blocked;i++){
  blocked=sql("SELECT count(*) FROM pg_stat_activity b WHERE b.application_name='staking510-B' AND b.wait_event_type='Lock' AND EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.application_name='staking510-A' AND a.pid=ANY(pg_blocking_pids(b.pid)));")==='1';
  if(!blocked)await new Promise(r=>setTimeout(r,100));
 }
 assert.ok(blocked,'second real session must block behind first; no fake sequential concurrency');
 a.child.stdin.end('COMMIT;\n');await a.done;committed=true;
 b.child.stdin.end();await b.done;
 assert.ok(b.output().includes('COMMIT510_B_REJECTED'));
 const facts=JSON.parse(sql(`SELECT jsonb_build_object('purchases',(SELECT count(*) FROM public.staking_purchases WHERE deal_id='${ids.deal}'),
 'percent',(SELECT sum(percent) FROM public.staking_purchases WHERE deal_id='${ids.deal}'),
 'receipts',(SELECT count(*) FROM public.staking_purchase_receipts_v1 WHERE deal_id='${ids.deal}'),
 'audits',(SELECT count(*) FROM public.staking_audit_logs WHERE deal_id='${ids.deal}' AND action='committed'),
 'escrow',(SELECT count(*) FROM public.escrow_transactions WHERE deal_id='${ids.deal}'));`));
 assert.deepEqual(facts,{purchases:1,percent:10,receipts:1,audits:1,escrow:0});
 assert.equal(protectedFacts(),before);
 console.log('COMMIT510_TRUE_TWO_SESSION_CAPACITY_AND_PROTECTED_FACTS_PASS',JSON.stringify(facts));
}finally{
 if(!a.child.stdin.writableEnded)a.child.stdin.end('ROLLBACK;\n');
 if(!b.child.stdin.writableEnded)b.child.stdin.end('ROLLBACK;\n');
 await Promise.allSettled([a.done,b.done]);
 sql(`UPDATE public.platform_bank_accounts SET is_active=false WHERE id='${ids.bank}';`);
 console.log('COMMIT510_RETAINED_AUDIT_NOT_DELETED',JSON.stringify({deal:ids.deal,committed}));
}
