import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const report=process.argv[2];assert.ok(report,'Provide a new local output JSON path');assert.equal(existsSync(report),false,'inspect retained fixture; do not duplicate');
const mode=process.argv[3]??'insert';assert.ok(['insert','update'].includes(mode));const update=mode==='update';
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_decided_action_20261028','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('wsl',args,{input:q,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
const src=readFileSync(new URL('./decidedHandActionGuard.local.pg17.sql',import.meta.url),'utf8').replaceAll('\r','');
const cut=src.indexOf(' -- Qualify stack189');assert.ok(cut>0);
const setup=src.slice(0,cut)+(update?`r:=public.record_action(hand,actors[3],'bet',3,entries[3],'preflop',4000);ASSERT r->>'status'='success',r::text;`:'')+`PERFORM set_config('test.decided_race',jsonb_build_object('hand',hand,'tour',tour,'actor',actor,'actors',actors,'entries',entries)::text,true);END $$;SELECT current_setting('test.decided_race');COMMIT;`;
const f=JSON.parse(sql(setup));const state={kind:'ACTUAL_TWO_CONNECTION_ROW_LOCK_RACE_OWNED_FORK_NOT_FULL_ACCEPTANCE',fixture:f,phase:'FIXTURE_COMMITTED'};const save=()=>writeFileSync(report,JSON.stringify(state,null,2)+'\n');save();
const auth=`SET LOCAL request.jwt.claim.sub='${f.actor}';SET LOCAL request.jwt.claims='{"role":"authenticated","sub":"${f.actor}"}';SET LOCAL ROLE authenticated;`;
const worker=()=>{const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let output='',error='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>error+=c);const done=new Promise((resolve,reject)=>child.on('exit',code=>code===0?resolve(output):reject(Error(error))));return {child,done,output:()=>output};};
const wait=async(check,label)=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,100));}throw Error('timeout '+label);};
const first=worker();let second,released=false;
try{
 const request1=randomUUID(),request2=randomUUID();
 state.mode=mode;save();
 first.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL application_name='stack189-first';${auth}SELECT public.record_action('${f.hand}','${f.actors[2]}','bet',${update?4:3},${f.entries[2]},'preflop',${update?10000:12000},'${request1}');SELECT 'DECIDED_FIRST_STAGED';\n`);
 await wait(()=>first.output().includes('DECIDED_FIRST_STAGED'),'first staged');
 const secondQuery=update?`DO $$ BEGIN
   UPDATE public.hand_actions SET action_amount=11000 WHERE hand_id='${f.hand}' AND action_order=3;
   RAISE EXCEPTION 'concurrent_update_over_stack_accepted';
   EXCEPTION WHEN check_violation THEN ASSERT SQLERRM='tracker_action_stack_exceeded',SQLERRM;END $$;
   SELECT jsonb_build_object('error','tracker_action_stack_exceeded');`
  :`SELECT public.record_action('${f.hand}','${f.actors[2]}','bet',4,${f.entries[2]},'flop',9000,'${request2}');`;
 second=worker();second.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL application_name='stack189-second';${auth}${secondQuery}COMMIT;\n`);
 await wait(()=>sql(`SELECT count(*) FROM pg_stat_activity w JOIN pg_stat_activity h ON h.pid=ANY(pg_blocking_pids(w.pid)) WHERE w.application_name='stack189-second' AND h.application_name='stack189-first' AND w.wait_event_type='Lock';`)==='1','observed native row lock');
 state.actualLockOverlap=true;save();first.child.stdin.end('COMMIT;\n');released=true;
 const raw=await Promise.all([first.done,second.done]);state.responses=raw.map(v=>JSON.parse(v.split(/\r?\n/).find(x=>x.startsWith('{'))));save();
 assert.equal(state.responses[0].status,'success');assert.equal(state.responses[1].error,'tracker_action_stack_exceeded');
 state.native=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('actions',(SELECT count(*) FROM public.hand_actions WHERE hand_id='${f.hand}'),'folds',(SELECT count(*) FROM public.hand_actions WHERE hand_id='${f.hand}' AND action_type='fold'),'live',(SELECT count(*) FROM public.hand_players hp WHERE hp.hand_id='${f.hand}' AND NOT EXISTS(SELECT 1 FROM public.hand_actions a WHERE a.hand_id=hp.hand_id AND a.player_id=hp.player_id AND a.entry_number=hp.entry_number AND a.action_type='fold')),'seats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active),'chips',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${f.tour}' AND is_active),'settlements',(SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${f.hand}'));ROLLBACK;`));
 assert.deepEqual(state.native,{actions:update?4:3,folds:0,live:3,seats:3,chips:60000,settlements:0});state.playerCommitted=Number(sql("SELECT sum(action_amount) FROM public.hand_actions WHERE hand_id='"+f.hand+"' AND player_id='"+f.actors[2]+"' AND entry_number="+f.entries[2]+";"));assert.equal(state.playerCommitted,update?14000:12000);state.phase='NATIVE_CONCURRENT_STACK_BUDGET_RECHECK_PASS';save();console.log(JSON.stringify({phase:state.phase,mode,actualLockOverlap:state.actualLockOverlap,responses:state.responses,native:state.native}));
}catch(error){state.error=String(error);state.phase='FAILED_RETAINED_FIXTURE';save();throw error;}finally{if(!released&&!first.child.stdin.destroyed)first.child.stdin.end('ROLLBACK;\n');if(second&&!second.child.stdin.destroyed)second.child.stdin.end('ROLLBACK;\n');}
