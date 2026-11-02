// Privileged maintenance-trigger race, not a canonical gameplay transition.
// Commits a NEW owned local fixture and retains it; never reset or reuse output.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
const report=process.argv[2];
assert.ok(report,'Provide a new local output JSON path');
assert.equal(existsSync(report),false,'inspect retained fixture; do not duplicate');
const args=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55442','PGUSER=postgres','PGDATABASE=vinpoker_ops_guard_main_20261028_v2','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=input=>execFileSync('wsl',args,{input,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
const src=readFileSync(new URL('./actionGuards.reviewedSchema.local.pg17.sql',import.meta.url),'utf8').replaceAll('\r','');
const cut=src.indexOf(' -- Qualify stack189');assert.ok(cut>0);
const setup=src.slice(0,cut)+`
 r:=public.record_action(hand,actors[3],'bet',3,entries[3],'preflop',3000);ASSERT r->>'status'='success',r::text;
 PERFORM set_config('role','none',true);
 target_hand:=gen_random_uuid();
 INSERT INTO public.tournament_hands
 SELECT (jsonb_populate_record(NULL::public.tournament_hands,to_jsonb(h)||jsonb_build_object('id',target_hand,'hand_number',1001,'status','completed'))).*
 FROM public.tournament_hands h WHERE h.id=hand;
 INSERT INTO public.hand_players
 SELECT (jsonb_populate_record(NULL::public.hand_players,to_jsonb(hp)||jsonb_build_object('id',gen_random_uuid(),'hand_id',target_hand))).*
 FROM public.hand_players hp WHERE hp.hand_id=hand;
 INSERT INTO public.hand_actions(hand_id,player_id,entry_number,action_type,action_amount,action_order,street)
 VALUES(target_hand,actors[3],entries[3],'bet',4000,10,'flop');
 PERFORM set_config('test.reparent_race',jsonb_build_object('hand',hand,'target',target_hand,'tour',tour,'player',actors[3],'entry',entries[3],
 'actions',(SELECT jsonb_agg(jsonb_build_object('id',id,'hand',hand_id,'amount',action_amount) ORDER BY hand_id) FROM public.hand_actions WHERE player_id=actors[3] AND hand_id IN(hand,target_hand)))::text,true);
END $$;SELECT current_setting('test.reparent_race');COMMIT;`;
const fixture=JSON.parse(sql(setup));
const state={kind:'PRIVILEGED_TWO_EXISTING_PARENT_REVERSE_REPARENT_LOCAL_RACE',fixture,phase:'FIXTURE_COMMITTED',limits:['Synthetic completed destination hand; not an operational hand transition','No hosted Auth, production write or whole-tour acceptance','Committed local fixture retained; do not rerun initializer']};
const save=()=>writeFileSync(report,JSON.stringify(state,null,2)+'\n');save();
assert.equal(fixture.actions.length,2);
const [low,high]=fixture.actions;
const worker=()=>{
 const child=spawn('wsl',args,{stdio:['pipe','pipe','pipe']});let output='',error='';
 child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>error+=c);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve(output):reject(Error(error)));});
 // Attach rejection handler immediately, while lock evidence is being collected.
 done.catch(()=>{});
 return {child,done,output:()=>output};
};
const wait=async(check,label)=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,100));}throw Error('timeout '+label);};
const first=worker();let second,released=false;
try{
 first.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL application_name='stack189-reparent-high';UPDATE public.hand_actions SET hand_id='${low.hand}' WHERE id='${high.id}';SELECT 'REPARENT_HIGH_STAGED';\n`);
 await wait(()=>first.output().includes('REPARENT_HIGH_STAGED'),'high to low staged');
 second=worker();second.child.stdin.end(`BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL application_name='stack189-reparent-low';UPDATE public.hand_actions SET hand_id='${high.hand}' WHERE id='${low.id}';COMMIT;SELECT 'REPARENT_LOW_COMMITTED';\n`);
 await wait(()=>sql(`SELECT count(*) FROM pg_stat_activity w JOIN pg_stat_activity h ON h.pid=ANY(pg_blocking_pids(w.pid)) WHERE w.application_name='stack189-reparent-low' AND h.application_name='stack189-reparent-high' AND w.wait_event_type='Lock';`)==='1','reverse reparent parent lock overlap');
 state.actualLockOverlap=true;save();first.child.stdin.end('COMMIT;SELECT \'REPARENT_HIGH_COMMITTED\';\n');released=true;
 const raw=await Promise.all([first.done,second.done]);
 assert.ok(raw[0].includes('REPARENT_HIGH_COMMITTED'));assert.ok(raw[1].includes('REPARENT_LOW_COMMITTED'));
 state.native=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object(
 'actions',(SELECT jsonb_agg(jsonb_build_object('id',id,'hand',hand_id,'amount',action_amount) ORDER BY id) FROM public.hand_actions WHERE id IN('${low.id}','${high.id}')),
 'actionCount',(SELECT count(*) FROM public.hand_actions WHERE hand_id IN('${low.hand}','${high.hand}')),
 'contributions',(SELECT sum(action_amount) FROM public.hand_actions WHERE hand_id IN('${low.hand}','${high.hand}') AND player_id='${fixture.player}'),
 'seats',(SELECT count(*) FROM public.tournament_seats WHERE tournament_id='${fixture.tour}' AND is_active),
 'chips',(SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${fixture.tour}' AND is_active),
 'settlements',(SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id IN('${low.hand}','${high.hand}')),
 'overBudget',(SELECT count(*) FROM (SELECT a.hand_id,a.player_id,a.entry_number FROM public.hand_actions a JOIN public.hand_players hp ON hp.hand_id=a.hand_id AND hp.player_id=a.player_id AND hp.entry_number=a.entry_number WHERE a.hand_id IN('${low.hand}','${high.hand}') GROUP BY a.hand_id,a.player_id,a.entry_number,hp.starting_stack HAVING sum(a.action_amount)>hp.starting_stack) x));ROLLBACK;`));
 assert.deepEqual(state.native.actions,[{id:low.id,hand:high.hand,amount:low.amount},{id:high.id,hand:low.hand,amount:high.amount}].sort((a,b)=>a.id.localeCompare(b.id)));
 assert.equal(state.native.actionCount,4);assert.equal(state.native.contributions,7000);assert.equal(state.native.seats,3);assert.equal(state.native.chips,60000);assert.equal(state.native.settlements,0);assert.equal(state.native.overBudget,0);
 state.phase='REVERSE_REPARENT_SERIALIZES_BOTH_COMMITS_NO_BUDGET_VIOLATION_PASS';save();console.log(JSON.stringify(state));
}catch(error){state.phase='FAILED_RETAINED_FIXTURE';state.error=String(error);save();throw error;}
finally{if(!released&&!first.child.stdin.destroyed)first.child.stdin.end('ROLLBACK;\n');if(second&&!second.child.stdin.destroyed)second.child.stdin.end('ROLLBACK;\n');}
