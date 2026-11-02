import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>{
 const actor='e2010000-0000-4000-8000-000000000001',club='e2010000-0000-4000-8000-000000000002',tour='e2010000-0000-4000-8000-000000000003';
 const config={name:'Canonical TEST',start_time:'2026-10-19T17:32:41.520568+07:00',buy_in:100000,rake_amount:10000,service_fee_amount:5000,guarantee_amount:null,starting_stack:20000,location:'TEST room',description:null,game_type:'nlh',minutes_per_level:20,late_reg_close_level:6};
 return {actor,club,tour,config,state:{config,levels:[],lifecycle:{club_id:club,status:'live',live_status:'playing'}},rows:[{id:tour,club_id:club,...config,status:'live',players_remaining:8,current_level:1,current_blinds:null}],rpc:vi.fn(),success:vi.fn(),error:vi.fn()};
});
vi.mock('@/hooks/useTournaments',()=>({useTournaments:()=>({data:fixture.rows,isLoading:false,isError:false})}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:vi.fn()})}));
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn()}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>{const client={rpc:fixture.rpc};return {useSupabaseClient:()=>client};});
vi.mock('@/ops/auth/OpsAuthProvider',()=>{const auth={user:{id:fixture.actor},session:{access_token:'canonical-edit-fixture-token'}};return {useOpsAuth:()=>auth};});
vi.mock('@/ops/auth/OpsCapabilityProvider',()=>({useOpsCapabilities:()=>({loading:false,clubs:[{id:fixture.club,name:'Club TEST'}],floorClubIds:[fixture.club],scope:[{club_id:fixture.club,can_owner:true}],isSuperAdmin:false,scopeError:null,metadataError:null})}));
vi.mock('@/ops/workspace/OpsWorkspaceProvider',()=>({useOpsWorkspace:()=>({selectedClubId:fixture.club})}));
vi.mock('@/components/floor/FloorVoiceAlertInbox',()=>({FloorVoiceAlertInbox:()=>null}));
vi.mock('sonner',()=>({toast:{error:fixture.error,success:fixture.success}}));
import OpsTournaments from './OpsTournaments';
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();});
it.each([false,true])('actual form and controller use canonical RPC, retain fees and recover a lost response (%s)',async(lost)=>{
 let receiptAvailable=!lost;let original:Record<string,unknown>|null=null;
 fixture.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  const context={ok:true,tournament_id:fixture.tour,club_id:fixture.club,actor_id:fixture.actor,can_edit_blinds:true,state:fixture.state};
  if(name==='get_tournament_edit_context_v1'){const result=Promise.resolve({data:context,error:null});return Object.assign(result,{abortSignal:()=>result});}
  const ack={ok:true,tournament_id:fixture.tour,club_id:fixture.club,actor_id:fixture.actor,request_id:args.p_request_id,state:{...fixture.state,config:args.p_config}};
  if(name==='edit_tournament_with_levels_v1'){original=args;return Promise.resolve(lost?{data:null,error:{message:'response lost'}}:{data:ack,error:null});}
  if(name==='get_tournament_edit_receipt_v1')return Promise.resolve(receiptAvailable?{data:ack,error:null}:{data:{ok:false,error:'receipt_not_found'},error:null});
  throw new Error('Unexpected legacy writer '+name);
 });
 render(<OpsTournaments/>);fireEvent.click(screen.getByRole('button',{name:/Canonical TEST/}));fireEvent.click(screen.getByRole('button',{name:'Sửa thông tin giải'}));
 await waitFor(()=>expect(screen.getByRole('textbox',{name:'Tên giải'})).toHaveValue('Canonical TEST'));
 fireEvent.change(screen.getByRole('textbox',{name:'Tên giải'}),{target:{value:'Renamed canonical TEST'}});fireEvent.click(screen.getByRole('button',{name:'Lưu thay đổi'}));
 if(lost){
  await waitFor(()=>expect(screen.getByRole('button',{name:'Kiểm tra yêu cầu đã lưu'})).toBeEnabled());expect(screen.getByRole('textbox',{name:'Tên giải'})).toBeDisabled();expect(fixture.success).not.toHaveBeenCalled();
  receiptAvailable=true;fireEvent.click(screen.getByRole('button',{name:'Kiểm tra yêu cầu đã lưu'}));
 }
 await waitFor(()=>expect(fixture.success).toHaveBeenCalledWith('Đã lưu thông tin giải.'));
 expect(fixture.rpc.mock.calls.filter(c=>c[0]==='edit_tournament_with_levels_v1')).toHaveLength(1);
 expect(fixture.rpc.mock.calls.some(c=>c[0]==='ops_update_tournament')).toBe(false);
 expect(original).toMatchObject({p_expected_actor_id:fixture.actor,p_club_id:fixture.club,p_tournament_id:fixture.tour,p_levels:null,p_expected_state:fixture.state,p_config:{...fixture.config,name:'Renamed canonical TEST'}});
 for(const [,args] of fixture.rpc.mock.calls.filter(c=>c[0]==='get_tournament_edit_receipt_v1'))expect(args).toEqual(original);
 expect(localStorage.length).toBe(0);
});

