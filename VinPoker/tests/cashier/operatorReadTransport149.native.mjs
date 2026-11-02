import assert from 'node:assert/strict';
import {measureLocalReadCases147} from './localReadTransport147.native.mjs';

export async function runOperatorReadTransport149({sql}){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 const tour='46cab483-91e7-4220-aacf-e17bdf05269c',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',table='d294f4a4-082b-4efc-a6ca-1f96579ea344';
 const base='http://127.0.0.1:54329';
 const manifest=await fetch(base+'/__local/manifest',{signal:AbortSignal.timeout(10000)}).then(r=>{assert.equal(r.status,200);return r.json()});
 assert.equal(manifest.tour,tour);assert.equal(manifest.club,club);assert.equal(manifest.actor,'675fe35e-60a8-4452-bb90-e79486d54da6');
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
  'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id='${tour}'),
  'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${tour}'),
  'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${tour}'),
  'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${tour}'),
  'bank',(SELECT jsonb_agg(to_jsonb(b) ORDER BY to_jsonb(b)::text) FROM public.chip_bank b),
  'bankLedger',(SELECT jsonb_agg(to_jsonb(b) ORDER BY to_jsonb(b)::text) FROM public.chip_bank_ledger b),
  'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_attendance a),
  'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.dealer_assignments a))::text);`);
 const before=fingerprint();let measurements;
 try{
  const denied=await fetch(base+'/rest/v1/rpc/get_floor_tournament_table_roster_v6',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({p_tournament_id:tour}),signal:AbortSignal.timeout(10000)});
  assert.equal(denied.status,401);
  const login=await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'native-owner@test.invalid',password:'LOCAL_TEST_ONLY'}),signal:AbortSignal.timeout(10000)});
  assert.equal(login.status,200);const credentials=await login.json();assert.equal(credentials.user.id,manifest.actor);assert.equal(typeof credentials.access_token,'string');
  const count=n=>assert.ok(Number.isSafeInteger(n)&&n>=0);
  measurements=await measureLocalReadCases147([
   {name:'get_floor_tournament_table_inventory_v1',body:{p_tournament_id:tour},check:v=>{assert.ok(Array.isArray(v));assert.equal(new Set(v.map(x=>x.game_table_id)).size,v.length);assert.equal(v.filter(x=>x.tournament_table_id===table&&x.table_session_id==='ee2b9393-0c96-42f9-8667-7f306edeb9bc').length,1)}},
   {name:'get_floor_tournament_table_roster_v6',body:{p_tournament_id:tour},check:v=>{assert.ok(Array.isArray(v));assert.ok(v.every(x=>x.tournament_id===tour));const row=v.find(x=>x.tournament_table_id===table);assert.ok(row);assert.deepEqual(row.seats.map(s=>[s.seat_number,s.chip_count]).sort((a,b)=>a[0]-b[0]),[[1,58800],[2,1200]])}},
   {name:'get_current_chip_inventory',body:{p_tournament_id:tour},check:v=>{assert.equal(v.tournament_id,tour);assert.equal(v.reconciled,true);assert.equal(v.total_value,60000);assert.equal(v.issued_total_value+v.ledger_delta_value,v.total_value);assert.ok(v.denominations.every(d=>Number.isSafeInteger(d.current_count)&&d.current_count>=0))}},
   {name:'get_chip_bank',body:{p_club_id:club},check:v=>{assert.equal(v.club_id,club);assert.equal(v.coupling_enabled,false);assert.ok(Array.isArray(v.denominations)&&v.denominations.every(d=>Number.isSafeInteger(d.on_hand_count)&&d.on_hand_count>=0))}},
   {name:'get_dealer_swing_health',body:{p_club_ids:[club]},check:v=>{assert.equal(v.length,1);assert.equal(v[0].club_id,club);assert.equal(typeof v[0].lock.held,'boolean');count(v[0].overdue_now);for(const key of ['pending','processing','failed_recent'])count(v[0].pre_announce[key])}},
   {name:'get_tournament_payout_recipients',body:{p_tournament_id:tour},check:v=>{assert.equal(v.tournamentId,tour);assert.deepEqual(v.places,[]);assert.equal(v.itmPlaces,0);assert.equal(v.totalCount,0);assert.equal(v.paidTotal,0)}},
  ],{authorization:'Bearer '+credentials.access_token});
 }finally{assert.equal(fingerprint(),before,'operator read measurement changed dealer, bank or retained journey facts');}
 console.log('READ149_RAW',JSON.stringify({kind:'LOCAL_AUTH_MODEL_REAL_AUTHENTICATED_PG_NOT_HOSTED_OR_UI_NAVIGATION',runId:manifest.runId,tour,club,requests:120,sequential:true,measurements}));
 assert.ok(measurements.every(m=>m.success===20),'all operator samples must pass their contracts');
 console.log(measurements.every(m=>m.p95Ms<=1000)?'READ149_OPERATOR_HTTP_P95_UNDER_1S_NO_DELTA_PASS':'READ149_OPERATOR_HTTP_P95_TARGET_MISSED');
}
