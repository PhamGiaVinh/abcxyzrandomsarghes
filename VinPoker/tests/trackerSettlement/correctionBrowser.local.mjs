import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runPaidCorrectionEdge} from './paidCorrectionEdge.native.mjs';

// One emitted native TEST manifest, never a latest-row/name-only lookup.
export async function createCorrectionBrowser({sql,query,scope,actor,log}){
 assert.equal(process.env.VINPOKER_NATIVE_BROWSER,'1');
 const single648=process.env.VINPOKER_CORRECTION_SINGLE648==='1';
 const winner103=scope.hand==='3b17d706-6efa-4264-80b0-ec296397f6cf';
 const finish137=scope.hand==='4aa376ee-4a27-4963-9c69-dd0a2cd17abf';
 const review284=process.env.VINPOKER_CORRECTION_REVIEW284_ONLY==='1';
 const commit290=process.env.VINPOKER_CORRECTION_COMMIT290==='1';
 assert.ok(!(review284&&commit290),'review-only and one-shot commit are separate canaries');
 const current24=review284||commit290;
 if(commit290)assert.ok(finish137,'commit290 only exact retained Hand32');
 if(review284)assert.ok(finish137,'review284 is pinned to the retained Hand32, never a latest-row substitute');
 const review104=winner103&&process.env.VINPOKER_CORRECTION_REVIEW104_ONLY==='1';
 assert.deepEqual(scope,single648?{tour:'c367013a-3ed3-48af-ad48-3915acadc50e',club:'d4427834-5f5f-48ef-bde5-e2dc388ed00b',actor:'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e',hand:'4f120026-cf38-4db3-bb05-ae6feaabf59a',table:'c2ce77c0-2b61-4a19-bd43-4752232cc55a',sourceRevision:'15'}:finish137?{tour:'46cab483-91e7-4220-aacf-e17bdf05269c',club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',actor:'675fe35e-60a8-4452-bb90-e79486d54da6',hand:'4aa376ee-4a27-4963-9c69-dd0a2cd17abf',table:'d294f4a4-082b-4efc-a6ca-1f96579ea344',sourceRevision:current24?'24':'21'}:winner103?{tour:'46cab483-91e7-4220-aacf-e17bdf05269c',club:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',
  actor:'675fe35e-60a8-4452-bb90-e79486d54da6',hand:'3b17d706-6efa-4264-80b0-ec296397f6cf',
  table:'d294f4a4-082b-4efc-a6ca-1f96579ea344',sourceRevision:review104?'19':'16'}:{tour:'de9f2288-efa8-4b70-8bf1-eb34f7e70f10',club:'6129d24d-8aab-41fd-b22b-99f135843a20',
  actor:'8212d904-4bcf-45f5-8192-613dd1559696',hand:'4ef98dd4-cb2b-4158-8a98-fe327ce71c0d',
  table:'0199beb9-a459-4aa1-994e-6a263ba183f5',sourceRevision:'10'});
 assert.equal(actor,scope.actor);
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"),'f');
 assert.equal(sql(`SELECT count(*) FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id
  JOIN public.clubs c ON c.id=t.club_id WHERE h.id='${scope.hand}' AND t.id='${scope.tour}' AND c.id='${scope.club}'
   AND c.owner_id='${actor}' AND h.created_by=c.owner_id AND h.tournament_table_id='${scope.table}'
   AND t.name='Cash identity local TEST' AND h.status='completed' AND NOT h.is_voided AND h.source_revision=${scope.sourceRevision};`),'1');
 if(single648){
  assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${scope.tour}';`),'1');
  assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${scope.hand}' AND source_revision=15 AND status='verified' AND verification_scope='historical_display';`),'1');
  assert.equal(sql(`SELECT count(*) FROM floor_private.floor_table_v3_existing_receipt('${actor}','record_tracker_manual_hand_v1','62671214-a5a8-492b-af17-64219d0e8061') r WHERE r.result->>'hand_id'='${scope.hand}';`),'1');
  assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(seat_number,starting_stack,ending_stack,hole_cards) ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${scope.hand}';`)),[[6,20000,20000,[]],[7,20000,19900,[]],[8,20000,20100,[]],[9,20000,20000,[]]]);
 }else if(winner103||finish137){
  assert.equal(sql(`SELECT id FROM public.tournament_hands WHERE tournament_id='${scope.tour}' AND status='completed' AND NOT is_voided ORDER BY created_at DESC,id DESC LIMIT 1;`),scope.hand);
  assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${scope.tour}' AND status='in_progress';`),'0');
  assert.equal(sql(`SELECT count(*) FROM public.tournament_settlement_outcomes WHERE hand_id='${scope.hand}' AND source_revision=${scope.sourceRevision} AND verification_scope='historical_display' AND status='verified';`),'1');
  assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_array(seat_number,starting_stack,ending_stack,hole_cards) ORDER BY seat_number) FROM public.hand_players WHERE hand_id='${scope.hand}';`)),current24?[[1,58600,58800,['Ks','Kh']],[2,1400,1200,['As','Ah']]]:finish137?[[1,58600,58400,['Ks','Kh']],[2,1400,1600,['As','Ah']]]:review104?[[1,58600,58600,['Ks','Kh']],[2,1400,1400,['As','Ah']]]:[[1,58600,57200,['Ks','Kh']],[2,1400,2800,['As','Ah']]]);
  if(finish137){
   assert.equal(sql(`SELECT count(*) FROM floor_private.floor_table_v3_existing_receipt('${actor}','record_tracker_manual_hand_v1','b04fc2c9-56cf-46f0-a256-bda72e88fcd1') r WHERE r.result->>'hand_id'='${scope.hand}' AND (r.result->>'committed_source_revision')::bigint=21;`),'1');
   assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE id='${scope.hand}' AND hand_number=32 AND community_cards='["2c","3d","7s","9c","${current24?'Kc':'Jd'}"]'::jsonb AND pot_size=400;`),'1');
  }
 }else assert.equal(sql(`SELECT count(*) FROM public.tournament_hands WHERE tournament_id='${scope.tour}' AND status='completed' AND NOT is_voided;`),'1');
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object(
  'registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.tournament_registrations r WHERE tournament_id='${scope.tour}'),
  'cash',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.cashier_buyin_movements m WHERE tournament_id='${scope.tour}'),
  'prizes',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.tournament_prize_payments p WHERE tournament_id='${scope.tour}'),
  'otherHands',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.tournament_hands h WHERE tournament_id='${scope.tour}' AND id<>'${scope.hand}')
  ${single648?`, 'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s),
   -- Canonical correction refreshes updated_at even for unchanged stacks.
   -- Ignore only that metadata on the four exact hand participants; freeze
   -- every value/identity and every other row, including their timestamps.
   'chipCounts',(SELECT jsonb_agg(CASE WHEN c.tournament_id='${scope.tour}' AND EXISTS(
     SELECT 1 FROM public.hand_players h WHERE h.hand_id='${scope.hand}' AND h.player_id=c.player_id AND h.entry_number=c.entry_number)
     THEN to_jsonb(c)-'updated_at' ELSE to_jsonb(c) END ORDER BY tournament_id,player_id,entry_number) FROM public.tournament_chip_counts c),
   'inventory',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.chip_inventory_ledger l),
   'bank',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.chip_bank_ledger l)`:''}
 )::text);`);
 const before=fingerprint(),role='correction_browser_'+randomUUID().replaceAll('-','');
 const readOnlyFingerprint=()=>sql(`SELECT md5(jsonb_build_object(
  'hand',(SELECT to_jsonb(h) FROM public.tournament_hands h WHERE id='${scope.hand}'),
  'players',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.hand_players p WHERE hand_id='${scope.hand}'),
  'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.hand_actions a WHERE hand_id='${scope.hand}'),
  'outcomes',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tournament_settlement_outcomes o WHERE hand_id='${scope.hand}'),
  'seats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.tournament_seats s WHERE tournament_id='${scope.tour}'))::text);`);
 const readOnlyBefore=review104||review284?readOnlyFingerprint():null;
 let ownedScope;
 const releaseScope=()=>{if(!ownedScope)return;
  sql(finish137||single648?`UPDATE public.tracker_correction_uat_scopes SET enabled=false,expires_at=NULL WHERE id='${ownedScope}' AND tournament_id='${scope.tour}' AND user_id='${actor}' AND capability='correct_completed_hand';`
   :`DELETE FROM public.tracker_correction_uat_scopes WHERE id='${ownedScope}' AND tournament_id='${scope.tour}' AND user_id='${actor}' AND capability='correct_completed_hand';`);
 };
 if(finish137){
  ownedScope=sql(`UPDATE public.tracker_correction_uat_scopes SET enabled=true,expires_at=now()+interval '30 minutes'
   WHERE id='318970fa-cbcc-4719-ae24-111db3f7c912' AND club_id='${scope.club}' AND tournament_id='${scope.tour}' AND tournament_table_id='${scope.table}' AND user_id='${actor}' AND capability='correct_completed_hand' AND NOT enabled AND expires_at IS NULL RETURNING id;`);
  assert.equal(ownedScope,'318970fa-cbcc-4719-ae24-111db3f7c912','reuse only the exact disabled owned local test scope');
 }else if(winner103||single648){
  ownedScope=sql(`INSERT INTO public.tracker_correction_uat_scopes(club_id,tournament_id,tournament_table_id,user_id,capability,enabled,expires_at)
   VALUES('${scope.club}','${scope.tour}','${scope.table}','${actor}','correct_completed_hand',true,now()+interval '30 minutes')
   ON CONFLICT DO NOTHING RETURNING id;`);
  assert.match(ownedScope,/^[a-f0-9-]{36}$/,'new exact local correction scope only; never overwrite an existing scope');
 }
 const service=`SET request.jwt.claim.role='service_role';SET request.jwt.claims='{"role":"service_role"}';SET ROLE ${role};`;
 let runtime,roleCreated=false;
 try{sql(`CREATE ROLE ${role} NOLOGIN INHERIT BYPASSRLS;`);roleCreated=true;sql(`GRANT service_role TO ${role};`);
  runtime=await runPaidCorrectionEdge({sql,service,fixture:scope,hand:scope.hand,
  scenario:async({invoke,errors})=>({invoke,errors})});}
 catch(error){try{if(roleCreated)sql(`DROP ROLE ${role};`);}finally{releaseScope();}throw error;}
 const quote=value=>`'${String(value).replaceAll("'","''")}'`;
 let flight=false,drop=true,commitAttempts=0;
 let snapshotProbeFault=process.env.VINPOKER_SNAPSHOT_PROBE_FAULT285==='1';
 if(snapshotProbeFault)assert.ok(review284,'snapshot recovery probe requires exact revision24 readonly canary');
 const columns={
  tournament_hands:['id','hand_number','hand_time','community_cards','pot_size','status','is_voided','created_at','table_id','button_seat','table_session_id'],
  hand_players:['id','hand_id','player_id','entry_number','seat_number','starting_stack','ending_stack','is_eliminated','hole_cards','player_name'],
  hand_actions:['id','hand_id','player_id','entry_number','street','action_type','action_amount','action_order'],
  tournament_seats:['player_id','player_name','avatar_url'],
 };
 return {
  manifest:{hand:scope.hand,table:scope.table},
  async handle(url,method,body){
   if(method==='POST'&&url.pathname==='/functions/v1/tournament-live-resettle-commit'){
    assert.ok(['preview','commit','receipt','resolve'].includes(body.mode));
    if(review104||review284)assert.equal(body.mode,'preview','qualified review is read-only, no correction commit or receipt write');
    assert.equal(body.tournament_id,scope.tour);assert.equal(body.hand_id,scope.hand);
    if(body.expected_actor_id)assert.equal(body.expected_actor_id,actor);
    if(single648&&['preview','commit'].includes(body.mode)){
     assert.deepEqual(Object.keys(body.edit),['holeCards']);
     const changed=body.edit.holeCards.filter(row=>row.hole_cards.length>0);
     assert.deepEqual(changed,[{player_id:'5aa1f9dd-0c9a-4372-80e4-bcc1209a2ac5',entry_number:1,hole_cards:['As','Ad']}]);
     const ownPlayers=new Set(['bec45325-0c51-4851-9823-f8f3109f4644','e5eded2a-1efc-406f-b794-316a39a20a51','5aa1f9dd-0c9a-4372-80e4-bcc1209a2ac5','5c2bfc67-c546-4ddb-8209-e5c5693d82f5']);
     assert.ok(body.edit.holeCards.length<=4&&new Set(body.edit.holeCards.map(row=>row.player_id)).size===body.edit.holeCards.length
      &&body.edit.holeCards.every(row=>row.entry_number===1&&ownPlayers.has(row.player_id)));
     assert.deepEqual([...body.expected_target_ending_stacks].sort((a,b)=>a.player_id.localeCompare(b.player_id)),JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'ending_stack',ending_stack) ORDER BY player_id) FROM public.hand_players WHERE hand_id='${scope.hand}';`)));
     if(body.mode==='commit'){assert.equal(commitAttempts++,0,'use receipt after unknown correction outcome');assert.equal(body.expected_source_revision,15);}
    }
    if(commit290&&['preview','commit'].includes(body.mode)){
     assert.deepEqual(body.edit,{communityCards:['2c','3d','7s','9c','Kd']});
     assert.equal(body.correction_reason,'LOCAL correction290 TEST đổi chất K, giữ nguyên stack');
     assert.deepEqual([...body.expected_target_ending_stacks].sort((a,b)=>a.player_id.localeCompare(b.player_id)),JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('player_id',player_id,'entry_number',entry_number,'ending_stack',ending_stack) ORDER BY player_id) FROM public.hand_players WHERE hand_id='${scope.hand}';`)));
     if(body.mode==='commit'){assert.equal(commitAttempts++,0,'one commit attempt; use resolve/receipt after unknown response');assert.equal(body.expected_source_revision,24);}
    }
    assert.equal(flight,false,'one correction request in flight');flight=true;
    try{
     const response=await runtime.invoke(body),value=await response.json();
     log.push({correctionMode:body.mode,hand:scope.hand,status:response.status,result:value.status??value.code,
      ...(commit290||single648?{request:body.idempotency_key??null,sourceRevision:value.source_revision??value.current_source_revision??null}: {})});
     if(body.mode==='commit'&&response.ok&&drop){drop=false;log.push({correctionFault:'RESPONSE_LOST_AFTER_COMMIT'});
      return {status:503,value:{code:'LOCAL_CORRECTION_RESPONSE_LOSS'}};}
     return {status:response.status,value};
    }finally{flight=false;}
   }
   const rpc=url.pathname.match(/^\/rest\/v1\/rpc\/(list_tracker_tables_v2|list_tracker_history_tables_v1|get_tracker_historical_display_queue_status)$/)?.[1];
   if(method==='POST'&&rpc){
    assert.deepEqual(body,{p_tournament_id:scope.tour});
    const value=query(rpc!=='get_tracker_historical_display_queue_status'?`SELECT public.${rpc}('${scope.tour}');`
     :`SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM public.${rpc}('${scope.tour}')q;`);
    log.push({correctionRead:rpc});return {status:200,value};
   }
   const table=url.pathname.match(/^\/rest\/v1\/(tournament_hands|hand_players|hand_actions|tournament_seats)$/)?.[1];
   if(method==='GET'&&table){
    const selected=url.searchParams.get('select')?.replaceAll(' ','').split(',');
    assert.ok(selected?.length&&selected.every(column=>columns[table].includes(column)));
    if(snapshotProbeFault&&table==='hand_players'&&selected.length===1&&selected[0]==='player_name'&&url.searchParams.get('limit')==='1'){
     snapshotProbeFault=false;log.push({correctionRead:'snapshot_probe',fault:'LOCAL_SNAPSHOT_PROBE_503_ONCE',mutation:false});
     return {status:503,value:{code:'LOCAL_SNAPSHOT_PROBE_UNAVAILABLE',message:'LOCAL snapshot probe285 temporarily unavailable'}};
    }
    const where=[table==='tournament_hands'?`id='${scope.hand}'`:table==='tournament_seats'?`tournament_id='${scope.tour}'`:`hand_id='${scope.hand}'`];
    const filterColumns=new Set([...columns[table],'tournament_id']);
    for(const [key,value]of url.searchParams){
     if(['select','order','offset','limit'].includes(key))continue;
     assert.ok(filterColumns.has(key));
     if(value.startsWith('eq.'))where.push(`${key}=${quote(value.slice(3))}`);
     else if(value.startsWith('gte.'))where.push(`${key}>=${quote(value.slice(4))}`);
     else{assert.ok(value.startsWith('in.(')&&value.endsWith(')'));const ids=value.slice(4,-1).split(',');
      assert.ok(ids.length>0&&ids.length<=80&&ids.every(id=>/^[a-f0-9-]{36}$/i.test(id)));where.push(`${key} IN(${ids.map(quote).join(',')})`);}
    }
    const order=(url.searchParams.get('order')??'').split(',').filter(Boolean).map(part=>{
     const [key,direction]=part.split('.');assert.ok(columns[table].includes(key)&&['asc','desc'].includes(direction));return `${key} ${direction}`;
    });
    const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??1000);
    assert.ok(Number.isSafeInteger(offset)&&offset>=0&&offset<=1000&&Number.isSafeInteger(limit)&&limit>0&&limit<=1000);
    const value=query(`SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM(SELECT ${selected.join(',')} FROM public.${table}
     WHERE ${where.join(' AND ')}${order.length?' ORDER BY '+order.join(','):''} LIMIT ${limit} OFFSET ${offset})q;`);
    log.push({correctionRead:table,rows:value.length});return {status:200,value};
   }
   if(url.pathname==='/auth/v1/logout'||url.pathname==='/auth/v1/user'&&method==='GET')return null;
   return {status:403,value:{code:'LOCAL_CORRECTION_SCOPE_ONLY'}};
  },
  dispose(){
   try{assert.equal(fingerprint(),before);assert.deepEqual(runtime.errors,[]);
    if(review104||review284)assert.equal(readOnlyFingerprint(),readOnlyBefore,'preview-only browser changed canonical hand/proofs/seats');
    console.log('LOCAL_CORRECTION_BROWSER_CASH_REGISTRATIONS_PRIZES_OTHER_HANDS_UNCHANGED_PASS');}
   finally{try{sql(`DROP ROLE ${role};`);}finally{releaseScope();}}
  },
 };
}
