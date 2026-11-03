import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {sql,jsonSql} from './nativeDb.mjs';
const tour='10000000-0000-4000-8000-000000000001';
// Synthetic-only rows. No cashier, payments or Telegram exists in this database.
sql(`INSERT INTO public.tournament_prizes(id,tournament_id,position,amount) VALUES(gen_random_uuid(),'${tour}',1,100);
 INSERT INTO public.tournament_eliminations(id,tournament_id) VALUES(gen_random_uuid(),'${tour}');
 INSERT INTO public.tournament_hands(id,tournament_id,tournament_table_id,table_session_id,hand_number,status)
 VALUES('21111111-0000-4000-8000-000000000001','${tour}','50000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',9000000,'in_progress') ON CONFLICT(id) DO NOTHING;`);
const cases=[
 ['tournament_levels',['ranking'],{level_number:100}],['table_sessions',['tables'],{}],['tournament_tables',['tables'],{}],
 ['tournament_seats',['tables','ranking','payout'],{}],['tournament_hands',['tables'],{}],
 ['hand_players',['tables'],{entry_number:100}],['hand_actions',['tables'],{}],
 ['tournament_chip_counts',['tables','ranking'],{entry_number:100}],['tournament_entries',['ranking','payout'],{entry_no:100}],
 ['tournament_prizes',['payout'],{}],['tournament_eliminations',['payout'],{}],
];
const checked=[];
for(const [table,components,overrides] of cases){
 const scope=table==='hand_actions'?`hand_id IN (SELECT id FROM public.tournament_hands WHERE tournament_id='${tour}')`:`tournament_id='${tour}'`;
 const row=jsonSql(`SELECT to_jsonb(r) FROM public.${table} r WHERE ${scope} ORDER BY id LIMIT 1;`);
 if(table==='tournament_hands')row.id='21111111-0000-4000-8000-000000000001';
 const before=()=>`SELECT jsonb_object_agg(component,source_revision) FROM spectator_projection_v2.entity_markers WHERE tournament_id='${tour}' AND entity_key='generation'`;
 for(const op of ['INSERT','UPDATE','DELETE']){
  const values={...row,...overrides,id:'f1111111-0000-4000-8000-000000000001'};
  const mutation=op==='INSERT'?`INSERT INTO public.${table} SELECT (jsonb_populate_record(NULL::public.${table},'${JSON.stringify(values).replaceAll("'","''")}'::jsonb)).*`
   :op==='UPDATE'?`UPDATE public.${table} SET id=id WHERE id='${row.id}'`:`DELETE FROM public.${table} WHERE id='${row.id}'`;
  const rows=sql(`BEGIN;${before()};${mutation};${before()};ROLLBACK;`).split('\n').map(JSON.parse);
  for(const component of components)assert.equal(Number(rows[1][component]),Number(rows[0][component])+1,`${table} ${op} ${component}`);
  checked.push({table,operation:op,components});
 }
}
const report={kind:'REAL_POSTGRESQL_SOURCE_TRIGGER_MATRIX_NOT_WEBSOCKET',checked};
const clock=jsonSql(`BEGIN;DELETE FROM spectator_projection_v2.broadcast_pending_v1;
 UPDATE public.tournaments SET clock_started_at=clock_timestamp() WHERE id='${tour}';
 SELECT jsonb_agg(DISTINCT component ORDER BY component) FROM spectator_projection_v2.broadcast_pending_v1;ROLLBACK;`);
assert.deepEqual(clock,['clock']);checked.push({table:'tournaments',operation:'CLOCK_UPDATE',components:['clock']});
sql("DELETE FROM public.tournament_hands WHERE id='21111111-0000-4000-8000-000000000001';");
writeFileSync('output/hud-scale/source-matrix.json',JSON.stringify(report,null,2));console.log(JSON.stringify({sourceCases:checked.length,passed:true}));
