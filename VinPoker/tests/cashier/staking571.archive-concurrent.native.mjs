// Retain synthetic local audit/receipt and legacy pending purchase; no money/provider activity.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.VINPOKER_NATIVE_DB_TEST,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=input=>execFileSync('wsl',args,{input,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
assert.equal(sql("SELECT md5(pg_get_functiondef('public.archive_staking_listing_v1(uuid,uuid,text)'::regprocedure));"),'83e12c114944a1e7deb4ff094278fffd');
const ids={actor:randomUUID(),replay:randomUUID(),purchaseRace:randomUUID(),purchase:randomUUID()};
console.log('ARCHIVE571_RETAINED_LOCAL_MANIFEST',JSON.stringify(ids));
const own=`('${ids.replay}'::uuid,'${ids.purchaseRace}'::uuid)`;
const protectedFacts=()=>sql(`SELECT md5(jsonb_build_array(
 ${['staking_deals','staking_purchases','staking_release_requests','escrow_transactions','staking_audit_logs','staking_listing_archive_receipts_v1'].map(t=>{const column=t==='staking_deals'?'id':'deal_id';return `(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x WHERE (${column} IS NULL OR ${column} NOT IN ${own}))`;}).join(',')},
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.notifications x WHERE coalesce(data->>'deal_id','') NOT IN('${ids.replay}','${ids.purchaseRace}')),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.user_roles x WHERE user_id<>'${ids.actor}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.profiles x WHERE user_id<>'${ids.actor}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournaments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x))::text);`);
const before=protectedFacts();
sql(`BEGIN;INSERT INTO auth.users(id) VALUES('${ids.actor}');INSERT INTO public.user_roles(user_id,role) VALUES('${ids.actor}','super_admin');
 INSERT INTO public.staking_deals(id,player_id,club_id,custom_event_name,custom_event_date,custom_event_venue,percentage_sold,markup,buy_in_amount_vnd,status,admin_review_status)
 SELECT target.id,'${ids.actor}',c.id,'LOCAL571 retained archive concurrency TEST',now(),'LOCAL ONLY',10,1,1000000,'listing','rejected'
 FROM (VALUES('${ids.replay}'::uuid),('${ids.purchaseRace}'::uuid)) target(id) CROSS JOIN(SELECT id FROM public.clubs ORDER BY id LIMIT 1)c;COMMIT;`);
const sessions=[];
function session(){
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='',terminal=false;
 child.stdout.setEncoding('utf8').on('data',s=>{out+=s;});child.stderr.setEncoding('utf8').on('data',s=>{err+=s;});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{terminal=true;return code===0?resolve():reject(Error(err));});});done.catch(()=>{});
 const item={child,done,output:()=>out,terminal:()=>terminal,diagnostics:()=>err};sessions.push(item);return item;
}
async function held(s,marker){for(let i=0;i<50&&!s.output().includes(marker);i++){assert.equal(s.terminal(),false,s.diagnostics());await new Promise(r=>setTimeout(r,100));}assert.ok(s.output().includes(marker),'writer must hold its uncommitted lock');}
async function blocked(a,b){let seen=false;for(let i=0;i<50&&!seen;i++){
 seen=sql(`SELECT count(*) FROM pg_stat_activity b WHERE b.application_name='${b}' AND b.wait_event_type='Lock' AND EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.application_name='${a}' AND a.pid=ANY(pg_blocking_pids(b.pid)));`)==='1';
 if(!seen)await new Promise(r=>setTimeout(r,100));}assert.ok(seen,'must observe true overlap blocking, not sequential replay');}
const call=deal=>`public.archive_staking_listing_v1('${ids.actor}','${deal}','rejected')`;
try{
 const a=session(),b=session();
 a.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL application_name='archive571-A';SET LOCAL ROLE service_role;SELECT ${call(ids.replay)};SELECT 'A_HOLDS';\n`);
 await held(a,'A_HOLDS');
 b.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL application_name='archive571-B';SET LOCAL ROLE service_role;SELECT ${call(ids.replay)};COMMIT;\n`);
 await blocked('archive571-A','archive571-B');a.child.stdin.end('COMMIT;\n');await a.done;b.child.stdin.end();await b.done;
 const receipt=s=>JSON.parse(s.output().split(/\r?\n/).find(line=>line.startsWith('{')));
 assert.deepEqual(receipt(a),receipt(b));
 assert.equal(sql(`SELECT count(*) FROM public.staking_audit_logs WHERE deal_id='${ids.replay}' AND metadata->>'operation'='archive_reviewed_listing';`),'1');
 const roleHeld=session(),revoke=session();
 roleHeld.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL application_name='archive571-role-held';SET LOCAL ROLE service_role;SELECT ${call(ids.replay)};SELECT 'ROLE_HOLDS';\n`);
 await held(roleHeld,'ROLE_HOLDS');
 revoke.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL application_name='archive571-role-revoke';DELETE FROM public.user_roles WHERE user_id='${ids.actor}' AND role='super_admin';SELECT 'ROLE_REVOKED';COMMIT;\n`);
 await blocked('archive571-role-held','archive571-role-revoke');roleHeld.child.stdin.end('COMMIT;\n');await roleHeld.done;revoke.child.stdin.end();await revoke.done;
 assert.ok(revoke.output().includes('ROLE_REVOKED'));assert.equal(sql(`SELECT count(*) FROM public.user_roles WHERE user_id='${ids.actor}' AND role='super_admin';`),'0');
 sql(`INSERT INTO public.user_roles(user_id,role) VALUES('${ids.actor}','super_admin');`);
 const p=session(),c=session();
 p.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL application_name='archive571-purchase';SELECT id FROM public.staking_deals WHERE id='${ids.purchaseRace}' FOR UPDATE;
 INSERT INTO public.staking_purchases(id,deal_id,backer_id,percent,markup,amount_vnd,status,reference_code) VALUES('${ids.purchase}','${ids.purchaseRace}','${ids.actor}',10,1,100000,'committed','LOCAL571-${ids.purchase}');SELECT 'PURCHASE_HOLDS';\n`);
 await held(p,'PURCHASE_HOLDS');
 c.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL application_name='archive571-archive';SET LOCAL ROLE service_role;
 DO $$ BEGIN BEGIN PERFORM ${call(ids.purchaseRace)};RAISE EXCEPTION 'unexpected_archive';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'staking_archive_dependencies_present' THEN RAISE;END IF;END;END $$;
 SELECT 'PURCHASE_DEPENDENCY_DENIED';COMMIT;\n`);
 await blocked('archive571-purchase','archive571-archive');p.child.stdin.end('COMMIT;\n');await p.done;c.child.stdin.end();await c.done;
 assert.ok(c.output().includes('PURCHASE_DEPENDENCY_DENIED'));
 const facts=JSON.parse(sql(`SELECT jsonb_build_object('archived',(SELECT status FROM public.staking_deals WHERE id='${ids.replay}'),
 'archive_receipts',(SELECT count(*) FROM public.staking_listing_archive_receipts_v1 WHERE deal_id='${ids.replay}'),
 'purchase_race_status',(SELECT status FROM public.staking_deals WHERE id='${ids.purchaseRace}'),
 'purchase_race_receipts',(SELECT count(*) FROM public.staking_listing_archive_receipts_v1 WHERE deal_id='${ids.purchaseRace}'),
 'purchases',(SELECT count(*) FROM public.staking_purchases WHERE id='${ids.purchase}'),
 'funds',(SELECT count(*) FROM public.escrow_transactions WHERE deal_id IN ${own}),
 'notifications',(SELECT count(*) FROM public.notifications WHERE data->>'deal_id' IN('${ids.replay}','${ids.purchaseRace}')));`));
 assert.deepEqual(facts,{archived:'cancelled',archive_receipts:1,purchase_race_status:'listing',purchase_race_receipts:0,purchases:1,funds:0,notifications:0});
 assert.equal(protectedFacts(),before);console.log('ARCHIVE571_TRUE_OVERLAP_REPLAY_PURCHASE_GUARD_NO_MONEY_PASS',JSON.stringify(facts));
}finally{
 for(const s of sessions)if(!s.child.stdin.writableEnded)s.child.stdin.end('ROLLBACK;\n');
 await Promise.allSettled(sessions.map(s=>s.done));sql(`DELETE FROM public.user_roles WHERE user_id='${ids.actor}' AND role='super_admin';`);
 assert.equal(sql(`SELECT count(*) FROM public.user_roles WHERE user_id='${ids.actor}' AND role='super_admin';`),'0');
 assert.equal(protectedFacts(),before);console.log('ARCHIVE571_RETAINED_HISTORY_TEST_ACTOR_PRIVILEGE_REVOKED');
}
