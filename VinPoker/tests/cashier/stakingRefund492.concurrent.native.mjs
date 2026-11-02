// Actual two-session lock probes, no committed fixture or financial writes.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
assert.equal(process.env.VINPOKER_NATIVE_DB_TEST,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=input=>execFileSync('wsl',args,{input,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname='pg_net';"),'0');
const targets=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('deal',d.id,'actor',d.player_id,'status',d.status,'request',r.id,'purchase',p.id))
 FROM public.staking_deals d LEFT JOIN public.staking_release_requests r ON r.deal_id=d.id
 JOIN LATERAL(SELECT id FROM public.staking_purchases WHERE deal_id=d.id ORDER BY id LIMIT 1)p ON true
 WHERE d.status IN('result_verified','cosigned');`));
const release=targets.find(t=>t.status==='cosigned'&&t.request);
const refundable=targets.find(t=>t.status==='result_verified');
assert.ok(release&&refundable,'retained exact lock targets required');
const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
 ${['staking_deals','staking_purchases','staking_release_requests','staking_refund_receipts_v1','escrow_transactions','staking_ledger','staking_audit_logs','payout_recipients','notifications','user_roles'].map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text);`);
const before=fingerprint();
for(const [table,target,id] of [
 ['staking_release_requests',release,release.request],
 ['staking_deals',release,release.deal],
 ['staking_purchases',refundable,refundable.purchase],
]){
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.setEncoding('utf8').on('data',s=>{out+=s;});
 child.stderr.setEncoding('utf8').on('data',s=>{err+=s;});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(err)));});
 done.catch(()=>{});
 try{
  child.stdin.write(`BEGIN;SET LOCAL application_name='refund492-${table}';SELECT id FROM public.${table} WHERE id='${id}' FOR UPDATE;SELECT 'REFUND492_LOCK_HELD';\n`);
  for(let i=0;i<50&&!out.includes('REFUND492_LOCK_HELD');i++)await new Promise(r=>setTimeout(r,100));
  assert.ok(out.includes('REFUND492_LOCK_HELD'),'missing acquired row-lock marker');
  assert.equal(sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='refund492-${table}' AND state='idle in transaction';`),'1');
  const probe=sql(`BEGIN;SET LOCAL lock_timeout='300ms';SET LOCAL statement_timeout='3s';
   INSERT INTO public.user_roles(user_id,role) SELECT '${target.actor}','super_admin'
   WHERE NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='${target.actor}' AND role='super_admin');
   SET LOCAL ROLE service_role;
   DO $$ BEGIN
    BEGIN PERFORM public.commit_staking_refund_v1('${target.actor}','e4920000-0000-4000-8000-000000000001','${target.deal}','LOCAL lock probe');
     RAISE EXCEPTION 'REFUND492_EXPECTED_LOCK_TIMEOUT';
    EXCEPTION WHEN lock_not_available THEN NULL;END;
   END $$;
   RESET ROLE;SELECT 'REFUND492_TIMEOUT_NO_COMMIT';ROLLBACK;`);
  assert.equal(probe,'REFUND492_TIMEOUT_NO_COMMIT');
  assert.equal(fingerprint(),before,'blocked RPC changed authoritative state');
  console.log(`REFUND492_${table.toUpperCase()}_ACTUAL_ROW_LOCK_FENCE_PASS`);
 }finally{
  if(!child.stdin.writableEnded)child.stdin.end('ROLLBACK;\n');await done;
 }
}
assert.equal(fingerprint(),before);
console.log('REFUND492_GLOBAL_FINANCIAL_ROLES_NOTIFICATIONS_UNCHANGED_PASS');
