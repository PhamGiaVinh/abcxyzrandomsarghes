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
for(const first of process.argv.includes('--reentry-first-only')?['reentry']:['reentry','restore']){
 const f=createPaidJourneyFixture(sql),claims=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';`,auth=claims+'SET LOCAL ROLE authenticated;';
 const invoke=q=>parse(sql(`BEGIN;${q}COMMIT;`));
 const original=JSON.parse(sql(`SELECT jsonb_build_object('session',x.id,'revision',x.revision,'epoch',x.control_epoch,'table',s.tournament_table_id,'seat',s.seat_number) FROM public.table_sessions x JOIN public.tournament_seats s ON s.table_session_id=x.id WHERE s.entry_id='${f.entry}' AND s.is_active;`));
 assert.equal(invoke(auth+`SELECT public.floor_bust_player_v3('${f.entry}',${original.revision},${original.epoch},20000,gen_random_uuid(),'restore_reentry_overlap_TEST');`).ok,true);
 const revision=sql(`SELECT revision FROM public.table_sessions WHERE id='${original.session}';`);
 const money=()=>sql(`SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${f.tour}';`),paid=money();
 const commands={restore:auth+`SELECT public.floor_restore_busted_player_to_seat_v5('${f.entry}','${original.table}',${original.seat},${revision},${original.epoch},gen_random_uuid(),'${original.session}');`,
  reentry:`SET LOCAL request.jwt.claims='{"role":"service_role"}';SET LOCAL request.jwt.claim.role='service_role';SET LOCAL ROLE service_role;SELECT public.cashier_create_app_reentry_v1('${f.tour}','${f.player}');`};
 const second=first==='restore'?'reentry':'restore',suffix=randomUUID().slice(0,8),hname='restore_reentry_h_'+suffix,wname='restore_reentry_w_'+suffix;
 let holder,waiter;
 try{
  holder=tx(hname,commands[first],true);await barrier(hname,"wait_event='ClientRead' AND xact_start IS NOT NULL");
  waiter=tx(wname,commands[second],false);await barrier(wname,"wait_event_type='Lock'");
  holder.end('COMMIT');const h=await holder.result,w=await waiter.result;assert.equal(h.code,0,h.error);assert.equal(w.code,0,w.error);
  const result={[first]:parse(h.out),[second]:parse(w.out)};
  if(first==='reentry'){
   assert.equal(result.reentry.ok,true);assert.equal(result.restore.error,'restore_reentry_dependency','pending priced re-entry must not coexist with restored old entry');
   assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE entry_id='${f.entry}' AND is_active;`),'0');
  }else{
   assert.equal(result.restore.ok,true);assert.equal(result.reentry.error,'entry_not_reenterable');
   assert.equal(sql(`SELECT count(*) FROM public.tournament_registrations WHERE source_entry_id='${f.entry}';`),'0');
   assert.equal(sql(`SELECT count(*) FROM public.tournament_seats WHERE entry_id='${f.entry}' AND is_active AND chip_count=20000;`),'1');
  }
  assert.equal(money(),paid,'restore/registration race cannot change paid ledger');
  console.log('RESTORE_REENTRY_TRUE_OVERLAP_'+first.toUpperCase()+'_FIRST_PASS');
 }finally{holder?.end('ROLLBACK');waiter?.end('ROLLBACK');await Promise.all([holder?.result,waiter?.result]);}
}
