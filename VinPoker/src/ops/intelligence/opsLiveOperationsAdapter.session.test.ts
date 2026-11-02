import {beforeEach,expect,it,vi} from 'vitest';
import {loadOpsLiveOperations} from './opsLiveOperationsAdapter';

const inventory=()=>({game_table_id:'physical',table_number:1,table_name:'Table TEST',operational_status:'available',
 availability_status:'in_use',table_session_id:'session-B',session_type:'cash',control_mode:'manual',control_epoch:1,revision:1,
 tournament_id:null,tournament_table_id:null,tournament_table_status:null,active_dealer_assignment_id:'assignment'});
const assignment=()=>({id:'assignment',table_id:'physical',table_session_id:'session-B',attendance_id:'attendance',status:'assigned',
 assigned_at:'2026-10-24T00:00:00Z',updated_at:'2026-10-24T00:00:00Z',swing_due_at:null,released_at:null,
 dealer_attendance:{current_state:'assigned',dealers:{full_name:'Current TEST'}}});
let inventoryRows:unknown[],assignments:unknown[],inventoryError:{message:string}|null;
let tournamentRows:unknown[];
let physicalStatus:string;
const rpc=vi.fn(async()=>({data:inventoryRows,error:inventoryError}));
const client={rpc,from:(table:string)=>{
 const data=table==='game_tables'?[{id:'physical',table_name:'Table TEST',status:physicalStatus,current_blind_level:null}]
  :table==='dealer_assignments'?assignments:table==='tournaments'?tournamentRows:[];
 const query=Promise.resolve({data,error:null}) as Promise<unknown>&Record<string,()=>unknown>;
 for(const method of ['select','eq','is','in','order'])query[method]=()=>query;
 return query;
}} as never;
beforeEach(()=>{rpc.mockClear();inventoryRows=[inventory()];assignments=[assignment()];inventoryError=null;tournamentRows=[];physicalStatus='active';});

it('uses canonical session counts even when the physical status marker is stale and Q0 is off',async()=>{
 physicalStatus='inactive';
 const value=await loadOpsLiveOperations(client,'club');
 expect(value.openTableCount).toBe(1);expect(value.operationalTableCount).toBe(1);
});

it.each(['valid','old-session','wrong-logical','wrong-tour','closed-inventory'])(
 'counts a tournament table only for its canonical current incarnation: %s',async(kind)=>{
 inventoryRows=[{...inventory(),session_type:'tournament',tournament_id:'tour',tournament_table_id:'logical',tournament_table_status:'active'}];
 if(kind==='closed-inventory'){inventoryRows=[{...inventory(),availability_status:'available',table_session_id:null,
  session_type:null,control_mode:null,control_epoch:null,revision:null,tournament_id:null,tournament_table_id:null,
  tournament_table_status:null,active_dealer_assignment_id:null}];assignments=[];}
 tournamentRows=[{id:kind==='wrong-tour'?'another-tour':'tour',name:'Current TEST Tour',status:'live',current_level:1,average_stack:1000,
  tournament_tables:[{id:kind==='wrong-logical'?'old-logical':'logical',table_id:null,game_table_id:'physical',
   table_session_id:kind==='old-session'?'session-A':'session-B',status:'active'}]}];
 const value=await loadOpsLiveOperations(client,'club',{q0CapacityTruth:true});
 if(kind==='valid'){
  expect(value.openTableCount).toBe(1);expect(value.rows[0].tournamentId).toBe('tour');
 }else{
  expect(value.openTableCount).toBeNull();expect(value.rows).toHaveLength(0);
  expect(value.availability).toBe('partial');expect(value.countComparisonEligible).toBe(false);
 }
});

it('uses the shared canonical inventory for the current Dealer assignment',async()=>{
 const value=await loadOpsLiveOperations(client,'club');
 expect(rpc).toHaveBeenCalledWith('get_club_table_inventory',{p_club_id:'club'});
 expect(value.rows[0].dealerName).toBe('Current TEST');expect(value.availability).toBe('exact');
});
it.each(['old-session','null-session','released','wrong-id','duplicate','repair','repair-no-assignment','missing-assignment','missing-inventory','inventory-error'])(
 'never displays an unverified Dealer as current: %s',async(kind)=>{
 if(kind==='old-session')assignments=[{...assignment(),table_session_id:'session-A'}];
 if(kind==='null-session')assignments=[{...assignment(),table_session_id:null}];
 if(kind==='released')assignments=[{...assignment(),status:'released',released_at:'2026-10-24T01:00:00Z'}];
 if(kind==='wrong-id')inventoryRows=[{...inventory(),active_dealer_assignment_id:'another-assignment'}];
 if(kind==='duplicate')assignments=[assignment(),{...assignment(),id:'other'}];
 if(kind==='repair')inventoryRows=[{...inventory(),availability_status:'repair_required',active_dealer_assignment_id:null}];
 if(kind==='repair-no-assignment'){inventoryRows=[{...inventory(),availability_status:'repair_required',active_dealer_assignment_id:null}];assignments=[];}
 if(kind==='missing-assignment')assignments=[];
 if(kind==='missing-inventory')inventoryRows=[];
 if(kind==='inventory-error')inventoryError={message:'unavailable'};
 const value=await loadOpsLiveOperations(client,'club');
 expect(value.availability).toBe('partial');expect(value.rows[0].dealerName).toBeNull();
 expect(value.reasonCode).toMatch(/INVENTORY|ASSIGNMENT_SESSION/);
});
