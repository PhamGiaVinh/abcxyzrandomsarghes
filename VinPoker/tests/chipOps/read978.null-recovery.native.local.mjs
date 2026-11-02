import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {createHmac,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {loadChipOpsTournamentOptions,loadIssuedChipInventory,loadIssuedStackSummary} from '../../src/ops/chip-ops/chipOpsReadAdapter.ts';

const browser981=process.env.VINPOKER_CHIP981_LOCAL==='1';
const browser980=process.env.VINPOKER_CHIP980_LOCAL==='1';
const browser979=browser981||browser980||process.env.VINPOKER_CHIP979_LOCAL==='1';
assert.ok(browser979||process.env.VINPOKER_CHIP978_LOCAL==='1');
const tour='46cab483-91e7-4220-aacf-e17bdf05269c',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const sql=input=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`));
const guard=read(`SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')),'comment',(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()));`);
assert.equal(guard.db,'vinpoker_ranking860_local');assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.external,0);assert.equal(guard.comment,'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const tables=['tournaments','stack_template','stack_template_issuance','tournament_chip_counts','tournament_entries','tournament_seats','cashier_buyin_movements','tournament_prize_payments'];
const fingerprint=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`);
const ownerRead=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;${q}ROLLBACK;`));
const result={kind:'ACTUAL_CHIP_READ_ADAPTER_SDK_HTTP_NATIVE_NULL_ENVELOPE_NOT_BROWSER_ACCEPTANCE',guard,tour,club,actor,before:fingerprint(),reads:[],denied:[],errors:[],checks:[]};
let fault=browser979&&!browser980&&!browser981?'tournaments':null;
let fault981=null;
result.runId=browser981?'981':browser980?'980':browser979?'979':'978';
if(browser981){result.kind='ACTUAL_CHIP_WORKSPACE_NATIVE_READS_MODELED_5S_503_NOT_FULL_ACCEPTANCE';result.faults981=[];}
const modelKey=randomUUID(),sessions=new Set(),user={id:actor,email:'chip979@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-27T00:00:00Z'};
const server=createServer(async(req,res)=>{
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  const u=new URL(req.url,'http://127.0.0.1:54329'),name=u.pathname.split('/').at(-1);let value;
  if(browser979&&u.pathname==='/__local/manifest')return send(200,{tour,club,actor,email:user.email,runId:'979',model:'READ ONLY native PG; Auth/HTTP modeled'});
  if(browser979&&u.pathname==='/auth/v1/token'){
   let raw='';for await(const part of req){raw+=part;assert.ok(raw.length<8192);}const body=JSON.parse(raw);assert.equal(body.email,user.email);assert.equal(body.password,'LOCAL_TEST_ONLY');
   const exp=Math.floor(Date.now()/1000)+3600,base=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,role:'authenticated',aud:'authenticated',exp})).toString('base64url');
   const token=base+'.'+createHmac('sha256',modelKey).update(base).digest('base64url');sessions.add(token);return send(200,{access_token:token,refresh_token:randomUUID(),expires_in:3600,expires_at:exp,token_type:'bearer',user});
  }
  if(browser979&&!sessions.has(String(req.headers.authorization??'').replace(/^Bearer /,'')))return send(401,{message:'LOCAL979_MODELED_SESSION_REQUIRED'});
  if(browser979&&u.pathname==='/auth/v1/user')return send(200,user);
  if(browser979&&req.method==='POST'&&['get_my_ops_capability_scope','get_my_ops_global_capability'].includes(name)){
   value=ownerRead(name==='get_my_ops_global_capability'
    ?"SELECT coalesce(jsonb_agg(jsonb_build_object('is_super_admin',is_super_admin)),'[]') FROM public.get_my_ops_global_capability();"
    :"SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.get_my_ops_capability_scope() x;");result.reads.push({name,nativeRows:Array.isArray(value)?value.length:null});return send(200,value);
  }
  if(req.method==='GET'&&u.pathname.startsWith('/rest/v1/')){
   if(browser979&&name==='clubs'){
    assert.equal(u.searchParams.get('select'),'id,name');const ids=u.searchParams.get('id');assert.match(ids,/^in\.\([a-f0-9,-]+\)$/);const list=ids.slice(4,-1).split(',');for(const id of list)assert.match(id,/^[a-f0-9-]{36}$/);
    value=ownerRead(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') FROM public.clubs WHERE id IN(${list.map(id=>`'${id}'`).join(',')});`);
   }else if(name==='tournaments'){
    assert.equal(u.searchParams.get('club_id'),`eq.${club}`);assert.equal(u.searchParams.get('deleted_at'),'is.null');assert.equal(u.searchParams.get('limit'),'200');
    assert.equal(u.searchParams.get('select'),'id,name,status,start_time,phase');
    value=ownerRead(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status,'start_time',start_time,'phase',phase) ORDER BY start_time DESC),'[]') FROM (SELECT * FROM public.tournaments WHERE club_id='${club}' AND deleted_at IS NULL ORDER BY start_time DESC LIMIT 200) t;`);
   }else if(name==='stack_template'){
    assert.equal(u.searchParams.get('tournament_id'),`eq.${tour}`);assert.equal(u.searchParams.get('select'),'id,name,stack_value');
    value=ownerRead(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'stack_value',stack_value) ORDER BY stack_value),'[]') FROM public.stack_template WHERE tournament_id='${tour}';`);
   }else if(name==='stack_template_issuance'){
    assert.equal(u.searchParams.get('select'),'stack_template_id,issued_count');assert.equal(u.searchParams.get('stack_template_id'),'in.(111ea925-758c-4095-b67b-4ffa0c022f26)');
    value=ownerRead("SELECT coalesce(jsonb_agg(jsonb_build_object('stack_template_id',stack_template_id,'issued_count',issued_count)),'[]') FROM public.stack_template_issuance WHERE stack_template_id='111ea925-758c-4095-b67b-4ffa0c022f26';");
   }else{result.denied.push(name);return send(403,{});}
  }else if(req.method==='POST'&&u.pathname==='/rest/v1/rpc/get_issued_chip_inventory'){
   let body='';for await(const part of req){body+=part;assert.ok(body.length<4096);}assert.deepEqual(JSON.parse(body),{p_tournament_id:tour});
   value=ownerRead(`SELECT public.get_issued_chip_inventory('${tour}');`);
  }else{result.denied.push(name);return send(403,{});}
  const inject=fault===name;
  result.reads.push({name,nativeRows:Array.isArray(value)?value.length:null,modeledNull:inject});
  if(browser981&&name==='get_issued_chip_inventory'&&fault981){
   const kind=fault981;fault981=null;
   if(kind==='slow'){
    const started=Date.now();await new Promise(resolve=>setTimeout(resolve,5000));
    result.faults981.push({kind,delayMs:Date.now()-started});
   }else{assert.equal(kind,'503');result.faults981.push({kind,status:503});return send(503,{message:'LOCAL981_MODELED_READ_UNAVAILABLE'});}
  }
  if(inject){assert.ok(Array.isArray(value)&&value.length>0);fault=null;return send(200,null);}
  send(200,value);
 }catch(error){result.errors.push({name:error.name,message:error.message});send(500,{message:'LOCAL978_READ_FAILURE'});}
});
const client=createClient('http://127.0.0.1:54329','LOCAL_TEST_ONLY',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54329,'127.0.0.1',resolve);});
 if(browser979){
  console.log(browser981?'CHIP981_HEALTHY_READY_ARM_SLOW_THEN503':browser980?'CHIP980_BROWSER_HEALTHY_READONLY_READY':'CHIP979_BROWSER_READONLY_READY_FAULT_TOURNAMENTS');
  await new Promise(resolve=>{let stage=0;process.stdin.on('data',chunk=>{const command=String(chunk).trim();if(command==='next'){assert.equal(fault,null);assert.ok(stage<2);if(browser981){assert.equal(fault981,null);fault981=['slow','503'][stage++];console.log('CHIP981_NEXT_'+fault981);}else{fault=['stack_template','stack_template_issuance'][stage++];console.log('CHIP979_NEXT_FAULT_'+fault);}}else if(command==='stop'){process.stdin.pause();resolve();}else throw new Error('unknown local control');});});
  assert.equal(result.reads.filter(r=>r.modeledNull).length,browser980||browser981?0:3);assert.equal(fault,null);
  if(browser981){assert.equal(result.faults981.length,2);assert.equal(result.faults981[0].kind,'slow');assert.ok(result.faults981[0].delayMs>=5000);assert.equal(result.faults981[1].status,503);assert.equal(fault981,null);assert.equal(result.reads.filter(r=>r.name==='get_issued_chip_inventory').length,4);}
  if(browser980)assert.ok(result.reads.filter(r=>r.name==='get_issued_chip_inventory').length>=21,'initial plus20actualscreenreads required');
  assert.equal(result.errors.length,0);assert.equal(result.denied.length,0);
 }else{
 for(const name of ['tournaments','stack_template','stack_template_issuance']){
  const operation=()=>name==='tournaments'?loadChipOpsTournamentOptions(client,club):loadIssuedStackSummary(client,tour);
  fault=name;await assert.rejects(operation,/CHIP_OPS_(TOURNAMENT_READ_FAILED|TEMPLATE_MALFORMED|ISSUANCE_MALFORMED)/);assert.equal(fault,null);
  const recovered=await operation();
  if(name==='tournaments')assert.ok(recovered.some(row=>row.id===tour));else assert.equal(recovered.totalIssuedStacks,3);
  result.checks.push({name,rejectedNull:true,recovered});
 }
 const inventory=await loadIssuedChipInventory(client,tour);assert.equal(inventory.tournamentId,tour);assert.equal(inventory.totalValue,60000);result.inventory=inventory;
 assert.equal(result.errors.length,0);assert.equal(result.denied.length,0);assert.equal(result.reads.filter(r=>r.modeledNull).length,3);
 }
}finally{
 if(server.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 result.after=fingerprint();result.unchanged=result.before===result.after;
 writeFileSync(`D:/Quy trình/output/reports/chip${result.runId}-null-recovery-native-local-20261027.json`,JSON.stringify(result,null,2)+'\n');assert.equal(result.unchanged,true);
}
console.log(browser981?'CHIP981_SLOW_503_RECOVERY_NATIVE_UNCHANGED_PASS':'CHIP978_THREE_NATIVE_NULL_REJECTIONS_RETRY_3_STACKS_60K_UNCHANGED_PASS');
