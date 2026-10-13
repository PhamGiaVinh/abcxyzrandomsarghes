import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGUSER,'postgres');
assert.ok(['55464','55441'].includes(process.env.PGPORT));assert.match(process.env.PGDATABASE??'',/^vinpoker_ops_chip69_/);
for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k]);
function sql(input){const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:8000});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
assert.equal(sql("SELECT inet_server_addr()='127.0.0.1'::inet AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999;"),'t');
function connection(name){
 const child=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',err='';
 const timer=setTimeout(()=>child.kill(),25000);
 const done=new Promise((resolve,reject)=>{child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});});
 child.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL idle_in_transaction_session_timeout='15s';\n`);
 return {child,done};
}
async function barrier(query){const end=Date.now()+5000;while(Date.now()<end){if(sql(query)==='t')return;await new Promise(r=>setTimeout(r,40));}assert.fail('actual backend overlap not observed');}
function parse(r){assert.equal(r.code,0,r.err);return JSON.parse(r.out.split('\n').find(v=>v.startsWith('{')));}

const raw=readFileSync(new URL('./issuanceIntent.currentSchema.sql',import.meta.url),'utf8');
for(const scenario of ['same_key','two_actors','color_up','bank_sync']){
 const ids=new Map([...raw.matchAll(/e1600000-0000-4000-8000-[0-9]{12}/g)].map(m=>[m[0],randomUUID()]));
 const id=suffix=>ids.get('e1600000-0000-4000-8000-'+suffix.padStart(12,'0'));
 let fixture=raw.slice(raw.indexOf('BEGIN;'),raw.indexOf('SET LOCAL ROLE authenticated;'));
 fixture=fixture.replaceAll(/e1600000-0000-4000-8000-[0-9]{12}/g,x=>ids.get(x)).replace(":'coupling_on'","'true'");
 sql(fixture+"INSERT INTO public.club_chip_masters(club_id,user_id) VALUES('"+id('2')+"','"+id('99')+"');COMMIT;");
 const actor=id('1'),other=id('99'),club=id('2'),tour=id('3'),template=id('8'),low=id('5'),high=id('6'),key=randomUUID();
 const call=(a,q)=>JSON.parse(sql("SET ROLE authenticated;SET request.jwt.claim.sub='"+a+"';"+q));
 assert.equal(call(actor,"SELECT public.chip_ops_set_bank_coupling('"+club+"',true);").status,'ok');
 const tag=randomUUID().slice(0,8),firstName='issue69_first_'+tag,secondName='issue69_second_'+tag;
 const first=connection(firstName);let second;
 const issue=(a,k,count,rev)=>"SELECT public.chip_ops_set_issuance_v2('"+template+"',"+count+","+rev+",'"+k+"','"+a+"');";
 let nextActor=scenario==='two_actors'?other:actor;
 let next=scenario==='same_key'?issue(actor,key,8,0):scenario==='two_actors'?issue(other,randomUUID(),9,0):
   scenario==='color_up'?"SELECT public.chip_ops_color_up('"+tour+"','"+low+"','"+high+"',8,1,'"+randomUUID()+"');":
   "SELECT public.chip_ops_bank_sync('"+club+"','[{\"denomination_id\":\""+low+"\",\"total\":200}]'::jsonb);";
 try{
  first.child.stdin.write("SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='"+actor+"';"+issue(actor,key,8,0)+"\n");
  await barrier("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='"+firstName+"' AND state='idle in transaction');");
  second=connection(secondName);
  second.child.stdin.end("SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='"+nextActor+"';"+next+"COMMIT;\n");
  await barrier("SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.application_name='"+firstName+"' WHERE b.application_name='"+secondName+"' AND b.wait_event_type='Lock' AND a.pid=ANY(pg_blocking_pids(b.pid)));");
 }finally{first.child.stdin.end('COMMIT;\n');}
 const winner=parse(await first.done),waiter=parse(await second.done);assert.equal(winner.status,'ok');
 if(scenario==='same_key')assert.deepEqual(waiter,winner);else if(scenario==='two_actors')assert.equal(waiter.error,'STALE_STATE');else assert.equal(waiter.status,'ok');
 assert.equal(sql("SELECT issued_count=8 AND revision=1 FROM public.stack_template_issuance WHERE stack_template_id='"+template+"';"),'t');
 const recovered=call(actor,"SELECT public.get_chip_issuance_receipt_v1('"+template+"',8,0,'"+key+"','"+actor+"');");
 assert.deepEqual(recovered.result,winner);
 assert.equal(sql("SELECT count(*) FROM public.chip_bank_ledger WHERE ref_type='stack_template' AND ref_id='"+template+"';"),'1');
 if(scenario==='bank_sync')assert.equal(sql("SELECT on_hand_count FROM public.chip_bank WHERE club_id='"+club+"' AND denomination_id='"+low+"';"),'120');
 if(scenario==='color_up')assert.equal(call(actor,"SELECT to_jsonb(x) FROM public.chip_ops_current_denom_counts('"+tour+"') x WHERE denomination_id='"+low+"';").current_count,0);
 console.log('ISSUANCE69_TRUE_OVERLAP_'+scenario.toUpperCase()+'_PASS');
}
