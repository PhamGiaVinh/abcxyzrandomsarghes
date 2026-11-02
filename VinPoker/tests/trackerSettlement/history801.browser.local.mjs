import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

assert.equal(process.env.VINPOKER_HISTORY801_CLONE,'1');
const prepare=process.argv.includes('--prepare-only'),serve=process.argv.includes('--serve-existing'),inspect=process.argv.includes('--inspect-existing');
assert.equal([prepare,serve,inspect].filter(Boolean).length,1,'select one explicit mode; never reset evidence');
const base=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_fnb719_gate_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',base,{input:q,encoding:'utf8',timeout:15000}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),'vinpoker_fnb719_gate_local|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_FNB719_OWNED_LOCAL_CLONE_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
let f;
if(prepare){
 assert.equal(sql("SELECT to_regclass('floor_private.history801_fixture') IS NULL;"),'t','consumed constructor');
 f={actor:randomUUID(),club:randomUUID(),tour:randomUUID(),table:randomUUID(),session:randomUUID()};
 sql(`BEGIN;
 INSERT INTO auth.users(id) VALUES('${f.actor}');
 INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES('${f.club}','${f.actor}','LOCAL801 synthetic HISTORY READ TEST','TEST','approved');
 INSERT INTO public.tournaments(id,club_id,name,status,live_status,buy_in,starting_stack) VALUES('${f.tour}','${f.club}','LOCAL801 reader fixture NOT PLAYED','active','registering',0,20000);
 DO $$DECLARE physical uuid;BEGIN
 SELECT id INTO STRICT physical FROM public.game_tables WHERE club_id='${f.club}' AND table_number=7;
 INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,tournament_id,control_mode,opened_by)
 VALUES('${f.session}','${f.club}',physical,'tournament','${f.tour}','manual','${f.actor}');
 INSERT INTO public.tournament_tables(id,tournament_id,game_table_id,table_session_id,table_number,status,max_seats)
 VALUES('${f.table}','${f.tour}',physical,'${f.session}',7,'active',9);
 END $$;
 -- Reader fixtures only: no played hand, participant, winner or verification is fabricated.
 INSERT INTO public.tournament_hands(tournament_id,tournament_table_id,table_id,table_session_id,hand_number,status,created_at,community_cards,pot_size,button_seat,source_revision,tracker_small_blind,tracker_big_blind,tracker_bba,tracker_level_number)
 SELECT '${f.tour}','${f.table}','${f.table}','${f.session}',n,'completed','2026-10-24T00:00:00Z','[]',0,1,1,50,100,0,1 FROM generate_series(1,21)n;
 UPDATE public.tournament_tables SET status='closed' WHERE id='${f.table}';
 UPDATE public.table_sessions SET closed_at=now() WHERE id='${f.session}';
 CREATE TABLE floor_private.history801_fixture(fixture jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
 ALTER TABLE floor_private.history801_fixture ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON floor_private.history801_fixture FROM PUBLIC,anon,authenticated,service_role;
 INSERT INTO floor_private.history801_fixture(fixture) VALUES('${JSON.stringify(f)}');
 COMMIT;`);
 console.log('HISTORY801_PREPARED_SYNTHETIC_21_NO_VERIFIED_PROOF_NOT_A_PLAYED_JOURNEY',JSON.stringify(f));
}else{
 f=JSON.parse(sql('SELECT fixture FROM floor_private.history801_fixture;'));
}
const anon=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;${q}ROLLBACK;`));
const page=(created=null,id=null)=>anon(`SELECT public.get_public_tournament_table_history_v2('${f.tour}','${f.table}',20,${created?`'${created}'::timestamptz`:'NULL'},${id?`'${id}'::uuid`:'NULL'});`);
const first=page();assert.equal(first.access,'public');assert.equal(first.items.length,20);assert.ok(first.nextCursor);
const second=page(first.nextCursor.createdAt,first.nextCursor.id);assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);
assert.equal(new Set([...first.items,...second.items].map(row=>row.handId)).size,21);
assert.ok([...first.items,...second.items].every(row=>row.result.status!=='verified'));
assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id IN(SELECT id FROM public.tournament_hands WHERE tournament_id='${f.tour}');`),'0');
console.log('HISTORY801_NATIVE_ANON_DEFAULT20_PLUS1_SAME_TIMESTAMP_UNIQUE_PENDING_NO_PROOF_PASS');
if(serve){
 const log=[];
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
   if(req.method==='GET'&&url.pathname==='/__local/manifest'){send(200,{...f,runId:'history801-readonly',singleTour:f.tour,historyTable:{id:f.table,session:f.session},model:'SYNTHETIC_READER_FIXTURE_REAL_ANON_PG_NOT_PLAYED_HANDS'});return;}
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
    const value=page(body.p_before_created_at,body.p_before_id);log.push({read:'history',limit:20,cursor:body.p_before_id,rows:value.items.length,role:'anon'});send(200,value);return;
   }
   send(req.method==='GET'?404:403,{message:'LOCAL801_READ_ONLY_ENDPOINT_NOT_ALLOWED'});
  }catch(error){log.push({rejected:true,code:error?.code??error?.name??'unknown'});send(400,{message:'LOCAL801_INVALID_REQUEST'});}
 });
 await new Promise(resolve=>server.listen(54329,'127.0.0.1',resolve));
 console.log('HISTORY801_READ_ONLY_BROWSER_READY');
 await new Promise(resolve=>process.stdin.once('data',()=>{
  process.stdin.pause();
  server.close(resolve);
  // This harness exposes reads only. The browser proxy may retain an HTTP
  // keep-alive socket after its tab closes; don't leave shutdown/finalizers
  // waiting indefinitely for that client-owned connection.
  server.closeAllConnections();
 }));
 assert.equal(fingerprint(),before,'browser changed protected facts');console.log('HISTORY801_READ_ONLY_BROWSER_PROTECTED_FACTS_UNCHANGED_PASS',JSON.stringify(log));
}
