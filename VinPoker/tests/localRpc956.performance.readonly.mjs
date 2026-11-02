import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';

// Native execution diagnostics, never a browser/HTTP or complete R13 verdict.
assert.equal(process.env.VINPOKER_RPC956_LOCAL,'1');
const base=['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres','PGDATABASE=vinpoker_ranking860_local','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=input=>execFileSync('wsl',base,{input,encoding:'utf8',timeout:30000,maxBuffer:4e6}).trim();
assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ranking860_local|127.0.0.1|55441');
assert.equal(sql("SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database();"),'VINPOKER_RANKING860_OWNED_LOCAL_SOURCE_vinpoker_ops_cash115_qualified_c_HEAD_ef6a26948');
assert.equal(sql("SELECT count(*) FROM pg_extension WHERE extname IN ('pg_net','pg_cron','dblink');"),'0');
const tour='46cab483-91e7-4220-aacf-e17bdf05269c',club='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor='675fe35e-60a8-4452-bb90-e79486d54da6';
const tables=['tournaments','tournament_entries','tournament_seats','tournament_hands','cashier_buyin_movements','tournament_prize_payments','dealer_attendance','tournament_close_report'];
const fingerprint=()=>sql(`BEGIN READ ONLY;SELECT md5(jsonb_build_array(${tables.map(t=>`(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') FROM public.${t} x)`).join(',')})::text);ROLLBACK;`);
const before=fingerprint();
const context=JSON.parse(sql(`BEGIN READ ONLY;SELECT jsonb_build_object('tour',(SELECT to_jsonb(t) FROM tournaments t WHERE id='${tour}'),'activeSeats',(SELECT count(*) FROM tournament_seats WHERE tournament_id='${tour}' AND is_active),'autoSwing',(SELECT auto_swing_enabled FROM club_settings WHERE club_id='${club}'));ROLLBACK;`));
assert.ok(context.tour);assert.equal(context.tour.club_id,club);assert.equal(context.autoSwing,false);
const claims=JSON.stringify({sub:actor,role:'authenticated'});
const prefix=`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='${claims}';SET LOCAL ROLE authenticated;`;
const cases=[
 ['Floor',`get_floor_tournament_table_inventory_v1('${tour}')`],
 ['Tracker',`get_tracker_hand_input_tables_v4('${tour}')`],
 ['Cashier',`get_tournament_payout_recipients('${tour}')`],
 ['Chip',`get_current_chip_inventory('${tour}')`],
 ['Swing',`get_dealer_swing_health(ARRAY['${club}'::uuid])`],
];
const result={kind:'NATIVE_PG_READ_ONLY_EXECUTION_DIAGNOSTIC_NOT_HTTP_BROWSER_R13_ACCEPTANCE',fixture:{tour,club,actor},context,clock:'PostgreSQL EXPLAIN ANALYZE Execution Time (milliseconds)',warmupPerCase:1,samplesPerCase:20,measurements:[],protectedBefore:before};
try{
 for(const [module,expression] of cases){
  const warmup=JSON.parse(sql(`${prefix}SELECT coalesce(jsonb_agg(value),'[]'::jsonb) FROM (SELECT to_jsonb(${expression}) value) q;ROLLBACK;`));
  const measurement={module,expression,warmup,samples:[]};result.measurements.push(measurement);
  for(let i=0;i<20;i++){
   const start=performance.now();
   try{
    const plan=JSON.parse(sql(`${prefix}EXPLAIN (ANALYZE,FORMAT JSON,TIMING OFF) SELECT ${expression};ROLLBACK;`))[0];
    assert.ok(Number.isFinite(plan['Execution Time']));
    measurement.samples.push({index:i+1,serverMs:plan['Execution Time'],planningMs:plan['Planning Time'],processRoundTripMs:Math.round((performance.now()-start)*100)/100,error:null});
   }catch(error){measurement.samples.push({index:i+1,error:error.code??error.name,processRoundTripMs:Math.round((performance.now()-start)*100)/100});}
  }
  const valid=measurement.samples.filter(s=>s.error===null).map(s=>s.serverMs).sort((a,b)=>a-b);
  measurement.errors=20-valid.length;measurement.p95ServerMs=valid.length===20?valid[18]:null;
  console.log('RPC956_CASE',JSON.stringify({module,errors:measurement.errors,p95ServerMs:measurement.p95ServerMs}));
 }
}finally{
 result.protectedAfter=fingerprint();result.unchanged=result.protectedAfter===before;
 writeFileSync('D:/Quy trình/output/reports/rpc956-native-read-performance-local-20261027.json',JSON.stringify(result,null,2)+'\n');
 assert.equal(result.unchanged,true,'native read changed protected facts');
}
assert.ok(result.measurements.every(m=>m.errors===0));
console.log('RPC956_NATIVE_EXECUTION_MEASURED_PROTECTED_FACTS_UNCHANGED');
