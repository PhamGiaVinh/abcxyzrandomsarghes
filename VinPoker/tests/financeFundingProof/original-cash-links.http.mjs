import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGDATABASE,'vinpoker_ops_funding_proof');assert.ok(process.env.RUNNER_TEMP);
const api='http://127.0.0.1:3015',container='finance-original-funding-proof',secret=randomBytes(48).toString('hex');
const id=n=>`19000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function command(p,args,options={}){const r=spawnSync(p,args,{encoding:'utf8',...options});
 if(r.status!==0){const detail=p==='psql'?String(r.stderr??'').replaceAll(secret,'[REDACTED]').slice(0,1500):'non-SQL setup failure';throw Error(`Isolated funding setup: ${detail}`);}return r.stdout.trim();}
const sql=q=>command('psql',['-XqAt','-v','ON_ERROR_STOP=1','-c',q]);
function token(sub){const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const body=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub,role:'authenticated',exp:Math.floor(Date.now()/1000)+600});return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');}
async function rpc(name,body,actor){const r=await fetch(`${api}/rpc/${name}`,{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${token(actor)}`},body:JSON.stringify(body)});assert.equal(r.status,200,`${name}: HTTP not successful`);const data=await r.json();assert.equal(data.error,undefined,`${name}: application refusal`);return data;}
const contracts=()=>JSON.parse(sql(`SELECT jsonb_object_agg(proname,md5(prosrc)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('pay_finalized_part_time_payroll_statement','record_club_expense','cashier_close_shift_v1','cashier_shift_summary_v1','cashier_adjust_shift_v1')`));
const expectedContracts={pay_finalized_part_time_payroll_statement:'aef6ec6ce2d1db9fe44ed43bf8bd4d08',record_club_expense:'ec4209e4c6e11503ecd4e52c5d4be0ee',cashier_close_shift_v1:'05f2f114e3cae4cc9f2176c1e16fcefa',cashier_shift_summary_v1:'680c8bd3b1d35ad7a64cbc5fa8f23ef9',cashier_adjust_shift_v1:'c4395c165d019262eaf2a52a61187ad8'};
const cases=[];
try{
 assert.deepEqual(contracts(),expectedContracts,'original released contracts changed');
 sql(`DO $$ BEGIN IF EXISTS(SELECT FROM public.clubs) THEN RAISE EXCEPTION 'empty_funding_fixture_required';END IF;END $$;
 ALTER ROLE authenticator LOGIN NOINHERIT NOSUPERUSER;GRANT authenticated,anon TO authenticator;
 CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $auth$;`);
 command('docker',['run','--detach','--name',container,'--network','host','-e','PGRST_DB_URI','-e','PGRST_DB_SCHEMAS','-e','PGRST_DB_ANON_ROLE','-e','PGRST_JWT_SECRET','-e','PGRST_SERVER_HOST','-e','PGRST_SERVER_PORT','postgrest/postgrest:v13.0.7'],{env:{...process.env,PGRST_DB_URI:'postgres://authenticator@127.0.0.1:5432/vinpoker_ops_funding_proof',PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:'3015'}});
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch(api,{signal:AbortSignal.timeout(500)})).status<500){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
 for(const [index,kind] of ['pt_cash','pt_bank','expense_cash_paid','expense_unpaid','expense_bank_paid'].entries()){
  console.log('FUNDING_ORIGINAL_CASE',kind);
  const club=id(100+index),owner=id(200+index),cashier=id(300+index),employee=id(400+index),dealer=id(500+index);
  sql(`INSERT INTO auth.users(id) VALUES('${owner}'),('${cashier}'),('${employee}');
   INSERT INTO public.profiles(user_id,display_name) VALUES('${owner}','TEST funding owner ${index}'),('${cashier}','TEST funding cashier ${index}'),('${employee}','TEST funding employee ${index}');
   INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${club}','${owner}','TEST isolated funding ${index}','TEST','approved');
   INSERT INTO public.club_cashiers(club_id,user_id) VALUES('${club}','${cashier}');
   INSERT INTO public.cashier_tour_settings(club_id,enabled) VALUES('${club}',true);`);
  const opening=10000000,amount=kind.startsWith('pt_')?5000000:1000000;
  const opened=await rpc('cashier_open_shift_v1',{p_club_id:club,p_opening_cash:opening},cashier);assert.equal(opened.ok,true);assert.match(opened.shift_id,/^[a-f0-9-]{36}$/);
  let receipt;
  if(kind.startsWith('pt_')){
   sql(`SET request.jwt.claim.sub='${owner}';
    INSERT INTO public.dealers(id,club_id,user_id,full_name,status,employment_type,hourly_rate_vnd) VALUES('${dealer}','${club}','${employee}','TEST funding dealer','active','part_time',50000);
    INSERT INTO public.dealer_pt_wage_rate_history(dealer_id,hourly_rate_vnd,pt_eligible,effective_from,changed_by) VALUES('${dealer}',50000,true,'2026-11-01T00:00:00+07:00','${owner}');
    INSERT INTO public.dealer_attendance(dealer_id,shift_date,status,current_state,check_in_time,check_out_time)
    SELECT '${dealer}',day::date,'checked_out','checked_out',day::timestamptz+interval '8 hours',day::timestamptz+interval '28 hours'
     FROM generate_series('2026-11-01'::date,'2026-11-05'::date,interval '1 day') AS days(day);`);
   const frozen=await rpc('finalize_part_time_payroll_statement',{p_request_id:id(600+index),p_club_id:club,p_dealer_id:dealer,p_reason:'TEST actual original funding capture'},owner);assert.equal(frozen.net_amount_vnd,amount);
   const intent={p_statement_id:frozen.statement_id,p_payment_method:kind==='pt_cash'?'cash':'bank',p_payment_reference:'TEST manual receipt, no actual bank transfer',p_idempotency_key:`original-funding-${index}`,p_note:'Isolated original-schema proof'};
   receipt=await rpc('pay_finalized_part_time_payroll_statement',intent,cashier);assert.equal(receipt.amount_vnd,amount);
   const retry=await rpc('pay_finalized_part_time_payroll_statement',intent,cashier);assert.equal(retry.payment_id,receipt.payment_id);assert.equal(retry.idempotent,true);
   assert.equal(sql(`SELECT count(*)||':'||sum(amount_vnd) FROM public.dealer_pt_wage_payments WHERE statement_id='${frozen.statement_id}'`),'1:5000000');
  }else{
   receipt=await rpc('record_club_expense',{p_club_id:club,p_category:'rent',p_amount_vnd:amount,p_incurred_at:new Date().toISOString(),p_description:'TEST source-link capture',p_payment_status:kind==='expense_unpaid'?'unpaid':'paid',p_payment_source:kind==='expense_unpaid'?null:kind==='expense_bank_paid'?'bank':'cash',p_tournament_id:null,p_series_id:null,p_attachment_url:null,p_adjusts_id:null,p_idempotency_key:`original-funding-${index}`},cashier);
   assert.equal(receipt.status,'ok');assert.ok(receipt.expense_id);
  }
  const summary=await rpc('cashier_shift_summary_v1',{p_shift_id:opened.shift_id},cashier);assert.equal(summary.ok,true);
  const actualMovements=Number(sql(`SELECT count(*) FROM public.cashier_buyin_movements WHERE shift_id='${opened.shift_id}'`));assert.equal(actualMovements,0);
  const shouldDeduct=kind==='pt_cash'||kind==='expense_cash_paid',counted=opening-(shouldDeduct?amount:0);
  const closed=await rpc('cashier_close_shift_v1',{p_shift_id:opened.shift_id,p_counted_cash:counted},cashier);
  assert.equal(closed.ok,true);assert.equal(closed.expected_cash,opening,'original unlinked drawer observation differs');
  assert.equal(closed.variance_cash,shouldDeduct?-amount:0);
  cases.push({kind,opening,recordedAmount:amount,linkedMovements:actualMovements,countedCash:counted,observedExpectedCash:closed.expected_cash,requiredExpectedCash:counted,variance:closed.variance_cash,invariantPassed:!shouldDeduct});
 }
 assert.deepEqual(contracts(),expectedContracts,'diagnostic changed original routines');
 assert.deepEqual(cases.filter(c=>!c.invariantPassed).map(c=>c.kind),['pt_cash','expense_cash_paid']);
 writeFileSync(join(process.env.RUNNER_TEMP,'original-cash-funding-gap.json'),JSON.stringify({sourceSha:process.env.SOURCE_SHA,diagnosticProofCaptured:true,qualification:false,productionMutation:false,productionCapacityClaim:false,
  scope:'original released full-pay/expense HTTP paths versus actual Cashier close; evidence of missing cash-source linkage, NOT acceptance',contracts:expectedContracts,cases}));
 console.log('ORIGINAL_CASH_SOURCE_GAP_REPRODUCED_QUALIFICATION_FALSE');
}catch(e){console.error('FUNDING_PROOF_FAILED',String(e.message).replaceAll(secret,'[REDACTED]'));process.exitCode=1;}
finally{spawnSync('docker',['rm','--force',container],{stdio:'ignore'});}
