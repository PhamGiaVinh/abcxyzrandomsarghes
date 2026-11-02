import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({create:vi.fn(),update:vi.fn(),canonicalSave:vi.fn(),editConfig:{name:'',start_time:'',buy_in:0,starting_stack:0,minutes_per_level:0,late_reg_close_level:0},live:vi.fn(),navigate:vi.fn(),error:vi.fn(),success:vi.fn()}));
const rows=vi.hoisted(()=>[{id:'tour-a',club_id:'club-a',name:'Existing TEST',status:'live',start_time:'2026-10-20T13:30:12.456Z',buy_in:100000,starting_stack:20000,players_remaining:8,current_level:1,current_blinds:null,minutes_per_level:25,late_reg_close_level:4}]);
vi.mock('@/hooks/useTournaments',()=>({useTournaments:()=>({data:rows,isLoading:false,isError:false})}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:vi.fn()})}));
vi.mock('react-router-dom',()=>({useNavigate:()=>state.navigate}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>({useSupabaseClient:()=>({})}));
vi.mock('@/ops/auth/OpsAuthProvider',()=>({useOpsAuth:()=>({user:{id:'owner-test'}})}));
vi.mock('@/ops/auth/OpsCapabilityProvider',()=>({useOpsCapabilities:()=>({loading:false,clubs:[{id:'club-a',name:'Club TEST'}],floorClubIds:['club-a'],scope:[{club_id:'club-a',can_owner:true}],isSuperAdmin:false,scopeError:null,metadataError:null})}));
vi.mock('@/ops/workspace/OpsWorkspaceProvider',()=>({useOpsWorkspace:()=>({selectedClubId:'club-a'})}));
vi.mock('@/components/floor/FloorVoiceAlertInbox',()=>({FloorVoiceAlertInbox:()=>null}));
vi.mock('@/ops/opsMutations',()=>({createTournament:state.create,updateTournament:state.update,updateTournamentLive:state.live,mutationError:()=>({message:'TEST failed'})}));
vi.mock('sonner',()=>({toast:{error:state.error,success:state.success}}));
vi.mock('@/ops/floor/useOpsTournamentEdit',()=>({useOpsTournamentEdit:()=>({config:state.editConfig,ready:true,pending:null,loading:false,busy:false,error:null,formKey:'verified-test-context',reload:vi.fn(),save:state.canonicalSave})}));
// Field extraction/validation only; actual create controller + RPC composition is tested separately.
vi.mock('@/ops/floor/useOpsTournamentCreate',()=>({useOpsTournamentCreate:()=>({config:null,ready:true,pending:null,loading:false,busy:false,error:null,formKey:'verified-create-fixture',reload:vi.fn(),save:state.create})}));
import OpsTournaments from './OpsTournaments';
const field=(name:string)=>document.querySelector<HTMLInputElement>(`[data-ops-field="${name}"]`)!;
async function edit(){
 state.editConfig={name:rows[0].name,start_time:rows[0].start_time,buy_in:rows[0].buy_in,starting_stack:rows[0].starting_stack,minutes_per_level:rows[0].minutes_per_level,late_reg_close_level:rows[0].late_reg_close_level};
 render(<OpsTournaments/>);fireEvent.click(screen.getByRole('button',{name:/Existing TEST/}));
 fireEvent.click(screen.getByRole('button',{name:'Sửa thông tin giải'}));
 await waitFor(()=>expect(field('Tên giải')).not.toBeNull());
}
const save=()=>fireEvent.click(screen.getByRole('button',{name:'Lưu thay đổi'}));
beforeEach(()=>{vi.clearAllMocks();state.create.mockResolvedValue({});state.update.mockResolvedValue({});state.live.mockResolvedValue({});});
it('submits edits through the canonical context/journal controller instead of the legacy writer',async()=>{
 await edit();save();await waitFor(()=>expect(state.canonicalSave).toHaveBeenCalledOnce());expect(state.update).not.toHaveBeenCalled();
});
async function liveForm(){
 render(<OpsTournaments/>);fireEvent.click(screen.getByRole('button',{name:/Existing TEST/}));
 fireEvent.click(screen.getByRole('button',{name:'Cập nhật live — người / level / blind'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Lưu cập nhật'})).toBeInTheDocument());
}
it('does not send invented blinds when saving unchanged live metadata',async()=>{
 await liveForm();fireEvent.click(screen.getByRole('button',{name:'Lưu cập nhật'}));
 await waitFor(()=>expect(state.live).toHaveBeenCalledOnce());
 expect(state.live.mock.calls[0][1]).toEqual({tournamentId:'tour-a',status:'live',playersRemaining:8,level:1});
});
it('routes level/blind control to the existing revision-checked clock workspace',async()=>{
 await liveForm();expect(screen.queryByText('2.000 / 4.000 · ante 4.000')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Đồng hồ & blinds'}));
 expect(state.navigate).toHaveBeenCalledWith('/ops/floor/tournaments/tour-a/clock?club=club-a');expect(state.live).not.toHaveBeenCalled();
});
it('preserves PostgreSQL sub-millisecond timestamp precision when the calendar is untouched',async()=>{
 const prior=rows[0].start_time;rows[0].start_time='2026-10-19T17:32:41.520568+07:00';
 try{await edit();save();await waitFor(()=>expect(state.canonicalSave).toHaveBeenCalledOnce());expect(state.canonicalSave.mock.calls[0][0].startTime).toBe(rows[0].start_time);}
 finally{rows[0].start_time=prior;}
});
it('editing a name preserves the exact stored date, buy-in, stack and blind configuration',async()=>{
 await edit();fireEvent.change(field('Tên giải'),{target:{value:'Renamed TEST'}});save();
 await waitFor(()=>expect(state.canonicalSave).toHaveBeenCalledOnce());
 expect(state.canonicalSave.mock.calls[0][0]).toEqual({name:'Renamed TEST',startTime:'2026-10-20T13:30:12.456Z',buyIn:100000,startingStack:20000,minutesPerLevel:25,lateRegCloseLevel:4});
});
it('uses an explicitly changed calendar date at UTC+7',async()=>{
 await edit();fireEvent.change(field('Ngày'),{target:{value:'2026-12-31'}});fireEvent.change(field('Giờ bắt đầu'),{target:{value:'23:45'}});save();
 await waitFor(()=>expect(state.canonicalSave).toHaveBeenCalledOnce());expect(state.canonicalSave.mock.calls[0][0].startTime).toBe('2026-12-31T16:45:00.000Z');
});
it.each([['Giờ bắt đầu',''],['Giờ bắt đầu','24:00'],['Ngày',''],['Ngày','2026-02-30'],['Buy-in','abc'],['Buy-in','1.5'],['Buy-in','-1'],['Buy-in','1e6'],['Buy-in','1,00'],['Buy-in','9007199254740993'],['Stack','20K'],['Stack','0']])('does not write when %s is invalid (%s)',async(label,value)=>{
 await edit();fireEvent.change(field(label),{target:{value}});save();
 await waitFor(()=>expect(state.error).toHaveBeenCalled());expect(state.update).not.toHaveBeenCalled();expect(state.canonicalSave).not.toHaveBeenCalled();expect(state.create).not.toHaveBeenCalled();expect(state.success).not.toHaveBeenCalled();
});
it('accepts explicit grouped whole numbers without changing untouched fields',async()=>{
 await edit();fireEvent.change(field('Buy-in'),{target:{value:'1.000.000'}});fireEvent.change(field('Stack'),{target:{value:'30,000'}});save();
 await waitFor(()=>expect(state.canonicalSave).toHaveBeenCalledOnce());expect(state.canonicalSave.mock.calls[0][0]).toMatchObject({buyIn:1000000,startingStack:30000,startTime:'2026-10-20T13:30:12.456Z'});
});
it('creates a deliberately free tournament with the explicitly selected Vietnam date',async()=>{
 render(<OpsTournaments/>);fireEvent.click(screen.getByRole('button',{name:'Tạo giải'}));
 fireEvent.click(screen.getByRole('button',{name:'Tạo mới — điền 5 ô'}));
 await waitFor(()=>expect(field('Tên giải')).not.toBeNull());
 for(const [label,value] of [['Tên giải','Free TEST'],['Ngày','2027-01-02'],['Giờ bắt đầu','00:15'],['Buy-in','0'],['Stack','20.000']])fireEvent.change(field(label),{target:{value}});
 fireEvent.click(document.querySelector('[data-ops-action="floor.tournaments.save"]')!);
 await waitFor(()=>expect(state.create).toHaveBeenCalledOnce());expect(state.create.mock.calls[0][0]).toEqual({name:'Free TEST',startTime:'2027-01-01T17:15:00.000Z',buyIn:0,startingStack:20000,minutesPerLevel:20,lateRegCloseLevel:6});expect(state.update).not.toHaveBeenCalled();
});
