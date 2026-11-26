import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
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
async function phase(name,index){
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
 // This is deliberately a reproduction receipt, never an authorization PASS.
 assert.equal(foreignRead.status,200);assert.equal(foreignRead.data.rows.length,1);assert.equal(foreignRead.data.rows[0].id,own.data.expense_id);
 assert.equal(directRead.status,200);assert.equal(directRead.data.length,1);assert.equal(directRead.data[0].id,own.data.expense_id);
 assert.equal(foreignWrite.status,200);assert.equal(foreignWrite.data.status,'ok');
 assert.equal(sql(`SELECT count(*) FROM public.club_expenses WHERE club_id='${a.club}' AND entered_by='${b.owner}'`),'1');
 const ownRead=await request('/rpc/get_club_expenses',range(b.club),b.owner);assert.equal(ownRead.status,200);assert.equal(ownRead.data.rows.length,1);
 proof.phases.push({name,ownWritesValid:true,ownReadValid:true,foreignCashierMembership:false,financeSummaryForeignStatus:control.status,expenseRpcForeignStatus:foreignRead.status,foreignRows:foreignRead.data.rows.length,directTableForeignStatus:directRead.status,directForeignRows:directRead.data.length,expenseWriterForeignStatus:foreignWrite.status,foreignExpenseCommitted:true,isolationInvariantPassed:false});
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
 proof.finding='P1: club_admin global shortcut bypasses club scope in expense reader, table SELECT policy and generic expense writer; normal club owner receives this role in AdminUsers.assignClub';
 writeFileSync(join(folder,'reproduction.json'),JSON.stringify(proof,null,2));console.log('CROSS_CLUB_EXPENSE_AUTHORITY_VIOLATION_REPRODUCED_NOT_QUALIFIED');
}catch(e){let message=String(e.message).replaceAll(secret,'[REDACTED]');for(const t of tokens)message=message.replaceAll(t,'[REDACTED]');writeFileSync(join(folder,'failure.json'),JSON.stringify({...proof,error:message},null,2));console.error('AUTHORITY_DIAGNOSTIC_FAILED',message);process.exitCode=1;}
finally{spawnSync('docker',['rm','--force',container],{stdio:'ignore'});}
