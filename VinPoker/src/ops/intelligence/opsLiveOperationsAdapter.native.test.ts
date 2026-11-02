import {execFileSync} from 'node:child_process';
import {expect,it} from 'vitest';
import {loadOpsLiveOperations} from './opsLiveOperationsAdapter';

// Opt-in retained local read. HTTP/PostgREST is modeled, real row/RLS reads are not.
it.skipIf(process.env.VINPOKER_OPS598_NATIVE!=='1')('links the retained canonical Floor table from native authenticated rows',async()=>{
 const output=execFileSync('wsl',['-d','PokerVision-P16-4C-Eval','--','env','PGHOST=127.0.0.1','PGPORT=55441',
  'PGUSER=postgres','PGDATABASE=vinpoker_ops_cash115_qualified_c','psql','-w','-X','-qAt','-v','ON_ERROR_STOP=1'],{
  encoding:'utf8',timeout:15000,input:`BEGIN;
  DO $$ BEGIN
   ASSERT current_database()='vinpoker_ops_cash115_qualified_c' AND host(inet_server_addr())='127.0.0.1' AND inet_server_port()=55441;
   ASSERT current_setting('data_directory')='/tmp/vinpoker-sol-local-20261016-0e79a729/data';
  END $$;
  GRANT USAGE ON SCHEMA auth TO authenticated;
  SET LOCAL request.jwt.claim.sub='675fe35e-60a8-4452-bb90-e79486d54da6';
  SET LOCAL ROLE authenticated;
  SELECT jsonb_build_object(
   'game_tables',(SELECT jsonb_agg(to_jsonb(g)) FROM(SELECT id,table_name,status,current_blind_level FROM public.game_tables WHERE id='c474ac95-6896-445d-81ba-dd6d752528df' AND club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760') g),
   'tournaments',(SELECT jsonb_agg(to_jsonb(t)) FROM(SELECT id,name,status,current_level,average_stack,
    (SELECT jsonb_agg(jsonb_build_object('id',tt.id,'table_session_id',tt.table_session_id,'table_id',tt.table_id,'game_table_id',tt.game_table_id,'status',tt.status)) FROM public.tournament_tables tt WHERE tt.tournament_id=t0.id AND tt.id='d294f4a4-082b-4efc-a6ca-1f96579ea344') tournament_tables
    FROM public.tournaments t0 WHERE id='46cab483-91e7-4220-aacf-e17bdf05269c' AND club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760') t),
   'inventory',(SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) FROM public.get_club_table_inventory('a8e7d1b7-fdaa-45ad-b0a1-f894b6315760') i),
   'dealer_assignments',(SELECT coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('dealer_attendance',jsonb_build_object('current_state',d.current_state,'dealers',jsonb_build_object('full_name',p.full_name)))),'[]'::jsonb)
    FROM public.dealer_assignments a LEFT JOIN public.dealer_attendance d ON d.id=a.attendance_id LEFT JOIN public.dealers p ON p.id=d.dealer_id
    WHERE a.table_id='c474ac95-6896-445d-81ba-dd6d752528df' AND a.club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND a.status='assigned'),
   'dealer_attendance',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'dealer_id',d.dealer_id,'check_in_time',d.check_in_time)),'[]'::jsonb)
    FROM public.dealer_attendance d JOIN public.dealers p ON p.id=d.dealer_id WHERE p.club_id='a8e7d1b7-fdaa-45ad-b0a1-f894b6315760' AND p.deleted_at IS NULL AND d.status='checked_in'));
  ROLLBACK;`,
 });
 const rows=JSON.parse(output.trim()) as Record<string,unknown>;
 expect(rows.game_tables).toHaveLength(1);expect(rows.tournaments).toHaveLength(1);
 expect(Array.isArray(rows.dealer_assignments)).toBe(true);expect(Array.isArray(rows.dealer_attendance)).toBe(true);
 const selections:Record<string,string>={};
 let inventoryRead=false;
 const client={rpc:async(name:string,args:unknown)=>{
  expect(name).toBe('get_club_table_inventory');expect(args).toEqual({p_club_id:'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760'});
  inventoryRead=true;return {data:rows.inventory,error:null};
 },from:(table:string)=>{
  const query=Promise.resolve({data:rows[table]??[],error:null}) as Promise<unknown>&Record<string,(value:string)=>unknown>;
  for(const method of ['eq','is','in','order'])query[method]=()=>query;
  query.select=(value:string)=>{selections[table]=value;return query;};return query;
 }} as never;
 const result=await loadOpsLiveOperations(client,'a8e7d1b7-fdaa-45ad-b0a1-f894b6315760',{q0CapacityTruth:true});
 expect(selections.tournaments).toContain('game_table_id');
 expect(result.openTableCount).toBe(1);expect(result.rows).toHaveLength(1);
 expect(result.rows[0]).toMatchObject({tableId:'c474ac95-6896-445d-81ba-dd6d752528df',tournamentId:'46cab483-91e7-4220-aacf-e17bdf05269c'});
 expect(inventoryRead).toBe(true);expect(result.reasonCode).not.toBe('OPS_LIVE_INVENTORY_UNVERIFIED');
 // This is one native read snapshot, not a close/reopen or Swing mutation test.
});
