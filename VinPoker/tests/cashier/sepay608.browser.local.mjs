import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

// Isolated partial-payment child, never a substitute for either retained journey.
// Every metadata/payment/receipt row remains in one transaction until ROLLBACK.
export async function createSePay608Browser({sql,actor,log}){
 assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');assert.equal(process.env.VINPOKER_SEPAY608_BROWSER,'1');
 assert.equal(actor,'675fe35e-60a8-4452-bb90-e79486d54da6');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
 assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','dblink','pg_cron');"),'0');
 const club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
 assert.equal(sql(`SELECT count(*) FROM public.clubs c JOIN public.cashier_tour_settings s ON s.club_id=c.id WHERE c.id='${club}' AND c.owner_id='${actor}' AND s.enabled
  AND EXISTS(SELECT 1 FROM public.club_cashiers WHERE club_id=c.id AND user_id='${actor}') AND EXISTS(SELECT 1 FROM public.club_dealer_controls WHERE club_id=c.id AND user_id='${actor}');`),'1');
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(${['tournaments','tournament_registrations','tournament_entries','tournament_seats','cashier_buyin_movements','bank_transactions','payment_settlements','tournament_prize_payments','notifications','cashier_till_shifts'].map(table=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.${table} x)`).join(',')},
  has_schema_privilege('authenticated','auth','USAGE'),(SELECT prosrc FROM pg_proc WHERE oid='auth.uid()'::regprocedure))::text);`);
 const before=fingerprint(),quote=value=>value==null?'NULL':`'${String(value).replaceAll("'","''")}'`;
 const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
 let output='',pending=null,queue=Promise.resolve(),ended=false,diagnostics='',f,drop=true;
 const keys=new Map();
 const closed=new Promise(resolve=>child.once('close',code=>{ended=true;if(pending){clearTimeout(pending.timer);pending.reject(Error(`sepay608 native closed ${code}: ${diagnostics}`));pending=null;}resolve(code);}));
 child.on('error',error=>pending?.reject(error));child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk.toString()).slice(-3000);});
 child.stdout.on('data',chunk=>{
  output+=chunk.toString();if(!pending||!output.includes(pending.marker+'\n'))return;
  const i=output.indexOf(pending.marker+'\n'),job=pending,lines=output.slice(0,i).trim().split('\n').filter(Boolean);
  output=output.slice(i+job.marker.length+1);pending=null;clearTimeout(job.timer);
  try{assert.equal(lines.length,1);job.resolve(JSON.parse(lines[0]));}catch(error){job.reject(error);}
 });
 const execute=statement=>{
  const next=queue.then(()=>new Promise((resolve,reject)=>{
   assert.equal(ended,false);const marker=`SEPAY608_${randomUUID()}`;
   const timer=setTimeout(()=>{pending=null;reject(Error('sepay608 native deadline'));child.stdin.end('ROLLBACK;\n\\q\n');},15000);
   pending={marker,timer,resolve,reject};child.stdin.write(`${statement}\n\\echo ${marker}\n`);
  }));queue=next.catch(()=>{});return next;
 };
 const asOwner=statement=>execute(`RESET ROLE;SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;${statement}RESET ROLE;`);
 const facts=()=>execute(`RESET ROLE;SELECT jsonb_build_object(
  'cash',(SELECT count(*) FROM public.cashier_buyin_movements WHERE registration_id='${f.registration}'),
  'received',(SELECT coalesce(sum(amount),0) FROM public.cashier_buyin_movements WHERE registration_id='${f.registration}'),
  'applied',(SELECT coalesce(sum(applied_amount),0) FROM public.cashier_buyin_movements WHERE registration_id='${f.registration}'),
  'entries',(SELECT count(*) FROM public.tournament_entries WHERE registration_id='${f.registration}'),
  'seats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${f.tour}'),
  'receipts',(SELECT count(*) FROM public.seat_draw_receipts WHERE registration_id='${f.registration}'),
  'paid',(SELECT cashier_paid_at IS NOT NULL FROM public.tournament_registrations WHERE id='${f.registration}'));`);
 async function cleanup(){
  try{
   if(f&&!ended){try{console.log('SEPAY608_BEFORE_ROLLBACK',JSON.stringify({facts:await facts(),events:log.filter(row=>row.sepay608)}));}catch{console.log('SEPAY608_PRE_ROLLBACK_DIAGNOSTIC_UNAVAILABLE');}}
   if(!ended)await execute("ROLLBACK;SELECT '{}'::jsonb;");
  }
  finally{
   if(!ended){if(!child.stdin.writableEnded&&!child.stdin.destroyed)child.stdin.end('\\q\n');await closed;}
   assert.equal(fingerprint(),before,'sepay608 rollback changed retained business/auth facts');
   if(f){assert.equal(sql(`SELECT (SELECT count(*) FROM public.tournaments WHERE id='${f.tour}')+(SELECT count(*) FROM auth.users WHERE id='${f.player}')+(SELECT count(*) FROM public.profiles WHERE user_id='${f.player}');`),'0');assert.equal(sql(`SELECT count(*) FROM public.clubs WHERE id='${f.club}' AND owner_id='${actor}';`),'1');}
   assert.equal(sql("SELECT count(*) FROM pg_trigger WHERE tgname='test_cash_receipt';"),'0');
   console.log('SEPAY608_FULL_ROLLBACK_NO_RETAINED_BUSINESS_OR_AUTH_DELTA_PASS');
  }
 }
 try{
  const raw=readFileSync('tests/cashier/cashPaymentIdentity.pg17.sql','utf8').replaceAll('\r\n','\n');
  const marker=' -- CASH112_CONCURRENCY_FIXTURE_READY';assert.equal(raw.split(marker).length,2);
  let prefix=raw.slice(0,raw.indexOf(marker));
  const caseStart=prefix.indexOf('\\if :{?CASH112_CASE}'),caseEnd=prefix.indexOf('\\endif');assert.ok(caseStart>=0&&caseEnd>caseStart);
  prefix=prefix.slice(0,caseStart)+"SET LOCAL test.cash112='false';"+prefix.slice(caseEnd+'\\endif'.length);
  assert.equal(prefix.split('owner_id uuid:=gen_random_uuid();').length,2);
  assert.equal(prefix.split('INSERT INTO auth.users(id) VALUES(owner_id),(player_id);').length,2);
  assert.equal(prefix.split('club uuid:=gen_random_uuid();').length,2);
  for(const statement of [
   "INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES(club,owner_id,'Cash identity local TEST','TEST','approved');",
   'INSERT INTO public.club_cashiers(club_id,user_id) VALUES(club,owner_id);',
   'INSERT INTO public.club_dealer_controls(club_id,user_id) VALUES(club,owner_id);',
   'INSERT INTO public.cashier_tour_settings(club_id,enabled) VALUES(club,true);',
  ]){assert.equal(prefix.split(statement).length,2);prefix=prefix.replace(statement,'');}
  const opening="r:=public.cashier_open_shift_v1(club,0);\n PERFORM pg_temp.assert_cash(r->>'ok'='true','canonical TEST drawer opens');";
  assert.equal(prefix.split(opening).length,2);
  prefix=prefix.replace(opening,"PERFORM pg_temp.assert_cash(EXISTS(SELECT 1 FROM public.cashier_till_shifts WHERE club_id=club AND closed_at IS NULL),'existing TEST drawer, never open/close another');");
  prefix=prefix.replace('owner_id uuid:=gen_random_uuid();',`owner_id uuid:='${actor}';`)
   .replace('club uuid:=gen_random_uuid();',`club uuid:='${club}';`)
   .replace('INSERT INTO auth.users(id) VALUES(owner_id),(player_id);',"INSERT INTO auth.users(id) VALUES(player_id); INSERT INTO public.profiles(user_id,display_name) VALUES(player_id,'SEPAY608 TEST player');")
   .replaceAll('Cash identity local TEST','SEPAY608 rollback TEST');
  f=await execute(`${prefix}
   PERFORM set_config('role','none',true);
   INSERT INTO public.platform_bank_accounts(club_id,bank_name,account_number,account_holder,is_active)
    VALUES(club,'LOCAL NON-BANK608','LOCAL608-'||registration,'LOCAL TEST ONLY',true);
   INSERT INTO public.bank_transactions(provider_txn_id,account_number,club_id,amount,transfer_type,content,api_verified_at,occurred_at)
    SELECT 'LOCAL608-'||gen_random_uuid(),'LOCAL608-'||registration,club,amount,'in',(SELECT reference_code FROM public.tournament_registrations WHERE id=registration),now(),now()
    FROM (VALUES(40000),(80000)) amounts(amount);
   PERFORM set_config('test.sepay608_fixture',jsonb_build_object('actor',owner_id,'player',player_id,'club',club,'tour',tour,'registration',registration,
    'banks',(SELECT jsonb_agg(jsonb_build_object('id',id,'amount',amount) ORDER BY amount) FROM public.bank_transactions WHERE account_number='LOCAL608-'||registration))::text,true);
  END $$;RESET ROLE;SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='2s';SET LOCAL idle_in_transaction_session_timeout='10min';SELECT current_setting('test.sepay608_fixture')::jsonb;`);
  assert.equal(f.actor,actor);assert.deepEqual(f.banks.map(bank=>bank.amount),[40000,80000]);
  assert.deepEqual(await facts(),{cash:0,received:0,applied:0,entries:0,seats:0,receipts:0,paid:false});
 }catch(error){await cleanup();throw error;}
 return {manifest:f,facts,cleanup,async route(url,method,body){
  if(!['/rest/v1/rpc/sepay_cashier_settlement_worklist','/rest/v1/rpc/cashier_sepay_intent_v1'].includes(url.pathname))return null;
  assert.equal(method,'POST');
  if(url.pathname.endsWith('/sepay_cashier_settlement_worklist')){
   assert.deepEqual(Object.keys(body).sort(),['p_limit','p_scope']);assert.equal(body.p_limit,200);assert.ok(['actionable','resolved'].includes(body.p_scope));
   const value=await asOwner(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY amount),'[]'::jsonb) FROM public.sepay_cashier_settlement_worklist('${body.p_scope}',200) r WHERE r.bank_transaction_id IN(${f.banks.map(bank=>quote(bank.id)).join(',')});`);
   log.push({sepay608:'read',scope:body.p_scope,rows:value.length});return {status:200,value};
  }
  assert.deepEqual(Object.keys(body).sort(),['p_mode','p_operation','p_bank_transaction_id','p_registration_id','p_reason','p_request_id','p_expected_snapshot'].sort());
  const bank=f.banks.find(bank=>bank.id===body.p_bank_transaction_id);assert.ok(bank);
  assert.equal(body.p_operation,'confirm');assert.equal(body.p_registration_id,f.registration);assert.ok(['commit','receipt'].includes(body.p_mode));
  assert.equal(body.p_reason,bank.amount===40000?'TEST608 first partial':'TEST608 completion');
  assert.deepEqual(body.p_expected_snapshot,{bank_amount:bank.amount,total_pay:100000});
  assert.match(body.p_request_id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  if(keys.has(bank.id))assert.equal(body.p_request_id,keys.get(bank.id));else{assert.equal(body.p_mode,'commit');keys.set(bank.id,body.p_request_id);}
  const value=await asOwner(`SELECT public.cashier_sepay_intent_v1('${body.p_mode}','confirm','${bank.id}','${f.registration}',${quote(body.p_reason)},'${body.p_request_id}',${quote(JSON.stringify(body.p_expected_snapshot))}::jsonb);`);
  log.push({sepay608:body.p_mode,bank:bank.id,request:body.p_request_id,status:value.status,outcome:value.receipt?.outcome});
  if(body.p_mode==='commit'){
   assert.equal(value.receipt?.outcome,bank.amount===40000?'partial_received':'paid_waiting_seat');
   assert.deepEqual(await facts(),bank.amount===40000?{cash:1,received:40000,applied:40000,entries:0,seats:0,receipts:0,paid:false}:{cash:2,received:120000,applied:100000,entries:0,seats:0,receipts:0,paid:true});
   if(bank.amount===40000&&drop){drop=false;return {status:503,value:{message:'LOCAL608_RESPONSE_LOST_AFTER_NATIVE_WRITE'}};}
  }
  return {status:200,value};
 }};
}
