import assert from 'node:assert/strict';

// A bounded transport seam, not an alternative redraw implementation.
export function createSingle677Redraw({sql,query,actor,club,tour,log}) {
 const scope={actor:'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',club:'d4427834-5f5f-48ef-bde5-e2dc388ed00b',tour:'c367013a-3ed3-48af-ad48-3915acadc50e'};
 assert.deepEqual({actor,club,tour},scope);
 assert.equal(sql('SELECT current_database()||\'|\'||inet_server_port()||\'|\'||current_setting(\'data_directory\');'),
  'vinpoker_ops_cash115_qualified_c|55441|/tmp/vinpoker-sol-local-20261016-0e79a729/data');
 const physical='991b1e8e-da4c-461a-9b39-ddebd7a5d044';
 const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
 const json=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
 const exact=(v,fields)=>assert.deepEqual(Object.keys(v).sort(),fields.sort());
 const flag=JSON.parse(sql('SELECT to_jsonb(r) FROM public.centerpoint_tournament_ops_release r WHERE id;'));
 assert.ok(flag&&typeof flag.enabled==='boolean'&&Array.isArray(flag.allowed_club_ids));
 assert.equal(sql(`SELECT count(*) FROM public.tournament_redraw_batches WHERE tournament_id='${tour}' AND status='applied';`),'0','original canary already consumed; never redraw it again to reproduce acceptance');
 console.log('LOCAL_SINGLE677_OPS_GATE_PREIMAGE',JSON.stringify(flag));
 assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active;`),'8|180000');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${tour}' AND status='in_progress';`),'0');
 const frozen=new Map();let batch=null,applied=false;
 const remember=(operation,body)=>{if(frozen.has(operation))assert.deepEqual(body,frozen.get(operation),'canary accepts only the original intent');else frozen.set(operation,structuredClone(body));};
 const checkBatch=id=>{
  assert.ok(uuid(id));if(batch!==null)assert.equal(id,batch);
  assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.tournament_redraw_batches WHERE id='${id}' AND tournament_id='${tour}'
   AND target_max_seats=9 AND target_game_table_ids=ARRAY['${physical}'::uuid]);`),'t');
 };
 const verify=()=>{
  assert.equal(sql(`SELECT count(*)||'|'||sum(chip_count) FROM public.tournament_seats WHERE tournament_id='${tour}' AND is_active;`),'8|180000');
  if(!applied)return;
  assert.equal(sql(`SELECT count(*) FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id=s.entry_id
   JOIN public.tournament_tables tt ON tt.id=s.tournament_table_id WHERE s.tournament_id='${tour}' AND s.is_active
   AND s.table_id=tt.id AND e.seat_id=s.id AND e.table_id=tt.game_table_id AND e.seat_number=s.seat_number
   AND e.current_stack=s.chip_count AND tt.game_table_id='${physical}';`),'8');
  assert.equal(sql(`SELECT count(*) FROM public.seat_draw_receipts r JOIN public.tournament_entries e ON e.id=r.entry_id
   WHERE e.tournament_id='${tour}' AND e.status='seated' AND r.status IN('issued','printed') AND r.seat_id=e.seat_id;`),'8');
  assert.equal(sql("SELECT status FROM public.tournament_tables WHERE id='4f493b5e-ef25-4e55-bafd-faab24fcade9';"),'closed');
  assert.equal(sql("SELECT status FROM public.dealer_rotation_schedule WHERE id='4ef20172-1278-4395-90a4-d46325c08426';"),'cancelled');
  console.log('LOCAL_SINGLE677_CANONICAL_SEATS_ENTRIES_RECEIPTS_RESERVATION_PASS');
 };
 // Apply the same isolated operational gate used by native tests; Auto/Daybreak stay OFF.
 sql(`UPDATE public.centerpoint_tournament_ops_release SET enabled=true,allowed_club_ids=ARRAY['${club}'::uuid] WHERE id;`);
 console.log('LOCAL_SINGLE677_TRANSIENT_OPS_GATE_ONLY',JSON.stringify({tour,physical}));
 return {
  handle(method,url,body) {
   const name=url.pathname.match(/^\/rest\/v1\/rpc\/(floor_plan_tournament_redraw_v1|floor_apply_tournament_redraw_v1|floor_get_redraw_intent_v1|floor_continue_tournament_redraw_v1)$/)?.[1];
   if(method!=='POST'||!name)return null;
   let statement;
   if(name==='floor_plan_tournament_redraw_v1') {
    exact(body,['p_tournament_id','p_target_max_seats','p_game_table_ids','p_request_id']);
    assert.equal(body.p_tournament_id,tour);assert.equal(body.p_target_max_seats,9);assert.deepEqual(body.p_game_table_ids,[physical]);assert.ok(uuid(body.p_request_id));
    remember('plan',body);
    statement=`SELECT public.${name}('${tour}',9,ARRAY['${physical}'::uuid],'${body.p_request_id}');`;
   } else if(name==='floor_get_redraw_intent_v1') {
    exact(body,['p_tournament_id','p_operation','p_request_id','p_payload','p_expected_actor']);
    assert.equal(body.p_tournament_id,tour);assert.equal(body.p_expected_actor,actor);assert.ok(uuid(body.p_request_id));
    assert.ok(['plan','apply','continue'].includes(body.p_operation));
    if(body.p_operation==='plan')assert.deepEqual(body.p_payload,{tournament_id:tour,target_max_seats:9,game_table_ids:[physical]});
    else {
     exact(body.p_payload,['batch_id',...(body.p_operation==='continue'?['expected_redraw_revision']:[])]);checkBatch(body.p_payload.batch_id);
     if(body.p_operation==='continue')assert.ok(Number.isSafeInteger(body.p_payload.expected_redraw_revision)&&body.p_payload.expected_redraw_revision>0);
    }
    statement=`SELECT public.${name}('${tour}','${body.p_operation}','${body.p_request_id}',${json(body.p_payload)},'${actor}');`;
   } else {
    exact(body,['p_batch_id','p_request_id',...(name==='floor_continue_tournament_redraw_v1'?['p_expected_redraw_revision']:[])]);
    checkBatch(body.p_batch_id);assert.ok(uuid(body.p_request_id));remember(name,body);
    if(name==='floor_continue_tournament_redraw_v1')assert.equal(body.p_expected_redraw_revision,1);
    statement=`SELECT public.${name}('${body.p_batch_id}',${name==='floor_continue_tournament_redraw_v1'?'1,':''}'${body.p_request_id}');`;
   }
   const value=query(statement);
   if(name==='floor_plan_tournament_redraw_v1'&&value.ok===true){batch=value.batch_id;checkBatch(batch);}
   if(name==='floor_apply_tournament_redraw_v1'&&value.ok===true){applied=true;verify();}
   log.push({single677:name,requestId:body.p_request_id,outcome:value.error??value.status??value.ok,batchId:value.batch_id??value.result?.batch_id??null});
   return {value,dropEligible:name==='floor_apply_tournament_redraw_v1'&&value.ok===true};
  },
  cleanup() {
   try{verify();}finally{
    sql(`UPDATE public.centerpoint_tournament_ops_release SET (enabled,allowed_club_ids,updated_at)=
     (SELECT r.enabled,r.allowed_club_ids,r.updated_at FROM jsonb_populate_record(NULL::public.centerpoint_tournament_ops_release,${json(flag)}) r) WHERE id;`);
    assert.deepEqual(JSON.parse(sql('SELECT to_jsonb(r) FROM public.centerpoint_tournament_ops_release r WHERE id;')),flag);
    console.log('LOCAL_SINGLE677_OPS_GATE_RESTORED_PASS');
   }
  },
 };
}
