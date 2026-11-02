import assert from 'node:assert/strict';
// Exact retained journey; product RPCs execute as the authenticated local actor.
export function createSingle661ManualSwing({sql,query,actor,club,log}){
 const plan662=process.env.VINPOKER_SINGLE662_PLAN==='1';
 assert.equal(actor,'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e');
 assert.equal(club,'d4427834-5f5f-48ef-bde5-e2dc388ed00b');
 assert.equal(sql('SELECT current_database();'),'vinpoker_ops_cash115_qualified_c');
 const plan={p_table_session_id:'uuid',p_assignment_id:'uuid',p_expected_assignment_version:'integer',p_next_attendance_id:'uuid',p_request_id:'uuid'};
 const swing={p_actor_user_id:'uuid',p_club_id:'uuid',p_table_id:'uuid',p_table_session_id:'uuid',p_assignment_id:'uuid',p_expected_version:'integer',p_request_id:'uuid'};
 const contracts={operator_plan_next_dealer_v1:plan,get_dealer_next_intent_receipt_v1:plan,operator_perform_swing_v2:swing,get_dealer_manual_swing_receipt_v1:swing,cancel_dealer_manual_swing_v1:swing};
 const frozen=new Map();
 return (method,url,body)=>{
  const name=url.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/)?.[1],fields=contracts[name];
  if(method!=='POST'||!fields)return null;
  assert.deepEqual(Object.keys(body).sort(),Object.keys(fields).sort());
  for(const [key,type] of Object.entries(fields))assert.ok(type==='uuid'?typeof body[key]==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(body[key]):Number.isSafeInteger(body[key])&&body[key]>=0);
  assert.equal(body.p_table_session_id,plan662?'f60106c2-7ed5-4be3-8512-602b16eddff3':'b792f67f-4110-4cf4-bf9f-2bb55a6d4ed5');
  assert.equal(body.p_assignment_id,plan662?'808821c8-7611-424e-934a-9ce262af139a':'cbf19368-cf31-492c-8616-1e5b0a122191');
  if(fields===plan){assert.equal(body.p_next_attendance_id,plan662?'1f3f1e56-db9d-46b9-9e3b-531845da5802':'e03c9a69-7c3d-4431-aa98-a801015dfae5');assert.equal(body.p_expected_assignment_version,0);}
  else{assert.ok(!plan662,'662 only plans; never executes early handoff');assert.equal(body.p_actor_user_id,actor);assert.equal(body.p_club_id,club);assert.equal(body.p_table_id,'991b1e8e-da4c-461a-9b39-ddebd7a5d044');assert.equal(body.p_expected_version,1);}
  const category=fields===plan?'plan':'swing';
  if(frozen.has(category))assert.deepEqual(body,frozen.get(category));else frozen.set(category,structuredClone(body));
  const args=Object.entries(fields).map(([key,type])=>`${key}=>${type==='uuid'?`'${body[key]}'`:body[key]}::${type}`).join(',');
  const value=query(`SELECT public.${name}(${args});`);
  log.push({single661:name,key:body.p_request_id,result:value});
  return {value,write:name==='operator_plan_next_dealer_v1'||name==='operator_perform_swing_v2'};
 };
}
