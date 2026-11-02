import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import * as engine from '../../supabase/functions/_shared/trackerEngine/index.ts';
import * as canonical from '../../src/lib/trackerVoice/canonicalRequest.ts';
import {routeTrackerVoiceIntent} from '../../src/lib/trackerVoice/intentRouter.ts';
import {resolveNextVoiceHoleCardsSeatNumber} from '../../src/lib/trackerVoice/holeCardsParser.ts';
import {computeVoiceFinishSettlement} from '../../supabase/functions/_shared/trackerSettlement/finishAssist.ts';
import {isManualFinishIntent,manualFinishReceiptMatches,manualFinishCancellationMatches} from '../../src/lib/trackerManualFinish.ts';
import {trackerUndoReceiptMatches} from '../../src/lib/trackerUndoReceipt.ts';

// Exact read seam used by useInputTableAlerts. The caller supplies the same
// authenticated transaction executor as the other local PostgREST reads.
export function readTrackerAlertCounts({url,fixture,query}) {
 assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
 assert.match(fixture.tour,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
 assert.equal(url.pathname,'/rest/v1/tracker_floor_alerts');
 assert.deepEqual([...url.searchParams.keys()].sort(),['select','status','tournament_id']);
 assert.equal(url.searchParams.get('select'),'physical_table_id');
 assert.equal(url.searchParams.get('tournament_id'),`eq.${fixture.tour}`);
 assert.equal(url.searchParams.get('status'),'in.(open,acknowledged,in_progress)');
 return query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT physical_table_id FROM public.tracker_floor_alerts WHERE tournament_id='${fixture.tour}' AND status IN ('open','acknowledged','in_progress')) t;`);
}

// Auth verification is modeled by the enclosing loopback session router. The
// actual product handler, engine, payload guards and authenticated RPCs execute.
export async function runTrackerBrowserEdge({body,fixture,user,query,log,validationMode='warn'}) {
 assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
 assert.ok(['warn','enforce'].includes(validationMode),'explicit local validation mode only');
 assert.equal(body.tournament_id,fixture.tour);
 assert.ok(['start_hand','record_action','update_community_cards','show_hole_cards','show_manual_cards_v1','get_manual_card_receipt_v1','record_manual_hand_v1','get_manual_finish_receipt_v1','cancel_manual_finish_v1','void_hand','undo_last_action_v1'].includes(body.action));
 const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
 if(body.action==='start_hand') {
  assert.ok(uuid(body.tournament_table_id)&&uuid(body.table_session_id));
  assert.equal(query(`SELECT to_jsonb(EXISTS(SELECT 1 FROM public.tournament_tables WHERE id='${body.tournament_table_id}' AND tournament_id='${fixture.tour}' AND table_session_id='${body.table_session_id}'));`),true);
 } else {
  const hand=body.hand_id??body.finish_intent?.hand_id;assert.ok(uuid(hand));
  assert.equal(query(`SELECT to_jsonb(EXISTS(SELECT 1 FROM public.tournament_hands WHERE id='${hand}' AND tournament_id='${fixture.tour}'));`),true);
 }
 const types={
  start_tracker_hand_v3:{p_tournament_id:'uuid',p_tournament_table_id:'uuid',p_table_session_id:'uuid',p_control_epoch:'bigint',p_hand_number:'integer',p_hand_time:'timestamptz',p_created_by:'uuid',p_button_seat:'integer'},
  record_action:{p_hand_id:'uuid',p_player_id:'uuid',p_entry_number:'integer',p_street:'text',p_action_type:'text',p_action_amount:'integer',p_action_order:'integer',p_user_id:'uuid',p_idempotency_key:'text',p_trace_id:'text'},
  update_community_cards:{p_hand_id:'uuid',p_community_cards:'jsonb',p_user_id:'uuid'},
  show_hole_cards:{p_hand_id:'uuid',p_player_hole_cards:'jsonb',p_user_id:'uuid'},
  show_tracker_manual_cards_v1:{p_hand_id:'uuid',p_session_id:'uuid',p_epoch:'bigint',p_revision:'bigint',p_request_key:'text',p_cards:'jsonb'},
  get_tracker_manual_card_receipt_v1:{p_request_key:'text',p_expected_payload:'jsonb'},
  record_tracker_manual_hand_v1:{p_intent:'jsonb'},get_tracker_manual_finish_receipt_v1:{p_intent:'jsonb'},cancel_tracker_manual_finish_v1:{p_intent:'jsonb'},
  void_last_hand:{p_hand_id:'uuid'},
  undo_tracker_last_action_v1:{p_tournament_id:'uuid',p_tournament_table_id:'uuid',p_hand_id:'uuid',p_expected_action_id:'uuid',p_expected_source_revision:'bigint',p_idempotency_key:'uuid'},
 };
 const quote=v=>v===null?'NULL':`'${(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")}'`;
 const client={auth:{getUser:async()=>({data:{user},error:null})},rpc:async(name,args)=>{
  const schema=types[name];assert.ok(schema,'unexpected local Edge RPC');assert.deepEqual(Object.keys(args).sort(),Object.keys(schema).sort());
  const params=Object.entries(args).map(([key,value])=>`${key}=>${quote(value)}::${schema[key]}`).join(',');
  try {
   const data=query(`SELECT to_jsonb(public.${name}(${params}));`);log.push({edgeRpc:name,handId:data?.hand_id??args.p_hand_id??null,
    requestId:args.p_intent?.request_id??args.p_idempotency_key??null,status:data?.status??data?.error??'read'});
   return {data,error:null};
  } catch(error) {
   // Expose only a canonical one-token DB error, never SQL/context or secrets.
   // Preserve business denials instead of misclassifying them as transport loss.
   const code=String(error?.stderr??'').match(/^ERROR:\s+([a-z][a-z0-9_]{2,100})\s*$/m)?.[1]??'local_edge_rpc_failed';
   log.push({edgeRpc:name,status:'error',error:code});
   return {data:null,error:{message:code}};
  }
 },from:table=>{
  assert.ok(['tournament_hands','hand_players','hand_actions'].includes(table));
  let columns,hand,single=false;
  const allowed={tournament_hands:['button_seat'],hand_players:['player_id, seat_number, starting_stack'],hand_actions:['player_id, street, action_type, action_amount, action_order']};
  const execute=()=>{
   assert.ok(allowed[table].includes(columns)&&uuid(hand));
   const where=table==='tournament_hands'?`id='${hand}' AND tournament_id='${fixture.tour}'`
    :`hand_id='${hand}' AND EXISTS(SELECT 1 FROM public.tournament_hands h WHERE h.id='${hand}' AND h.tournament_id='${fixture.tour}')`;
   const rows=query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT ${columns} FROM public.${table} WHERE ${where}${table==='hand_actions'?' ORDER BY action_order':''}) t;`);
   return {data:single?rows[0]??null:rows,error:null};
  };
  const b={select:value=>{columns=value;return b;},eq:(column,value)=>{assert.equal(column,table==='tournament_hands'?'id':'hand_id');hand=value;return b;},
   order:()=>b,maybeSingle:()=>{single=true;return Promise.resolve(execute());},then:(resolve,reject)=>Promise.resolve().then(execute).then(resolve,reject)};
  return b;
 }};
 let handler;
 const source=stripTypeScriptTypes(readFileSync('supabase/functions/tournament-live-update/index.ts','utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,''));
 runInNewContext(source,{...engine,...canonical,routeTrackerVoiceIntent,resolveNextVoiceHoleCardsSeatNumber,computeVoiceFinishSettlement,trackerUndoReceiptMatches,
  isManualFinishIntent,manualFinishReceiptMatches,manualFinishCancellationMatches,Request,Response,console,
  Deno:{env:{get:key=>({SUPABASE_URL:'http://127.0.0.1:54329',SUPABASE_ANON_KEY:'LOCAL_TEST_ANON',TRACKER_VALIDATION_MODE:validationMode})[key]},serve:fn=>{handler=fn;}},
  createClient:(_url,key)=>{assert.equal(key,'LOCAL_TEST_ANON');return client;},
 });
 assert.equal(typeof handler,'function');
 return handler(new Request('http://127.0.0.1:54329/functions/v1/tournament-live-update',{method:'POST',
  headers:{'content-type':'application/json',authorization:'Bearer LOCAL_TEST_ALREADY_VERIFIED'},body:JSON.stringify(body)}));
}
