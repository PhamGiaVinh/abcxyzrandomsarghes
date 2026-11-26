import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHmac,randomBytes,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.equal(process.env.PGDATABASE,'vinpoker_ops_expense_cash_source');
assert.ok(process.env.RUNNER_TEMP);
const file='supabase/pending-migrations/20261126011530_finance_expense_cash_source_v1.sql';
const expense='supabase/migrations/20270128000354_finance_expense_scope_idempotency.sql';
const pt='supabase/pending-migrations/20261126001901_finance_pt_cash_drawer_link_v1.sql';
const pinned=JSON.parse(readFileSync('tests/financeExpenseCash/prerequisite-contract.json','utf8'));
const prior=JSON.parse(readFileSync(join(process.env.EXPENSE_DEPENDENCY_ARTIFACT,'expense-cash-dependency-catalog.json'),'utf8'));
assert.equal(prior.sourceSha,pinned.captureSha);assert.equal(prior.qualification,false);
assert.deepEqual(prior.catalog,pinned.catalog);
const hash=f=>createHash('sha256').update(readFileSync(f)).digest('hex');
assert.equal(hash(expense),pinned.expense354SqlSha256);assert.equal(hash(pt),pinned.ptSqlSha256);
const folder=join(process.env.RUNNER_TEMP,'expense-cash-source');mkdirSync(folder,{recursive:true});
const proof={sourceSha:process.env.SOURCE_SHA,migrationSha256:hash(file),dependencyCapture:pinned.captureRun,cases:[],races:[],faults:[],productionMutation:false,productionCapacityClaim:false};
const secret=randomBytes(48).toString('hex'),tokens=[],container='expense-cash-source-http',api='http://127.0.0.1:3020';
const id=n=>`18130000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function command(program,args){const r=spawnSync(program,args,{encoding:'utf8'});assert.equal(r.status,0,program==='psql'?String(r.stderr).slice(0,1800):'isolated command failed');return r.stdout.trim();}
const sql=q=>command('psql',['-XqAt','-v','ON_ERROR_STOP=1','-c',q]);
const read=q=>JSON.parse(sql(q));
const install=()=>spawnSync('psql',['-Xq','-v','ON_ERROR_STOP=1','--single-transaction','-f',file],{encoding:'utf8'});
function token(actor){const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');const body=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:actor,role:'authenticated',exp:Math.floor(Date.now()/1000)+1200});const t=body+'.'+createHmac('sha256',secret).update(body).digest('base64url');tokens.push(t);return t;}
async function request(name,args,actor){const r=await fetch(api+'/rpc/'+name,{method:'POST',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${token(actor)}`},body:JSON.stringify(args)});return {status:r.status,data:await r.json()};}
async function rpc(name,args,actor){const r=await request(name,args,actor);assert.equal(r.status,200,name+': HTTP');assert.equal(r.data.error,undefined,name+': refused');return r.data;}
const pay=(f,args=f.args,actor=f.cashier)=>request('record_cashier_club_expense_v1',args,actor);
function facts(f){return read(`SELECT jsonb_build_object('expenses',(SELECT count(*) FROM public.club_expenses WHERE club_id='${f.club}'),'receipts',(SELECT count(*) FROM public.finance_expense_cash_receipts WHERE club_id='${f.club}'),'movements',(SELECT count(*) FROM public.cashier_buyin_movements WHERE club_id='${f.club}'))`);}
const noFacts=f=>assert.deepEqual(facts(f),{expenses:0,receipts:0,movements:0});
function attack(query,reason){const r=spawnSync('psql',['-XqAt','-v','ON_ERROR_STOP=1','-c',`BEGIN;${query};ROLLBACK;`],{encoding:'utf8'});assert.notEqual(r.status,0);assert.ok(r.stderr.includes(reason),'expected refusal: '+reason+'; actual: '+r.stderr.slice(0,1000));}
async function seed(index,enabled=true,opening=10000000){
 const f={club:id(100+index),owner:id(200+index),cashier:id(300+index),accountant:id(400+index),index};
 sql(`INSERT INTO auth.users(id) VALUES('${f.owner}'),('${f.cashier}'),('${f.accountant}');
 INSERT INTO public.profiles(user_id,display_name) VALUES('${f.owner}','Expense source TEST owner ${index}'),('${f.cashier}','Expense source TEST cashier ${index}'),('${f.accountant}','Expense source TEST accountant ${index}');
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${f.club}','${f.owner}','Expense source TEST ${index}','TEST','approved');
 INSERT INTO public.club_cashiers(club_id,user_id) VALUES('${f.club}','${f.cashier}');
 INSERT INTO public.club_accountants(club_id,user_id,granted_by) VALUES('${f.club}','${f.accountant}','${f.owner}');
 INSERT INTO public.cashier_tour_settings(club_id,enabled,expense_cash_source_enabled) VALUES('${f.club}',true,${enabled});`);
 const opened=await rpc('cashier_open_shift_v1',{p_club_id:f.club,p_opening_cash:opening},f.cashier);assert.equal(opened.ok,true);f.shift=opened.shift_id;
 f.args={p_request_id:id(1000+index),p_club_id:f.club,p_shift_id:f.shift,p_category:'rent',p_amount_vnd:1000000,p_incurred_at:'2026-10-10T08:00:00+07:00',p_description:'TEST explicit till expense',p_tournament_id:null,p_series_id:null,p_attachment_url:null};return f;
}
function legacy(f,key,status='paid',source='cash',amount=1000000,adjusts=null){return {p_club_id:f.club,p_category:'rent',p_amount_vnd:amount,p_incurred_at:f.args.p_incurred_at,p_description:f.args.p_description,p_payment_status:status,p_payment_source:source,p_tournament_id:null,p_series_id:null,p_attachment_url:null,p_adjusts_id:adjusts,p_idempotency_key:key};}
async function hold(shift){
 const child=spawn('psql',['-XqAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']}),closed=new Promise(r=>child.once('close',r));let buffer='';
 const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('till holder timeout')),5000);child.stdout.on('data',c=>{buffer+=c;for(const line of buffer.split(/\r?\n/))if(line.startsWith('{')){const value=JSON.parse(line);if(value.held){clearTimeout(timer);resolve(value.pid);}}});child.once('error',reject);});
 child.stdin.write(`BEGIN;SELECT id FROM public.cashier_till_shifts WHERE id='${shift}' FOR UPDATE;SELECT json_build_object('held',true,'pid',pg_backend_pid());\n`);
 let pid;try{pid=await ready;}catch(e){child.kill('SIGTERM');await closed;throw e;}
 return {pid,release:async()=>{child.stdin.end('COMMIT;\n\\q\n');assert.equal(await closed,0);}};
}
async function blocked(name,min=1){for(let i=0;i<60;i++){const a=read(`SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait',wait_event_type)),'[]') FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%${name}%'`);if(a.length>=min)return a;await new Promise(r=>setTimeout(r,100));}throw Error('missing real HTTP lock barrier: '+name);}
try{
 assert.equal(sql('SELECT count(*) FROM public.clubs'),'0');
 command('psql',['-Xq','-v','ON_ERROR_STOP=1','-f',expense]);command('psql',['-Xq','-v','ON_ERROR_STOP=1','--single-transaction','-f',pt]);
 const original=read(`SELECT jsonb_object_agg(proname,md5(prosrc)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN('record_club_expense','cashier_close_shift_v1','pay_finalized_part_time_payroll_statement','get_club_expenses')`);
 for(const fault of ['cashier_movement_shape','cashier_buyin_movements_purpose_check','cashier_pt_source_shape']){
  const saved=pinned.catalog.constraints.find(x=>x.name===fault);assert.ok(saved);
  sql(`ALTER TABLE public.cashier_buyin_movements DROP CONSTRAINT ${fault};ALTER TABLE public.cashier_buyin_movements ADD CONSTRAINT ${fault} CHECK(true)`);
  const refused=install();assert.notEqual(refused.status,0);assert.ok(refused.stderr.includes('finance_expense_cash_pt_dependency_drift'));
  assert.equal(sql("SELECT to_regclass('public.finance_expense_cash_receipts') IS NULL"),'t');
  assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='cashier_tour_settings' AND column_name='expense_cash_source_enabled'"),'0');
  sql(`ALTER TABLE public.cashier_buyin_movements DROP CONSTRAINT ${fault};ALTER TABLE public.cashier_buyin_movements ADD CONSTRAINT ${fault} ${saved.definition}`);proof.faults.push({name:fault,refused:true,noCandidateObjects:true});
 }
 for(const [name,mutate,restore] of [
  ['disabled-source-trigger','ALTER TABLE public.cashier_buyin_movements DISABLE TRIGGER finance_verify_pt_cash_movement','ALTER TABLE public.cashier_buyin_movements ENABLE TRIGGER finance_verify_pt_cash_movement'],
  ['nonunique-source-index','DROP INDEX public.cashier_one_movement_per_pt_wage_payment;CREATE INDEX cashier_one_movement_per_pt_wage_payment ON public.cashier_buyin_movements(dealer_pt_wage_payment_id) WHERE dealer_pt_wage_payment_id IS NOT NULL','DROP INDEX public.cashier_one_movement_per_pt_wage_payment;'+pinned.catalog.indexes.find(x=>x.name==='cashier_one_movement_per_pt_wage_payment').definition]
 ]){sql(mutate);const refused=install();assert.notEqual(refused.status,0);assert.ok(refused.stderr.includes('finance_expense_cash_pt_dependency_drift'));assert.equal(sql("SELECT to_regclass('public.finance_expense_cash_receipts') IS NULL"),'t');sql(restore);proof.faults.push({name,refused:true,noCandidateObjects:true});}
 const applied=install();assert.equal(applied.status,0,String(applied.stderr).slice(0,2000));
 assert.equal(sql("SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE a.attrelid='public.cashier_tour_settings'::regclass AND a.attname='expense_cash_source_enabled'"),'false');
 assert.equal(sql("SELECT has_table_privilege('authenticated','public.finance_expense_cash_receipts','INSERT') OR has_table_privilege('service_role','public.finance_expense_cash_receipts','INSERT')"),'f');
 assert.equal(sql("SELECT has_function_privilege('anon','public.record_cashier_club_expense_v1(uuid,uuid,uuid,public.expense_category,bigint,timestamptz,text,uuid,uuid,text)','EXECUTE') OR has_function_privilege('service_role','public.record_cashier_club_expense_v1(uuid,uuid,uuid,public.expense_category,bigint,timestamptz,text,uuid,uuid,text)','EXECUTE')"),'f');
 sql(`ALTER ROLE authenticator LOGIN NOINHERIT NOSUPERUSER;GRANT authenticated,anon TO authenticator;
 CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $auth$;`);
 const d=spawnSync('docker',['run','--detach','--name',container,'--network','host',...['PGRST_DB_URI','PGRST_DB_SCHEMAS','PGRST_DB_ANON_ROLE','PGRST_JWT_SECRET','PGRST_SERVER_HOST','PGRST_SERVER_PORT'].flatMap(k=>['-e',k]),'postgrest/postgrest:v13.0.7'],{encoding:'utf8',env:{...process.env,PGRST_DB_URI:'postgres://authenticator@127.0.0.1:5432/vinpoker_ops_expense_cash_source',PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3020'}});assert.equal(d.status,0,'isolated API startup');
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch(api,{signal:AbortSignal.timeout(500)})).status<500){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
 const off=await seed(1,false),disabled=await pay(off);assert.equal(disabled.data.code,'55000');noFacts(off);
 const oldKey='finance-cash-expense:'+off.args.p_request_id;const old=await rpc('record_club_expense',legacy(off,oldKey),off.cashier);assert.equal(old.status,'ok');assert.deepEqual(facts(off),{expenses:1,receipts:0,movements:0});
 sql(`UPDATE public.cashier_tour_settings SET expense_cash_source_enabled=true WHERE club_id='${off.club}'`);
 const oldReplay=await rpc('record_club_expense',legacy(off,oldKey),off.cashier);assert.equal(oldReplay.expense_id,old.expense_id);assert.equal(oldReplay.idempotent,true);
 const noRetro=await pay(off);assert.equal(noRetro.data.code,'55000');assert.match(noRetro.data.message,/LEGACY_SOURCE_UNVERIFIED/);assert.deepEqual(facts(off),{expenses:1,receipts:0,movements:0});proof.cases.push({name:'default-off-and-historical-replay-never-retro-links',legacyExpenses:1,receipts:0,movements:0});
 const cash=await seed(2),paid=await pay(cash);assert.equal(paid.status,200);assert.equal(paid.data.idempotent,false);assert.equal(paid.data.amount_vnd,1000000);assert.deepEqual(facts(cash),{expenses:1,receipts:1,movements:1});
 const movement=read(`SELECT to_jsonb(m) FROM public.cashier_buyin_movements m WHERE club_expense_cash_receipt_id='${cash.args.p_request_id}'`);assert.equal(movement.purpose,'club_expense');assert.equal(movement.amount,1000000);assert.equal(movement.shift_id,cash.shift);assert.equal(movement.actor_id,cash.cashier);
 assert.equal(sql(`SELECT (m.created_at=r.paid_at AND m.created_at>=s.opened_at)::text FROM public.cashier_buyin_movements m JOIN public.finance_expense_cash_receipts r ON r.request_id=m.club_expense_cash_receipt_id JOIN public.cashier_till_shifts s ON s.id=r.shift_id WHERE r.request_id='${cash.args.p_request_id}'`),'true');
 const summary=await rpc('cashier_shift_summary_v1',{p_shift_id:cash.shift},cash.cashier);assert.equal(summary.expected_cash,9000000);assert.equal(summary.totals.club_expense_cash_out,1000000);assert.equal(summary.totals.dealer_pt_cash_out,0);
 const october=await rpc('get_club_expenses',{p_club_id:cash.club,p_from:'2026-10-01T00:00:00+07:00',p_to:'2026-11-01T00:00:00+07:00'},cash.owner);assert.equal(october.total_vnd,1000000);assert.equal(october.rows.length,1);
 const paymentWindow={p_club_id:cash.club,p_from:new Date(Date.now()-60000).toISOString(),p_to:new Date(Date.now()+60000).toISOString()};const flow=await rpc('cashier_cashflow_range_v1',paymentWindow,cash.cashier);assert.equal(flow.cash_flow.club_expense_cash_out,1000000);assert.equal(flow.cash_flow.cash_out,0);
 const noCostNow=await rpc('get_club_expenses',paymentWindow,cash.owner);assert.equal(noCostNow.total_vnd,0);
 const closed=await rpc('cashier_close_shift_v1',{p_shift_id:cash.shift,p_counted_cash:9000000},cash.cashier);assert.equal(closed.variance_cash,0);assert.equal(closed.expected_cash,9000000);
 const frozen=sql(`SELECT to_jsonb(s)::text FROM public.cashier_till_shifts s WHERE id='${cash.shift}'`),replay=await pay(cash);assert.equal(replay.status,200);assert.equal(replay.data.idempotent,true);assert.equal(replay.data.expense_id,paid.data.expense_id);assert.deepEqual(facts(cash),{expenses:1,receipts:1,movements:1});
 for(const patch of [{p_amount_vnd:1000001},{p_shift_id:id(99999)},{p_description:'different'},{p_incurred_at:'2026-10-11T08:00:00+07:00'},{p_attachment_url:'https://example.invalid/receipt'},{p_category:'misc'}]){const conflict=await pay(cash,{...cash.args,...patch});assert.equal(conflict.data.code,'22023');assert.equal(conflict.status,400);}
 attack(`UPDATE public.club_expenses SET amount_vnd=2 WHERE id='${paid.data.expense_id}'`,'FINANCE_FUNDED_EXPENSE_IMMUTABLE');
 attack(`DELETE FROM public.club_expenses WHERE id='${paid.data.expense_id}'`,'FINANCE_FUNDED_EXPENSE_IMMUTABLE');
 attack(`UPDATE public.finance_expense_cash_receipts SET amount_vnd=2 WHERE request_id='${cash.args.p_request_id}'`,'FINANCE_EXPENSE_CASH_RECEIPT_IMMUTABLE');
 attack(`DELETE FROM public.finance_expense_cash_receipts WHERE request_id='${cash.args.p_request_id}'`,'FINANCE_EXPENSE_CASH_RECEIPT_IMMUTABLE');
 attack(`UPDATE public.cashier_buyin_movements SET club_expense_cash_receipt_id=NULL WHERE id='${movement.id}'`,'Cashier movements are append-only');
 assert.deepEqual(read(`SELECT to_jsonb(m) FROM public.cashier_buyin_movements m WHERE id='${movement.id}'`),movement);
 const correction=await rpc('record_club_expense',legacy(cash,'cash-cost-correction','unpaid',null,-200000,paid.data.expense_id),cash.owner);assert.equal(correction.status,'ok');assert.deepEqual(facts(cash),{expenses:2,receipts:1,movements:1});assert.equal(sql(`SELECT to_jsonb(s)::text FROM public.cashier_till_shifts s WHERE id='${cash.shift}'`),frozen);
 proof.cases.push({name:'explicit-source-one-cost-one-payment-one-movement-close-replay-immutable',costInOctober:1000000,costAtPaymentTime:0,cashPaidNow:1000000,expected:closed.expected_cash,variance:0,negativeCostAdjustmentCashEffect:0,exactReplayAndConflicts:true});
 const denied=await seed(3);for(const actor of [cash.cashier,denied.accountant]){const r=await pay(denied,denied.args,actor);assert.equal(r.status,403);assert.equal(r.data.code,'42501');noFacts(denied);}
 const foreign=await pay(denied,{...denied.args,p_shift_id:off.shift});assert.equal(foreign.data.code,'55000');noFacts(denied);
 const reference=await pay(denied,{...denied.args,p_tournament_id:id(99998)});assert.equal(reference.status,403);noFacts(denied);
 const legacyBypass=await request('record_club_expense',legacy(denied,'legacy-new-cash'),denied.cashier);assert.equal(legacyBypass.data.code,'55000');noFacts(denied);
 const negativeCash=await request('record_club_expense',legacy(denied,'cost-not-cash-return','paid','cash',-200000),denied.cashier);assert.equal(negativeCash.data.code,'55000');noFacts(denied);
 const negativeSource=await pay(denied,{...denied.args,p_amount_vnd:-1});assert.equal(negativeSource.data.code,'22023');noFacts(denied);proof.cases.push({name:'foreign-actor-accountant-source-reference-and-legacy-negative-cash-fenced',expenses:0,receipts:0,movements:0});
 for(const [index,order] of [[4,'pay-first'],[5,'close-first']]){
  const f=await seed(index),holder=await hold(f.shift);let p,c,first,second;
  try{if(order==='pay-first'){p=pay(f);first=await blocked('record_cashier_club_expense_v1');c=request('cashier_close_shift_v1',{p_shift_id:f.shift,p_counted_cash:9000000},f.cashier);second=await blocked('cashier_close_shift_v1');}else{c=request('cashier_close_shift_v1',{p_shift_id:f.shift,p_counted_cash:10000000},f.cashier);first=await blocked('cashier_close_shift_v1');p=pay(f);second=await blocked('record_cashier_club_expense_v1');}}finally{await holder.release();}
  assert.ok(second.some(x=>x.blockers.some(pid=>first.some(y=>y.pid===pid))),'second writer must wait behind first writer');const [payment,close]=await Promise.all([p,c]);assert.equal(close.status,200);assert.equal(close.data.variance_cash,0);
  if(order==='pay-first'){assert.equal(payment.status,200);assert.equal(close.data.expected_cash,9000000);assert.deepEqual(facts(f),{expenses:1,receipts:1,movements:1});}else{assert.equal(payment.data.code,'55000');assert.equal(close.data.expected_cash,10000000);noFacts(f);}
  proof.races.push({order,first,second,paymentStatus:payment.status,paymentCode:payment.data.code??null,expected:close.data.expected_cash,variance:0,facts:facts(f)});
 }
 for(const [index,same] of [[6,true],[7,false]]){
  const f=await seed(index),holder=await hold(f.shift);const secondArgs=same?f.args:{...f.args,p_request_id:id(2000+index),p_amount_vnd:6000000};if(!same)f.args.p_amount_vnd=6000000;let p1,p2,first,second;
  try{p1=pay(f);first=await blocked('record_cashier_club_expense_v1');p2=pay(f,secondArgs);second=await blocked('record_cashier_club_expense_v1',2);}finally{await holder.release();}
  const [a,b]=await Promise.all([p1,p2]);assert.equal(a.status,200);if(same){assert.equal(b.status,200);assert.equal(b.data.idempotent,true);assert.equal(a.data.expense_id,b.data.expense_id);}else{assert.equal(b.data.code,'55000');assert.match(b.data.message,/INSUFFICIENT/);}assert.deepEqual(facts(f),{expenses:1,receipts:1,movements:1});proof.races.push({order:same?'same-intent-race':'two-intents-insufficient-shared-cash',first,second,firstStatus:a.status,secondStatus:b.status,facts:facts(f)});
 }
 const revoked=await seed(8),holder=await hold(revoked.shift);let pending,barrier;
 try{pending=pay(revoked);barrier=await blocked('record_cashier_club_expense_v1');sql(`DELETE FROM public.club_cashiers WHERE club_id='${revoked.club}' AND user_id='${revoked.cashier}'`);}finally{await holder.release();}
 const lost=await pending;assert.equal(lost.status,403);assert.equal(lost.data.code,'42501');noFacts(revoked);proof.cases.push({name:'role-revoked-while-waiting-rolls-back-all-facts',barrier,status:lost.status,facts:facts(revoked)});
 const deferred=await seed(9),directExpense=id(4001),directRequest=id(4002);
 const costInsert=`INSERT INTO public.club_expenses(id,club_id,category,amount_vnd,incurred_at,payment_status,payment_source,entered_by,idempotency_key) VALUES('${directExpense}','${deferred.club}','rent',1000000,now(),'paid','cash','${deferred.cashier}','finance-cash-expense:${directRequest}')`;
 attack(costInsert+';SET CONSTRAINTS ALL IMMEDIATE','FINANCE_EXPENSE_EXPLICIT_CASH_SOURCE_REQUIRED');noFacts(deferred);
 attack(`SET LOCAL request.jwt.claim.sub='${deferred.cashier}';${costInsert};INSERT INTO public.finance_expense_cash_receipts(request_id,club_id,expense_id,shift_id,amount_vnd,paid_by) VALUES('${directRequest}','${deferred.club}','${directExpense}','${deferred.shift}',1000000,'${deferred.cashier}');SET CONSTRAINTS ALL IMMEDIATE`,'FINANCE_EXPENSE_CASH_MOVEMENT_REQUIRED');noFacts(deferred);
 proof.cases.push({name:'direct-privileged-insert-deferred-source-and-movement-guards-forced',constraintsForcedImmediate:true,facts:facts(deferred)});
 const after=read(`SELECT jsonb_object_agg(proname,md5(prosrc)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN('record_club_expense','cashier_close_shift_v1','pay_finalized_part_time_payroll_statement','get_club_expenses')`);assert.deepEqual(after,original);
 proof.actualPostgrest=true;proof.defaultOff=true;proof.originalWritersPreserved=true;proof.scope='isolated explicit NEW positive expense/till source only; no existing-unpaid settlement, returns, advances, bank funding, approval policy, actual payment UI, hosted TEST or capacity claim';writeFileSync(join(folder,'verification.json'),JSON.stringify(proof));console.log('EXPLICIT_EXPENSE_CASH_HTTP_SOURCE_AND_CLOSE_RACES_PASS');
}catch(e){let message=String(e.message).replaceAll(secret,'[REDACTED]');for(const t of tokens)message=message.replaceAll(t,'[REDACTED]');writeFileSync(join(folder,'failure.json'),JSON.stringify({...proof,error:message}));console.error('EXPENSE_CASH_SOURCE_FAILED',message);process.exitCode=1;}
finally{spawnSync('docker',['rm','--force',container],{stdio:'ignore'});}
