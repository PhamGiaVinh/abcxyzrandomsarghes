import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

// Actual report RPC in a rollback-only browser transaction; no retained hand is
// changed, no arbitrary scope accepted and no external notification transport.
export async function createFloorAlertBrowser({sql,scope,actor,log}){
 const review280=process.env.VINPOKER_FLOOR_ALERT_REVIEW280==='1';
 assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
 assert.equal(process.env.VINPOKER_FLOOR_ALERT_BROWSER,'1');
 assert.equal(scope.tour,'46cab483-91e7-4220-aacf-e17bdf05269c');
 assert.equal(scope.table,'d294f4a4-082b-4efc-a6ca-1f96579ea344');
 assert.equal(scope.session,'ee2b9393-0c96-42f9-8667-7f306edeb9bc');
 assert.equal(actor,'675fe35e-60a8-4452-bb90-e79486d54da6');
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
  'hands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id='${scope.tour}'),
  'alerts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.tracker_floor_alerts a WHERE tournament_id='${scope.tour}'),
  'scopes',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tracker_correction_uat_scopes s WHERE tournament_id='${scope.tour}'),
  'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${scope.tour}'),
  'configs',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.tracker_voice_configs c WHERE tournament_id='${scope.tour}'),
  'session',(SELECT to_jsonb(s) FROM public.table_sessions s WHERE id='${scope.session}'),
  'modeRequests',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM floor_private.table_mode_requests_v1 r WHERE table_session_id='${scope.session}'))::text);`);
 const before=fingerprint();
 const session=JSON.parse(sql(`SELECT jsonb_build_object('epoch',control_epoch,'revision',revision,'mode',control_mode)
  FROM public.table_sessions WHERE id='${scope.session}' AND tournament_id='${scope.tour}' AND closed_at IS NULL;`)||'null');
 assert.ok(session&&Number.isSafeInteger(session.epoch)&&session.epoch>0&&Number.isSafeInteger(session.revision));
 assert.ok(['manual','tracker'].includes(session.mode));
 let epoch=session.epoch;
 const physical=sql(`SELECT game_table_id FROM public.tournament_tables WHERE id='${scope.table}';`);
 const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
 assert.ok(uuid(physical));
 const child=spawn('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441','PGUSER=postgres',
  'PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
 let output='',waiting=null,ended=false,queue=Promise.resolve(),request=null,drop=true,failureCode='',alertId=null;
 const closed=new Promise(resolve=>child.once('close',code=>{ended=true;if(waiting)clearTimeout(waiting.timer);waiting?.reject(new Error(`local alert transaction closed ${failureCode}`));waiting=null;resolve(code);}));
 child.on('error',()=>{ended=true;waiting?.reject(new Error('local alert transaction unavailable'));waiting=null;});
 child.stderr.on('data',chunk=>{
  const line=String(chunk).match(/^ERROR:\s+([a-zA-Z_ ]{1,120})(?:\n|$)/m)?.[1];
  if(line)failureCode=line; // Canonical code/plain permission label only, no SQL/context.
 });
 child.stdout.on('data',chunk=>{
  output+=String(chunk);
  if(output.length>2e6){waiting?.reject(new Error('local alert output limit'));child.stdin.end();return;}
  if(waiting&&output.includes(waiting.marker+'\n')){
   const index=output.indexOf(waiting.marker+'\n'),lines=output.slice(0,index).trim().split('\n').filter(Boolean);
   output=output.slice(index+waiting.marker.length+1);const done=waiting;waiting=null;clearTimeout(done.timer);
   try{assert.equal(lines.length,1);done.resolve(JSON.parse(lines[0]));}catch(error){done.reject(error);}
  }
 });
 const execute=statement=>{
  const task=queue.then(()=>new Promise((resolve,reject)=>{
   assert.equal(ended,false);const marker=`LOCAL_ALERT_${randomUUID()}`;
   const timer=setTimeout(()=>{waiting=null;reject(new Error('local alert transaction timeout'));child.stdin.end();},10000);
   waiting={marker,resolve,reject,timer};child.stdin.write(`${statement}\n\\echo ${marker}\n`);
  }));queue=task.catch(()=>{});return task;
 };
 let manifest;
 let dropTransition=process.env.VINPOKER_FLOOR_TRANSITION_RESPONSE_LOSS==='1';
 let delayRevision=process.env.VINPOKER_FLOOR_ALERT_REVISION_DELAY==='1';
 try{
  await execute(`BEGIN;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='2s';SET LOCAL idle_in_transaction_session_timeout='15min';
   GRANT USAGE ON SCHEMA auth TO authenticated;
   INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled)
   VALUES('${scope.club}','${scope.tour}','${scope.table}','${actor}','report_wrong_action',true) ON CONFLICT DO NOTHING;
   SET LOCAL request.jwt.claim.sub='${actor}';SET LOCAL request.jwt.claim.role='authenticated';
   SET LOCAL request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';SET LOCAL ROLE authenticated;
   SELECT '{}'::jsonb;`);
  if(!review280&&session.mode==='manual'){
   const changed=await execute(`SELECT public.floor_request_table_control_mode_v4('${scope.table}','${scope.session}','tracker',${session.revision},${epoch},'${randomUUID()}');`);
   assert.equal(changed.ok,true);assert.equal(changed.outcome,'applied');
   const actual=await execute(`RESET ROLE;SELECT jsonb_build_object('epoch',control_epoch,'mode',control_mode) FROM public.table_sessions WHERE id='${scope.session}';SET LOCAL ROLE authenticated;`);
   assert.equal(actual.mode,'tracker');assert.equal(actual.epoch,epoch+1);epoch=actual.epoch;
   log.push({floorAlertPreparation:'CANONICAL_MODE_REQUEST',transaction:'ROLLBACK_ONLY',epoch});
  }
  if(review280){
   manifest=await execute(`SELECT jsonb_build_object('hand',id,'table',tournament_table_id,'revision',source_revision,'reviewOnly',true)
    FROM public.tournament_hands WHERE id='4aa376ee-4a27-4963-9c69-dd0a2cd17abf' AND tournament_id='${scope.tour}'
     AND tournament_table_id='${scope.table}' AND source_revision=24 AND status='completed' AND NOT is_voided;`);
   assert.equal(manifest?.revision,24,'exact retained current hand, no old guard relaxation');
   const fixture=await execute(`RESET ROLE;
    WITH inserted AS(INSERT INTO public.tracker_floor_alerts(club_id,tournament_id,tournament_table_id,physical_table_id,hand_id,
      reported_by,alert_kind,priority,title,message,correction_required,source_action_id,source_action_snapshot,source_revision,source_state_fingerprint)
     SELECT '${scope.club}','${scope.tour}','${scope.table}','${physical}','${manifest.hand}','${actor}','wrong_action','high',
      'LOCAL selected-action280 TEST','Synthetic legacy alert metadata; reader/draft only, rollback on stop.',true,a.id,to_jsonb(a),24,s.source_chain_hash
     FROM public.hand_actions a CROSS JOIN LATERAL public.get_tournament_historical_display_source_hash(a.hand_id) s
     WHERE a.id='4a87e786-b21d-4074-9250-85e28fbb8386' AND a.hand_id='${manifest.hand}' AND a.action_order=3
     RETURNING id,source_action_id)
    SELECT jsonb_build_object('alert',id,'action',source_action_id) FROM inserted;
    SET LOCAL ROLE authenticated;`);
   assert.ok(uuid(fixture?.alert)&&uuid(fixture?.action));alertId=fixture.alert;
   manifest.alert=alertId;manifest.action=fixture.action;
   log.push({selectedAction280Fixture:manifest,transaction:'ROLLBACK_ONLY_METADATA_NOT_REPORT_RPC'});
  }else{
  await execute(`SELECT public.start_tracker_hand_v3('${scope.tour}','${scope.table}','${scope.session}',${epoch},
    (SELECT max(hand_number)+1 FROM public.tournament_hands WHERE tournament_id='${scope.tour}'),now(),'${actor}',1);`)
   .then(result=>{assert.equal(result.status,'success');});
  manifest=await execute(`SELECT jsonb_build_object('hand',id,'table',tournament_table_id,'revision',source_revision)
   FROM public.tournament_hands WHERE tournament_id='${scope.tour}' AND status='in_progress' AND NOT is_voided;`);
  }
  assert.ok(manifest.hand&&Number.isSafeInteger(manifest.revision));
  log.push({floorAlertFixture:manifest,transaction:'ROLLBACK_ONLY'});
 }catch(error){child.stdin.end();await closed;assert.equal(fingerprint(),before);throw error;}
 return {
  manifest,
  async handle(url,method,body){
   if(method==='POST'&&['/rest/v1/rpc/list_tracker_tables_v2','/rest/v1/rpc/list_tracker_history_tables_v1','/rest/v1/rpc/get_tracker_historical_display_queue_status'].includes(url.pathname)){
    assert.deepEqual(body,{p_tournament_id:scope.tour});const name=url.pathname.split('/').at(-1);
    const value=await execute(name==='get_tracker_historical_display_queue_status'
     ?`SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM public.${name}('${scope.tour}')s;`
     :`SELECT public.${name}('${scope.tour}');`);
    log.push({rpc:name,transaction:'ROLLBACK_ONLY',status:'read'});return {status:200,value};
   }
   if(url.pathname==='/rest/v1/rpc/list_tracker_floor_alerts'&&method==='POST'){
    assert.deepEqual(body,{p_tournament_id:scope.tour,p_status:null});
    const value=await execute(`SELECT public.list_tracker_floor_alerts('${scope.tour}',NULL);`);
    log.push({rpc:'list_tracker_floor_alerts',rows:value.alerts?.length??null,transaction:'ROLLBACK_ONLY'});
    return {status:200,value};
   }
   if(url.pathname==='/rest/v1/rpc/transition_tracker_floor_alert'&&method==='POST'){
    if(review280)return {status:403,value:{code:'LOCAL_REVIEW280_READ_ONLY'}};
    assert.deepEqual(Object.keys(body).sort(),['p_alert_id','p_expected_version','p_transition','p_note','p_idempotency_key'].sort());
    assert.equal(body.p_alert_id,alertId);assert.ok(alertId);
    assert.ok(Number.isSafeInteger(body.p_expected_version)&&body.p_expected_version>0);
    assert.ok(['acknowledge','start','resolve'].includes(body.p_transition));assert.equal(body.p_note,null);
    assert.match(body.p_idempotency_key,/^floor-alert:[a-f0-9-]{36}$/i);
    const value=await execute(`SELECT public.transition_tracker_floor_alert('${alertId}',${body.p_expected_version},'${body.p_transition}',NULL,'${body.p_idempotency_key}');`);
    log.push({rpc:'transition_tracker_floor_alert',transition:body.p_transition,key:body.p_idempotency_key,result:value,transaction:'ROLLBACK_ONLY'});
    if(dropTransition){dropTransition=false;log.push({floorTransitionResponseLoss:true,transaction:'ROLLBACK_ONLY'});return {status:503,value:{message:'LOCAL_TRANSITION_RESPONSE_LOSS'}};}
    return {status:200,value};
   }
   if(method==='GET'&&url.pathname==='/rest/v1/game_tables'){
    assert.equal(url.searchParams.get('select'),'id,table_number');assert.equal(url.searchParams.get('id'),`in.(${physical})`);
    return {status:200,value:await execute(`SELECT jsonb_agg(jsonb_build_object('id',id,'table_number',table_number)) FROM public.game_tables WHERE id='${physical}';`)};
   }
   if(url.pathname==='/rest/v1/tournament_hands'&&method==='GET'){
    const columns='id,hand_number,hand_time,community_cards,pot_size,status,is_voided,created_at,table_id,button_seat';
    if(url.searchParams.get('select')?.replaceAll(' ','')===columns){
     assert.equal(url.searchParams.get('tournament_id'),`eq.${scope.tour}`);
     const tables=url.searchParams.get('table_id');
     let tableIds=[scope.table,physical],sessionId=null;
     if(review280){
      assert.ok(tables?.startsWith('eq.')||tables?.startsWith('in.(')&&tables.endsWith(')'));
      tableIds=tables.startsWith('eq.')?[tables.slice(3)]:tables.slice(4,-1).split(',');
      assert.ok(tableIds.length>0&&tableIds.length<=2&&tableIds.every(uuid));
      const sessionFilter=url.searchParams.get('table_session_id');
      if(sessionFilter){assert.ok(sessionFilter.startsWith('eq.')&&uuid(sessionFilter.slice(3)));sessionId=sessionFilter.slice(3);}
      const valid=await execute(`SELECT count(*)::int FROM unnest(ARRAY[${tableIds.map(id=>`'${id}'::uuid`).join(',')}]) candidate(id)
       WHERE EXISTS(SELECT 1 FROM public.tournament_tables tt WHERE tt.tournament_id='${scope.tour}'
        AND (tt.id=candidate.id OR COALESCE(tt.game_table_id,tt.table_id)=candidate.id)${sessionId?` AND tt.table_session_id='${sessionId}'`:''});`);
      assert.equal(valid,tableIds.length);
     }else assert.ok(tables===`eq.${scope.table}`||tables===`in.(${scope.table},${physical})`||tables===`in.(${physical},${scope.table})`);
     assert.equal(url.searchParams.get('order'),'created_at.desc,id.desc');
     assert.ok(!url.searchParams.has('offset')||url.searchParams.get('offset')==='0');
     const value=await execute(`SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM(SELECT ${columns} FROM public.tournament_hands
      WHERE tournament_id='${scope.tour}' AND table_id IN(${tableIds.map(id=>`'${id}'::uuid`).join(',')})${sessionId?` AND table_session_id='${sessionId}'`:''} ORDER BY created_at DESC,id DESC)h;`);
     assert.ok(value.length<1000);log.push({read:'floor_history_hands',rows:value.length,tableIds,sessionId,transaction:'ROLLBACK_ONLY'});
     return {status:200,value};
    }
    if(url.searchParams.get('select')==='id,hand_number,status,is_voided'){
     const filter=url.searchParams.get('id');assert.ok(filter?.startsWith('in.(')&&filter.endsWith(')'));
     const ids=filter.slice(4,-1).split(',');assert.ok(ids.length>0&&ids.length<=80&&ids.every(uuid));
     if(!review280)assert.deepEqual(ids,[manifest.hand]);
     assert.equal(await execute(`SELECT count(*)::int FROM public.tournament_hands WHERE id=ANY(ARRAY[${ids.map(id=>`'${id}'::uuid`).join(',')}]) AND tournament_id='${scope.tour}';`),ids.length);
     return {status:200,value:await execute(`SELECT jsonb_agg(jsonb_build_object('id',id,'hand_number',hand_number,'status',status,'is_voided',is_voided)) FROM public.tournament_hands WHERE id=ANY(ARRAY[${ids.map(id=>`'${id}'::uuid`).join(',')}]);`)};
    }
    assert.equal(url.searchParams.get('select'),'id,source_revision');
    assert.equal(url.searchParams.get('id'),`eq.${manifest.hand}`);
    assert.equal(url.searchParams.get('tournament_id'),`eq.${scope.tour}`);
    assert.equal(url.searchParams.get('tournament_table_id'),`eq.${scope.table}`);
    const value=await execute(`SELECT jsonb_build_object('id',id,'source_revision',source_revision) FROM public.tournament_hands WHERE id='${manifest.hand}';`);
    if(delayRevision){delayRevision=false;log.push({floorRevisionReadDelay:12000,transaction:'ROLLBACK_ONLY'});await new Promise(resolve=>setTimeout(resolve,12000));}
    return {status:200,value};
   }
   if(method==='GET'&&['/rest/v1/hand_players','/rest/v1/hand_actions'].includes(url.pathname)){
    const table=url.pathname.split('/').at(-1),columns=url.searchParams.get('select')?.replaceAll(' ','');
    if(table==='hand_players'&&columns==='player_name'){
     assert.equal(url.searchParams.get('limit'),'1');
     return {status:200,value:await execute(`SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM(SELECT player_name FROM public.hand_players WHERE hand_id='${manifest.hand}' LIMIT 1)p;`)};
    }
    const base='id,hand_id,player_id,entry_number,seat_number,starting_stack,ending_stack,is_eliminated,hole_cards';
    assert.ok(table==='hand_players'?[base,base+',player_name'].includes(columns):columns==='id,hand_id,player_id,entry_number,street,action_type,action_amount,action_order');
    const filter=url.searchParams.get('hand_id');assert.ok(filter?.startsWith('in.(')&&filter.endsWith(')'));
    const ids=filter.slice(4,-1).split(',');assert.ok(ids.length>0&&ids.length<=80&&ids.every(uuid));
    const list=ids.map(id=>`'${id}'::uuid`).join(',');
    const valid=await execute(`SELECT count(*)::int FROM public.tournament_hands WHERE id=ANY(ARRAY[${list}]) AND tournament_id='${scope.tour}' AND table_id IN('${scope.table}','${physical}');`);
    assert.equal(valid,ids.length);assert.ok(!url.searchParams.has('offset')||url.searchParams.get('offset')==='0');
    const order=table==='hand_players'?'hand_id,player_id,entry_number,id':'hand_id,action_order,id';
    const value=await execute(`SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]') FROM(SELECT ${columns} FROM public.${table} WHERE hand_id=ANY(ARRAY[${list}]) ORDER BY ${order})p;`);
    assert.ok(value.length<1000);log.push({read:`floor_history_${table}`,rows:value.length,transaction:'ROLLBACK_ONLY'});
    return {status:200,value};
   }
   if(url.pathname!=='/rest/v1/rpc/report_tracker_wrong_hand_v1'||method!=='POST')return null;
   if(review280)return {status:403,value:{code:'LOCAL_REVIEW280_READ_ONLY'}};
   assert.deepEqual(Object.keys(body).sort(),['p_tournament_id','p_tournament_table_id','p_hand_id','p_expected_source_revision','p_request_id'].sort());
   assert.equal(body.p_tournament_id,scope.tour);assert.equal(body.p_tournament_table_id,scope.table);
   assert.equal(body.p_hand_id,manifest.hand);assert.equal(body.p_expected_source_revision,manifest.revision);
   assert.match(body.p_request_id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
   if(request)assert.deepEqual(body,request);else request={...body};
   const value=await execute(`SELECT public.report_tracker_wrong_hand_v1('${scope.tour}','${scope.table}','${manifest.hand}',${manifest.revision},'${request.p_request_id}');`);
   assert.equal(value.ok,true);
   alertId=value.alert_id;
   const listed=await execute(`SELECT public.list_tracker_floor_alerts('${scope.tour}',NULL);`);
   assert.equal(listed.ok,true);
   const matches=listed.alerts.filter(a=>a.id===value.alert_id);assert.equal(matches.length,1);
   assert.equal(matches[0].dealer_id,null);assert.equal(matches[0].assignment_id,null);
   log.push({rpc:'report_tracker_wrong_hand_v1',requestId:request.p_request_id,result:value,nonemptyFloorList:true,transaction:'ROLLBACK_ONLY'});
   if(drop){drop=false;return {status:503,value:{message:'LOCAL_REPORT_RESPONSE_LOSS'}};}
   return {status:200,value};
  },
  async cleanup(){
   if(!ended){await execute("ROLLBACK;SELECT '{}'::jsonb;");child.stdin.end('\\q\n');}
   assert.equal(await closed,0);assert.equal(fingerprint(),before);
   console.log('LOCAL_FLOOR_ALERT_BROWSER_ROLLBACK_HAND_ALERT_SCOPE_CONFIG_SEAT_UNCHANGED_PASS');
  },
 };
}
