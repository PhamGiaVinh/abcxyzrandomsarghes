import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.PGHOST,'127.0.0.1');
assert.ok(process.env.PGDATABASE?.startsWith('vinpoker_ops_'));
function sql(q){const r=spawnSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function tx(name,q,hold,commit=false){
 const p=spawn('psql',['-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const result=new Promise(resolve=>{p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>error+=c);p.on('close',code=>resolve({code,out,error}));p.on('error',e=>resolve({code:-1,error:String(e)}));});
 p.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='10s';${q}\n`);
 if(!hold)p.stdin.end(commit?'COMMIT;\n':'ROLLBACK;\n');
 return {result,finish:()=>p.stdin.end('ROLLBACK;\n')};
}
async function barrier(name,condition){for(let i=0;i<160;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`)==='t')return;await new Promise(r=>setTimeout(r,25));}assert.fail('missing actual overlap barrier');}
for(const branding of [false,true]){
 const prefix=randomUUID().slice(0,8);
 let fixture=readFileSync('tests/floorProduction/trackerRosterSession.pg17.sql','utf8').split('-- Only public RPC calls')[0];
 const marker=" PERFORM set_config('role','authenticated',true);";
 assert.ok(fixture.includes(marker));
 fixture=fixture.replaceAll('f7280000',prefix).replace(marker,' RETURN;\n'+marker)+'\nCOMMIT;\n';
 sql(fixture);
 const tour=`${prefix}-0000-4000-8000-000000000003`,club=`${prefix}-0000-4000-8000-000000000002`;
 const token=`fixture-only-tv-concurrency-${randomUUID()}`;
 sql(`INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status) VALUES('${randomUUID()}','${club}','${token}','${tour}','paired');`);
 // Two simultaneous flights share an event/branding, never their runtime.
 // This fixture is local-only (loopback/owned DB guards above); public writers
 // create the second flight's operational session and participation.
 const flightB=randomUUID(),event=randomUUID(),tableB=randomUUID(),tokenB=`fixture-only-tv-flight-b-${randomUUID()}`;
 sql(`BEGIN;
 INSERT INTO public.tournament_events(id,club_id,name) VALUES('${event}','${club}','Shared event TEST');
 UPDATE public.tournaments SET event_id='${event}',phase='flight',flight_label='A',
   clock_started_at=now()-interval '120 seconds',clock_paused_at=now() WHERE id='${tour}';
 INSERT INTO public.tournaments(id,club_id,name,status,live_status,current_level,event_id,phase,flight_label,clock_started_at,clock_paused_at)
 VALUES('${flightB}','${club}','Flight B TEST','live','playing',1,'${event}','flight','B',now()-interval '300 seconds',now());
 INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,is_break,duration_minutes)
 VALUES('${flightB}',1,500,1000,100,false,40);
 INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status)
 VALUES('${tableB}','${club}','Flight B TEST',73,'tournament','inactive','available');
 SELECT set_config('request.jwt.claim.sub','${prefix}-0000-4000-8000-000000000001',true);
 DO $$ DECLARE opened jsonb; seated jsonb; epoch bigint; BEGIN
 opened:=public.floor_open_tournament_table_v3('${flightB}','${tableB}','manual','${randomUUID()}');
 IF opened->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'flight B open failed: %',opened; END IF;
 SELECT control_epoch INTO epoch FROM public.table_sessions WHERE id=(opened->>'table_session_id')::uuid;
 PERFORM set_config('role','authenticated',true);
 seated:=public.set_tracker_table_roster_seat_v2('${flightB}',(opened->>'tournament_table_id')::uuid,
   (opened->>'table_session_id')::uuid,epoch,'${randomUUID()}',1,'Flight B player TEST',45000);
 PERFORM set_config('role','none',true);
 IF seated->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'flight B seat failed: %',seated; END IF;
 END $$;
 INSERT INTO public.tv_tournament_layouts(club_id,event_id,brand_name,layout,updated_by)
 SELECT '${club}','${event}','Shared event brand TEST',public.get_tv_tournament_branding_v1('${tour}')->'layout','${prefix}-0000-4000-8000-000000000001';
 INSERT INTO public.tv_displays(id,club_id,display_token,assigned_tournament_id,status)
 VALUES('${randomUUID()}','${club}','${tokenB}','${flightB}','paired');
 COMMIT;`);
 const flights=await Promise.all([token,tokenB].map((t,i)=>tx(`tv_flight_${prefix}_${i}`,
   `SET LOCAL ROLE anon;SELECT public.get_tv_display_state_v4('${t}',${branding});`,false).result));
 const payloads=flights.map(r=>{assert.equal(r.code,0,r.error);return JSON.parse(r.out);});
 for(const [i,p] of payloads.entries()){
  assert.equal(p.status,'paired');assert.equal(p.tournament.id,i===0?tour:flightB);
  assert.equal(p.clock.tournament_id,p.tournament.id);
  assert.equal(p.participation_counts.remaining,i===0?0:1);
  assert.equal(p.participation_counts.live_entry_stack,i===0?0:45000);
  assert.equal(p.levels[0].big_blind,i===0?100:1000);
  assert.equal(p.clock.elapsed_seconds,i===0?120:300);
  if(branding)assert.equal(p.display.club_brand_name,'Shared event brand TEST');
 }
 assert.notEqual(payloads[0].clock.control_revision,payloads[1].clock.control_revision);
 const call=`SET LOCAL ROLE anon;SELECT public.get_tv_display_state_v4('${token}',${branding});`;
 const a=tx(`tv_a_${prefix}`,call,true);
 await barrier(`tv_a_${prefix}`,"state='idle in transaction'");
 const b=tx(`tv_b_${prefix}`,call,false);
 await barrier(`tv_b_${prefix}`,"wait_event_type='Lock'");a.finish();
 const results=await Promise.all([a.result,b.result]);
 for(const r of results){assert.equal(r.code,0,r.error);const payload=JSON.parse(r.out);assert.equal(payload.status,'paired');assert.equal(payload.tournament.id,tour);assert.ok(payload.participation_counts);}
 const reader=tx(`tv_read_${prefix}`,call,true);
 await barrier(`tv_read_${prefix}`,"state='idle in transaction'");
 const revoke=tx(`tv_revoke_${prefix}`,`UPDATE public.tv_displays SET status='revoked' WHERE display_token='${token}';`,false,true);
 await barrier(`tv_revoke_${prefix}`,"wait_event_type='Lock'");reader.finish();
 const [readResult,revokeResult]=await Promise.all([reader.result,revoke.result]);
 assert.equal(readResult.code,0,readResult.error);assert.equal(revokeResult.code,0,revokeResult.error);
 const revoked=JSON.parse(sql(`BEGIN;SET LOCAL ROLE anon;SELECT public.get_tv_display_state_v4('${token}',${branding});ROLLBACK;`));
 assert.equal(revoked.status,'revoked');assert.equal(revoked.participation_counts,undefined);
}
console.log('PARTICIPATION_TV_TRUE_OVERLAP_PASS');
console.log('PARTICIPATION_TV_SHARED_EVENT_FLIGHTS_ISOLATED_PASS');
