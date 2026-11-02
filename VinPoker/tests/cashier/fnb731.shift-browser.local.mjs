import assert from 'node:assert/strict';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const quote=v=>v===null?'NULL':`'${String(v).replaceAll("'","''")}'`;
export function createFnb731Shift({sql,query,log,fixture,actor}){
 const f=JSON.parse(sql('SELECT fixture FROM floor_private.fnb731_browser_fixture;'));
 assert.equal(f.test_only,true);assert.equal(f.club,fixture.club);assert.equal(f.actor,actor);
 for(const key of ['club','actor','tour','menu','ingredient'])assert.ok(uuid(f[key]));
 assert.equal(sql("SELECT to_regprocedure('public.fnb_open_shift_v2(uuid,bigint,text,uuid)') IS NOT NULL;"),'t');
 const ownOrders=`SELECT order_id FROM public.fnb_order_items WHERE menu_item_id='${f.menu}'`;
 const nonTarget=()=>sql(`SELECT md5(jsonb_build_array(
  ${Object.entries({fnb_orders:`id NOT IN(${ownOrders})`,fnb_order_items:`menu_item_id<>'${f.menu}'`,fnb_order_events:`order_id NOT IN(${ownOrders})`,
   fnb_stock_movements:`ingredient_id<>'${f.ingredient}'`,fnb_ingredients:`id<>'${f.ingredient}'`,fnb_menu_items:`id<>'${f.menu}'`,fnb_recipe_items:`menu_item_id<>'${f.menu}'`,
   bank_transactions:'true',payment_settlements:'true',cashier_buyin_movements:'true',tournament_prize_payments:'true',tournament_hands:'true',tournament_seats:'true'}).map(([t,w])=>`(SELECT jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text) FROM public.${t} x WHERE ${w})`).join(',')})::text);`);
 const before=nonTarget();
 const hasOpenReceipt=sql(`SELECT EXISTS(SELECT 1 FROM floor_private.fnb_shift_intents_v1 WHERE actor='${actor}' AND payload->>'operation'='open' AND payload->>'club'='${f.club}');`)==='t';
 let loseOpen=!hasOpenReceipt,loseClose=false,loseCreate=false,dropCreate=false,loseCancel=false,createReceiptFault=false,receiptFault=!hasOpenReceipt;
 const record=(name,body,value)=>{log.push({fnb731:name,request:body.p_client_request_id??body.p_request_id??null,shift:value?.shift_id??null,status:value?.status??null});};
 const routes=['fnb_club_ids','fnb_list_link_targets','fnb_open_shift_v2','fnb_close_shift_v2','fnb_get_shift_report','fnb_get_shift_intent_v1','fnb_cancel_shift_intent_v1','fnb_create_order','fnb_create_comp_order','fnb_get_create_receipt_v1','fnb_cancel_create_intent_v1','fnb_mark_paid','fnb_cancel_order'];
 const money=n=>{assert.ok(Number.isSafeInteger(n)&&n>=0);return n;};
 const sameShift=id=>{assert.ok(uuid(id));assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.fnb_cashier_shifts WHERE id='${id}' AND club_id='${f.club}');`),'t');return quote(id);};
 return {matches(url){return url.pathname==='/rest/v1/clubs'&&url.searchParams.has('id')||routes.some(r=>url.pathname===`/rest/v1/rpc/${r}`)||/^\/rest\/v1\/fnb_/.test(url.pathname);},
  command(command){if(command==='fnb-shift-receipt-ready'){receiptFault=false;return true;}if(command==='fnb-shift-close-loss'){loseClose=true;receiptFault=true;return true;}if(command==='fnb-create-loss'){loseCreate=true;dropCreate=false;createReceiptFault=true;return true;}if(command==='fnb-create-before-loss'){dropCreate=true;loseCreate=false;createReceiptFault=false;return true;}if(command==='fnb-cancel-response-loss'){loseCancel=true;createReceiptFault=true;return true;}if(command==='fnb-create-receipt-ready'){createReceiptFault=false;return true;}return false;},
  handle(url,method,body){
   let value;const name=url.pathname.split('/').at(-1);
   if(name==='clubs'){
    assert.equal(method,'GET');assert.equal(url.searchParams.get('select'),'id,name');assert.equal(url.searchParams.get('id'),`in.(${f.club})`);
    value=query(`SELECT jsonb_agg(jsonb_build_object('id',id,'name',name)) FROM public.clubs WHERE id='${f.club}';`);
   }else if(method==='GET'){
    assert.equal(url.searchParams.get('select'),'*');
    const simple={fnb_categories:'sort_order.asc,name.asc',fnb_menu_items:'sort_order.asc',fnb_ingredients:'name.asc',fnb_cashier_shifts:'opened_at.desc'};
    if(simple[name]){
     assert.equal(url.searchParams.get('club_id'),`eq.${f.club}`);assert.equal(url.searchParams.get('order'),simple[name]);
     if(name==='fnb_cashier_shifts')assert.equal(url.searchParams.get('limit'),'20');
     value=query(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (SELECT * FROM public.${name} WHERE club_id='${f.club}' ORDER BY ${simple[name].split(',').map(p=>p.replace('.asc',' ASC').replace('.desc',' DESC')).join(',')} ${name==='fnb_cashier_shifts'?'LIMIT 20':''}) x;`);
    }else if(name==='fnb_orders'){
     assert.equal(url.searchParams.get('club_id'),`eq.${f.club}`);assert.equal(url.searchParams.get('limit'),'100');assert.equal(url.searchParams.get('order'),'created_at.desc');
     const statuses=url.searchParams.get('status');assert.match(statuses,/^in\.\((pending|paid|shipped|cancelled|expired)(,(pending|paid|shipped|cancelled|expired))*\)$/);
     value=query(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (SELECT * FROM public.fnb_orders WHERE club_id='${f.club}' AND status::text IN(${statuses.slice(4,-1).split(',').map(quote).join(',')}) ORDER BY created_at DESC LIMIT 100) x;`);
    }else if(name==='fnb_order_items'){
     const ids=url.searchParams.get('order_id');assert.match(ids,/^in\.\(.+\)$/);const list=ids.slice(4,-1).split(',');assert.ok(list.every(uuid));
     value=query(`SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM public.fnb_order_items x WHERE club_id='${f.club}' AND order_id IN(${list.map(quote).join(',')});`);
    }else throw Error('unsupported FNB731 read');
   }else{
    assert.equal(method,'POST');assert.ok(routes.includes(name));
    if(name==='fnb_club_ids'){assert.deepEqual(body,{_user_id:actor});value=query(`SELECT coalesce(jsonb_agg(id),'[]'::jsonb) FROM public.fnb_club_ids('${actor}') id;`);assert.deepEqual(value,[f.club]);}
    else if(name==='fnb_list_link_targets'){assert.deepEqual(body,{p_club_id:f.club});value=query(`SELECT public.fnb_list_link_targets('${f.club}');`);}
    else if(name==='fnb_get_shift_report')value=query(`SELECT public.fnb_get_shift_report(${sameShift(body.p_shift_id)});`);
    else if(name==='fnb_get_shift_intent_v1'){
     assert.equal(body.p_expected_actor,actor);assert.equal(body.p_club_id,f.club);assert.ok(uuid(body.p_request_id));
     value=query(`SELECT public.fnb_get_shift_intent_v1('${f.club}','${body.p_request_id}','${actor}');`);
     if(receiptFault){record('receipt_503_after_native_read',body,value);return {status:503,value:{message:'LOCAL731_RECEIPT_UNAVAILABLE'}};}
    }else if(name==='fnb_open_shift_v2'){
     assert.equal(body.p_expected_actor,actor);assert.equal(body.p_club_id,f.club);assert.ok(uuid(body.p_client_request_id));
     value=query(`SELECT public.fnb_open_shift_v2('${f.club}',${money(body.p_opening_float_vnd)},'${body.p_client_request_id}','${actor}');`);
     if(loseOpen){loseOpen=false;record('open_COMMIT_response_503',body,value);return {status:503,value:{message:'LOCAL731_COMMITTED_RESPONSE_LOST'}};}
    }else if(name==='fnb_close_shift_v2'){
     assert.equal(body.p_expected_actor,actor);assert.ok(uuid(body.p_client_request_id));assert.equal(body.p_note,null);
     value=query(`SELECT public.fnb_close_shift_v2(${sameShift(body.p_shift_id)},${money(body.p_counted_cash_vnd)},NULL,'${body.p_client_request_id}','${actor}');`);
     if(loseClose){loseClose=false;record('close_COMMIT_response_503',body,value);return {status:503,value:{message:'LOCAL731_COMMITTED_RESPONSE_LOST'}};}
    }else if(name==='fnb_cancel_shift_intent_v1'){
     assert.equal(body.p_expected_actor,actor);assert.equal(body.p_club_id,f.club);assert.ok(uuid(body.p_request_id));assert.ok(['open','close'].includes(body.p_operation));assert.equal(body.p_note,null);
     value=query(`SELECT public.fnb_cancel_shift_intent_v1('${f.club}',${quote(body.p_operation)},${body.p_operation==='open'?(assert.equal(body.p_shift_id,null),'NULL'):sameShift(body.p_shift_id)},${money(body.p_amount_vnd)},NULL,'${body.p_request_id}','${actor}');`);
    }else if(name==='fnb_get_create_receipt_v1'){
     assert.equal(body.p_club_id,f.club);assert.equal(body.p_expected_actor,actor);assert.ok(uuid(body.p_request_id));
     value=query(`SELECT public.fnb_get_create_receipt_v1('${f.club}','${body.p_request_id}','${actor}');`);
     if(createReceiptFault){record('create_receipt_503_after_native_read',body,value);return {status:503,value:{message:'LOCAL736_CREATE_RECEIPT_UNAVAILABLE'}};}
    }else if(name==='fnb_cancel_create_intent_v1'){
     assert.equal(body.p_club_id,f.club);assert.equal(body.p_expected_actor,actor);assert.ok(uuid(body.p_request_id));assert.ok(['order','comp'].includes(body.p_operation));
     const p=body.p_payload;assert.equal(p.source,'counter');assert.equal(p.lines.length,1);assert.equal(p.lines[0].menu_item_id,f.menu);assert.equal(p.lines[0].qty,1);
     value=query(`SELECT public.fnb_cancel_create_intent_v1('${f.club}','${body.p_request_id}','${actor}',${quote(body.p_operation)},${quote(JSON.stringify(p))}::jsonb);`);
     if(loseCancel){loseCancel=false;record('cancel_COMMIT_response_503',body,value);return {status:503,value:{message:'LOCAL740_COMMITTED_CANCEL_RESPONSE_LOST'}};}
    }else if(name==='fnb_create_comp_order'){
     assert.equal(body.p_club_id,f.club);assert.equal(body.p_source,'counter');assert.ok(uuid(body.p_client_request_id));
     assert.equal(body.p_lines.length,1);assert.equal(body.p_lines[0].menu_item_id,f.menu);assert.equal(body.p_lines[0].qty,1);
     assert.ok(body.p_comp_reason===null||typeof body.p_comp_reason==='string');
     if(dropCreate){dropCreate=false;record('comp_NOT_DISPATCHED',body,null);return {status:503,value:{message:'LOCAL740_COMP_PRE_DISPATCH_DROPPED'}};}
     value=query(`SELECT public.fnb_create_comp_order('${f.club}','counter',${quote(body.p_table_label)},${quote(body.p_customer_name)},${quote(body.p_note)},${quote(JSON.stringify(body.p_lines))}::jsonb,${quote(body.p_comp_reason)},'${body.p_client_request_id}');`);
     if(loseCreate){loseCreate=false;record('comp_COMMIT_response_503',body,value);return {status:503,value:{message:'LOCAL736_COMMITTED_COMP_RESPONSE_LOST'}};}
    }else if(name==='fnb_create_order'){
     assert.equal(body.p_club_id,f.club);assert.equal(body.p_source,'counter');assert.equal(body.p_table_ref,null);assert.equal(body.p_player_ref,null);assert.ok(uuid(body.p_client_request_id));
     assert.equal(body.p_lines.length,1);assert.equal(body.p_lines[0].menu_item_id,f.menu);assert.ok([1,2,3].includes(body.p_lines[0].qty));
     if(dropCreate){dropCreate=false;record('create_NOT_DISPATCHED',body,null);return {status:503,value:{message:'LOCAL740_CREATE_PRE_DISPATCH_DROPPED'}};}
     value=query(`SELECT public.fnb_create_order('${f.club}','counter',${quote(body.p_table_label)},${quote(body.p_customer_name)},${quote(body.p_note)},${quote(JSON.stringify(body.p_lines))}::jsonb,'${body.p_client_request_id}',NULL,NULL);`);
     if(loseCreate){loseCreate=false;record('create_COMMIT_response_503',body,value);return {status:503,value:{message:'LOCAL735_COMMITTED_CREATE_RESPONSE_LOST'}};}
    }else{
     assert.ok(uuid(body.p_order_id));assert.equal(sql(`SELECT EXISTS(SELECT 1 FROM public.fnb_orders WHERE id='${body.p_order_id}' AND club_id='${f.club}' AND id IN(${ownOrders}));`),'t','only731 orders may be paid/cancelled');
     value=query(name==='fnb_mark_paid'?`SELECT public.fnb_mark_paid('${body.p_order_id}');`:`SELECT public.fnb_cancel_order('${body.p_order_id}',${quote(body.p_reason??null)});`);
    }
   }
   record(name,body??{},value);return {value};
  },verify(){assert.equal(nonTarget(),before,'all non731 orders/stock/bank/tournament facts must remain unchanged');
   assert.equal(sql(`SELECT on_hand=20+coalesce((SELECT sum(delta) FROM public.fnb_stock_movements WHERE ingredient_id='${f.ingredient}'),0) FROM public.fnb_ingredients WHERE id='${f.ingredient}';`),'t');
   console.log('FNB731_OTHER_THIRTEEN_TABLE_FACTS_UNCHANGED_OWN_STOCK_LEDGER_CONSERVED');}
 };
}
