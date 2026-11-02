import assert from 'node:assert/strict';

// Exact retained synthetic704 canary only. Parent models Auth; all actual writes
// are authenticated native RPC calls. No payment, provider or primary journey claim.
export function createPayout704Manual({sql,query,actor,log}){
 const tour='e7040000-0000-4000-8000-000000000002',club='7f3c6f90-3667-4c8c-9a00-6f00da680d84';
 assert.equal(actor,'40b8f243-bf3b-4aaa-962b-db788380207c');
 assert.equal(sql(`SELECT count(*) FROM public.tournaments WHERE id='${tour}' AND club_id='${club}' AND name='LOCAL704 synthetic browser manual payout TEST' AND prize_pool=300000;`),'1');
 const quote=value=>`'${String(value).replaceAll("'","''")}'`;
 const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_array(
 ${['tournament_entries','tournament_seats','table_sessions','tournament_tables','tournament_hands','hand_players','hand_actions','tournament_settlement_outcomes','cashier_buyin_movements','chip_inventory_ledger','chip_bank_ledger','tournament_prize_payments','tournament_close_report','dealer_attendance','dealer_assignments','notifications','tournament_events'].map(t=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x)`).join(',')},
 (SELECT jsonb_agg(CASE WHEN id='${tour}' THEN to_jsonb(x)-'itm_places'-'updated_at' ELSE to_jsonb(x) END ORDER BY id) FROM public.tournaments x),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_payout_runs x WHERE tournament_id<>'${tour}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prizes x WHERE tournament_id<>'${tour}'),
 (SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM floor_private.payout_manual_edit_receipts_v1 x WHERE tournament_id<>'${tour}'))::text);`);
 const before=fingerprint();let dropSave=true,dropReceipt=false,dropCancel=true;
 const paths=['/rest/v1/rpc/save_tournament_prizes_v3','/rest/v1/rpc/get_tournament_payout_edit_receipt_v1',
 '/rest/v1/rpc/cancel_tournament_payout_edit_v1','/rest/v1/rpc/get_tournament_prizes',
 '/rest/v1/tournaments','/rest/v1/tournament_payout_runs','/rest/v1/tournament_entries'];
 const columns=['satellite_payout',
 'id,club_id,operations_mode,buy_in,rake_amount,prize_pool,itm_places,registration_closed_at,live_status,event_id',
 'id,buy_in,rake_amount,prize_pool,itm_places,registration_closed_at,live_status,event_id,club_id,planned_itm_percent,planned_payout_archetype,planned_min_cash_x,planned_rounding_unit',
 'id,buy_in,rake_amount,prize_pool,itm_places,registration_closed_at,live_status,event_id,club_id,planned_itm_percent,planned_payout_archetype,planned_min_cash_x,planned_rounding_unit,operations_mode'];
 return {tour,club,paths,verify(){assert.equal(fingerprint(),before);console.log('PAYOUT704_ALL_PRIMARY_CASH_CHIP_ENTRIES_HANDS_PAYMENTS_DEALERS_OTHER_SCOPE_UNCHANGED_PASS');},
 handle(url,method,body,res,send){
  if(method==='POST'&&url.pathname.startsWith('/rest/v1/rpc/')){
   const name=url.pathname.split('/').pop();assert.equal(body.p_tournament_id,tour);
   if(name==='get_tournament_prizes'){assert.deepEqual(body,{p_tournament_id:tour});send(200,query(`SELECT public.get_tournament_prizes('${tour}');`));return;}
   assert.equal(body.p_expected_actor,actor);assert.ok(uuid(body.p_request_id));
   if(name==='get_tournament_payout_edit_receipt_v1'){
    assert.deepEqual(Object.keys(body).sort(),['p_tournament_id','p_request_id','p_expected_actor'].sort());
    const value=query(`SELECT public.${name}('${tour}','${body.p_request_id}','${actor}');`);
    log.push({test:'PAYOUT704_NATIVE_RECEIPT',requestId:body.p_request_id,status:value.status,mutation:false});
    if(dropReceipt){dropReceipt=false;send(503,{message:'LOCAL704_RECEIPT_UNAVAILABLE_ONCE'});}else send(200,value);return;
   }
   assert.ok(['save_tournament_prizes_v3','cancel_tournament_payout_edit_v1'].includes(name));
   assert.deepEqual(Object.keys(body).sort(),['p_tournament_id','p_rows','p_reason','p_expected_run_id','p_request_id','p_expected_actor'].sort());
   assert.ok(uuid(body.p_expected_run_id));assert.deepEqual(body.p_rows,[{position:1,amount:300000}]);
   assert.ok(['LOCAL704 saved-response-loss','LOCAL704 cancellation'].includes(body.p_reason));
   if(name==='save_tournament_prizes_v3'&&body.p_reason==='LOCAL704 cancellation'){
    log.push({test:'PAYOUT704_SAVE_TRANSPORT_FAILED_BEFORE_RPC',requestId:body.p_request_id,mutation:false});
    send(503,{message:'LOCAL704_SAVE_NOT_REACHED'});return;
   }
   const value=query(`SELECT public.${name}('${tour}',${quote(JSON.stringify(body.p_rows))}::jsonb,${quote(body.p_reason)},'${body.p_expected_run_id}','${body.p_request_id}','${actor}');`);
   log.push({test:'PAYOUT704_NATIVE_COMMITTED',operation:name,requestId:body.p_request_id,result:value,mutation:true});
   if(name==='save_tournament_prizes_v3'&&dropSave){dropSave=false;dropReceipt=true;send(503,{message:'LOCAL704_SAVE_RESPONSE_LOST_AFTER_COMMIT'});return;}
   if(name==='cancel_tournament_payout_edit_v1'&&dropCancel){dropCancel=false;send(503,{message:'LOCAL704_CANCEL_RESPONSE_LOST_AFTER_COMMIT'});return;}
   send(200,value);return;
  }
  if(method==='GET'&&url.pathname==='/rest/v1/tournaments'){
   assert.equal(url.searchParams.get('id'),`eq.${tour}`);const select=url.searchParams.get('select');assert.ok(columns.includes(select));
   send(200,query(`SELECT to_jsonb(x) FROM(SELECT ${select} FROM public.tournaments WHERE id='${tour}')x;`));return;
  }
  if(method==='GET'&&url.pathname==='/rest/v1/tournament_payout_runs'){
   assert.equal(url.searchParams.get('select'),'*');assert.equal(url.searchParams.get('tournament_id'),`eq.${tour}`);
   const status=url.searchParams.get('status');assert.ok(['eq.applied','eq.draft_snapshot'].includes(status));
   assert.equal(url.searchParams.has('id'),false);
   send(200,query(`SELECT coalesce((SELECT to_jsonb(x) FROM public.tournament_payout_runs x WHERE tournament_id='${tour}' AND status='${status.slice(3)}'),'null'::jsonb);`));return;
  }
  if(method==='HEAD'&&url.pathname==='/rest/v1/tournament_entries'){
   assert.equal(url.searchParams.get('select'),'id');assert.equal(url.searchParams.get('tournament_id'),`eq.${tour}`);
   assert.equal(url.searchParams.get('or'),'(status.is.null,status.not.in.(void,voided,cancelled,canceled,refunded,rejected))');
   const count=query(`SELECT count(*) FROM public.tournament_entries WHERE tournament_id='${tour}';`);assert.equal(count,0);
   res.setHeader('Content-Range','*/0');send(200,null);return;
  }
  send(403,{message:'LOCAL704_EXACT_MANUAL_PATH_ONLY'});
 }};
}
