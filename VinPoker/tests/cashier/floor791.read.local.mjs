import assert from 'node:assert/strict';

// Exact retained Main club. Read-only transport seam, never an authority substitute.
export function createFloor791Read({query,fixture,actor,log,sum807=false,d2847=false}) {
 if(d2847){
  assert.equal(sum807,false);
  assert.equal(fixture.event,'e6551af0-e6d0-4fb0-9342-fdd7465fcaf2');
  assert.equal(fixture.tour,'0f56388a-c47f-48fd-970a-4f5589627d4b');
  assert.equal(fixture.club,'399956aa-7858-422a-ad34-ca7ee52ff64d');
  assert.equal(actor,'ba3e052f-27d5-4da5-b832-0b5d9cecbf2f');
 }else if(sum807){
  assert.equal(fixture.event,'1cb64e29-c5d8-43e3-b8d9-7815905749b1');
  assert.equal(fixture.tour,'a8a56692-2752-4f9d-b57c-f78d9b354d34');
  assert.equal(fixture.club,'c0d7785d-5bd4-48ca-9014-8611a274382d');
  assert.equal(actor,'495e96be-c00b-4e68-b227-593300f3e2bc');
 }else{
  assert.equal(fixture.club,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760');
  assert.equal(actor,'675fe35e-60a8-4452-bb90-e79486d54da6');
 }
 const club=fixture.club;
 let holdNextList=false;
 const tourIds=query(`SELECT coalesce(jsonb_agg(id),'[]'::jsonb) FROM public.tournaments WHERE club_id='${club}' AND deleted_at IS NULL;`);
 const eventIds=query(`SELECT coalesce(jsonb_agg(id),'[]'::jsonb) FROM public.tournament_events WHERE club_id='${club}';`);
 const list=(value,allowed)=>{
  assert.match(value??'',/^in\.\([a-f0-9,-]+\)$/i);
  const ids=value.slice(4,-1).split(',');
  assert.ok(ids.length&&ids.every(id=>allowed.includes(id)));
  return ids.map(id=>`'${id}'::uuid`).join(',');
 };
 const read=(statement,kind)=>{const value=query(statement);log.push({floor791:kind,rows:Array.isArray(value)?value.length:null,mutation:false});return {status:200,value};};
 return {
  command(value){if(value!=='floor-list-hang-next')return false;holdNextList=true;return true;},
  handle(url,method,body){
   if(method==='POST'&&url.pathname==='/rest/v1/rpc/get_public_tournament_redraw_v1'){
    assert.deepEqual(Object.keys(body),['p_tournament_id']);assert.ok(tourIds.includes(body.p_tournament_id));
    return read(`SELECT public.get_public_tournament_redraw_v1('${body.p_tournament_id}');`,'public_redraw');
   }
   if(method==='POST'&&url.pathname==='/rest/v1/rpc/get_bagged_flight_tables_v1'){
    assert.deepEqual(Object.keys(body),['p_flight_tournament_id']);assert.ok(tourIds.includes(body.p_flight_tournament_id));
    return read(`SELECT public.get_bagged_flight_tables_v1('${body.p_flight_tournament_id}');`,'bagged_flight_tables');
   }
   const eventRead=url.pathname.match(/^\/rest\/v1\/rpc\/(multi_day_floor_read_v1|multi_day_qualification_preview_v1|multi_day_final_roster_v1|multi_day_payout_preview_v1|multi_day_payout_postfinal_state_v1)$/)?.[1];
   if(method==='POST'&&eventRead){
    assert.deepEqual(Object.keys(body),['p_event_id']);assert.ok(eventIds.includes(body.p_event_id));
    return read(`SELECT public.${eventRead}('${body.p_event_id}');`,eventRead);
   }
   const rpc=url.pathname.match(/^\/rest\/v1\/rpc\/(get_my_floor_operator_scope|dealer_control_club_ids|get_tournament_participation_counts_v1)$/)?.[1];
   if(method==='POST'&&rpc){
    if(rpc==='get_my_floor_operator_scope'){
     assert.deepEqual(body,{});
     return read('SELECT coalesce(jsonb_agg(s),\'[]\'::jsonb) FROM public.get_my_floor_operator_scope() s;',rpc);
    }
    if(rpc==='dealer_control_club_ids'){
     assert.deepEqual(body,{_user_id:actor});
     return read(`SELECT coalesce(jsonb_agg(id),'[]'::jsonb) FROM public.dealer_control_club_ids('${actor}') id;`,rpc);
    }
    assert.deepEqual(Object.keys(body),['p_tournament_id']);assert.ok(tourIds.includes(body.p_tournament_id));
    return read(`SELECT public.get_tournament_participation_counts_v1('${body.p_tournament_id}');`,rpc);
   }
   if(method!=='GET')return null;
   const columns=url.searchParams.get('select')?.replaceAll(/\s/g,'');
   if(url.pathname==='/rest/v1/clubs'&&columns==='id,name'&&url.searchParams.has('id')){
    list(url.searchParams.get('id'),[club]);
    return read(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT id,name FROM public.clubs WHERE id='${club}')t;`,'club_names');
   }
   if(url.pathname==='/rest/v1/tournaments'&&columns==='*'&&url.searchParams.has('club_id')){
    list(url.searchParams.get('club_id'),[club]);assert.equal(url.searchParams.get('deleted_at'),'is.null');
    const order=url.searchParams.get('order');assert.ok(['start_time.asc','created_at.desc'].includes(order));
    const statuses=url.searchParams.get('status');
    assert.ok(statuses===null||statuses==='in.(upcoming,registering,drawing,active,live,break,final_table)');
    const result=read(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT * FROM public.tournaments WHERE club_id='${club}' AND deleted_at IS NULL
     ${statuses?"AND status IN('upcoming','registering','drawing','active','live','break','final_table')":''} ORDER BY ${order==='start_time.asc'?'start_time':'created_at DESC'})t;`,'tournament_list');
    if(order==='created_at.desc'&&holdNextList){holdNextList=false;log.push({floor793:'list_held_after_native_read',mutation:false});return {...result,hold:true};}
    return result;
   }
   const specs={
    '/rest/v1/tournament_registrations':{columns:'tournament_id',filter:'tournament_id',allowed:tourIds,extra:" AND status='confirmed'"},
    '/rest/v1/tournament_seats':{columns:'tournament_id,player_id',filter:'tournament_id',allowed:tourIds,extra:' AND is_active'},
    '/rest/v1/tournament_events':{columns:'id,itm_percent,name,guarantee_amount',filter:'id',allowed:eventIds,extra:''},
    '/rest/v1/tournament_event_qualifiers':{columns:'final_tournament_id',filter:'final_tournament_id',allowed:tourIds,extra:''},
    '/rest/v1/tournament_entries':{columns:'tournament_id,player_id',filter:'tournament_id',allowed:tourIds,extra:''},
    '/rest/v1/tracker_floor_alerts':{columns:'id,tournament_id,physical_table_id,hand_id,title,priority,status',filter:'tournament_id',allowed:tourIds,extra:" AND status IN('open','acknowledged','in_progress') ORDER BY created_at"},
   };
   const spec=specs[url.pathname];
   if(spec&&columns===spec.columns){
    const ids=list(url.searchParams.get(spec.filter),spec.allowed);
    if(url.pathname.endsWith('tournament_registrations'))assert.equal(url.searchParams.get('status'),'eq.confirmed');
    if(url.pathname.endsWith('tournament_seats'))assert.equal(url.searchParams.get('is_active'),'eq.true');
    if(url.pathname.endsWith('tracker_floor_alerts')){
     assert.equal(url.searchParams.get('status'),'in.(open,acknowledged,in_progress)');assert.equal(url.searchParams.get('order'),'created_at.asc');
    }
    return read(`SELECT coalesce(jsonb_agg(t),'[]'::jsonb) FROM(SELECT ${spec.columns} FROM public.${url.pathname.split('/').at(-1)} WHERE ${spec.filter} IN(${ids})${spec.extra})t;`,url.pathname.split('/').at(-1));
   }
   return null;
  },
 };
}
