import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const players1205=process.env.VINPOKER_SCHEDULE1205_LOCAL==='1';
const malformed1195=process.env.VINPOKER_SCHEDULE1195_LOCAL==='1'||players1205;
const public1194=malformed1195||process.env.VINPOKER_SCHEDULE1194_LOCAL==='1';
const malformed972=process.env.VINPOKER_CLUB972_LOCAL==='1',detail971=malformed972||process.env.VINPOKER_CLUB971_LOCAL==='1',runId=players1205?'1205':malformed1195?'1195':public1194?'1194':malformed972?'972':detail971?'971':process.env.VINPOKER_SCHEDULE970_LOCAL==='1'?'970':'969';
const origin=players1205?'http://127.0.0.1:53005':malformed1195?'http://127.0.0.1:52995':public1194?'http://127.0.0.1:52994':'http://127.0.0.1:5188';
assert.ok(public1194||detail971||runId==='970'||process.env.VINPOKER_SCHEDULE969_LOCAL==='1');
const db=public1194?'vinpoker_stocktake1159_local':'vinpoker_ranking860_local';
const output=`D:/Quy trình/output/reports/schedule${runId}-native-browser-local-${public1194?'20261028':'20261027'}.json`;
if(public1194)assert.equal(existsSync(output),false);
const club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
const probe=process.argv.includes('--http-probe');
const sql=(q,target=db)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE='+target,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:15000,maxBuffer:4e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),db+'|127.0.0.1|55441');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),public1194?'VINPOKER_STOCKTAKE1159_OWNED_LOCAL_TEST_CLONE':'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
const native=q=>JSON.parse(sql(`BEGIN READ ONLY;SET LOCAL request.jwt.claim.sub='';SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;${q}ROLLBACK;`));
const tables=['clubs','tournaments','tournament_series','club_series_images','app_settings','cashier_buyin_movements','tournament_entries','tournament_seats','tournament_prize_payments'];
const fingerprint=(target=db)=>sql(`BEGIN READ ONLY;SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text);ROLLBACK;`,target);
let preparation;
if(public1194){
 assert.equal(sql("SELECT current_setting('data_directory');"),'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink');"),'0');
}
if(public1194&&!malformed1195){
 const sourceBefore=fingerprint('vinpoker_ranking860_local');
 const moneyProof=()=>sql("BEGIN READ ONLY;SELECT md5(jsonb_build_array("+['cashier_buyin_movements','tournament_entries','tournament_seats','tournament_prize_payments','chip_bank_ledger','chip_inventory_ledger','dealer_attendance','dealer_assignments'].map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')+")::text);ROLLBACK;");
 const moneyBefore=moneyProof(),actor='675fe35e-60a8-4452-bb90-e79486d54da6',request=randomUUID();
 const rows=[['NLH',100000,'nlh'],['PLO',3000000,'plo'],['MIX',12000000,'mixed']].map(([name,buy_in,game_type],i)=>({club_id:club,name:'Schedule1194 '+name+' TEST',start_time:new Date(Date.now()+7200000+i*60000).toISOString(),buy_in,starting_stack:20000,game_type,location:null}));
 const literal="'"+JSON.stringify(rows).replaceAll("'","''")+"'::jsonb";
 const result=JSON.parse(sql(`BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;SELECT public.create_tournament_schedule_batch_v1(${literal},'${request}','${actor}');COMMIT;`));
 writeFileSync('D:/Quy trình/output/reports/schedule1194-canonical-fixture-local-20261028.json',JSON.stringify({actor,club,request,rows,result},null,2));
 assert.equal(result.ok,true);assert.equal(result.tournaments.length,3);const moneyAfter=moneyProof();assert.equal(moneyBefore,moneyAfter);
 preparation={actor,request,rows,result,moneyBefore,moneyAfter,sourceBefore};
}
if(malformed1195){
 const retained=JSON.parse(readFileSync('D:/Quy trình/output/reports/schedule1194-canonical-fixture-local-20261028.json','utf8'));
 const ids=retained.result.tournaments.map(t=>t.tournament_id);ids.forEach(id=>assert.match(id,/^[a-f0-9-]{36}$/));
 const actual=native(`SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'buy_in',buy_in,'start_time',start_time)) FROM public.tournaments WHERE id IN(${ids.map(id=>"'"+id+"'").join(',')});`);
 assert.equal(actual.length,3);for(const row of actual){const planned=retained.rows.find(r=>r.name===row.name);assert.ok(planned);assert.equal(row.buy_in,planned.buy_in);assert.ok(Date.parse(row.start_time)>Date.now(),'1194 retained fixture no longer upcoming');}
 preparation={...retained,reusedFrom1194:true,actual,sourceBefore:fingerprint('vinpoker_ranking860_local')};
}
const state={scope:public1194?'ACTUAL_PUBLIC_ROOT_ANON_NATIVE_CANONICAL_THREE_SCHEDULES_FILTERS_MODELED503':detail971?'ACTUAL_PUBLIC_CLUB_DETAIL_ANON_NATIVE_SCOPE_MODELED_READ_FAILURE':'ACTUAL_PUBLIC_ROOT_SCHEDULE_ANON_NATIVE_SINGLE_TEST_CLUB_SCOPE_MODELED_GALLERY503',runId,club,preparation,before:fingerprint(),reads:[],denied:[],faults:0};let galleryFault=!public1194,tourFault=public1194;
if(malformed1195)state.scope='ACTUAL_PUBLIC_ROOT_ANON_NATIVE_MALFORMED_NAME_BEFORE_AFTER_REUSED1194_FIXTURE';
const progress=()=>{if(malformed1195)writeFileSync(output.replace('.json','.progress.json'),JSON.stringify(state,null,2));};
const server=createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile,prefer');res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 const reply=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  if(public1194){assert.equal(req.headers.host,'127.0.0.1:54329');if(req.headers.origin)assert.equal(req.headers.origin,origin);}
  const url=new URL(req.url,'http://127.0.0.1:54329'),table=url.pathname.split('/').at(-1);
  if(url.pathname.startsWith('/auth/'))return reply(401,{message:'LOCAL969_MODELED_ANONYMOUS_AUTH'});
  if(req.method==='GET'&&url.pathname.startsWith('/rest/v1/')){
   let value;
   if(table==='clubs'){
    if(detail971){
     assert.equal(url.searchParams.get('id'),`eq.${club}`);assert.equal(url.searchParams.get('select'),'*');
     value=native(`SELECT jsonb_build_object('id',id,'name',name,'region',region,'address',address,'cover_url',cover_url,'description',description,'schedule',schedule,'daily_schedule_image_url',daily_schedule_image_url,'weekly_schedule_image_url',weekly_schedule_image_url) FROM public.clubs WHERE id='${club}' AND status='approved';`);
     if(galleryFault&&!malformed972){galleryFault=false;state.faults++;state.reads.push({table,modeled503:true});return reply(503,{message:'LOCAL971_MODELED_CLUB_READ_FAILURE'});}
    }else{
    assert.equal(url.searchParams.get('status'),'eq.approved');
    value=native(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'region',region,'daily_schedule_image_url',daily_schedule_image_url,'weekly_schedule_image_url',weekly_schedule_image_url,'schedule_sort_order',schedule_sort_order)),'[]') FROM public.clubs WHERE id='${club}' AND status='approved';`);assert.equal(value.length,1);
    }
   }else if(table==='tournaments'){
    if(detail971){
     assert.equal(url.searchParams.get('club_id'),`eq.${club}`);const from=url.searchParams.get('start_time');assert.match(from,/^gte\.[0-9T:.Z+-]+$/);
     value=native(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY start_time),'[]') FROM public.tournaments t WHERE club_id='${club}' AND start_time>='${from.slice(4)}'::timestamptz;`);
     if(galleryFault&&malformed972){assert.ok(value.length>0,'native positive tour required');galleryFault=false;state.faults++;value=value.map((row,index)=>index===0?{...row,name:{invalid:true}}:row);state.reads.push({table,modeledMalformedTourName:true,nativeRows:value.length});return reply(200,value);}
    }else{
    const fields=['id','name','start_time','buy_in','rake_amount','service_fee_amount','free_rake_enabled','free_rake_slots','free_rake_used','starting_stack','current_players','current_blinds','live_status','clock_started_at','location','game_type','minutes_per_level','late_reg_close_level'];
    value=native(`SELECT coalesce(jsonb_agg(jsonb_build_object(${fields.map(x=>`'${x}',t.${x}`).join(',')},'club',jsonb_build_object('id',c.id,'name',c.name,'region',c.region)) ORDER BY t.buy_in DESC,t.id),'[]') FROM public.tournaments t JOIN public.clubs c ON c.id=t.club_id WHERE c.id='${club}';`);
    if(public1194){state.latestNativeTours=value;if(tourFault){tourFault=false;state.faults++;
     if(malformed1195){const id=preparation.result.tournaments[0].tournament_id;assert.equal(typeof value.find(r=>r.id===id)?.name,'string');const faulty=value.map(r=>r.id===id?(players1205?{...r,current_players:{invalid:true}}:{...r,name:{invalid:true}}):r);state.reads.push({table,modeledMalformedTourName:true,id,nativeRows:value.length});progress();return reply(200,faulty);}
     state.reads.push({table,modeled503:true,nativeRows:value.length});return reply(503,{message:'LOCAL1194_MODELED_TOUR_READ_FAILURE'});}}
    }
   }else if(table==='tournament_series')value=native("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'location',location,'start_date',start_date,'end_date',end_date,'cover_url',cover_url) ORDER BY start_date),'[]') FROM public.tournament_series;");
   else if(table==='club_series_images'){
    assert.equal(url.searchParams.get('club_id'),detail971?`eq.${club}`:`in.(${club})`);
    value=native(`SELECT coalesce(jsonb_agg(jsonb_build_object('club_id',club_id,'image_url',image_url,'caption',caption,'position',position) ORDER BY position),'[]') FROM public.club_series_images WHERE club_id='${club}';`);
    if(galleryFault&&!detail971){galleryFault=false;state.faults++;state.reads.push({table,modeled503:true,nativeRows:value.length});return reply(503,{message:'LOCAL969_MODELED_GALLERY_FAILURE'});}
   }else if(table==='app_settings'){
    const key=url.searchParams.get('key');assert.ok(['eq.banners','eq.vip_banner',...(public1194?['eq.support_user_id']:[])].includes(key));value=native(`SELECT coalesce((SELECT jsonb_build_object('value',value) FROM public.app_settings WHERE key='${key.slice(3)}'),'null'::jsonb);`);
   }else if(table==='tournament_packages')value=native("SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM public.tournament_packages p WHERE status='active';");
   else{state.denied.push({method:req.method,path:url.pathname});return reply(403,{message:'LOCAL969_READ_NOT_ALLOWED'});}
   if(public1194)assert.ok(!/https?:\/\/(?!127\.0\.0\.1[:/])/.test(JSON.stringify(value)),'External assets outside this local packet');
   state.reads.push({table,rows:Array.isArray(value)?value.length:null});progress();return reply(200,value);
  }
  state.denied.push({method:req.method,path:url.pathname});return reply(403,{message:'LOCAL969_WRITES_NOT_ALLOWED'});
 }catch(error){state.reads.push({error:error.message});return reply(400,{message:'LOCAL969_INVALID_READ'});}
});
try{
 await new Promise(resolve=>server.listen(54329,'127.0.0.1',resolve));console.log('SCHEDULE969_NATIVE_ANON_READ_ONLY_READY');
 if(probe){
  for(let attempt=0;attempt<2;attempt++){
   for(const key of ['banners','vip_banner']){const r=await fetch(`http://127.0.0.1:54329/rest/v1/app_settings?key=eq.${key}`);assert.equal(r.status,200);assert.equal(await r.json(),null);}
   for(const path of ['clubs?status=eq.approved','tournaments','tournament_series']){const r=await fetch(`http://127.0.0.1:54329/rest/v1/${path}`);assert.equal(r.status,200);assert.ok(Array.isArray(await r.json()));}
   const r=await fetch(`http://127.0.0.1:54329/rest/v1/club_series_images?club_id=in.(${club})`);assert.equal(r.status,attempt===0?503:200);await r.json();
  }
 }else if(malformed1195){await new Promise(resolve=>process.stdin.on('data',chunk=>{const command=String(chunk).trim();if(command==='rearm'){assert.equal(tourFault,false);tourFault=true;console.log('SCHEDULE1195_MALFORMED_NAME_REARMED');}else{assert.equal(command,'stop');process.stdin.pause();resolve();}}));}
 else{await new Promise(resolve=>process.stdin.once('data',resolve));process.stdin.pause();}
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 assert.equal(state.faults,malformed1195?2:1);assert.ok(state.reads.some(r=>r.table===(public1194?'tournaments':'club_series_images')&&!r.modeled503&&!r.modeledMalformedTourName));assert.ok(!state.reads.some(r=>r.error));
}finally{
 if(server.listening){server.closeAllConnections();server.close();}state.after=fingerprint();state.unchanged=state.after===state.before;state.httpProbe=probe;if(public1194){state.sourceAfter=fingerprint('vinpoker_ranking860_local');state.sourceUnchanged=state.sourceAfter===preparation.sourceBefore;assert.equal(state.sourceUnchanged,true);}writeFileSync(public1194?output:`D:/Quy trình/output/reports/schedule${runId}-native-${probe?'http-probe':'browser'}-local-20261027.json`,JSON.stringify(state,null,2)+'\n');
}
assert.equal(state.unchanged,true);console.log('SCHEDULE969_GALLERY_RECOVERY_NATIVE_READONLY_UNCHANGED_PASS');
