import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const tour='46cab483-91e7-4220-aacf-e17bdf05269c',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
const low='e7b5353a-f675-4f9f-9910-94be26189ca7',high='1a7c0201-025d-4dae-81b7-a7f44cc14021';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(x);
const literal=x=>`'${String(x).replaceAll("'","''")}'`;
export async function createCoupling613Browser({sql,actor,log}){
 assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');assert.equal(process.env.VINPOKER_COUPLING613_BROWSER,'1');
 assert.equal(actor,'675fe35e-60a8-4452-bb90-e79486d54da6');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),
  'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
 assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id,denomination_id) FROM public.chip_bank x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.color_up_operation x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id) FROM public.chip_ops_bank_config x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x))::text);`);
 const before=fingerprint();
 const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',
  'PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
 let output='',waiting=null,ended=false,queue=Promise.resolve(),operation=null,intent=null,reverseIntent=null,loss=true;
 let bankUsed=false,bankBusy=false;
 const negative=process.env.VINPOKER_COUPLING614_NEGATIVE==='1';
 const errors=[];child.stderr.on('data',b=>errors.push(String(b).slice(0,500)));
 const closed=new Promise(resolve=>child.once('close',code=>{ended=true;waiting?.reject(Error('coupling613 child ended'));waiting=null;resolve(code);}));
 child.on('error',error=>{ended=true;waiting?.reject(error);waiting=null;});
 child.stdout.on('data',chunk=>{
  output+=String(chunk);
  if(output.length>2e6){waiting?.reject(Error('coupling613 output limit'));child.stdin.end();return;}
  if(waiting&&output.includes(waiting.marker+'\n')){
   const at=output.indexOf(waiting.marker+'\n'),lines=output.slice(0,at).trim().split('\n').filter(Boolean),done=waiting;
   output=output.slice(at+waiting.marker.length+1);waiting=null;
   try{assert.equal(lines.length,1);done.resolve(JSON.parse(lines[0]));}catch(error){done.reject(error);}
  }
 });
 const execute=statement=>{
  const next=queue.then(()=>new Promise((resolve,reject)=>{
   if(ended){reject(Error('coupling613 unavailable'));return;}
   const marker=`RESULT_${randomUUID()}`;
   const timer=setTimeout(()=>{waiting=null;child.stdin.end();reject(Error('coupling613 deadline'));},15000);
   waiting={marker,resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}};
   child.stdin.write(`${statement}\n\\echo ${marker}\n`);
  }));queue=next.catch(()=>{});return next;
 };
 const facts=()=>execute(`SELECT jsonb_build_object('inventory',public.get_current_chip_inventory('${tour}')->'total_value',
  'banks',(SELECT jsonb_agg(jsonb_build_object('denom',denomination_id,'count',on_hand_count) ORDER BY denomination_id)
   FROM public.chip_bank WHERE club_id='${club}' AND denomination_id IN('${low}','${high}')));`);
 try{
  await execute(`BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='2s';SET LOCAL idle_in_transaction_session_timeout='10min';
   DO $$ BEGIN
    ASSERT NOT public.chip_ops_coupling_on('${club}');
    ASSERT NOT EXISTS(SELECT 1 FROM public.chip_bank WHERE club_id='${club}' AND denomination_id IN('${low}','${high}'));
    ASSERT EXISTS(SELECT 1 FROM public.tournaments WHERE id='${tour}' AND club_id='${club}' AND deleted_at IS NULL);
   END $$;
   INSERT INTO public.chip_bank(club_id,denomination_id,on_hand_count) VALUES('${club}','${low}',0),('${club}','${high}',120);
   SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL ROLE authenticated;
   SELECT public.chip_ops_set_bank_coupling('${club}',true);`);
  const initial=await facts();assert.equal(initial.inventory,60000);
 }catch(error){child.stdin.end();await closed;assert.equal(fingerprint(),before);throw error;}
 return {manifest:{tour,club},async bankUse(restore){
  assert.ok(negative&&operation&&!bankBusy);assert.equal(bankUsed,restore);bankBusy=true;
  try{
   const result=await execute(`SELECT public.chip_ops_bank_adjust_v2('${club}','${low}','${restore?'thu':'xuat'}',100,'${tour}',
    (SELECT version FROM public.chip_bank WHERE club_id='${club}' AND denomination_id='${low}'), '${randomUUID()}','${actor}');`);
   assert.equal(result.outcome,'applied');bankUsed=!restore;
   const state=await facts();assert.equal(state.inventory,60000);
   log.push({coupling614:restore?'restore':'use',result,state,transaction:'ROLLBACK_ONLY'});
  }finally{bankBusy=false;}
 },paths:['/rest/v1/rpc/get_current_chip_inventory','/rest/v1/rpc/get_color_up_history',
  '/rest/v1/rpc/chip_ops_color_up','/rest/v1/rpc/chip_ops_reverse_color_up','/rest/v1/rpc/get_chip_color_up_receipt_v1',
  '/rest/v1/tournaments','/rest/v1/tournament_levels'],
 async route(url,method,body){
  let statement,name=url.pathname.split('/').at(-1);
  if(method==='GET'){
   if(name==='tournaments'){
    assert.equal(url.searchParams.get('select'),'current_level');assert.equal(url.searchParams.get('id'),`eq.${tour}`);
    statement=`SELECT jsonb_build_object('current_level',current_level) FROM public.tournaments WHERE id='${tour}';`;
   }else{
    assert.equal(name,'tournament_levels');assert.equal(url.searchParams.get('select'),'big_blind');assert.equal(url.searchParams.get('tournament_id'),`eq.${tour}`);
    const level=Number(url.searchParams.get('level_number')?.replace(/^eq\./,''));assert.ok(Number.isSafeInteger(level)&&level>=0);
    statement=`SELECT coalesce((SELECT jsonb_build_object('big_blind',big_blind) FROM public.tournament_levels WHERE tournament_id='${tour}' AND level_number=${level}),'null');`;
   }
  }else{
   assert.equal(method,'POST');
   if(['get_current_chip_inventory','get_color_up_history'].includes(name)){
    assert.deepEqual(body,{p_tournament_id:tour});statement=`SELECT public.${name}('${tour}');`;
   }else if(name==='chip_ops_color_up'){
    assert.deepEqual(Object.keys(body).sort(),['p_tournament_id','p_denom_removed','p_denom_target','p_target_added','p_level_number','p_idempotency_key'].sort());
    assert.equal(body.p_tournament_id,tour);assert.equal(body.p_denom_removed,low);assert.equal(body.p_denom_target,high);assert.equal(body.p_target_added,120);
    assert.ok(uuid(body.p_idempotency_key)&&Number.isSafeInteger(body.p_level_number));
    if(intent)assert.deepEqual(body,intent);else intent={...body};
    statement=`SELECT public.chip_ops_color_up('${tour}','${low}','${high}',120,${body.p_level_number},${literal(body.p_idempotency_key)});`;
   }else if(name==='chip_ops_reverse_color_up'){
    assert.ok(operation);assert.deepEqual(Object.keys(body).sort(),['p_operation_id','p_idempotency_key'].sort());
    assert.equal(body.p_operation_id,operation);assert.ok(uuid(body.p_idempotency_key));
    if(reverseIntent)assert.deepEqual(body,reverseIntent);else reverseIntent={...body};
    statement=`SELECT public.chip_ops_reverse_color_up('${operation}',${literal(body.p_idempotency_key)});`;
   }else{
    assert.equal(name,'get_chip_color_up_receipt_v1');assert.ok(intent);
    assert.deepEqual(body,{p_tournament_id:tour,p_operation:'color_up',p_request_key:intent.p_idempotency_key,
     p_payload:{tournament:tour,removed:low,target:high,added:120,level:intent.p_level_number}});
    statement=`SELECT public.get_chip_color_up_receipt_v1('${tour}','color_up',${literal(intent.p_idempotency_key)},${literal(JSON.stringify(body.p_payload))}::jsonb);`;
   }
  }
  const beforeDenied=name==='chip_ops_reverse_color_up'&&bankUsed?await execute(`SELECT jsonb_build_object('v',md5(jsonb_build_array(
   public.get_current_chip_inventory('${tour}'),(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.chip_inventory_ledger l WHERE tournament_id='${tour}'),
   (SELECT to_jsonb(o) FROM public.color_up_operation o WHERE id='${operation}'))::text));`):null;
  const value=await execute(statement);log.push({coupling613:name,args:body,result:value,transaction:'ROLLBACK_ONLY'});
  if(name==='chip_ops_color_up'){
   assert.equal(value.status,'ok');assert.equal(value.removed_count,600);assert.ok(uuid(value.color_up_operation_id));operation=value.color_up_operation_id;
   const state=await facts();assert.equal(state.inventory,60000);log.push({coupling613:'facts',state});
   if(loss){loss=false;return {status:503,value:{message:'LOCAL613_RESPONSE_LOSS_AFTER_NATIVE_WRITE'}};}
  }
  if(name==='chip_ops_reverse_color_up'){
   if(bankUsed){
    assert.ok(negative);assert.equal(value.error,'BANK_NEGATIVE');
    const afterDenied=await execute(`SELECT jsonb_build_object('v',md5(jsonb_build_array(public.get_current_chip_inventory('${tour}'),
     (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.chip_inventory_ledger l WHERE tournament_id='${tour}'),
     (SELECT to_jsonb(o) FROM public.color_up_operation o WHERE id='${operation}'))::text));`);
    assert.deepEqual(afterDenied,beforeDenied);log.push({coupling614:'denied_no_inventory_ledger_operation_delta'});
   }else assert.equal(value.status,'ok');
   const state=await facts();assert.equal(state.inventory,60000);log.push({coupling613:'undo_facts',state});
  }
  return {status:200,value};
 },async cleanup(){
  if(!ended){await execute("ROLLBACK;SELECT '{}'::jsonb;");child.stdin.end('\\q\n');}
  assert.equal(await closed,0,errors.join('\n'));assert.equal(fingerprint(),before);
  console.log('COUPLING613_ALL_BANK_INVENTORY_CONFIG_CASH_PRIZE_ENTRY_SEAT_ROLLBACK_PASS');
 }};
}
