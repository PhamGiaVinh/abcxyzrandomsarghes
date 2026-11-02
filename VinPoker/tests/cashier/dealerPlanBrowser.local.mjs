import assert from 'node:assert/strict';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
export function createDealerPlanBrowser({scope,sql,query,log}){
 assert.match(scope.prefix,/^[a-f0-9]{8}$/);
 const id=n=>`${scope.prefix}-0000-4000-8000-${String(n).padStart(12,'0')}`;
 for(const [k,n] of [['actor',1],['club',2],['table',11],['session',21],['tour',3],['incoming',44]])assert.equal(scope[k],id(n));
 assert.ok(uuid(scope.assignment.id));
 assert.equal(sql(`SELECT md5(replace(pg_get_functiondef('public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)'::regprocedure),chr(13),''));`),'c6adcb202cccc977d0061a681e337740');
 assert.equal(sql(`SELECT md5(replace(pg_get_functiondef('public.operator_plan_next_dealer_v1(uuid,uuid,integer,uuid,uuid)'::regprocedure),chr(13),''));`),'2f5bc9c0aeba16b74839b0d9318b6d3c');
 assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.clubs c JOIN public.table_sessions s ON s.club_id=c.id
  JOIN public.tournaments t ON t.club_id=c.id JOIN public.dealer_assignments a ON a.table_session_id=s.id
  WHERE c.id='${scope.club}' AND c.owner_id='${scope.actor}' AND c.name='Operational TEST'
  AND t.id='${scope.tour}' AND t.name='Operational TEST' AND s.id='${scope.session}' AND s.game_table_id='${scope.table}'
  AND s.closed_at IS NULL AND a.id='${scope.assignment.id}' AND a.status='assigned' AND a.released_at IS NULL);`),'t');
 assert.equal(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${scope.club}';`),'f');
 const financial=()=>sql(`SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_inventory_ledger x),
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_bank_ledger x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x))::text);`);
 const facts=()=>sql(`SELECT jsonb_agg(jsonb_build_object('id',id,'in',check_in_time,'out',check_out_time,'worked',total_worked_minutes_today,'ot',overtime_minutes) ORDER BY id)
  FROM public.dealer_attendance WHERE id IN('${id(41)}','${scope.incoming}');`);
 const beforeMoney=financial(),beforeFacts=facts(),frozen=new Map();
 let closeProof=null;
 const plan={p_table_session_id:'uuid',p_assignment_id:'uuid',p_expected_assignment_version:'integer',p_next_attendance_id:'uuid',p_request_id:'uuid'};
 const swing={p_actor_user_id:'uuid',p_club_id:'uuid',p_table_id:'uuid',p_table_session_id:'uuid',p_assignment_id:'uuid',p_expected_version:'integer',p_request_id:'uuid'};
 const contracts={operator_plan_next_dealer_v1:plan,get_dealer_next_intent_receipt_v1:plan,operator_perform_swing_v2:swing,
  get_dealer_manual_swing_receipt_v1:swing,cancel_dealer_manual_swing_v1:swing,
  operator_close_club_table_v2:{p_table_session_id:'uuid',p_expected_revision:'bigint',p_request_id:'uuid'}};
 return {manifest:{table:scope.table,session:scope.session,assignment:scope.assignment.id},cleanup(){assert.equal(financial(),beforeMoney);assert.equal(facts(),beforeFacts);
   assert.equal(sql(`SELECT auto_swing_enabled FROM public.club_settings WHERE club_id='${scope.club}';`),'f');console.log('DEALER_BROWSER_FINANCIAL_TIME_FACTS_UNCHANGED_AUTO_OFF_PASS');},
  route(url,method,body){
   if(method==='GET'&&url.pathname==='/__local/dealer-state'){
    const value=query(`SELECT jsonb_build_object(
    'inventory',(SELECT to_jsonb(i) FROM public.get_club_table_inventory('${scope.club}') i WHERE game_table_id='${scope.table}'),
    'assignment',(SELECT to_jsonb(a) FROM public.dealer_assignments a WHERE table_session_id='${scope.session}' AND status='assigned' AND released_at IS NULL),
    'dealers',(SELECT jsonb_agg(to_jsonb(a)||jsonb_build_object('dealers',to_jsonb(d)) ORDER BY a.id) FROM public.dealer_attendance a JOIN public.dealers d ON d.id=a.dealer_id WHERE a.id IN('${id(41)}','${scope.incoming}'))
   );`);
    assert.ok(value.inventory);const active=value.inventory.table_session_id===scope.session;
    const closed=value.inventory.table_session_id===null&&closeProof?.closed===true;
    assert.ok(active||closed,'exact session is unverified, never infer a replacement');
    value.session={id:scope.session,revision:closed?closeProof.revision:value.inventory.revision,closed};
    return {value};
   }
   const name=url.pathname.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/)?.[1],fields=contracts[name];
   if(!fields||method!=='POST')return null;
   assert.deepEqual(Object.keys(body).sort(),Object.keys(fields).sort());
   for(const [key,type] of Object.entries(fields))assert.ok(type==='uuid'?uuid(body[key]):Number.isSafeInteger(body[key])&&body[key]>=0);
   assert.equal(body.p_table_session_id,scope.session);
   if('p_assignment_id'in body)assert.equal(body.p_assignment_id,scope.assignment.id);
   if('p_actor_user_id'in body)assert.equal(body.p_actor_user_id,scope.actor);
   if('p_club_id'in body)assert.equal(body.p_club_id,scope.club);
   if('p_table_id'in body)assert.equal(body.p_table_id,scope.table);
   if('p_next_attendance_id'in body)assert.equal(body.p_next_attendance_id,scope.incoming);
   const category=name.includes('next')?'plan':name==='operator_close_club_table_v2'?'close':'swing';
   if(frozen.has(category))assert.deepEqual(body,frozen.get(category),'one exact request per canary operation');else frozen.set(category,structuredClone(body));
   const args=Object.entries(fields).map(([key,type])=>`${key}=>${type==='uuid'?`'${body[key]}'`:body[key]}::${type}`).join(',');
   const value=query(`SELECT public.${name}(${args});`);log.push({rpc:name,requestId:body.p_request_id,result:value});
   if(name==='operator_close_club_table_v2'&&value?.ok===true&&value.closed===true&&value.table_session_id===scope.session)closeProof=value;
   return {value,kind:name==='operator_plan_next_dealer_v1'?'plan':name==='operator_perform_swing_v2'?'swing':null,key:body.p_request_id};
  }};
}
