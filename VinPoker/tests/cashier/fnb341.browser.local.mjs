import assert from 'node:assert/strict';
// Exact retained TEST fixture. No payment, external notification or arbitrary SQL endpoint.
export function createFnb341Browser({sql,log,name='TEST341',fault='disconnect',readOnly=false}){
 assert.ok(['TEST341','TEST342','TEST349','TEST350'].includes(name));assert.ok(['disconnect','503','before503','none'].includes(fault));
 assert.equal(sql("SELECT current_database()||'|'||host(inet_server_addr())||'|'||inet_server_port();"),'vinpoker_ops_cash115_qualified_c|127.0.0.1|55441');
 const f=JSON.parse(sql('SELECT fixture FROM floor_private.fnb335_fixture;'));
 assert.equal(f.completed,true);assert.equal(f.club,'ddcd5243-42be-49cf-897b-2027a35893e5');
 assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fnb_guest_order_receipt_v1(text,smallint,text,text,jsonb,text,text)'::regprocedure;"),'6ad2faf30241557404a88af898b1e8b7');
 const literal=x=>x==null?'NULL':`'${String(x).replaceAll("'","''")}'`;
 const run=q=>JSON.parse(sql(`BEGIN;SET LOCAL request.jwt.claims='{"role":"anon"}';SET LOCAL ROLE anon;${q}COMMIT;`));
 const existing=JSON.parse(sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('request',request_id,'order',order_id)),'[]'::jsonb) FROM floor_private.fnb_guest_request_receipts_v1 WHERE payload->>'customer_name'=${literal(name)};`));
 assert.ok(existing.length<=1);let requestId=existing[0]?.request??null,orderId=existing[0]?.order??null,dropOnce=!orderId;
 const fingerprint=()=>sql(`SELECT md5(jsonb_build_object('orders',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_orders x WHERE club_id<>'${f.club}'),
 'items',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.fnb_order_items x WHERE club_id<>'${f.club}'),
 'cash',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.cashier_buyin_movements x),
 'prizes',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tournament_prize_payments x),
 'notices',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.notifications x))::text);`);
 const before=fingerprint();let statusFault=false,menuFault=false;
 return {setStatusFault(value){statusFault=value;},setMenuFault(value){menuFault=value;},manifest:{url:`http://127.0.0.1:5188/fnb/order?t=${f.tokens[0]}`,menuUrl:readOnly?`http://127.0.0.1:5188/fnb/order?t=${f.tokens[1]}`:null,resumed:!!orderId},
 handle({url,method,body}){
  if(!url.pathname.startsWith('/rest/v1/rpc/fnb_guest_'))return null;
  assert.equal(method,'POST');
  const rpc=url.pathname.slice('/rest/v1/rpc/'.length);
  if(readOnly&&rpc==='fnb_guest_lookup')assert.ok(f.tokens.includes(body.p_token));else assert.equal(body.p_token,f.tokens[0]);
  if(rpc==='fnb_guest_lookup'){
   const value=run(`SELECT public.fnb_guest_lookup(${literal(body.p_token)});`);
   return {value:menuFault?{...value,items:null}:value};
  }
  if(rpc==='fnb_guest_order_status'){
   if(statusFault)return {status:503,value:{message:'LOCAL343_STATUS_READ_UNAVAILABLE'}};
   if(body.p_order_id!==orderId){assert.ok(['4e78cef4-6e80-4d39-a700-628efce6c2da','9c6b42ed-6bc0-4b4a-b537-7417a84621bc'].includes(body.p_order_id));
    assert.equal(sql(`SELECT count(*) FROM public.fnb_orders WHERE id=${literal(body.p_order_id)}::uuid AND club_id='ddcd5243-42be-49cf-897b-2027a35893e5';`),'1');}
   return {value:run(`SELECT public.fnb_guest_order_status(${literal(f.tokens[0])},${literal(body.p_order_id)}::uuid);`)};
  }
  assert.ok(['fnb_guest_create_order','fnb_guest_order_receipt_v1','fnb_guest_abandon_request_v1'].includes(rpc));
  assert.ok(!readOnly||rpc==='fnb_guest_order_receipt_v1','read-only343 cannot mutate');
  assert.equal(body.p_seat,3);assert.equal(body.p_customer_name,name);assert.equal(body.p_note,null);assert.equal(body.p_payment_method,name==='TEST350'?'bank_transfer':'cash');
  assert.deepEqual(body.p_lines,[{menu_item_id:f.item,qty:1}]);assert.match(body.p_client_request_id,/^[a-f0-9-]{36}$/i);
  if(requestId)assert.equal(body.p_client_request_id,requestId);else requestId=body.p_client_request_id;
  if(rpc==='fnb_guest_create_order'&&fault==='before503'){
   log.push({rpc,fault:'FNB349_503_BEFORE_ANY_DB_CREATE',requestId});return {status:503,value:{message:'LOCAL_TEST_REQUEST_NOT_SENT_TO_DB'}};
  }
  const args=[body.p_token,body.p_seat,body.p_customer_name,body.p_note,JSON.stringify(body.p_lines),body.p_payment_method,body.p_client_request_id];
  const encoded=args.map((x,i)=>i===1?`${x}::smallint`:i===4?`${literal(x)}::jsonb`:literal(x)).join(',');
  const value=run(`SELECT public.${rpc}(${encoded});`);
  log.push({rpc,requestId,result:value.error??value.status??(value.found?'found':'missing'),order:value.order_id??value.receipt?.order_id??null});
  if(rpc==='fnb_guest_create_order'&&value.status==='ok'){
   if(orderId)assert.equal(value.order_id,orderId);orderId=value.order_id;
   if(fault==='503'){log.push({fault:'FNB342_503_AFTER_COMMIT',requestId,order:orderId});return {status:503,value:{message:'LOCAL_TEST_RESPONSE_LOST_AFTER_COMMIT'}};}
   if(dropOnce&&fault==='disconnect'){dropOnce=false;log.push({fault:'FNB341_RESPONSE_DROPPED_AFTER_COMMIT',requestId,order:orderId});return {drop:true};}
  }
  return {value};
 },verify(){assert.equal(fingerprint(),before);console.log('FNB341_OTHER_ORDERS_CASH_PRIZES_NOTICES_UNCHANGED_PASS');}};
}
