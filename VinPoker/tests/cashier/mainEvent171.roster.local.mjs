import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {runRegisterBrowserEdge} from './registerBrowserEdge.local.mjs';

// Extend the SAME linked journey; only Auth/profile metadata is synthetic.
// Entry, price, money, seating and receipts are canonical product RPC results.
assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
const flightA=process.env.VINPOKER_MAIN180_ROSTER==='1';
assert.ok(flightA?process.env.VINPOKER_MAIN171_ROSTER!=='1':process.env.VINPOKER_MAIN171_ROSTER==='1');
const tour=flightA?'782a5196-5ea1-44ed-8a27-1b872d5f88d9':'fdf91018-09f3-4cdc-b76a-f688eb216cee';
const club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760';
const actor='675fe35e-60a8-4452-bb90-e79486d54da6',event='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';
const sql=input=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441',
 'PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],
 {input,encoding:'utf8',timeout:30000,maxBuffer:2e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournaments t JOIN public.tournament_events e ON e.id=t.event_id
 JOIN public.clubs c ON c.id=t.club_id JOIN public.club_settings cs ON cs.club_id=c.id
 WHERE t.id='${tour}' AND t.club_id='${club}' AND e.id='${event}' AND e.name='Main Event browser local TEST 164'
 AND c.owner_id='${actor}' AND t.phase='flight' AND t.status='active' AND NOT cs.auto_swing_enabled
 AND t.buy_in=100000 AND t.rake_amount=10000 AND t.service_fee_amount=5000);`),'t');
assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_seats
 WHERE id='${flightA?'aceae78c-70f7-4464-9899-dbf75cbd2070':'8cce3f07-76c7-4249-b8c5-af1473cd0bfa'}'
 AND tournament_id='${tour}' AND entry_id='${flightA?'0c1a0382-3437-437d-a5f2-74b8206a8dce':'b15a5fa6-9934-48ce-8517-fe5a25f3c72a'}'
 AND chip_count=20000 AND is_active);`),'t');
if(flightA){
 assert.equal(sql(`SELECT count(*) FROM public.tournament_registrations WHERE tournament_id='${tour}';`),'1','fresh Flight A roster only');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}';`),'1');
 assert.equal(sql(`SELECT count(*) FROM public.table_sessions WHERE id='0f8ed188-785b-4105-a8c2-6a93f6192f01'
  AND tournament_id='${tour}' AND closed_at IS NULL;`),'1');
}
const protectedState=()=>sql(`SELECT md5(jsonb_build_object(
 'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id<>'${tour}'),
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id<>'${tour}'),
 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id<>'${tour}'),
 'issuance',(SELECT jsonb_agg(to_jsonb(i) ORDER BY stack_template_id) FROM public.stack_template_issuance i),
 'bags',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.chip_bag b),
 'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h)
 )::text);`);
const before=protectedState(),usage=sql("SELECT has_schema_privilege('authenticated','auth','USAGE');");
const query=statement=>JSON.parse(sql(`BEGIN;${usage==='f'?'GRANT USAGE ON SCHEMA auth TO authenticated;':''}
 SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';
 SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
 ${statement}RESET ROLE;${usage==='f'?'REVOKE USAGE ON SCHEMA auth FROM authenticated;':''}COMMIT;`));
const log=[],players=[];
for(let n=1;n<=7;n++){
 const name=`Linked Main Event ${flightA?'180':'171'} TEST player ${n}`;
 const prior=JSON.parse(sql(`SELECT coalesce(jsonb_agg(user_id),'[]') FROM public.profiles WHERE display_name='${name}';`));
 assert.ok(prior.length<=1,'ambiguous TEST profile');
 const player=prior[0]??randomUUID();
 if(!prior.length)sql(`BEGIN;INSERT INTO auth.users(id) VALUES('${player}');
  INSERT INTO public.profiles(user_id,display_name) VALUES('${player}','${name}');COMMIT;`);
 assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM auth.users WHERE id='${player}');`),'t');
 const response=await runRegisterBrowserEdge({body:{tournament_id:tour},fixture:{tour,club},user:{id:player},sql,log});
 assert.equal(response.status,200);const registration=await response.json();
 assert.equal(registration.success,true);assert.equal(registration.total_pay,115000);
 const id=registration.registration_id;assert.match(id,/^[a-f0-9-]{36}$/);
 const hash=createHash('sha256').update(`main${flightA?'180':'171'}:${tour}:${player}`).digest('hex').slice(0,32);
 const key=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;
 const intent={actor_id:actor,club_id:club,tournament_id:tour,registration_id:id,amount:registration.total_pay,request_id:key};
 const call=()=>query(`SELECT public.resolve_cashier_cash_buyin_intent_v1('${JSON.stringify(intent)}'::jsonb,'record');`);
 const paid=call();assert.equal(paid.status,'recorded');assert.equal(paid.result.seating_state,'seated');
 assert.equal(paid.result.starting_stack,20000);assert.equal(paid.result.table_number,1);
 if(n===1)assert.deepEqual(call(),paid,'same key must return frozen payment/seat receipt');
 players.push({player,name,registration:id,request:key,...paid.result});
}
assert.equal(sql(`SELECT count(*)||'|'||sum(amount)||'|'||sum(applied_amount) FROM public.cashier_buyin_movements WHERE tournament_id='${tour}';`),'8|920000|920000');
assert.equal(sql(`SELECT count(*)||'|'||sum(current_stack)||'|'||count(DISTINCT player_id) FROM public.tournament_entries WHERE tournament_id='${tour}' AND status='seated';`),'8|160000|8');
assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count)||'|'||count(DISTINCT seat_number) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active;`),'8|160000|8');
assert.equal(protectedState(),before,'other tours and denomination issuance must not change');
console.log(flightA?'LOCAL_MAIN180_FLIGHT_A_SEVEN_EDGE_CANONICAL_PAID_SEATS_PASS':'LOCAL_MAIN171_SEVEN_EDGE_REGISTRATIONS_CANONICAL_CASH_SEATS_PASS',JSON.stringify({tour,players,protectedFingerprint:before,authTransportModeled:true,notSevenBrowserClicks:true}));
