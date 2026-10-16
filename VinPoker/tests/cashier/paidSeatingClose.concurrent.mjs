import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createPaidJourneyFixture} from './paidJourney.fixture.mjs';
const database='vinpoker_ops_cash115_qualified_c';
assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.PGPORT,'55441');
assert.equal(process.env.PGUSER,'postgres');assert.equal(process.env.PGDATABASE,database);
for(const key of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert.ok(!process.env[key]);
const prefix=process.platform==='win32'?['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${database}`,'psql']:[];
const binary=prefix.length?'wsl':'psql',flags=['-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync(binary,[...prefix,...flags],{input:q,encoding:'utf8',timeout:20000}).trim();
const parse=out=>JSON.parse(out.split('\n').find(line=>line.startsWith('{')));
function tx(name,query,hold){const child=spawn(binary,[...prefix,...flags]);let out='',error='';
 const result=new Promise(resolve=>{child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>error+=c);child.on('close',code=>resolve({code,out,error}));child.on('error',e=>resolve({code:-1,out,error:String(e)}));});
 const end=command=>{if(!child.stdin.writableEnded)child.stdin.end(command+';\n');};
 child.stdin.write(`SET application_name='${name}';BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL idle_in_transaction_session_timeout='15s';${query}\n`);
 if(!hold)end('COMMIT');return {result,end};}
async function barrier(name,condition){for(let i=0;i<100;i++){if(sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND ${condition});`)==='t')return;await new Promise(done=>setTimeout(done,25));}assert.fail('actual lock barrier absent: '+name);}
for(const first of process.argv.includes('--seat-first-only')?['seat']:['close','seat']){
 const f=createPaidJourneyFixture(sql);
 const claims=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';`;
 const auth=claims+'SET LOCAL ROLE authenticated;';
 const invoke=q=>parse(sql(`BEGIN;${q}COMMIT;`));
 const originalSession=JSON.parse(sql(`SELECT to_jsonb(x) FROM public.table_sessions x JOIN public.tournament_seats s ON s.table_session_id=x.id WHERE s.entry_id='${f.entry}' AND s.is_active;`));
 assert.equal(invoke(auth+`SELECT public.floor_bust_player_v3('${f.entry}',${originalSession.revision},${originalSession.control_epoch},20000,gen_random_uuid(),'paid_close_overlap_TEST');`).ok,true);
 const tables=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('id',t.id,'physical',t.game_table_id,'session',s.id,'revision',s.revision) ORDER BY t.table_number) FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id='${f.tour}' AND t.status='active';`));
 assert.equal(tables.length,2);
 for(const table of tables)assert.equal(invoke(auth+`SELECT public.close_tournament_table_v4('${table.id}',${table.revision},gen_random_uuid());`).ok,true);
 const player=randomUUID();sql(`INSERT INTO auth.users(id) VALUES('${player}');`);
 const registration=invoke(`SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL ROLE service_role;SELECT public.cashier_create_app_registration_v1('${f.tour}','${player}');`);
 assert.equal(registration.ok,true);const reg=registration.registration_id;
 const intent={actor_id:f.actor,club_id:f.club,tournament_id:f.tour,registration_id:reg,amount:100000,request_id:randomUUID()};
 const paid=invoke(auth+`SELECT public.resolve_cashier_cash_buyin_intent_v1('${JSON.stringify(intent)}'::jsonb,'record');`);
 assert.equal(paid.status,'recorded');assert.equal(paid.result.seating_state,'waiting');
 const money=()=>sql(`SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE registration_id='${reg}';`);
 const committedMoney=money();
 const opened=invoke(auth+`SELECT public.floor_open_tournament_table_v3('${f.tour}','${tables[0].physical}','manual',gen_random_uuid());`);assert.equal(opened.ok,true);
 const current=JSON.parse(sql(`SELECT jsonb_build_object('id',t.id,'session',s.id,'revision',s.revision) FROM public.tournament_tables t JOIN public.table_sessions s ON s.id=t.table_session_id WHERE t.tournament_id='${f.tour}' AND t.status='active';`));
 assert.notEqual(current.session,tables[0].session);
 const commands={close:auth+`SELECT public.close_tournament_table_v4('${current.id}',${current.revision},gen_random_uuid());`,
  // Internal exact-target worker core, not a browser-granted/global scheduler endpoint.
  seat:claims+`SELECT public.cashier_try_seat_paid_v1('${reg}','${f.actor}');`};
 const second=first==='close'?'seat':'close',suffix=randomUUID().slice(0,8),hname='paid_close_h_'+suffix,wname='paid_close_w_'+suffix;
 let holder,waiter;
 try{
  holder=tx(hname,commands[first],true);await barrier(hname,"wait_event='ClientRead' AND xact_start IS NOT NULL");
  waiter=tx(wname,commands[second],false);await barrier(wname,"wait_event_type='Lock'");
  holder.end('COMMIT');const h=await holder.result,w=await waiter.result;assert.equal(h.code,0,h.error);assert.equal(w.code,0,w.error);
  const results={[first]:parse(h.out),[second]:parse(w.out)};
  if(first==='close'){
   assert.equal(results.close.ok,true);assert.equal(results.seat.seating_state,'waiting');
   assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE registration_id='${reg}';`),'0');
   assert.equal(sql(`SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id='${current.session}';`),'t');
  }else{
   assert.equal(results.seat.seating_state,'seated');assert.equal(results.close.ok,false);
   assert.equal(sql(`SELECT closed_at IS NULL FROM public.table_sessions WHERE id='${current.session}';`),'t');
   assert.equal(sql(`SELECT count(*) FROM public.tournament_entries e JOIN public.tournament_seats s ON s.entry_id=e.id AND s.is_active WHERE e.registration_id='${reg}' AND s.table_session_id='${current.session}' AND s.chip_count=20000;`),'1');
   const revision=sql(`SELECT revision FROM public.table_sessions WHERE id='${current.session}';`);
   const freshClose=invoke(auth+`SELECT public.close_tournament_table_v4('${current.id}',${revision},gen_random_uuid());`);
   assert.equal(freshClose.error,'table_not_empty','fresh revision must still refuse occupied table, not merely reject stale CAS');
  }
  assert.equal(money(),committedMoney,'lifecycle race never changes committed payment');
  console.log('PAID_SEATING_CLOSE_TRUE_OVERLAP_'+first.toUpperCase()+'_FIRST_PASS');
 }finally{holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);}
}
