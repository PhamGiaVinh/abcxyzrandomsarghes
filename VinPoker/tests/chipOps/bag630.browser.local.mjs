import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const tour='46cab483-91e7-4220-aacf-e17bdf05269c',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
const literal=x=>`'${String(x).replaceAll("'","''")}'`;
export async function createBag630Browser({sql,actor,log}){
 assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');assert.equal(process.env.VINPOKER_BAG630_BROWSER,'1');
 assert.equal(actor,'675fe35e-60a8-4452-bb90-e79486d54da6');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),
  'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
 assert.equal(sql("SELECT md5(replace(pg_get_functiondef('public.chip_ops_bag_intent_v1(uuid,integer,text,jsonb,uuid,uuid,text)'::regprocedure),chr(13),''));"),'22bf8a1b1ee90c116d6ad2908e85cf09');
 const active=process.env.VINPOKER_BAG635_ACTIVE==='1';
 if(active)assert.equal(sql("SELECT count(*) FROM floor_private.bag_active_hand_backup271 b WHERE md5(replace(pg_get_functiondef(to_regprocedure(b.signature)),chr(13),''))=b.after_digest;"),'2');
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bag x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id,day_number) FROM public.day_close x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_ops_signoff_audit x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY actor_id,request_key) FROM floor_private.chip_mutation_receipts x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_entries x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_seats x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_players x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.hand_actions x))::text);`);
 const before=fingerprint();
 assert.equal(sql(`SELECT count(*) FROM public.chip_bag WHERE tournament_id='${tour}';`),'0');
 const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',
  'PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
 let output='',waiting=null,ended=false,queue=Promise.resolve(),loss=true;
 const errors=[];child.stderr.on('data',b=>errors.push(String(b).slice(0,500)));
 const closed=new Promise(resolve=>child.once('close',code=>{ended=true;waiting?.reject(Error('bag630 child ended'));waiting=null;resolve(code);}));
 child.on('error',error=>{ended=true;waiting?.reject(error);waiting=null;});
 child.stdout.on('data',chunk=>{
  output+=String(chunk);
  if(output.length>2e6){waiting?.reject(Error('bag630 output limit'));child.stdin.end();return;}
  if(waiting&&output.includes(waiting.marker+'\n')){
   const at=output.indexOf(waiting.marker+'\n'),lines=output.slice(0,at).trim().split('\n').filter(Boolean),done=waiting;
   output=output.slice(at+waiting.marker.length+1);waiting=null;
   try{assert.equal(lines.length,1);done.resolve(JSON.parse(lines[0]));}catch(error){done.reject(error);}
  }
 });
 const execute=statement=>{
  const next=queue.then(()=>new Promise((resolve,reject)=>{
   if(ended){reject(Error('bag630 unavailable'));return;}
   const marker=`RESULT_${randomUUID()}`;
   const timer=setTimeout(()=>{waiting=null;child.stdin.end();reject(Error('bag630 deadline'));},15000);
   waiting={marker,resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}};
   child.stdin.write(`${statement}\n\\echo ${marker}\n`);
  }));queue=next.catch(()=>{});return next;
 };
 try{
  await execute(`BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='2s';SET LOCAL idle_in_transaction_session_timeout='10min';
   SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL ROLE authenticated;
   SELECT public.get_bag_tag_state('${tour}',1);`);
  if(active){
   assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${tour}' AND status='in_progress';`),'0');
   const context=JSON.parse(sql(`SELECT jsonb_build_object('epoch',control_epoch,'number',(SELECT coalesce(max(hand_number),0)+1 FROM public.tournament_hands WHERE tournament_id='${tour}')) FROM public.table_sessions WHERE id='ee2b9393-0c96-42f9-8667-7f306edeb9bc' AND closed_at IS NULL AND control_mode='tracker';`));
   assert.ok(Number.isSafeInteger(context.epoch)&&Number.isSafeInteger(context.number));
   const result=await execute(`SELECT public.start_tracker_hand_v3('${tour}','d294f4a4-082b-4efc-a6ca-1f96579ea344','ee2b9393-0c96-42f9-8667-7f306edeb9bc',${context.epoch},${context.number},now(),'${actor}',1);`);
   assert.equal(result.status,'success');log.push({bag635:'canonical_start_inside_rollback',number:context.number,result});
  }
 }catch(error){child.stdin.end();await closed;assert.equal(fingerprint(),before);throw error;}
 return {manifest:{tour,club},paths:['/rest/v1/rpc/get_bag_tag_state','/rest/v1/rpc/chip_ops_bag_intent_v1'],
 async route(url,method,body){
  assert.equal(method,'POST');assert.equal(body.p_tournament_id,tour);assert.ok([1,2].includes(body.p_day_number));
  const name=url.pathname.split('/').at(-1);let statement;
  if(name==='get_bag_tag_state'){
   assert.deepEqual(Object.keys(body).sort(),['p_tournament_id','p_day_number'].sort());
   statement=`SELECT public.get_bag_tag_state('${tour}',${body.p_day_number});`;
  }else{
   assert.equal(name,'chip_ops_bag_intent_v1');
   assert.deepEqual(Object.keys(body).sort(),['p_tournament_id','p_day_number','p_operation','p_payload','p_request_id','p_expected_actor','p_action'].sort());
   assert.equal(body.p_expected_actor,actor);assert.ok(/^[0-9a-f-]{36}$/i.test(body.p_request_id));
   assert.ok(['record','unseal','close','reopen'].includes(body.p_operation));assert.ok(['write','read','cancel'].includes(body.p_action));
   assert.ok(body.p_payload&&typeof body.p_payload==='object'&&!Array.isArray(body.p_payload));
   statement=`SELECT public.chip_ops_bag_intent_v1('${tour}',${body.p_day_number},${literal(body.p_operation)},${literal(JSON.stringify(body.p_payload))}::jsonb,${literal(body.p_request_id)},'${actor}',${literal(body.p_action)});`;
  }
  const value=await execute(statement);log.push({bag630:name,args:body,result:value,transaction:'ROLLBACK_ONLY'});
  if(name==='chip_ops_bag_intent_v1'&&body.p_action==='write'&&loss&&value.result?.status==='ok'){
   assert.equal(value.status,'committed');assert.equal(value.result.status,'ok');loss=false;
   return {status:503,value:{message:'LOCAL630_RESPONSE_LOSS_AFTER_NATIVE_WRITE'}};
  }
  return {status:200,value};
 },async cleanup(){
  if(!ended){await execute("ROLLBACK;SELECT '{}'::jsonb;");child.stdin.end('\\q\n');}
  assert.equal(await closed,0,errors.join('\n'));assert.equal(fingerprint(),before);
  console.log('BAG630_TWELVE_GLOBAL_FACTS_FULL_ROLLBACK_PASS');
 }};
}
