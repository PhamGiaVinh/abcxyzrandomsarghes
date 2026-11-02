import assert from 'node:assert/strict';

const READ_NAMES=new Set(['get_tournament_clock','get_public_tournament_clock_summary','get_public_tournament_table_live_or_last_hand_v2',
 'get_public_tournament_table_history_v2','get_public_tournament_table_hand_v2','get_floor_tournament_table_inventory_v1',
 'get_floor_tournament_table_roster_v6','get_current_chip_inventory','get_chip_bank','get_dealer_swing_health','get_tournament_payout_recipients']);

export async function measureLocalReadCases147(cases,headers={}){
 const measurements=[];
 for(const c of cases){
  assert.ok(READ_NAMES.has(c.name),'measurement only supports explicit read RPCs');
  const samples=[];
  for(let i=0;i<20;i++){
   const start=performance.now();let status=null,error=null;
   try{
    const response=await fetch(`http://127.0.0.1:54329/rest/v1/rpc/${c.name}`,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(c.body),signal:AbortSignal.timeout(10000)});
    status=response.status;assert.equal(status,200);c.check(await response.json());
   }catch(e){error=e instanceof Error?e.name:'unknown';}
   samples.push({index:i+1,ms:Math.round((performance.now()-start)*100)/100,status,error});
  }
  const durations=samples.map(s=>s.ms).sort((a,b)=>a-b);
  measurements.push({rpc:c.name,samples,p95Ms:durations[18],success:samples.filter(s=>s.error===null).length});
 }
 return measurements;
}

// Sequential read-only transport measurement. Never accept a URL or writer name.
export async function runLocalReadTransport147({sql}){
 assert.equal(process.env.VINPOKER_NATIVE_PAYOUT,'1');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 const tour='46cab483-91e7-4220-aacf-e17bdf05269c',table='d294f4a4-082b-4efc-a6ca-1f96579ea344',hand='4aa376ee-4a27-4963-9c69-dd0a2cd17abf';
 const manifest=await fetch('http://127.0.0.1:54329/__local/manifest',{signal:AbortSignal.timeout(10000)}).then(r=>{assert.equal(r.status,200);return r.json()});
 assert.equal(manifest.tour,tour);assert.equal(manifest.historyTable.id,table);
 assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE id='${hand}' AND source_revision=24 AND status='completed';`),'1');
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('tour',(SELECT to_jsonb(t) FROM public.tournaments t WHERE id='${tour}'),
 'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id='${tour}'),
 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${tour}'),
 'entries',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.tournament_entries e WHERE tournament_id='${tour}'),
 'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${tour}'),
 'outcomes',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_settlement_outcomes o WHERE tournament_id='${tour}'))::text);`);
 const before=fingerprint();
 const cases=[
  {name:'get_tournament_clock',body:{p_tournament_id:tour},check:v=>assert.equal(v.tournament_id,tour)},
  {name:'get_public_tournament_clock_summary',body:{p_tournament_id:tour},check:v=>{assert.equal(v.length,1);assert.equal(v[0].tournament_id,tour)}},
  {name:'get_public_tournament_table_live_or_last_hand_v2',body:{p_tournament_id:tour,p_tournament_table_id:table},check:v=>{assert.equal(v.access,'public');assert.equal(v.tableId,table)}},
  {name:'get_public_tournament_table_history_v2',body:{p_tournament_id:tour,p_tournament_table_id:table,p_limit:20,p_before_created_at:null,p_before_id:null},check:v=>{assert.equal(v.access,'public');const row=v.items.find(x=>x.handId===hand);assert.ok(row);assert.equal(row.result.status,'verified')}},
  {name:'get_public_tournament_table_hand_v2',body:{p_tournament_id:tour,p_tournament_table_id:table,p_hand_id:hand},check:v=>{assert.equal(v.id,hand);assert.equal(v.bigBlind,200);assert.deepEqual(v.board,['2c','3d','7s','9c','Kc'])}},
 ];
 let measurements;
 try{
  measurements=await measureLocalReadCases147(cases);
 }finally{assert.equal(fingerprint(),before,'read measurements changed retained journey facts');}
 const result={kind:'LOCAL_HTTP_BRIDGE_REAL_ANON_PG_NOT_HOSTED_OR_UI_NAVIGATION',runId:manifest.runId,tour,table,hand,requests:100,sequential:true,measurements};
 console.log('READ147_RAW',JSON.stringify(result));
 assert.ok(measurements.every(m=>m.success===20),'every read sample must pass its response contract');
 console.log(measurements.every(m=>m.p95Ms<=1000)?'READ147_LOCAL_HTTP_P95_UNDER_1S_NO_DELTA_PASS':'READ147_LOCAL_HTTP_P95_TARGET_MISSED');
}
