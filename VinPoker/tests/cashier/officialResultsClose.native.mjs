import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createPaidJourneyFixture} from './paidJourney.fixture.mjs';

assert.equal(process.env.VINPOKER_NATIVE_OFFICIAL_CLOSE,'1');
for(const [k,v] of Object.entries({PGHOST:'127.0.0.1',PGPORT:'55441',PGUSER:'postgres',PGDATABASE:'vinpoker_ops_cash115_qualified_c'}))assert.equal(process.env[k],v);
for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[k]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql']:[];
const sql=q=>execFileSync(prefix.length?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
const f=createPaidJourneyFixture(sql),survivor=crypto.randomUUID();
const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
const call=q=>JSON.parse(sql(`BEGIN;${auth}${q}COMMIT;`));
const missing=process.argv.includes('--missing-evidence'),existing=process.argv.includes('--existing-places'),partial=process.argv.includes('--partial-places'),fault=process.argv.includes('--close-fault'),overlap=process.argv.includes('--overlap');
assert.ok([missing,existing,partial,fault,overlap].filter(Boolean).length<=1);
function tx(name,hold,actor=f.actor){const p=spawn(prefix.length?'wsl':'psql',[...prefix,'-w','-X','-qAt','-v','ON_ERROR_STOP=1']);let out='',error='';
 const result=new Promise(resolve=>{p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>error+=c);p.on('close',code=>resolve({code,out,error}));p.on('error',e=>resolve({code:-1,out,error:String(e)}));});
 const end=command=>{if(!p.stdin.writableEnded)p.stdin.end(command+';\n');};
 p.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='15s';
 SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${actor}"}';SET LOCAL ROLE authenticated;
 SELECT public.close_tournament('${f.tour}','TEST official close overlap');\n`);
 if(!hold)end('COMMIT');return {result,end};}
async function barrier(name,condition){for(let n=0;n<100;n++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`)==='t')return;await new Promise(resolve=>setTimeout(resolve,25));}assert.fail('official close overlap barrier absent '+name);}
sql(`BEGIN;INSERT INTO auth.users(id) VALUES('${survivor}');DO $$ DECLARE r jsonb;reg uuid;BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);PERFORM set_config('role','service_role',true);
 r:=public.cashier_create_app_registration_v1('${f.tour}','${survivor}');IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'official_close_registration_failed: %',r;END IF;reg:=(r->>'registration_id')::uuid;
 PERFORM set_config('role','none',true);PERFORM set_config('request.jwt.claim.sub','${f.actor}',true);PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.actor}"}',true);PERFORM set_config('role','authenticated',true);
 r:=public.resolve_cashier_cash_buyin_intent_v1(jsonb_build_object('actor_id','${f.actor}','club_id','${f.club}','tournament_id','${f.tour}','registration_id',reg,'amount',100000,'request_id',gen_random_uuid()),'record');
 IF r->>'status' IS DISTINCT FROM 'recorded' OR r->'result'->>'seating_state' IS DISTINCT FROM 'seated' THEN RAISE EXCEPTION 'official_close_payment_failed: %',r;END IF;
END $$;COMMIT;`);
const placement=player=>JSON.parse(sql(`SELECT jsonb_build_object('entry',e.id,'table',s.tournament_table_id,'session',x.id,'revision',x.revision,'epoch',x.control_epoch,'stack',s.chip_count)
 FROM public.tournament_entries e JOIN public.tournament_seats s ON s.entry_id=e.id AND s.is_active JOIN public.table_sessions x ON x.id=s.table_session_id WHERE e.tournament_id='${f.tour}' AND e.player_id='${player}';`));
const settings=sql(`SELECT player_history_enabled FROM public.club_settings WHERE club_id='${f.club}';`);assert.ok(['','t','f'].includes(settings));
const cash=()=>sql(`SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${f.tour}';`),cashBefore=cash();
sql(`INSERT INTO public.club_settings(club_id,player_history_enabled) VALUES('${f.club}',true) ON CONFLICT(club_id) DO UPDATE SET player_history_enabled=true;`);
try{
 if(missing)sql(`UPDATE public.club_settings SET player_history_enabled=false WHERE club_id='${f.club}';`);
 const loser=placement(f.player);
 const bust=call(`SELECT public.floor_bust_player_v3('${loser.entry}',${loser.revision},${loser.epoch},${loser.stack},'${crypto.randomUUID()}','TEST official close two-player result');`);assert.equal(bust.ok,true);
 assert.equal(sql(`SELECT bust_order FROM public.tournament_entries WHERE id='${loser.entry}';`),missing?'':'1');
 if(missing)sql(`UPDATE public.club_settings SET player_history_enabled=true WHERE club_id='${f.club}';`);
 assert.equal(sql(`SELECT registration_closed_at IS NULL FROM public.tournaments WHERE id='${f.tour}';`),'t');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${f.tour}' AND finished_place IS NOT NULL;`),'0','auto-finalization must wait while registration is open');
 const winner=placement(survivor);
 const left=call(`SELECT public.floor_free_sit_player_v1('${winner.entry}',${winner.revision},${winner.epoch},${winner.stack},'${crypto.randomUUID()}','TEST end play preserves winner stack');`);assert.equal(left.ok,true);assert.equal(left.payout_applied,false);
 const tables=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('id',t.id,'revision',s.revision)) FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id='${f.tour}' AND t.status='active';`));
 for(const t of tables)assert.equal(call(`SELECT public.close_tournament_table_v4('${t.id}',${t.revision},'${crypto.randomUUID()}');`).ok,true);
 const ready=call(`SELECT public.get_tournament_close_readiness_v1('${f.tour}');`);assert.equal(ready.ready,!missing);
 if(missing)assert.ok(ready.blockers.includes('official_results_evidence_missing'));
 const entries=()=>sql(`SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${f.tour}';`);
 const protectedState=()=>sql(`SELECT md5(jsonb_build_object('tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${f.tour}'),
  'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${f.tour}'),
  'reports',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_close_report r WHERE tournament_id='${f.tour}'))::text);`);
 const beforeOutsider=protectedState();
 const outsider=JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claim.sub='${f.player}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.player}"}';SET LOCAL ROLE authenticated;SELECT public.close_tournament('${f.tour}','TEST outsider close');COMMIT;`));
 assert.equal(outsider.error,'actor_not_allowed');assert.equal(protectedState(),beforeOutsider);
 if(process.env.VINPOKER_EXPECT_OFFICIAL_BASELINE!=='1')for(const role of ['anon','authenticated','service_role'])for(const helper of ['floor_private.felt_finalize_official_results_at_close_v1()','floor_private.felt_official_results_close_status_v1(uuid)'])assert.equal(sql(`SELECT has_function_privilege('${role}','${helper}','EXECUTE');`),'f');
 if(existing||partial){const r=call(`SELECT public.finalize_tournament_results('${f.tour}');`);assert.equal(r.ok,true);assert.equal(r.survivors,1);}
 const beforeClose=protectedState(),beforeEntries=entries();
 if(missing||partial||fault){
  let setup='';
  if(partial)setup=`UPDATE public.tournament_entries SET finished_place=NULL WHERE id='${loser.entry}';`;
  if(fault)setup=`CREATE FUNCTION pg_temp.official_close_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
   IF (SELECT count(*) FROM public.tournament_entries WHERE tournament_id=NEW.tournament_id AND finished_place IS NOT NULL)<>2 THEN RAISE EXCEPTION 'TEST_finalization_not_run_before_fault';END IF;
   RAISE EXCEPTION 'TEST_official_close_after_finalization_fault';END $$;
   CREATE TRIGGER zz_official_close_fault AFTER INSERT ON public.tournament_close_report FOR EACH ROW EXECUTE FUNCTION pg_temp.official_close_fault();`;
  const partialReadiness=partial?`DO $$ DECLARE r jsonb;BEGIN r:=public.get_tournament_close_readiness_v1('${f.tour}');IF r->>'ready' IS DISTINCT FROM 'false' OR NOT(r->'blockers' @> '["official_results_incomplete"]'::jsonb) THEN RAISE EXCEPTION 'TEST_partial_result_readiness_not_blocked: %',r;END IF;END $$;`:'';
  assert.throws(()=>sql(`BEGIN;${setup}${auth}${partialReadiness}SELECT public.close_tournament('${f.tour}','TEST guarded official result close');COMMIT;`),
   new RegExp(missing?'official_results_evidence_missing':partial?'official_results_incomplete':'TEST_official_close_after_finalization_fault'));
  assert.equal(protectedState(),beforeClose,'failed finalization/report must roll back the entire close');assert.equal(cash(),cashBefore);
  console.log('NATIVE_OFFICIAL_CLOSE_'+(missing?'MISSING_EVIDENCE':partial?'PARTIAL_RESULT':'AFTER_FINALIZATION_FAULT')+'_ZERO_DELTA_PASS');
 }else{
 let close;
 if(overlap){const suffix=crypto.randomUUID().slice(0,8),hname='official_h_'+suffix,wname='official_w_'+suffix,cashier=crypto.randomUUID();let h,w;
  sql(`BEGIN;INSERT INTO auth.users(id) VALUES('${cashier}');INSERT INTO public.club_cashiers(club_id,user_id) VALUES('${f.club}','${cashier}');COMMIT;`);
  try{h=tx(hname,true);await barrier(hname,"wait_event='ClientRead' AND xact_start IS NOT NULL");w=tx(wname,false,cashier);await barrier(wname,"wait_event_type='Lock'");
   h.end('COMMIT');const holder=await h.result,waiter=await w.result;assert.equal(holder.code,0,holder.error);assert.equal(waiter.code,0,waiter.error);
   close=JSON.parse(holder.out.split('\n').find(s=>s.startsWith('{')));const replay=JSON.parse(waiter.out.split('\n').find(s=>s.startsWith('{')));assert.equal(replay.outcome,'already_closed');assert.equal(replay.report_id,close.report_id);
  }finally{h?.end('ROLLBACK');w?.end('ROLLBACK');await Promise.all([h?.result,w?.result]);}
 }else close=call(`SELECT public.close_tournament('${f.tour}','TEST official results at canonical close, no payout');`);
 assert.equal(close.ok,true);
 assert.equal(sql(`SELECT status FROM public.tournaments WHERE id='${f.tour}';`),'completed');
 assert.equal(cash(),cashBefore);assert.equal(sql(`SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${f.tour}';`),'0');
 const actual=JSON.parse(sql(`SELECT jsonb_object_agg(player_id,finished_place) FROM public.tournament_entries WHERE tournament_id='${f.tour}';`));
 console.log('NATIVE_OFFICIAL_CLOSE_OBSERVED',JSON.stringify({club:f.club,tournament:f.tour,loser:f.player,winner:survivor,actual}));
 assert.equal(actual[f.player],2,'canonical completed tour must finalize captured loser place');
 assert.equal(actual[survivor],1,'canonical completed tour must finalize survivor place');
 const finalState=protectedState(),replayed=call(`SELECT public.close_tournament('${f.tour}','TEST replay official close');`);assert.equal(replayed.outcome,'already_closed');assert.equal(replayed.report_id,close.report_id);assert.equal(protectedState(),finalState);
 assert.equal(sql(`SELECT detail->'official_results'->>'status' FROM public.tournament_close_report WHERE tournament_id='${f.tour}';`),existing?'preserved':'finalized');
 if(existing)assert.equal(entries(),beforeEntries,'existing official results must not be recomputed');
 console.log('NATIVE_PAID_HISTORY_ENABLED_CANONICAL_CLOSE_OFFICIAL_PLACES'+(existing?'_PRESERVED':overlap?'_TRUE_OVERLAP':'')+'_PASS');
 }
}finally{
 if(settings==='')sql(`DELETE FROM public.club_settings WHERE club_id='${f.club}';`);
 else sql(`UPDATE public.club_settings SET player_history_enabled=${settings==='t'?'true':'false'} WHERE club_id='${f.club}';`);
 assert.equal(sql(`SELECT player_history_enabled FROM public.club_settings WHERE club_id='${f.club}';`),settings);
}
