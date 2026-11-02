import assert from 'node:assert/strict';
export function createFnb384Kitchen({sql,query,log,fixture,actor}){
 const readOnly=process.env.VINPOKER_FNB385_READONLY==='1';
 const sessionReadOnly=process.env.VINPOKER_FNB607_SESSION_READ==='1';
 assert.ok(!sessionReadOnly||readOnly,'session probe must be read-only');
 const f=JSON.parse(sql('SELECT fixture FROM floor_private.fnb384_fixture;'));
 assert.equal(f.actor,actor);assert.equal(f.club,fixture.club);assert.equal(f.tour,fixture.tour);
 assert.equal(sql("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='public.fnb_mark_shipped(uuid,uuid)'::regprocedure;"),'31b85897c490845913ab864bdfd5320c');
 const filters={fnb_orders:`id<>'${f.order}'`,fnb_order_items:`order_id<>'${f.order}'`,fnb_order_events:`order_id<>'${f.order}'`,fnb_ingredients:`id<>'${f.ingredient}'`,
  fnb_menu_items:`id NOT IN(SELECT menu_item_id FROM public.fnb_order_items WHERE order_id='${f.order}')`,fnb_recipe_items:`menu_item_id NOT IN(SELECT menu_item_id FROM public.fnb_order_items WHERE order_id='${f.order}')`,
  fnb_stock_movements:`ref_id IS DISTINCT FROM '${f.order}'::uuid`,cashier_buyin_movements:'true',tournament_prize_payments:'true',notifications:'true'};
 const other=()=>sql(`SELECT md5(jsonb_build_array(${Object.entries(filters).map(([table,where])=>`(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.${table} t WHERE ${where})`).join(',')})::text);`);
 const before=other();
 if(sessionReadOnly){assert.match(process.env.VINPOKER_FNB607_EXPECTED_FACTS??'',/^[a-f0-9]{32}$/);assert.equal(before,process.env.VINPOKER_FNB607_EXPECTED_FACTS);}
 else assert.equal(before,'aff064478c8c3cf2ba56a91cc6e72a5e');
 const full=()=>sql(`SELECT md5(jsonb_build_array(${Object.keys(filters).map(table=>`(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.${table} t)`).join(',')})::text);`);
 const fullBefore=sessionReadOnly?full():null;
 let queueFault=false;
 return {setQueueFault(value){assert.ok(sessionReadOnly&&readOnly);queueFault=value;},paths:['/rest/v1/rpc/fnb_club_ids','/rest/v1/rpc/fnb_list_link_targets',...(readOnly?[]:['/rest/v1/rpc/fnb_mark_shipped']),'/rest/v1/fnb_orders','/rest/v1/fnb_order_items'],
  handle(url,method,body){
   let value;
   if(method==='POST'&&url.pathname==='/rest/v1/rpc/fnb_club_ids'){
    assert.deepEqual(body,{_user_id:actor});value=query(`SELECT coalesce(jsonb_agg(id),'[]'::jsonb) FROM public.fnb_club_ids('${actor}') id;`);assert.deepEqual(value,[f.club]);
   }else if(method==='POST'&&url.pathname==='/rest/v1/rpc/fnb_list_link_targets'){
    assert.deepEqual(body,{p_club_id:f.club});value=query(`SELECT public.fnb_list_link_targets('${f.club}');`);
   }else if(method==='POST'&&url.pathname==='/rest/v1/rpc/fnb_mark_shipped'){
    assert.ok(!readOnly,'layout review cannot ship');
    assert.deepEqual(Object.keys(body).sort(),['p_line_id','p_order_id']);assert.equal(body.p_order_id,f.order);assert.ok(body.p_line_id===null||f.lines.includes(body.p_line_id));
    value=query(`SELECT public.fnb_mark_shipped('${f.order}',${body.p_line_id===null?'NULL':`'${body.p_line_id}'`}::uuid);`);
    log.push({test:'FNB384_KITCHEN_CANONICAL_SHIP',order:f.order,line:body.p_line_id,result:value});return {value};
   }else if(method==='GET'&&url.pathname==='/rest/v1/fnb_orders'){
    assert.equal(url.searchParams.get('select'),'*');assert.equal(url.searchParams.get('club_id'),`eq.${f.club}`);assert.equal(url.searchParams.get('status'),'eq.paid');assert.equal(url.searchParams.get('order'),'paid_at.asc');assert.equal(url.searchParams.get('limit'),'100');
    value=query(`SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY paid_at),'[]'::jsonb) FROM (SELECT * FROM public.fnb_orders WHERE club_id='${f.club}' AND status='paid' ORDER BY paid_at LIMIT 100) o;`);
    assert.ok(value.every(row=>row.id===f.order),'do not filter away unexpected older paid TEST orders');
    if(queueFault){log.push({test:'FNB607_QUEUE_503_AFTER_NATIVE_READ',rows:value.length});return {status:503,value:{message:'LOCAL607_QUEUE_READ_UNAVAILABLE'}};}
   }else if(method==='GET'&&url.pathname==='/rest/v1/fnb_order_items'){
    assert.equal(url.searchParams.get('select'),'*');assert.equal(url.searchParams.get('order_id'),`in.(${f.order})`);
    value=query(`SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY id),'[]'::jsonb) FROM public.fnb_order_items i WHERE order_id='${f.order}';`);
   }else throw new Error('unsupported FNB384 route');
   log.push({test:'FNB384_KITCHEN_NATIVE_READ',path:url.pathname,rows:Array.isArray(value)?value.length:null});return {value};
  },verify(){assert.equal(other(),before);if(sessionReadOnly)assert.equal(full(),fullBefore);assert.equal(sql(`SELECT on_hand FROM public.fnb_ingredients WHERE id='${f.ingredient}';`),'7');console.log(sessionReadOnly?'FNB607_FULL_TEN_TABLE_FACTS_UNCHANGED_STOCK7_PASS':'FNB384_KITCHEN_OTHER_TEN_TABLE_FACTS_UNCHANGED_STOCK7_PASS');}};
}
