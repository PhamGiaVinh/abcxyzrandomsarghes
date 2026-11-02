import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_TV1051_LOCAL,'1');
const report='D:/Quy trình/output/reports/tv1051-three-original-projections-local-20261027.json';assert.equal(existsSync(report),false);
const event='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
const fixtures=[['A','775f323b-9497-4f02-9941-85903ceecc21','782a5196-5ea1-44ed-8a27-1b872d5f88d9'],['B','66db01fc-1181-49c3-b964-a7c51761cb23','fdf91018-09f3-4cdc-b76a-f688eb216cee'],['D2','ca1f1e29-0d57-4e59-b7e5-309f7928f3da','4cd3af4d-7e1d-4042-855f-04fb6777e580']];
const sql=(db,q)=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE='+db,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=(db,q)=>JSON.parse(sql(db,"BEGIN READ ONLY;SET LOCAL statement_timeout='10s';"+q+'ROLLBACK;'));
const tables=['tv_displays','tournaments','tournament_events','tournament_tables','tournament_entries','tournament_seats','tournament_hands','tournament_prize_payments'];
const fingerprint=db=>read(db,"SELECT to_jsonb(md5(jsonb_build_array("+tables.map(t=>"(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public."+t+" x)").join(',')+")::text));");
const out={kind:'TWELVE_EXISTING_DISPLAY_ANON_NATIVE_PROJECTIONS_NOT_BROWSER_OR_WHOLE_JOURNEY',databases:[],errors:[]};
try{for(const db of ['vinpoker_ops_cash115_qualified_c','vinpoker_ranking860_local']){
 const guard=read(db,"SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'dir',current_setting('data_directory'),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));");assert.equal(guard.db,db);assert.equal(guard.host,'127.0.0.1');assert.equal(guard.port,55441);assert.equal(guard.dir,'/tmp/vinpoker-sol-local-20261016-0e79a729/data');assert.equal(guard.external,0);
 const item={guard,before:fingerprint(db),observations:[]};out.databases.push(item);
 try{for(const [flight,display,tour] of fixtures){
  const oracle=read(db,"SELECT jsonb_build_object('id',id,'event_id',event_id,'status',status,'current_level',current_level,'players_remaining',players_remaining,'entry_count',(SELECT count(*) FROM public.tournament_entries e WHERE e.tournament_id=t.id),'prize_pool',prize_pool) FROM public.tournaments t WHERE id='"+tour+"';");assert.equal(oracle.event_id,event);
  assert.equal(read(db,"SELECT to_jsonb(count(*)) FROM public.tv_displays WHERE id='"+display+"' AND assigned_tournament_id='"+tour+"' AND status='paired';"),1);
  for(const branding of [false,true]){
   const p=JSON.parse(sql(db,"BEGIN;SET LOCAL statement_timeout='10s';DO $$ BEGIN PERFORM set_config('test.tv1051.token',(SELECT display_token FROM public.tv_displays WHERE id='"+display+"'),true);END $$;SET LOCAL request.jwt.claim.role='anon';SET LOCAL request.jwt.claims='{\"role\":\"anon\"}';SET LOCAL ROLE anon;SELECT public.get_tv_display_state_v4(current_setting('test.tv1051.token'),"+branding+");ROLLBACK;"));
   const snapshot={flight,branding,oracle,status:p.status,keys:Object.keys(p),displayId:p.display?.id,tournament:p.tournament,clock:p.clock,mainEvent:p.main_event,levelCount:p.levels?.length,tableCount:p.tables?.length};item.observations.push(snapshot);
   assert.equal(p.status,'paired');assert.equal(p.display.id,display);assert.equal(p.tournament.id,tour);assert.equal(p.clock.tournament_id,tour);assert.equal(p.main_event.id,event);assert.equal(p.tournament.status,oracle.status);
  }
 }}finally{item.after=fingerprint(db);item.unchanged=item.before===item.after;assert.equal(item.unchanged,true);}
}}catch(error){out.errors.push(error.message);throw error;}finally{writeFileSync(report,JSON.stringify(out,null,2));}
console.log('TV1051_12_EXISTING_ANON_NATIVE_READS_UNCHANGED_SCOPE_PASS_NOT_BROWSER_ACCEPTANCE');
