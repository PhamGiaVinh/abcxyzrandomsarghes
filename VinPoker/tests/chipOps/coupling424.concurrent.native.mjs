import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
assert.equal(process.env.VINPOKER_NATIVE_DB_TEST,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=input=>execFileSync('wsl',args,{input,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
const id=n=>`e4240000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const f={actor:id(1),club:id(10),tour:id(20),set:id(30),low:id(40),high:id(41),template:id(50)};
assert.ok(process.argv.slice(2).every(x=>x==='--resume-pre-issuance'));
const resume=process.argv.includes('--resume-pre-issuance');
assert.equal(sql(`SELECT count(*) FROM auth.users WHERE id='${f.actor}';`),resume?'1':'0','one-shot retained canary: do not rerun/reset');
if(resume){
 assert.equal(sql(`SELECT count(*) FROM public.clubs c JOIN public.tournaments t ON t.club_id=c.id WHERE c.id='${f.club}' AND c.owner_id='${f.actor}' AND t.id='${f.tour}' AND t.name='Coupling424 isolated TEST';`),'1');
 assert.equal(sql(`SELECT count(*) FROM public.stack_template_issuance WHERE stack_template_id='${f.template}';`),'0');
 assert.equal(sql(`SELECT count(*) FROM public.color_up_operation WHERE tournament_id='${f.tour}';`),'0');
 assert.equal(sql(`SELECT count(*) FROM public.chip_bank_ledger WHERE club_id='${f.club}';`),'2');
 assert.equal(sql(`SELECT on_hand_count FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${f.low}';`),'1000');
 assert.equal(sql(`SELECT on_hand_count FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${f.high}';`),'100');
 assert.equal(sql(`SELECT public.chip_ops_coupling_on('${f.club}');`),'f');
}
const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL ROLE authenticated;`;
const call=q=>JSON.parse(sql(`BEGIN;${auth}${q}COMMIT;`));
const outside=()=>sql(`SELECT md5(jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x WHERE club_id<>'${f.club}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x WHERE club_id<>'${f.club}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY denomination_id,club_id) FROM public.chip_bank x WHERE club_id<>'${f.club}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY club_id) FROM public.chip_ops_bank_config x WHERE club_id<>'${f.club}')
 )::text);`);
const before=outside();
if(!resume)sql(`BEGIN;
 INSERT INTO auth.users(id) VALUES('${f.actor}');
 INSERT INTO public.clubs(id,owner_id,name,region) VALUES('${f.club}','${f.actor}','Coupling424 isolated TEST','TEST');
 INSERT INTO public.club_settings(club_id,auto_swing_enabled) VALUES('${f.club}',false);
 INSERT INTO public.tournaments(id,club_id,name,status,live_status) VALUES('${f.tour}','${f.club}','Coupling424 isolated TEST','live','playing');
 INSERT INTO public.chip_set(id,club_id,name) VALUES('${f.set}','${f.club}','Coupling424 TEST');
 INSERT INTO public.chip_set_denomination(id,chip_set_id,club_id,value) VALUES('${f.low}','${f.set}','${f.club}',100),('${f.high}','${f.set}','${f.club}',1000);
 INSERT INTO public.tournament_chip_set(tournament_id,chip_set_id,club_id) VALUES('${f.tour}','${f.set}','${f.club}');
 INSERT INTO public.stack_template(id,tournament_id,club_id,chip_set_id,name,stack_value) VALUES('${f.template}','${f.tour}','${f.club}','${f.set}','Coupling424 TEST',20000);
 INSERT INTO public.stack_template_line(stack_template_id,denomination_id,count) VALUES('${f.template}','${f.low}',200);
 COMMIT;`);
const bank=(direction,count,version,key)=>`SELECT public.chip_ops_bank_adjust_v2('${f.club}','${f.low}','${direction}',${count},'${f.tour}',${version},'${key}','${f.actor}');`;
const worker=()=>{
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.setEncoding('utf8').on('data',x=>{out+=x;});child.stderr.setEncoding('utf8').on('data',x=>{err+=x;});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve(out):reject(new Error(`coupling424 worker${code}:${err}`)));});
 done.catch(()=>{});return {child,done,output:()=>out};
};
const until=async(check,label)=>{for(let i=0;i<60;i++){if(check())return;await new Promise(r=>setTimeout(r,100));}throw new Error('coupling424 wait:'+label);};
const overlap=async(firstSql,secondSql,tag)=>{
 const first=worker();let second,released=false;
 try{
  first.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL application_name='coupling424-${tag}-first';${auth}${firstSql}SELECT 'COUPLING424_STAGED';\n`);
  await until(()=>first.output().includes('COUPLING424_STAGED'),'holder');
  second=worker();second.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL application_name='coupling424-${tag}-second';${auth}${secondSql}COMMIT;\n`);
  await until(()=>sql(`SELECT count(*) FROM pg_stat_activity w JOIN pg_stat_activity h ON h.pid=ANY(pg_blocking_pids(w.pid)) WHERE w.application_name='coupling424-${tag}-second' AND h.application_name='coupling424-${tag}-first' AND w.wait_event_type='Lock';`)==='1','actual blocker');
  console.log('COUPLING424_'+tag+'_PG_BLOCKING_CONFIRMED');
  first.child.stdin.end('COMMIT;\n');released=true;
  const outputs=await Promise.all([first.done,second.done]);
  return outputs.map(out=>JSON.parse(out.split(/\r?\n/).find(line=>line.startsWith('{'))));
 }finally{if(!released){if(!first.child.stdin.writableEnded)first.child.stdin.end('ROLLBACK;\n');await first.done.catch(()=>{});if(second)await second.done.catch(()=>{});}}
};
const evidence=[];
try{
 assert.equal(call(bank('thu',1000,0,'coupling424-initial-low')).outcome,'applied');
 assert.equal(call(`SELECT public.chip_ops_bank_adjust_v2('${f.club}','${f.high}','thu',100,'${f.tour}',0,'coupling424-initial-high','${f.actor}');`).outcome,'applied');
 assert.equal(call(`SELECT public.chip_ops_set_bank_coupling('${f.club}',true);`).status,'ok');
 assert.equal(call(`SELECT public.chip_ops_set_issuance_v2('${f.template}',1,0,'${id(60)}','${f.actor}');`).status,'ok');
 for(const tag of ['color_first','bank_first']){
  const version=Number(sql(`SELECT version FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${f.low}';`));
  const key=`coupling424-${tag}-bank`,colorKey=`coupling424-${tag}-color`;
  const color=`SELECT public.chip_ops_color_up('${f.tour}','${f.low}','${f.high}',20,1,'${colorKey}');`;
  const adjust=bank('xuat',100,version,key);
  const result=await overlap(tag==='color_first'?color:adjust,tag==='color_first'?adjust:color,tag);
  const conversion=result[tag==='color_first'?0:1],adjustment=result[tag==='color_first'?1:0];
  assert.equal(conversion.status,'ok');assert.equal(conversion.rounding_delta,0);
  assert.equal(adjustment.outcome,tag==='color_first'?'rejected':'applied');
  if(tag==='color_first')assert.equal(adjustment.error,'race_lost');
  assert.equal(sql(`SELECT on_hand_count FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${f.low}';`),tag==='color_first'?'1000':'900');
  assert.equal(sql(`SELECT on_hand_count FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${f.high}';`),'80');
  const replay=call(adjust);assert.deepEqual({...replay,idempotent:false},{...adjustment,idempotent:false});
  assert.equal(call(`SELECT public.chip_ops_reverse_color_up('${conversion.color_up_operation_id}','coupling424-${tag}-undo');`).status,'ok');
  if(tag==='bank_first'){
   const nowVersion=Number(sql(`SELECT version FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${f.low}';`));
   assert.equal(call(bank('thu',100,nowVersion,'coupling424-bank-first-compensation')).outcome,'applied');
  }
  assert.equal(sql(`SELECT on_hand_count FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${f.low}';`),'800');
  assert.equal(sql(`SELECT on_hand_count FROM public.chip_bank WHERE club_id='${f.club}' AND denomination_id='${f.high}';`),'100');
  const inventory=call(`SELECT public.get_current_chip_inventory('${f.tour}');`);assert.equal(inventory.total_value,20000);assert.equal(inventory.reconciled,true);
  const after=call(adjust);assert.deepEqual({...after,idempotent:false},{...adjustment,idempotent:false},'bank receipt changed after compensation');
  evidence.push({order:tag,bankOutcome:adjustment.outcome,error:adjustment.error??null,operation:conversion.color_up_operation_id});
 }
 assert.equal(sql(`SELECT count(*) FROM public.color_up_operation WHERE tournament_id='${f.tour}' AND status='reversed';`),'2');
 assert.equal(sql(`SELECT count(*) FROM public.chip_bank WHERE club_id='${f.club}' AND on_hand_count<0;`),'0');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`),'0');
 assert.equal(outside(),before,'outside TEST scope changed');
 console.log('COUPLING424_CURRENT_V2_BOTH_LOCK_ORDERS_COMPENSATED_PASS',JSON.stringify({fixture:f,evidence}));
}finally{
 assert.equal(call(`SELECT public.chip_ops_set_bank_coupling('${f.club}',false);`).status,'ok');
 assert.equal(sql(`SELECT public.chip_ops_coupling_on('${f.club}');`),'f');
 assert.equal(outside(),before,'outside scope changed during finally');
 console.log('COUPLING424_OFF_AUDIT_RETAINED_OUTSIDE_SCOPE_UNCHANGED');
}
