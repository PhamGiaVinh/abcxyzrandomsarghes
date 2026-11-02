import assert from 'node:assert/strict';

// Exact read-only PostgREST subset for the actual Intelligence consumer.
// SQL executes through the existing authenticated native query closure.
export function createOps601Read({query,club,log}){
 const selects={
  game_tables:'id,table_name,status,current_blind_level',
  tournaments:'id,name,status,current_level,average_stack,tournament_tables(id,table_id,game_table_id,table_session_id,status)',
  dealer_assignments:'id,attendance_id,table_id,table_session_id,assigned_at,released_at,status,version,updated_at,last_swing_attempted_at,swing_in_progress,swing_processed_at,swing_due_at,pre_assigned_attendance_id,pre_assigned_at,dealer_attendance!attendance_id(current_state,dealers(full_name))',
  dealer_attendance:'id,dealer_id,check_in_time,dealers!inner(club_id,deleted_at)',
 };
 return {accepts(url,method){return (method==='POST'&&url.pathname==='/rest/v1/rpc/get_club_table_inventory')
  || (method==='GET'&&Object.hasOwn(selects,url.pathname.replace('/rest/v1/','')));},handle(url,method,body){
  if(url.pathname==='/rest/v1/rpc/get_club_table_inventory'&&method==='POST'){
   assert.deepEqual(body,{p_club_id:club});
   const value=query(`SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) FROM public.get_club_table_inventory('${club}') i;`);
   log.push({ops601:'inventory_native_read',rows:value.length});return {value};
  }
  const table=url.pathname.replace('/rest/v1/','');
  if(method!=='GET'||!Object.hasOwn(selects,table))return null;
  assert.equal(url.searchParams.get('select'),selects[table]);
  if(table!=='dealer_attendance')assert.equal(url.searchParams.get('club_id'),`eq.${club}`);
  let statement;
  if(table==='game_tables')statement=`SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) FROM(SELECT id,table_name,status,current_blind_level FROM public.game_tables WHERE club_id='${club}' ORDER BY table_name) g;`;
  if(table==='tournaments'){
   assert.equal(url.searchParams.get('status'),'in.(drawing,live,break,final_table)');
   statement=`SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM(SELECT id,name,status,current_level,average_stack,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('id',tt.id,'table_id',tt.table_id,'game_table_id',tt.game_table_id,'table_session_id',tt.table_session_id,'status',tt.status)),'[]'::jsonb) FROM public.tournament_tables tt WHERE tt.tournament_id=t0.id) tournament_tables
    FROM public.tournaments t0 WHERE club_id='${club}' AND status IN('drawing','live','break','final_table')) t;`;
  }
  if(table==='dealer_assignments'){
   assert.equal(url.searchParams.get('status'),'eq.assigned');
   statement=`SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM(SELECT a0.id,a0.attendance_id,a0.table_id,a0.table_session_id,a0.assigned_at,a0.released_at,a0.status,a0.version,a0.updated_at,a0.last_swing_attempted_at,a0.swing_in_progress,a0.swing_processed_at,a0.swing_due_at,a0.pre_assigned_attendance_id,a0.pre_assigned_at,
    jsonb_build_object('current_state',d.current_state,'dealers',jsonb_build_object('full_name',p.full_name)) dealer_attendance
    FROM public.dealer_assignments a0 LEFT JOIN public.dealer_attendance d ON d.id=a0.attendance_id LEFT JOIN public.dealers p ON p.id=d.dealer_id
    WHERE a0.club_id='${club}' AND a0.status='assigned' ORDER BY a0.assigned_at) a;`;
  }
  if(table==='dealer_attendance'){
   assert.equal(url.searchParams.get('status'),'eq.checked_in');assert.equal(url.searchParams.get('dealers.club_id'),`eq.${club}`);assert.equal(url.searchParams.get('dealers.deleted_at'),'is.null');
   statement=`SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) FROM(SELECT d0.id,d0.dealer_id,d0.check_in_time,jsonb_build_object('club_id',p.club_id,'deleted_at',p.deleted_at) dealers
    FROM public.dealer_attendance d0 JOIN public.dealers p ON p.id=d0.dealer_id WHERE d0.status='checked_in' AND p.club_id='${club}' AND p.deleted_at IS NULL ORDER BY d0.check_in_time) d;`;
  }
  const value=query(statement);assert.ok(Array.isArray(value));
  log.push({ops601:table+'_native_read',rows:value.length});return {value};
 }};
}
