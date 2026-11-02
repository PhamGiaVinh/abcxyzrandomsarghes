import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {writeFileSync,existsSync} from 'node:fs';
const clubs1254=process.env.VINPOKER_CLUBS1254_LOCAL==='1';
const clubs1230=process.env.VINPOKER_CLUBS1230_LOCAL==='1'||clubs1254;
const held1230=clubs1230&&process.argv.includes('--held1230');
const output1230=clubs1254?'D:/Quy trình/output/reports/clubs1254-metadata-fixture-native-browser-local-20261028.json':held1230?'D:/Quy trình/output/reports/clubs1230-held-native-browser-local-20261028.json':'D:/Quy trình/output/reports/clubs1230-native-browser-local-20261028.json';
if(clubs1230)assert.equal(existsSync(output1230),false);
const money1216=process.env.VINPOKER_LEADERBOARD1216_LOCAL==='1';
const output1216='D:/Quy trình/output/reports/leaderboard1216-native-browser-local-20261028.json';
if(money1216)assert.equal(existsSync(output1216),false);
const history976=process.env.VINPOKER_HISTORY976_LOCAL==='1';
const mobile975=history976||process.env.VINPOKER_LEADERBOARD975_LOCAL==='1';
assert.ok(clubs1230||money1216||mobile975||process.env.VINPOKER_LEADERBOARD974_LOCAL==='1');
const runId=clubs1230?'1230':money1216?'1216':history976?'976':mobile975?'975':'974';
const club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
const probe=process.argv.includes('--http-probe');
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:15000,maxBuffer:4e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ranking860_local|127.0.0.1|55441');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
if(money1216||clubs1230){assert.equal(sql("SELECT current_setting('data_directory');"),'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');}
const metadataFixture=`DO $$ BEGIN ASSERT (SELECT count(*) FROM public.clubs WHERE id IN('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760','d4427834-5f5f-48ef-bde5-e2dc388ed00b') AND name='Cash identity local TEST' AND region='TEST' AND rating=0 AND status='approved')=2; END $$;
UPDATE public.clubs SET region='TP.HCM',rating=4,name='000 local sort TEST' WHERE id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
UPDATE public.clubs SET region='Hanoi',rating=1,name='ZZZ local sort TEST' WHERE id='d4427834-5f5f-48ef-bde5-e2dc388ed00b';`;
const native=(q,metadata=false)=>JSON.parse(sql(`BEGIN ${metadata?'':'READ ONLY'};${metadata?metadataFixture:''}SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;${q}ROLLBACK;`));
const tables=['clubs','tournaments','tournament_series','club_series_images','app_settings','leaderboard_entries','all_time_money_list','club_money_list','player_results','profiles','cashier_buyin_movements','tournament_entries','tournament_seats','tournament_prize_payments'];
const fingerprint=()=>sql(`BEGIN READ ONLY;SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text);ROLLBACK;`);
const state={scope:'ACTUAL_PUBLIC_LEADERBOARD_ANON_NATIVE_READS_MODELED_NULL_CLUB_ROW',runId,club,before:fingerprint(),reads:[],denied:[],faults:0};let galleryFault=!clubs1254,nativeReady1230=!held1230;
if(clubs1254){state.scope='ACTUAL_PUBLIC_CLUBS_NATIVE_ANON_TWO_TEST_CLUB_METADATA_TRANSACTION_ROLLBACK_NOT_BASELINE_OR_FULL_E2E';state.runId='1254';}
const server=createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin',clubs1254?'http://127.0.0.1:53054':clubs1230?'http://127.0.0.1:53030':money1216?'http://127.0.0.1:53016':'http://127.0.0.1:5188');res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile,prefer');res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 const reply=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  const url=new URL(req.url,'http://127.0.0.1:54329'),table=url.pathname.split('/').at(-1);
  if(url.pathname.startsWith('/auth/'))return reply(401,{message:'LOCAL969_MODELED_ANONYMOUS_AUTH'});
  if(req.method==='GET'&&url.pathname.startsWith('/rest/v1/')){
   let value;
   if(table==='clubs'){
    assert.equal(url.searchParams.get('status'),'eq.approved');
    if(clubs1230){assert.equal(url.searchParams.get('select'),'*');assert.equal(url.searchParams.get('order'),'schedule_sort_order.asc,name.asc');value=native("SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT * FROM public.clubs WHERE status='approved' ORDER BY schedule_sort_order ASC,name ASC)x;",clubs1254);assert.ok(value.length>0);assert.ok(value.every(row=>!row.cover_url),'No external images');state.nativeClubOrder=value.map(row=>row.id);if(clubs1254)state.nativeClubOracle=value.map(({id,name,region,rating})=>({id,name,region,rating}));if(galleryFault||!nativeReady1230){galleryFault=false;state.faults++;state.reads.push({table,modeledMalformedRow:true,nativeRows:value.length});return reply(200,[null]);}}else value=native(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') FROM public.clubs WHERE id='${club}' AND status='approved';`);
    if(galleryFault&&!history976&&!money1216){assert.equal(value.length,1);galleryFault=false;state.faults++;state.reads.push({table,modeledMalformedRow:true,nativeRows:value.length});return reply(200,[null]);}
   }else if(['leaderboard_entries','all_time_money_list','club_money_list'].includes(table)){
    value=native(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public.${table} x;`);
   }else if(table==='player_results'){
    assert.equal(url.searchParams.get('verified_by_admin'),'eq.true');
    const cutoff=url.searchParams.get('event_date');
    if(cutoff!==null){assert.ok(mobile975);assert.match(cutoff,/^gte\.\d{4}-\d{2}-\d{2}$/);}
    const player=url.searchParams.get('player_id');
    if(player!==null){assert.ok(history976);assert.match(player,/^eq\.[a-f0-9-]{36}$/);}
    value=native(`SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY event_date DESC),'[]') FROM public.player_results x WHERE verified_by_admin=true${cutoff?` AND event_date>='${cutoff.slice(4)}'::date`:''}${player?` AND player_id='${player.slice(3)}'::uuid`:''};`);
    if(money1216&&galleryFault){assert.ok(value.length>0);galleryFault=false;state.faults++;state.reads.push({table,modeledPrizeNull:true,nativeRows:value.length});value=value.map((r,i)=>i===0?{...r,prize:null}:r);return reply(200,value);}
    if(player){state.reads.push({table,historyPlayer:player.slice(3),nativeRows:value.length,modeled503:galleryFault});
     if(galleryFault){galleryFault=false;state.faults++;return reply(503,{message:'LOCAL976_MODELED_HISTORY_FAILURE'});}}
    if(cutoff)state.reads.push({table,cutoff,nativeRows:value.length});
   }else if(table==='profiles'){
    const ids=url.searchParams.get('user_id');assert.match(ids,/^in\.\([a-f0-9,-]+\)$/);
    const list=ids.slice(4,-1).split(',');for(const id of list)assert.match(id,/^[a-f0-9-]{36}$/);
    value=native(`SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'display_name',display_name,'avatar_url',avatar_url)),'[]') FROM public.profiles WHERE user_id IN(${list.map(x=>"'"+x+"'").join(',')});`);
   }else if(table==='app_settings'){
    const key=url.searchParams.get('key');assert.ok(['eq.banners','eq.vip_banner'].includes(key));value=native(`SELECT coalesce((SELECT jsonb_build_object('value',value) FROM public.app_settings WHERE key='${key.slice(3)}'),'null'::jsonb);`);
   }else{state.denied.push({method:req.method,path:url.pathname});return reply(403,{message:'LOCAL974_READ_NOT_ALLOWED'});}
   state.reads.push({table,rows:Array.isArray(value)?value.length:null});return reply(200,value);
  }
  state.denied.push({method:req.method,path:url.pathname});return reply(403,{message:'LOCAL969_WRITES_NOT_ALLOWED'});
 }catch(error){state.reads.push({error:error.message});return reply(400,{message:'LOCAL969_INVALID_READ'});}
});
try{
 await new Promise(resolve=>server.listen(54329,'127.0.0.1',resolve));console.log('LEADERBOARD974_NATIVE_ANON_READ_ONLY_READY');
 await new Promise(resolve=>{if(!held1230){process.stdin.once('data',resolve);return;}process.stdin.on('data',chunk=>{const command=String(chunk).trim();if(command==='recover'){nativeReady1230=true;state.recoveryEnabledAt=Date.now();console.log('CLUBS1230_NATIVE_RECOVERY_ENABLED');}else{assert.equal(command,'stop');resolve();}});});process.stdin.pause();
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 if(clubs1254)assert.equal(state.faults,0);else if(held1230)assert.ok(state.faults>=1);else assert.equal(state.faults,1);assert.ok(state.reads.some(r=>r.table==='clubs'&&!r.modeledMalformedRow));assert.ok(!state.reads.some(r=>r.error));
 if(mobile975&&!history976)assert.ok(state.reads.some(r=>r.cutoff),'actual dated-filter read required');
 if(history976)assert.ok(state.reads.some(r=>r.historyPlayer&&!r.modeled503&&r.nativeRows>0),'positive native history retry required');
}finally{
 if(server.listening){server.closeAllConnections();server.close();}state.after=fingerprint();state.unchanged=state.after===state.before;state.httpProbe=probe;writeFileSync(clubs1230?output1230:money1216?output1216:`D:/Quy trình/output/reports/leaderboard${runId}-native-${probe?'http-probe':'browser'}-local-20261027.json`,JSON.stringify(state,null,2)+'\n');
}
assert.equal(state.unchanged,true);console.log('LEADERBOARD974_GALLERY_RECOVERY_NATIVE_READONLY_UNCHANGED_PASS');
