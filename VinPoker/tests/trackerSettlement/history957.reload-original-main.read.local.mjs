import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';

assert.equal(process.env.VINPOKER_HISTORY957_MAIN_LOCAL,'1');
const prepare=process.argv.includes('--prepare-only'),serve=process.argv.includes('--serve-existing'),inspect=process.argv.includes('--inspect-existing'),audit=process.argv.includes('--final-audit');
assert.equal([prepare,serve,inspect,audit].filter(Boolean).length,1,'select one explicit mode; never reset evidence');
const base=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',base,{input:q,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
assert.equal(prepare,false,'never construct a replacement original Main');
const f={actor:'675fe35e-60a8-4452-bb90-e79486d54da6',club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',tour:'4cd3af4d-7e1d-4042-855f-04fb6777e580',table:'8508d715-cd7c-4f1f-bb0d-223d967e355c',session:'9e586a50-61a8-440f-81df-27839c7ba81a'};
assert.equal(sql("SELECT count(*) FROM public.tournament_close_report WHERE tournament_id='"+f.tour+"';"),'1');
const anon=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;${q}ROLLBACK;`));
const page=(created=null,id=null)=>anon(`SELECT public.get_public_tournament_table_history_v2('${f.tour}','${f.table}',20,${created?`'${created}'::timestamptz`:'NULL'},${id?`'${id}'::uuid`:'NULL'});`);
const first=page();assert.equal(first.access,'public');assert.equal(first.items.length,13);assert.equal(first.nextCursor,null);assert.equal(new Set(first.items.map(x=>x.handId)).size,13);assert.ok(first.items.every(x=>x.result.status==='verified'));assert.equal(sql("SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id IN(SELECT id FROM public.tournament_hands WHERE tournament_id='"+f.tour+"' AND tournament_table_id='"+f.table+"');"),'13');console.log('HISTORY957_ORIGINAL_MAIN_NATIVE_13_VERIFIED_CURRENT_TABLE_PASS');
if(audit){
 const {readFileSync}=await import('node:fs');
 const before=JSON.parse(readFileSync('D:/Quy trình/output/reports/history957-original-main-before-local-20261026.json','utf8'));
 const protectedTables=['cashier_buyin_movements','tournament_entries','tournament_seats','tournament_prize_payments','fnb_orders','fnb_stock_movements'];
 const after=sql(`BEGIN READ ONLY;SELECT md5(jsonb_build_array(${protectedTables.map(table=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.${table} x)`).join(',')},(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x))::text);ROLLBACK;`);
 assert.equal(after,before.before);
 const {log}=await fetch('http://127.0.0.1:54329/__local/evidence').then(r=>{assert.equal(r.status,200);return r.json();});
 assert.equal(log.filter(x=>x.fault==='HISTORY957_INITIAL_HTTP503').length,1);
 assert.ok(log.some(x=>x.read==='history'&&x.rows===13));
 assert.ok(!log.some(x=>x.rejected));
 writeFileSync('D:/Quy trình/output/reports/history957-independent-final-local-20261027.json',JSON.stringify({fixture:f,before:before.before,after,unchanged:true,log},null,2)+'\n');
 console.log('HISTORY957_INDEPENDENT_FINAL_READONLY_FACTS_UNCHANGED_PASS');
}
if(serve){
 const log=[]; let firstFault957=true;
 let cursorFault885=process.env.VINPOKER_HISTORY885_CURSOR503==='1';
 const protectedTables=['cashier_buyin_movements','tournament_entries','tournament_seats','tournament_prize_payments','fnb_orders','fnb_stock_movements'];
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(${protectedTables.map(table=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.${table} x)`).join(',')},(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_hands x))::text);`);
 const before=fingerprint();
 const server=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,cache-control,accept-profile,content-profile,x-retry-count');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  const send=(status,value)=>{res.writeHead(status);res.end(JSON.stringify(value));};
  if(req.method==='OPTIONS'){log.push({preflight:req.headers['access-control-request-headers']??''});res.writeHead(204);res.end();return;}
  try{
   const url=new URL(req.url,'http://127.0.0.1:54329');
   if(url.pathname!=='/__local/evidence')log.push({transport:req.method,path:url.pathname});
   if(req.method==='GET'&&url.pathname==='/__local/manifest'){send(200,{...f,runId:'history957-original-main-readonly',singleTour:f.tour,historyTable:{id:f.table,session:f.session},model:'ORIGINAL_MAIN167_CANONICAL_RETAINED_PROOF_READ_ONLY'});return;}
   if(req.method==='GET'&&url.pathname==='/__local/evidence'){send(200,{log});return;}
   if(url.pathname.startsWith('/auth/')){send(401,{message:'LOCAL801_PUBLIC_ANON_ONLY'});return;}
   let raw='';for await(const chunk of req){raw+=chunk;assert.ok(raw.length<8192);}
   const body=raw?JSON.parse(raw):{};
   if(req.method==='POST'&&url.pathname==='/rest/v1/rpc/get_public_tournament_table_history_v2'){
    assert.equal(body.p_tournament_id,f.tour);assert.equal(body.p_tournament_table_id,f.table);assert.equal(body.p_limit,20);
    assert.deepEqual(Object.keys(body).sort(),['p_tournament_id','p_tournament_table_id','p_limit','p_before_created_at','p_before_id'].sort());
    assert.equal(body.p_before_created_at===null,body.p_before_id===null);
    if(body.p_before_created_at!==null){assert.match(body.p_before_created_at,/^\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?$/);assert.match(body.p_before_id,/^[a-f0-9-]{36}$/i);}
    if(cursorFault885&&body.p_before_id!==null){cursorFault885=false;log.push({fault:'HISTORY885_CURSOR_HTTP503',cursor:body.p_before_id});send(503,{message:'LOCAL885_MODELED_CURSOR_TRANSPORT_FAILURE'});return;}
    if(firstFault957){firstFault957=false;log.push({fault:"HISTORY957_INITIAL_HTTP503"});send(503,{message:"LOCAL957_MODELED_READ_FAILURE"});return;}
    const value=page(body.p_before_created_at,body.p_before_id);log.push({read:'history',limit:20,cursor:body.p_before_id,rows:value.items.length,role:'anon'});send(200,value);return;
   }
   send(req.method==='GET'?404:403,{message:'LOCAL801_READ_ONLY_ENDPOINT_NOT_ALLOWED'});
  }catch(error){log.push({rejected:true,code:error?.code??error?.name??'unknown'});send(400,{message:'LOCAL801_INVALID_REQUEST'});}
 });
 writeFileSync('D:/Quy trình/output/reports/history957-original-main-before-local-20261026.json',JSON.stringify({fixture:f,before,expected:first},null,2)+'\n');
 await new Promise(resolve=>server.listen(54329,'127.0.0.1',resolve));
 console.log('HISTORY957_ORIGINAL_MAIN_READ_ONLY_BROWSER_READY');
 await new Promise(resolve=>process.stdin.once('data',()=>{
  process.stdin.pause();
  server.close(resolve);
  // This harness exposes reads only. The browser proxy may retain an HTTP
  // keep-alive socket after its tab closes; don't leave shutdown/finalizers
  // waiting indefinitely for that client-owned connection.
  server.closeAllConnections();
 }));
 assert.equal(fingerprint(),before,'browser changed protected facts');writeFileSync('D:/Quy trình/output/reports/history957-original-main-final-local-20261026.json',JSON.stringify({fixture:f,unchanged:true,before,log},null,2)+'\n');console.log('HISTORY957_ORIGINAL_MAIN_PROTECTED_FACTS_UNCHANGED_PASS',JSON.stringify(log));
}
