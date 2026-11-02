import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
assert.equal(process.env.VINPOKER_CHIP1022_LOCAL,'1');
const db='vinpoker_ops_cash115_qualified_c';
const sql=q=>execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',`PGDATABASE=${db}`,'psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{input:`BEGIN READ ONLY;SET LOCAL statement_timeout='10s';${q}ROLLBACK;`,encoding:'utf8',timeout:20000,maxBuffer:4e6}).trim();
const read=q=>JSON.parse(sql(q));
const guard=read("SELECT jsonb_build_object('db',current_database(),'host',host(inet_server_addr()),'port',inet_server_port(),'directory',current_setting('data_directory'),'external',(SELECT count(*) FROM pg_extension WHERE extname IN('pg_net','pg_cron','dblink')));");
assert.deepEqual(guard,{db,host:'127.0.0.1',port:55441,directory:'/tmp/vinpoker-sol-local-20261016-0e79a729/data',external:0});
const tables=['tournaments','tournament_entries','tournament_seats','tournament_tables','table_sessions','tournament_close_report','tournament_prizes','tournament_prize_payments','tournament_chip_counts','seat_draw_receipts','seat_assignment_history','table_operation_receipts','cashier_buyin_movements','dealer_attendance','dealer_assignments','tournament_hands','tournament_settlement_outcomes','multi_day_final_participations_v1','chip_inventory_ledger','chip_bank_ledger'];
const fingerprint=()=>read(`SELECT to_jsonb(md5(jsonb_build_array(${tables.map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')})::text));`);
const result={kind:'ORIGINAL_CHIP_GRAIN_AUDIT_READONLY_NOT_FULL_ACCEPTANCE',guard,tables,before:fingerprint(),journeys:[]};
try{
 for(const [key,tour,actor] of [
 ['single244','c367013a-3ed3-48af-ad48-3915acadc50e','febf2b51-fdb7-42ff-886c-b3bb1fffdc3e'],
 ['main167FlightA','782a5196-5ea1-44ed-8a27-1b872d5f88d9','675fe35e-60a8-4452-bb90-e79486d54da6'],
 ['main167FlightB','fdf91018-09f3-4cdc-b76a-f688eb216cee','675fe35e-60a8-4452-bb90-e79486d54da6'],
 ['main167Final','4cd3af4d-7e1d-4042-855f-04fb6777e580','675fe35e-60a8-4452-bb90-e79486d54da6']]){
 const inventory=read(`SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;SELECT public.get_current_chip_inventory('${tour}');`);
 assert.equal(inventory.tournament_id,tour);
 assert.equal(inventory.total_value,inventory.denominations.reduce((sum,d)=>sum+d.value*d.current_count,0));
 assert.equal(inventory.issued_total_value,inventory.denominations.reduce((sum,d)=>sum+d.value*d.issued_count_total,0));
 assert.equal(inventory.total_value,inventory.issued_total_value+inventory.ledger_delta_value);
 const ledgers=read(`SELECT jsonb_build_object('inventoryRows',(SELECT count(*) FROM public.chip_inventory_ledger WHERE tournament_id='${tour}'),'inventoryByDenomination',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT denomination_id,sum(delta_count) net_delta,count(*) rows FROM public.chip_inventory_ledger WHERE tournament_id='${tour}' GROUP BY denomination_id ORDER BY denomination_id)x),'bankRowsDirect',(SELECT count(*) FROM public.chip_bank_ledger WHERE tournament_id='${tour}'),'bankRowsViaInventoryRef',(SELECT count(*) FROM public.chip_bank_ledger b WHERE EXISTS(SELECT 1 FROM public.chip_inventory_ledger i WHERE i.tournament_id='${tour}' AND i.ref_id=b.ref_id AND i.ref_type=b.ref_type)),'activeSeatStack',(SELECT coalesce(sum(chip_count),0) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active));`);
 result.journeys.push({key,tour,inventory,ledgers,physicalHandoverAccepted:false});
 }
 result.carry=read("SELECT jsonb_build_object('participations',count(*),'carriedStack',sum(carried_stack),'sourceBagCount',sum(jsonb_array_length(source_bags))) FROM public.multi_day_final_participations_v1 WHERE event_id='dbb49f8d-7d47-4c2c-afd9-f57062c9971d';");
 assert.equal(result.carry.participations,15);assert.equal(result.carry.carriedStack,300000);assert.equal(result.carry.sourceBagCount,16);
 const single=result.journeys[0];assert.equal(single.inventory.total_value,180000);assert.equal(single.ledgers.inventoryRows,4);assert.ok(single.ledgers.inventoryByDenomination.every(x=>Number(x.net_delta)===0));
 for(const row of result.journeys)assert.equal(Number(row.ledgers.activeSeatStack),0);
 result.notInterchangeable={historicalFlightDenominationValue:result.journeys[1].inventory.total_value+result.journeys[2].inventory.total_value,carriedStack:result.carry.carriedStack,finalIssuedValue:result.journeys[3].inventory.total_value};
 assert.equal(result.notInterchangeable.historicalFlightDenominationValue,320000);assert.equal(result.notInterchangeable.finalIssuedValue,0);
}finally{
 result.after=fingerprint();result.unchanged=result.before===result.after;
 writeFileSync('D:/Quy trình/output/reports/chip1022-original-ledger-grains-local-20261027.json',JSON.stringify(result,null,2)+'\n');assert.equal(result.unchanged,true);
}
console.log(JSON.stringify({unchanged:result.unchanged,groups:tables.length,carry:result.carry,journeys:result.journeys.map(x=>({key:x.key,value:x.inventory.total_value,...x.ledgers}))}));
