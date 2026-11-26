import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHmac,randomBytes,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

// Synthetic users and empty isolated DB only. No production credential is read.
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_expense_authority');
assert.ok(process.env.RUNNER_TEMP);
const sqlFiles=[
 ['supabase/migrations/20270128000354_finance_expense_scope_idempotency.sql','4c7615860dba50225a6507f6b2db378f417701a3968bb0063414bdad1ac62632'],
 ['supabase/pending-migrations/20261126001901_finance_pt_cash_drawer_link_v1.sql','44106b5d3500dbb9c1b2f4d3a1feecfc6c83f1ff018266e1951f32d8b5eb2dcb'],
 ['supabase/pending-migrations/20261126011530_finance_expense_cash_source_v1.sql','34464adca0c8546bae2e7b81dee1fee43dbd50c2c44dc68be00b5fd0102e92bf'],
 ['supabase/pending-migrations/20261126023026_finance_expense_cash_source_status_v1.sql','28287f7df15621f00c8e5edd9ebd233d2822eead10af96807bca9fbe0840f914'],
];
for(const [file,hash] of sqlFiles)assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash);
const secret=randomBytes(48).toString('hex'),tokens=[];
const api='http://127.0.0.1:3022',container='expense-authority-http';
const folder=join(process.env.RUNNER_TEMP,'expense-authority');mkdirSync(folder,{recursive:true});
const proof={sourceSha:process.env.SOURCE_SHA,qualification:false,productionMutation:false,productionCapacityClaim:false,actualPostgrest:false,phases:[]};
const id=n=>`18160000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function command(program,args){const r=spawnSync(program,args,{encoding:'utf8'});assert.equal(r.status,0,program==='psql'?r.stderr.slice(0,1800):'isolated command failed');return r.stdout.trim();}
const sql=q=>command('psql',['-XqAt','-v','ON_ERROR_STOP=1','-c',q]);
const read=q=>JSON.parse(sql(q));
function token(actor){const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');const body=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:actor,role:'authenticated',exp:Math.floor(Date.now()/1000)+900});const t=body+'.'+createHmac('sha256',secret).update(body).digest('base64url');tokens.push(t);return t;}
async function request(path,args,actor){const r=await fetch(api+path,{method:args===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token(actor)}`},...(args===undefined?{}:{body:JSON.stringify(args)}),signal:AbortSignal.timeout(12000)});return {status:r.status,data:await r.json()};}
const range=club=>({p_club_id:club,p_from:'2026-10-01T00:00:00+07:00',p_to:'2026-11-01T00:00:00+07:00'});
const intent=(club,key)=>({p_club_id:club,p_category:'rent',p_amount_vnd:1000000,p_incurred_at:'2026-10-10T08:00:00+07:00',p_description:'Synthetic cross-club authorization test',p_payment_status:'unpaid',p_payment_source:null,p_tournament_id:null,p_series_id:null,p_attachment_url:null,p_adjusts_id:null,p_idempotency_key:key});
const candidate='supabase/pending-migrations/20261126071752_finance_expense_club_authority_v1.sql';
const writer="public.record_club_expense(uuid,public.expense_category,bigint,timestamptz,text,text,text,uuid,uuid,text,uuid,text)";
const reader='public.get_club_expenses(uuid,timestamptz,timestamptz)';
const snapshot=()=>read(`SELECT jsonb_build_object('functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN ('${writer}'::regprocedure,'${reader}'::regprocedure)),'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid='public.club_expenses'::regclass),'expenses',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.club_expenses e),'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.club_expenses'::regclass))`);
function refusedApply(expected){const before=snapshot();const r=spawnSync('psql',['-Xq','-v','ON_ERROR_STOP=1','-f',candidate],{encoding:'utf8'});assert.notEqual(r.status,0);assert.ok(r.stderr.includes(expected),r.stderr.slice(0,1000));assert.deepEqual(snapshot(),before);}
function guardFaults(){
 const faults=[
  {name:'disabled-rls',change:'ALTER TABLE public.club_expenses DISABLE ROW LEVEL SECURITY',restore:'ALTER TABLE public.club_expenses ENABLE ROW LEVEL SECURITY',error:'expense_authority_rls_drift'},
  {name:'extra-permissive-policy',change:'CREATE POLICY expense_authority_fault ON public.club_expenses FOR SELECT TO authenticated USING(true)',restore:'DROP POLICY expense_authority_fault ON public.club_expenses',error:'expense_authority_rls_drift'},
  {name:'changed-accountant-policy',change:'ALTER POLICY club_expenses_select_accountant ON public.club_expenses USING(true)',restore:'ALTER POLICY club_expenses_select_accountant ON public.club_expenses USING(public.is_club_accountant(auth.uid(),club_id))',error:'expense_authority_accountant_policy_drift'},
  {name:'unexpected-execute-grant',change:`GRANT EXECUTE ON FUNCTION ${writer} TO anon`,restore:`REVOKE EXECUTE ON FUNCTION ${writer} FROM anon`,error:'expense_authority_metadata_drift'},
 ];
 for(const fault of faults){sql(fault.change);refusedApply(fault.error);sql(fault.restore);}
 proof.preimageFaults=faults.map(f=>({name:f.name,refusedAtomically:true}));
}
async function phase(name,index,isolated=false){
 const a={club:id(index*10+1),owner:id(index*10+2)},b={club:id(index*10+3),owner:id(index*10+4)};
 sql(`INSERT INTO auth.users(id) VALUES('${a.owner}'),('${b.owner}');
 INSERT INTO public.profiles(user_id,display_name) VALUES('${a.owner}','Authority TEST A ${index}'),('${b.owner}','Authority TEST B ${index}');
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${a.club}','${a.owner}','Authority TEST A ${index}','TEST','approved'),('${b.club}','${b.owner}','Authority TEST B ${index}','TEST','approved');
 INSERT INTO public.user_roles(user_id,role) VALUES('${a.owner}','club_admin'),('${b.owner}','club_admin');`);
 assert.equal(sql(`SELECT public.is_club_cashier('${b.owner}','${a.club}')`),'f');
 const own=await request('/rpc/record_club_expense',intent(a.club,`${name}-own-a`),a.owner);assert.equal(own.status,200);assert.equal(own.data.status,'ok');
 const bOwn=await request('/rpc/record_club_expense',intent(b.club,`${name}-own-b`),b.owner);assert.equal(bOwn.status,200);assert.equal(bOwn.data.status,'ok');
 const control=await request('/rpc/get_club_finance_summary_v2',{p_club_id:a.club,p_from_date:'2026-10-01',p_to_date:'2026-10-31'},b.owner);assert.equal(control.status,403);assert.equal(control.data.code,'42501');
 const foreignRead=await request('/rpc/get_club_expenses',range(a.club),b.owner);
 const directRead=await request(`/club_expenses?club_id=eq.${a.club}&select=id,club_id,amount_vnd`,undefined,b.owner);
 const foreignWrite=await request('/rpc/record_club_expense',intent(a.club,`${name}-foreign-b`),b.owner);
 if(isolated){
  assert.equal(foreignRead.status,403);assert.equal(foreignRead.data.code,'42501');
  assert.equal(directRead.status,200);assert.deepEqual(directRead.data,[]);
  assert.equal(foreignWrite.status,403);assert.equal(foreignWrite.data.code,'42501');
  assert.equal(sql(`SELECT count(*) FROM public.club_expenses WHERE club_id='${a.club}' AND entered_by='${b.owner}'`),'0');
  const before=read(`SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.club_expenses e WHERE club_id='${a.club}'`);
  sql(`INSERT INTO public.club_accountants(club_id,user_id) VALUES('${a.club}','${b.owner}')`);
  const grantedRead=await request('/rpc/get_club_expenses',range(a.club),b.owner);assert.equal(grantedRead.status,200);assert.equal(grantedRead.data.rows.length,1);
  const grantedWrite=await request('/rpc/record_club_expense',intent(a.club,`${name}-accountant`),b.owner);assert.equal(grantedWrite.status,200);assert.equal(grantedWrite.data.status,'ok');
  const replay=await request('/rpc/record_club_expense',intent(a.club,`${name}-accountant`),b.owner);assert.equal(replay.status,200);assert.equal(replay.data.expense_id,grantedWrite.data.expense_id);assert.equal(replay.data.idempotent,true);
  sql(`DELETE FROM public.club_accountants WHERE club_id='${a.club}' AND user_id='${b.owner}'`);
  const revokedRead=await request('/rpc/get_club_expenses',range(a.club),b.owner);assert.equal(revokedRead.status,403);
  const revokedReplay=await request('/rpc/record_club_expense',intent(a.club,`${name}-accountant`),b.owner);assert.equal(revokedReplay.status,403);
  const ownRead=await request('/rpc/get_club_expenses',range(b.club),b.owner);assert.equal(ownRead.status,200);assert.equal(ownRead.data.rows.length,1);
  const after=read(`SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.club_expenses e WHERE club_id='${a.club}'`);
  assert.deepEqual(after.filter(e=>e.id===own.data.expense_id),before);
  assert.equal(after.length,2);assert.equal(after.reduce((sum,e)=>sum+Number(e.amount_vnd),0),2000000);
  proof.phases.push({name,isolationInvariantPassed:true,foreignReadDenied:true,foreignTableRows:0,foreignWriteDenied:true,foreignCommittedRows:0,explicitAccountantGranted:true,sameIntentReplay:true,revokedReadAndReplayDenied:true,otherClubStillAccessible:true,originalExpenseUnchanged:true});
  return {a,b,own,grantedWrite};
 }
 // This is deliberately a reproduction receipt, never an authorization PASS.
 assert.equal(foreignRead.status,200);assert.equal(foreignRead.data.rows.length,1);assert.equal(foreignRead.data.rows[0].id,own.data.expense_id);
 assert.equal(directRead.status,200);assert.equal(directRead.data.length,1);assert.equal(directRead.data[0].id,own.data.expense_id);
 assert.equal(foreignWrite.status,200);assert.equal(foreignWrite.data.status,'ok');
 assert.equal(sql(`SELECT count(*) FROM public.club_expenses WHERE club_id='${a.club}' AND entered_by='${b.owner}'`),'1');
 const ownRead=await request('/rpc/get_club_expenses',range(b.club),b.owner);assert.equal(ownRead.status,200);assert.equal(ownRead.data.rows.length,1);
 proof.phases.push({name,ownWritesValid:true,ownReadValid:true,foreignCashierMembership:false,financeSummaryForeignStatus:control.status,expenseRpcForeignStatus:foreignRead.status,foreignRows:foreignRead.data.rows.length,directTableForeignStatus:directRead.status,directForeignRows:directRead.data.length,expenseWriterForeignStatus:foreignWrite.status,foreignExpenseCommitted:true,isolationInvariantPassed:false});
}
// Match the existing Cashier runtime's real psql/HTTP lock barrier pattern.
async function hold(statements){
 const child=spawn('psql',['-XqAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']}),closed=new Promise(resolve=>child.once('close',resolve));let buffer='';
 const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('authority holder timeout')),5000);child.stdout.on('data',chunk=>{buffer+=chunk;for(const line of buffer.split(/\r?\n/))if(line.startsWith('{')){const value=JSON.parse(line);if(value.held){clearTimeout(timer);resolve(value.pid);}}});child.once('error',error=>{clearTimeout(timer);reject(error);});});
 child.stdin.write('BEGIN;SET LOCAL statement_timeout=\'10s\';'+statements+';SELECT json_build_object(\'held\',true,\'pid\',pg_backend_pid());\n');
 let pid;try{pid=await ready;}catch(error){child.kill('SIGTERM');await closed;throw error;}
 return {pid,release:async()=>{child.stdin.end('COMMIT;\n\\q\n');assert.equal(await closed,0);}};
}
async function concurrencyAndRecovery({a,b,grantedWrite}){
 const original=snapshot(),key='authority-two-actors-same-intent',args=intent(a.club,key);
 // Uncommitted grants must not authorize another connection.
 let holder=await hold(`INSERT INTO public.club_accountants(club_id,user_id) VALUES('${a.club}','${b.owner}')`);
 try{const beforeCommit=await request('/rpc/record_club_expense',args,b.owner);assert.equal(beforeCommit.status,403);assert.equal(beforeCommit.data.code,'42501');}
 finally{await holder.release();}
 holder=await hold('LOCK TABLE public.club_expenses IN SHARE MODE');
 let requests,observed;
 try{
  requests=[request('/rpc/record_club_expense',args,a.owner),request('/rpc/record_club_expense',args,b.owner)];
  for(let i=0;i<60;i++){
   observed=read(`SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'blockers',pg_blocking_pids(pid))),'[]') FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%record_club_expense%' AND ${holder.pid}=ANY(pg_blocking_pids(pid))`);
   if(observed.length===2)break;await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(observed.length,2,'two actual HTTP connections blocked by the owned table holder');assert.equal(new Set(observed.map(r=>r.pid)).size,2);
 }finally{await holder.release();}
 const results=await Promise.all(requests);for(const result of results){assert.equal(result.status,200);assert.equal(result.data.status,'ok');}
 assert.equal(results[0].data.expense_id,results[1].data.expense_id);assert.deepEqual(results.map(r=>r.data.idempotent).sort(),[false,true]);
 assert.deepEqual(read(`SELECT jsonb_build_object('count',count(*),'total',sum(amount_vnd)) FROM public.club_expenses WHERE club_id='${a.club}' AND idempotency_key='${key}'`),{count:1,total:1000000});
 const conflict=await request('/rpc/record_club_expense',{...args,p_amount_vnd:2000000},b.owner);assert.equal(conflict.status,400);assert.equal(conflict.data.code,'22023');
 sql(`DELETE FROM public.club_accountants WHERE club_id='${a.club}' AND user_id='${b.owner}'`);
 const revoked=await Promise.all([request('/rpc/get_club_expenses',range(a.club),b.owner),request('/rpc/record_club_expense',args,b.owner),request('/rpc/record_club_expense',intent(a.club,'after-committed-revocation'),b.owner)]);
 for(const result of revoked){assert.equal(result.status,403);assert.equal(result.data.code,'42501');}
 const hidden=await request(`/club_expenses?club_id=eq.${a.club}&select=id`,undefined,b.owner);assert.equal(hidden.status,200);assert.deepEqual(hidden.data,[]);
 const other=await request('/rpc/get_club_expenses',range(b.club),b.owner);assert.equal(other.status,200);assert.equal(other.data.rows.length,1);
 const committed=snapshot();assert.deepEqual(committed.expenses.filter(e=>original.expenses.some(o=>o.id===e.id)),original.expenses);assert.equal(committed.expenses.length,original.expenses.length+1);
 proof.concurrency={actualHttpConnections:2,observedBlockedConnections:observed.length,uncommittedGrantDenied:true,oneExpense:true,totalVnd:1000000,conflictingIntentDenied:true,committedRevocationDeniesReadReplayAndNewWrite:true,foreignTableRows:0,otherClubPreserved:true,originalExpensesUnchanged:true};
 // Forward source recovery keeps the corrected authorization, not the vulnerable preimage.
 const definition=sql(`SELECT pg_get_functiondef('${writer}'::regprocedure)`),body=sql(`SELECT prosrc FROM pg_proc WHERE oid='${writer}'::regprocedure`);
 assert.ok(definition.includes(body));assert.ok(!body.includes("has_role(v_uid,'club_admin'"));
 sql(`REVOKE EXECUTE ON FUNCTION ${writer} FROM authenticated,service_role`);
 const paused=await request('/rpc/record_club_expense',intent(a.club,'recovery-pause'),a.owner);assert.equal(paused.status,403);assert.equal(paused.data.code,'42501');
 const safeRead=await request('/rpc/get_club_expenses',range(a.club),a.owner);assert.equal(safeRead.status,200);
 sql(definition.replace(body,"BEGIN RAISE EXCEPTION 'isolated_forward_recovery_fault' USING ERRCODE='55000'; END;"));
 sql(`BEGIN;${definition};GRANT EXECUTE ON FUNCTION ${writer} TO authenticated,service_role;COMMIT;`);
 assert.deepEqual(snapshot(),committed);
 const recovered=await request('/rpc/record_club_expense',args,a.owner);assert.equal(recovered.status,200);assert.equal(recovered.data.expense_id,results[0].data.expense_id);assert.equal(recovered.data.idempotent,true);
 const originalReplay=await request('/rpc/record_club_expense',intent(a.club,'candidate-club-authority-fix-accountant'),a.owner);assert.equal(originalReplay.status,200);assert.equal(originalReplay.data.expense_id,grantedWrite.data.expense_id);
 const foreign=await request('/rpc/record_club_expense',args,b.owner);assert.equal(foreign.status,403);assert.deepEqual(snapshot(),committed);
 proof.forwardRecovery={pausedWriterDenied:true,safeReadRetained:true,correctedSourceRestored:true,metadataPoliciesAndExpensesUnchanged:true,receiptIdentityPreserved:true,foreignWriteStillDenied:true,limits:'Isolated source recovery from the corrected definition; not a hosted backup/restore or production rollback authorization.'};
}

try{
 assert.equal(sql('SELECT count(*) FROM public.clubs'),'0');
 sql(`ALTER ROLE authenticator LOGIN NOINHERIT NOSUPERUSER;GRANT authenticated,anon TO authenticator;
 CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $auth$;`);
 const r=spawnSync('docker',['run','--detach','--name',container,'--network','host',...['PGRST_DB_URI','PGRST_DB_SCHEMAS','PGRST_DB_ANON_ROLE','PGRST_JWT_SECRET','PGRST_SERVER_HOST','PGRST_SERVER_PORT'].flatMap(k=>['-e',k]),'postgrest/postgrest:v13.0.7'],{encoding:'utf8',env:{...process.env,PGRST_DB_URI:'postgres://authenticator@127.0.0.1:5432/vinpoker_ops_expense_authority',PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3022'}});assert.equal(r.status,0,'isolated API startup');
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch(api,{signal:AbortSignal.timeout(500)})).status<500){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);proof.actualPostgrest=true;
 await phase('captured-current-schema',1);
 for(const [file] of sqlFiles)command('psql',['-Xq','-v','ON_ERROR_STOP=1','--single-transaction','-f',file]);
 sql("NOTIFY pgrst,'reload schema'");
 await phase('candidate-e231-frozen-sql',2);
 guardFaults();
 const beforeFix=snapshot();
 command('psql',['-Xq','-v','ON_ERROR_STOP=1','-f',candidate]);
 const afterFix=snapshot();assert.deepEqual(afterFix.expenses,beforeFix.expenses);
 for(let i=0;i<beforeFix.functions.length;i++){const old=beforeFix.functions[i],fixed=afterFix.functions[i];for(const key of Object.keys(old).filter(k=>k!=='prosrc'))assert.deepEqual(fixed[key],old[key],key);}
 proof.functionMetadataAndExistingExpensesPreserved=true;
 refusedApply('expense_authority_function_preimage_drift');proof.repeatApplyRefusedAtomically=true;
 sql("NOTIFY pgrst,'reload schema'");
 const scoped=await phase('candidate-club-authority-fix',3,true);
 await concurrencyAndRecovery(scoped);
 proof.candidateMigrationSha256=createHash('sha256').update(readFileSync(candidate)).digest('hex');
 proof.finding='P1: club_admin global shortcut bypasses club scope in expense reader, table SELECT policy and generic expense writer; normal club owner receives this role in AdminUsers.assignClub';
 writeFileSync(join(folder,'reproduction.json'),JSON.stringify(proof,null,2));console.log('CROSS_CLUB_EXPENSE_AUTHORITY_VIOLATION_REPRODUCED_NOT_QUALIFIED');
}catch(e){let message=String(e.message).replaceAll(secret,'[REDACTED]');for(const t of tokens)message=message.replaceAll(t,'[REDACTED]');writeFileSync(join(folder,'failure.json'),JSON.stringify({...proof,error:message},null,2));console.error('AUTHORITY_DIAGNOSTIC_FAILED',message);process.exitCode=1;}
finally{spawnSync('docker',['rm','--force',container],{stdio:'ignore'});}
