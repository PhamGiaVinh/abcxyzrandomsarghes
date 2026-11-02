import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';

assert.equal(process.env.VINPOKER_VIEWER889_MAIN_LOCAL,'1');
const prepare=process.argv.includes('--prepare-only'),serve=process.argv.includes('--serve-existing'),inspect=process.argv.includes('--inspect-existing');
assert.equal([prepare,serve,inspect].filter(Boolean).length,1,'select one explicit mode; never reset evidence');
const base=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',base,{input:q,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
assert.equal(prepare,false,'never construct a replacement original Main');
const f={actor:'675fe35e-60a8-4452-bb90-e79486d54da6',club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',tour:'4cd3af4d-7e1d-4042-855f-04fb6777e580',table:'8508d715-cd7c-4f1f-bb0d-223d967e355c',session:'9e586a50-61a8-440f-81df-27839c7ba81a'};
assert.equal(sql("SELECT count(*) FROM public.tournament_close_report WHERE tournament_id='"+f.tour+"';"),'1');
const anon=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;${q}ROLLBACK;`));
const page=(created=null,id=null,limit=20)=>anon(`SELECT public.get_public_tournament_table_history_v2('${f.tour}','${f.table}',${limit},${created?`'${created}'::timestamptz`:'NULL'},${id?`'${id}'::uuid`:'NULL'});`);
const first=page();assert.equal(first.access,'public');assert.equal(first.items.length,13);assert.equal(first.nextCursor,null);assert.equal(new Set(first.items.map(x=>x.handId)).size,13);assert.ok(first.items.every(x=>x.result.status==='verified'));assert.equal(sql("SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id IN(SELECT id FROM public.tournament_hands WHERE tournament_id='"+f.tour+"' AND tournament_table_id='"+f.table+"');"),'13');console.log('VIEWER889_ORIGINAL_MAIN_NATIVE_13_VERIFIED_CURRENT_TABLE_PASS');
if(serve){
 const log=[];
 let cursorFault885=process.env.VINPOKER_HISTORY885_CURSOR503==='1';
 const protectedTables=['cashier_buyin_movements','tournament_entries','tournament_seats','tournament_prize_payments','fnb_orders','fnb_stock_movements'];
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(${protectedTables.map(table=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.${table} x)`).join(',')},(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x))::text);`);
 const before=fingerprint();
 let holdCore889=true;
 const server=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,cache-control,accept-profile,content-profile,x-retry-count');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  const send=(status,value)=>{res.writeHead(status);res.end(JSON.stringify(value));};
  if(req.method==='OPTIONS'){log.push({preflight:req.headers['access-control-request-headers']??''});res.writeHead(204);res.end();return;}
  try{
   const url=new URL(req.url,'http://127.0.0.1:54329');
   if(url.pathname!=='/__local/evidence')log.push({transport:req.method,path:url.pathname});
   if(req.method==='GET'&&url.pathname==='/__local/manifest'){send(200,{...f,runId:'viewer889-original-main-readonly',singleTour:f.tour,historyTable:{id:f.table,session:f.session},model:'ORIGINAL_MAIN167_CANONICAL_RETAINED_PROOF_READ_ONLY'});return;}
   if(req.method==='GET'&&url.pathname==='/__local/evidence'){send(200,{log});return;}
   if(url.pathname.startsWith('/auth/')){send(401,{message:'LOCAL801_PUBLIC_ANON_ONLY'});return;}
   let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<8192);}
   const body=raw?JSON.parse(raw):{};
   const name=url.pathname.startsWith('/rest/v1/rpc/')?url.pathname.slice('/rest/v1/rpc/'.length):'';
   const allowed=['get_public_tournament_table_hand_v2','get_public_tournament_table_live_or_last_hand_v2','get_public_tournament_hand_v2','get_public_tournament_hand_detail_v1','get_public_tournament_settlement','get_public_tournament_clock_summary','get_public_tournament_results','get_tournament_clock','get_public_tournament_registration_summary_v1','get_public_tournament_hand_catalog_v2','get_public_tournament_viewer_snapshot_v2','get_tournament_tables'];
   if(req.method==='POST'&&allowed.includes(name)){
    if('p_tournament_id' in body)assert.equal(body.p_tournament_id,f.tour);
    if('p_tournament_table_id' in body)assert.equal(body.p_tournament_table_id,f.table);
    if('p_table_ids' in body)assert.ok(Array.isArray(body.p_table_ids)&&body.p_table_ids.every(id=>id===f.table));
    if('p_hand_id' in body)assert.ok(first.items.some(x=>x.handId===body.p_hand_id));
    const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
    const contracts=JSON.parse(sql("BEGIN READ ONLY;SELECT jsonb_agg(jsonb_build_object('names',p.proargnames[1:p.pronargs],'types',(SELECT jsonb_agg(format_type(p.proargtypes[n-1],NULL) ORDER BY n) FROM generate_series(1,p.pronargs)n),'set',p.proretset)) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname="+quote(name)+";ROLLBACK;"));
    const keys=Object.keys(body),matches=contracts.filter(c=>keys.every(k=>c.names.includes(k)));assert.equal(matches.length,1);const contract=matches[0];
    const defs=keys.map(k=>{assert.match(k,/^p_[a-z0-9_]+$/);const type=contract.types[contract.names.indexOf(k)];assert.ok(['uuid','integer','bigint','boolean','jsonb','text','uuid[]','text[]'].includes(type));return k+' '+type;}).join(',');
    const args=keys.map(k=>k+'=>b.'+k).join(',');
    const expression='public.'+name+'('+args+')';
    const query=contract.set?"SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM jsonb_to_record("+quote(JSON.stringify(body))+'::jsonb) AS b('+defs+') CROSS JOIN LATERAL '+expression+' x;':'SELECT to_jsonb('+expression+') FROM jsonb_to_record('+quote(JSON.stringify(body))+'::jsonb) AS b('+defs+');';
    const value=anon(query);log.push({read:'replay',rpc:name,hand:body.p_hand_id??null,role:'anon'});if(name==='get_public_tournament_table_live_or_last_hand_v2'&&holdCore889){holdCore889=false;log.push({fault:'HOLD_FIRST_CORE889',hand:body.p_hand_id});res.once('close',()=>{if(!res.writableEnded)log.push({fault:'CORE889_CLIENT_ABORTED'});});return;}send(200,value);return;
   }
   if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_public_tournament_table_history_v2'){
    assert.equal(body.p_tournament_id,f.tour);assert.equal(body.p_tournament_table_id,f.table);assert.ok([20,50].includes(body.p_limit));
    assert.deepEqual(Object.keys(body).sort(),['p_tournament_id','p_tournament_table_id','p_limit','p_before_created_at','p_before_id'].sort());
    assert.equal(body.p_before_created_at===null,body.p_before_id===null);
    if(body.p_before_created_at!==null){assert.match(body.p_before_created_at,/^\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?$/);assert.match(body.p_before_id,/^[a-f0-9-]{36}$/i);}
    if(cursorFault885&&body.p_before_id!==null){cursorFault885=false;log.push({fault:'HISTORY885_CURSOR_HTTP503',cursor:body.p_before_id});send(503,{message:'LOCAL885_MODELED_CURSOR_TRANSPORT_FAILURE'});return;}
    const value=page(body.p_before_created_at,body.p_before_id,body.p_limit);log.push({read:'history',limit:body.p_limit,cursor:body.p_before_id,rows:value.items.length,role:'anon'});send(200,value);return;
   }
   send(req.method==='GET'?404:403,{message:'LOCAL801_READ_ONLY_ENDPOINT_NOT_ALLOWED'});
  }catch(error){log.push({rejected:true,code:error?.code??error?.name??'unknown'});send(400,{message:'LOCAL801_INVALID_REQUEST'});}
 });
 writeFileSync('D:/Quy trình/output/reports/viewer889-original-main-run3-before-local-20261026.json',JSON.stringify({fixture:f,before,expected:first},null,2)+'\n');
 await new Promise(resolve=>server.listen(54329,'127.0.0.1',resolve));
 console.log('VIEWER889_ORIGINAL_MAIN_READ_ONLY_BROWSER_READY');
 await new Promise(resolve=>process.stdin.once('data',()=>{
  process.stdin.pause();
  server.close(resolve);
  // This harness exposes reads only. The browser proxy may retain an HTTP
  // keep-alive socket after its tab closes; don't leave shutdown/finalizers
  // waiting indefinitely for that client-owned connection.
  server.closeAllConnections();
 }));
 assert.equal(fingerprint(),before,'browser changed protected facts');writeFileSync('D:/Quy trình/output/reports/viewer889-original-main-run3-final-local-20261026.json',JSON.stringify({fixture:f,unchanged:true,before,log},null,2)+'\n');console.log('VIEWER889_ORIGINAL_MAIN_PROTECTED_FACTS_UNCHANGED_PASS',JSON.stringify(log));
}
