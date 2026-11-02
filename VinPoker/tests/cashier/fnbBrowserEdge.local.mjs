import assert from 'node:assert/strict';
// Strict local adapter: no arbitrary SQL, all writes execute real authenticated RPCs.
export function runFnbBrowserEdge({url,method,body,fixture,actor,query,log}){
  const literal=value=>value==null?'NULL':`'${String(value).replaceAll("'","''")}'`;
  const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
  const collect=statement=>query(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM (${statement}) t;`);
  const rpc=url.pathname.match(/^\/rest\/v1\/rpc\/(fnb_club_ids|fnb_list_link_targets|fnb_create_order|fnb_create_comp_order|fnb_mark_paid|fnb_cancel_order|fnb_mark_shipped)$/)?.[1];
  if(rpc&&method==='POST'){
    let args;
    if(rpc==='fnb_club_ids'){
      assert.deepEqual(body,{_user_id:actor});
      return {status:200,value:query(`SELECT coalesce(jsonb_agg(id),'[]'::jsonb) FROM public.fnb_club_ids('${actor}') id;`)};
    }
    if(rpc==='fnb_list_link_targets'){assert.deepEqual(body,{p_club_id:fixture.club});args=literal(fixture.club);}
    else if(rpc==='fnb_create_order'||rpc==='fnb_create_comp_order'){
      assert.equal(body.p_club_id,fixture.club);assert.equal(body.p_source,'counter');
      assert.ok(Array.isArray(body.p_lines)&&body.p_lines.length>0&&body.p_lines.length<=20);
      for(const line of body.p_lines){assert.ok(uuid(line.menu_item_id));assert.ok(Number.isSafeInteger(line.qty)&&line.qty>0&&line.qty<=20);}
      assert.ok(uuid(body.p_client_request_id));
      for(const field of ['p_table_label','p_customer_name','p_note','p_comp_reason'])assert.ok(body[field]==null||(typeof body[field]==='string'&&body[field].length<=500));
      args=[fixture.club,'counter',body.p_table_label,body.p_customer_name,body.p_note].map(literal).join(',')+`,${literal(JSON.stringify(body.p_lines))}::jsonb,`;
      if(rpc==='fnb_create_comp_order')args+=`${literal(body.p_comp_reason)},${literal(body.p_client_request_id)}`;
      else {assert.ok(body.p_table_ref==null&&body.p_player_ref==null,'walk-in TEST only');args+=`${literal(body.p_client_request_id)},NULL,NULL`;}
    }else{
      assert.ok(uuid(body.p_order_id));
      assert.equal(query(`SELECT to_jsonb(EXISTS(SELECT 1 FROM public.fnb_orders WHERE id='${body.p_order_id}' AND club_id='${fixture.club}'));`),true);
      args=literal(body.p_order_id);
      if(rpc==='fnb_cancel_order'){assert.ok(typeof body.p_reason==='string'&&body.p_reason.length<=500);args+=`,${literal(body.p_reason)}`;}
      if(rpc==='fnb_mark_shipped'){assert.ok(body.p_line_id==null||uuid(body.p_line_id));args+=`,${literal(body.p_line_id)}`;}
    }
    const value=query(`SELECT public.${rpc}(${args});`);
    log.push({rpc,requestId:body.p_client_request_id??null,order:value.order_id??body.p_order_id??null,outcome:value.error??value.status});
    return {status:200,value};
  }
  if(method!=='GET')return null;
  if(url.pathname==='/rest/v1/clubs'&&url.searchParams.has('id')){
    assert.equal(url.searchParams.get('select'),'id,name');
    const ids=url.searchParams.get('id');assert.match(ids,/^in\.\([a-f0-9,"-]+\)$/i);
    const requested=ids.slice(4,-1).replaceAll('"','').split(',');assert.ok(requested.every(uuid));
    const allowed=query(`SELECT coalesce(jsonb_agg(id),'[]'::jsonb) FROM public.fnb_club_ids('${actor}') id;`);
    assert.ok(requested.every(id=>allowed.includes(id)));
    return {status:200,value:collect(`SELECT id,name FROM public.clubs WHERE id IN(${requested.map(literal).join(',')}) ORDER BY (id='${fixture.club}') DESC,id`)};
  }
  const table=url.pathname.match(/^\/rest\/v1\/(fnb_categories|fnb_menu_items|fnb_ingredients|fnb_orders|fnb_order_items)$/)?.[1];
  if(!table)return null;
  assert.equal(url.searchParams.get('select'),'*');
  let where=`club_id='${fixture.club}'`;
  if(table==='fnb_order_items'){
    const ids=url.searchParams.get('order_id');assert.match(ids,/^in\.\([a-f0-9,"-]+\)$/i);
    const requested=ids.slice(4,-1).replaceAll('"','').split(',');assert.ok(requested.every(uuid));
    where+=` AND order_id IN(${requested.map(literal).join(',')})`;
  }else assert.equal(url.searchParams.get('club_id'),`eq.${fixture.club}`);
  if(table==='fnb_orders'){
    const status=url.searchParams.get('status');assert.ok(['in.(pending)','in.(paid)','eq.pending','eq.paid'].includes(status));
    where+=` AND status='${status.includes('pending')?'pending':'paid'}'`;
    for(const [field,expected] of [['source','table'],['payment_method','cash']])if(url.searchParams.has(field)){assert.equal(url.searchParams.get(field),`eq.${expected}`);where+=` AND ${field}='${expected}'`;}
  }
  const value=collect(`SELECT * FROM public.${table} WHERE ${where} ORDER BY id LIMIT 100`);
  log.push({read:table,rows:value.length});return {status:200,value};
}
