import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.VINPOKER_PAYOUT703_LOCAL,'1');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',
 'PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=input=>execFileSync('wsl',args,{input,encoding:'utf8',timeout:15000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port()||'|'||current_setting('data_directory');"),
 'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron');"),'0');
assert.equal(sql("SELECT count(*) FROM floor_private.payout703_local_recovery;"),'1');
const actor='40b8f243-bf3b-4aaa-962b-db788380207c';
const ids={tour:randomUUID(),seed:randomUUID(),prize:randomUUID(),replay:randomUUID(),cancelFirst:randomUUID(),saveFirst:randomUUID(),raceA:randomUUID(),raceB:randomUUID()};
console.log('PAYOUT703_SYNTHETIC_METADATA_ONLY_NO_ENTRIES_CASH_PAYMENT_OR_E2E',JSON.stringify(ids));
const protectedFacts=()=>sql(`SELECT md5(jsonb_build_array(
 ${['tournaments','tournament_payout_runs','tournament_prizes','tournament_prize_payments','tournament_entries','cashier_buyin_movements'].map(t=>
 `(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.${t} x WHERE ${t==='tournaments'?'id':'tournament_id'}<>'${ids.tour}')`).join(',')},
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM floor_private.payout_manual_edit_receipts_v1 x WHERE tournament_id<>'${ids.tour}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.notifications x))::text);`);
const before=protectedFacts();
sql(`BEGIN;
 INSERT INTO public.tournaments SELECT (jsonb_populate_record(NULL::public.tournaments,to_jsonb(t)||jsonb_build_object(
 'id','${ids.tour}','name','LOCAL703 synthetic manual payout concurrency TEST','current_players',0,'players_remaining',0,'created_at',now(),'updated_at',now()))).* FROM public.tournaments t WHERE id='6a7fb4a3-8b46-44be-a71a-ca12a052ee08';
 INSERT INTO public.tournament_payout_runs SELECT (jsonb_populate_record(NULL::public.tournament_payout_runs,to_jsonb(r)||jsonb_build_object(
 'id','${ids.seed}','tournament_id','${ids.tour}','entries_snapshot',0,'generated_at',now()))).* FROM public.tournament_payout_runs r WHERE id='379600a2-fd2d-4e6d-8004-b52b3d681740';
 INSERT INTO public.tournament_prizes(id,tournament_id,position,percentage,amount) VALUES('${ids.prize}','${ids.tour}',1,100,300000);
 COMMIT;`);
const sessions=[];
function session(){
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let out='',err='',terminal=false;
 child.stdout.setEncoding('utf8').on('data',s=>{out+=s;});child.stderr.setEncoding('utf8').on('data',s=>{err+=s;});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{terminal=true;code===0?resolve():reject(Error(err));});});done.catch(()=>{});
 const s={child,done,output:()=>out,terminal:()=>terminal,diagnostics:()=>err};sessions.push(s);return s;
}
async function held(s){for(let i=0;i<70&&!s.output().includes('HOLDS703');i++){assert.equal(s.terminal(),false,s.diagnostics());await new Promise(r=>setTimeout(r,100));}assert.ok(s.output().includes('HOLDS703'));}
async function blocked(a,b){let seen=false;for(let i=0;i<70&&!seen;i++){
 seen=sql(`SELECT count(*) FROM pg_stat_activity b WHERE b.application_name='${b}' AND b.wait_event_type='Lock'
 AND EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.application_name='${a}' AND a.pid=ANY(pg_blocking_pids(b.pid)));`)==='1';
 if(!seen)await new Promise(r=>setTimeout(r,100));}assert.ok(seen,'true overlap must be observed in pg_blocking_pids');}
const call=(op,key,run)=>`public.${op==='cancel'?'cancel_tournament_payout_edit_v1':'save_tournament_prizes_v3'}('${ids.tour}','[{"position":1,"amount":300000}]','LOCAL703 same confirmed intent','${run}','${key}','${actor}')`;
const pre=name=>`BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL application_name='${name}';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL ROLE authenticated;`;
const result=s=>JSON.parse(s.output().split(/\r?\n/).find(line=>line.startsWith('{')));
async function pair(label,first,second,expectedError){
 const a=session(),b=session();a.child.stdin.write(`${pre('payout703-'+label+'-A')} SELECT ${first};SELECT 'HOLDS703';\n`);await held(a);
 const statement=expectedError?`DO $$DECLARE denied boolean:=false;BEGIN BEGIN PERFORM ${second};EXCEPTION WHEN OTHERS THEN IF SQLERRM='${expectedError}' THEN denied:=true;ELSE RAISE;END IF;END;ASSERT denied;END $$;SELECT 'EXPECTED_STALE703';`:`SELECT ${second};`;
 b.child.stdin.write(`${pre('payout703-'+label+'-B')} ${statement} COMMIT;\n`);
 await blocked('payout703-'+label+'-A','payout703-'+label+'-B');
 a.child.stdin.end('COMMIT;\n');await a.done;b.child.stdin.end();await b.done;
 if(expectedError)assert.ok(b.output().includes('EXPECTED_STALE703'));else assert.deepEqual(result(a),result(b));
 console.log(`PAYOUT703_TRUE_OVERLAP_${label}_PASS`);return result(a);
}
try{
 const replay=await pair('REPLAY',call('save',ids.replay,ids.seed),call('save',ids.replay,ids.seed));assert.equal(replay.status,'saved');
 const cancelled=await pair('CANCEL_FIRST',call('cancel',ids.cancelFirst,replay.run_id),call('save',ids.cancelFirst,replay.run_id));assert.equal(cancelled.status,'cancelled');
 const saved=await pair('SAVE_FIRST',call('save',ids.saveFirst,replay.run_id),call('cancel',ids.saveFirst,replay.run_id));assert.equal(saved.status,'saved');
 const winner=await pair('DIFFERENT_KEYS_CAS',call('save',ids.raceA,saved.run_id),call('save',ids.raceB,saved.run_id),'PAYOUT_EDIT_STALE_RUN');
 assert.equal(winner.status,'saved');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_payout_runs WHERE tournament_id='${ids.tour}';`),'4');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_payout_runs WHERE tournament_id='${ids.tour}' AND status='applied';`),'1');
 assert.equal(sql(`SELECT count(*) FROM floor_private.payout_manual_edit_receipts_v1 WHERE tournament_id='${ids.tour}';`),'4');
 assert.equal(sql(`SELECT (SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${ids.tour}')+
 (SELECT count(*) FROM public.cashier_buyin_movements WHERE tournament_id='${ids.tour}')+
 (SELECT count(*) FROM public.tournament_prize_payments WHERE tournament_id='${ids.tour}');`),'0');
 assert.equal(protectedFacts(),before);
 for(const file of ['single699.applied-payout.readonly.sql','payout700.recovery.readonly.sql'])console.log(sql(readFileSync(`tests/cashier/${file}`,'utf8')));
 console.log('PAYOUT703_RETAINED_SYNTHETIC_AUDIT_PRIMARY_AND_OTHER_SCOPES_UNCHANGED_PASS');
}finally{
 for(const s of sessions)if(!s.child.stdin.writableEnded)s.child.stdin.end('ROLLBACK;\n');
 await Promise.allSettled(sessions.map(s=>s.done));
 assert.equal(protectedFacts(),before);
}
