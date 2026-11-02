import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {tournamentCreateJournalKey} from '@/lib/tournamentCreate';
const f=vi.hoisted(()=>{const actor='e2010000-0000-4000-8000-000000000001',club='e2010000-0000-4000-8000-000000000002';return {actor,club,auth:{user:{id:actor},session:{access_token:'canonical-create-fixture'}},rpc:vi.fn(),success:vi.fn(),error:vi.fn()};});
vi.mock('@/hooks/useTournaments',()=>({useTournaments:()=>({data:[],isLoading:false,isError:false})}));
vi.mock('@tanstack/react-query',()=>({useQueryClient:()=>({invalidateQueries:vi.fn()})}));
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn()}));
vi.mock('@/integrations/supabase/SupabaseClientContext',()=>{const client={rpc:f.rpc};return {useSupabaseClient:()=>client};});
vi.mock('@/ops/auth/OpsAuthProvider',()=>({useOpsAuth:()=>f.auth}));
vi.mock('@/ops/auth/OpsCapabilityProvider',()=>({useOpsCapabilities:()=>({loading:false,clubs:[{id:f.club,name:'Club TEST'}],floorClubIds:[f.club],scope:[{club_id:f.club,can_owner:true}],isSuperAdmin:false,scopeError:null,metadataError:null})}));
vi.mock('@/ops/workspace/OpsWorkspaceProvider',()=>({useOpsWorkspace:()=>({selectedClubId:f.club})}));
vi.mock('@/components/floor/FloorVoiceAlertInbox',()=>({FloorVoiceAlertInbox:()=>null}));
vi.mock('sonner',()=>({toast:{error:f.error,success:f.success}}));
import OpsTournaments from './OpsTournaments';
const key=tournamentCreateJournalKey(f.actor,f.club);
const ack=(args:Record<string,unknown>)=>({ok:true,tournament_id:'e2010000-0000-4000-8000-000000000003',actor_id:f.actor,club_id:f.club,request_id:args.p_request_id,level_count:0});
async function open(){fireEvent.click(screen.getByRole('button',{name:'Tạo giải'}));fireEvent.click(screen.getByRole('button',{name:'Tạo mới — điền 5 ô'}));await waitFor(()=>expect(screen.getByRole('textbox',{name:'Tên giải'})).toBeInTheDocument());}
function fill(){for(const [label,value] of [['Tên giải','Canonical create TEST'],['Ngày','2030-01-02'],['Giờ bắt đầu','20:00'],['Buy-in','100000'],['Stack','20000']])fireEvent.change(screen.getByRole('textbox',{name:label}),{target:{value}});}
const submit=()=>fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Tạo giải'}));
beforeEach(()=>{localStorage.clear();f.rpc.mockReset();f.success.mockReset();f.error.mockReset();});afterEach(()=>vi.restoreAllMocks());
it('actual create form routes an exact persisted request through canonical create with Ops lifecycle and no invented levels',async()=>{
 f.rpc.mockImplementation((name,args)=>{expect(name).toBe('create_tournament_with_levels_v1');expect(JSON.parse(localStorage.getItem(key)!)).toEqual(args);return Promise.resolve({data:ack(args),error:null});});
 render(<OpsTournaments/>);await open();fill();submit();await waitFor(()=>expect(f.success).toHaveBeenCalled());
 expect(f.rpc).toHaveBeenCalledOnce();const args=f.rpc.mock.calls[0][1];expect(args).toMatchObject({p_club_id:f.club,p_expected_actor_id:f.actor,p_levels:[],p_config:{name:'Canonical create TEST',status:'upcoming',current_level:1,buy_in:100000,starting_stack:20000,rake_amount:0,service_fee_amount:0,start_time:'2030-01-02T13:00:00.000Z'}});expect(args.p_request_id).toMatch(/^[a-f0-9-]{36}$/);expect(localStorage.getItem(key)).toBeNull();
});
it('keeps unknown create locked across remount and recovers by exact receipt without another writer',async()=>{
 let available=false;let original:Record<string,unknown>|null=null;
 f.rpc.mockImplementation((name,args)=>{if(name==='create_tournament_with_levels_v1'){original=args;return Promise.resolve({data:null,error:{message:'response lost'}});}if(name==='get_tournament_create_receipt_v1')return Promise.resolve(available?{data:ack(args),error:null}:{data:null,error:{message:'receipt unavailable'}});throw Error('Unexpected legacy writer '+name);});
 const view=render(<OpsTournaments/>);await open();fill();submit();await waitFor(()=>expect(screen.getByText(/Đang giữ yêu cầu tạo trước/)).toBeInTheDocument());expect(f.success).not.toHaveBeenCalled();const retained=localStorage.getItem(key);expect(JSON.parse(retained!)).toEqual(original);
 view.unmount();render(<OpsTournaments/>);await open();expect(screen.getByRole('textbox',{name:'Tên giải'})).toBeDisabled();expect(screen.getByRole('textbox',{name:'Tên giải'})).toHaveValue('Canonical create TEST');available=true;fireEvent.click(screen.getByRole('button',{name:'Kiểm tra yêu cầu đã lưu'}));await waitFor(()=>expect(f.success).toHaveBeenCalledOnce());expect(f.rpc.mock.calls.filter(x=>x[0]==='create_tournament_with_levels_v1')).toHaveLength(1);expect(f.rpc.mock.calls.filter(x=>x[0]==='get_tournament_create_receipt_v1').every(x=>JSON.stringify(x[1])===JSON.stringify(original))).toBe(true);expect(localStorage.getItem(key)).toBeNull();
});
it('does not submit a second writer while the first create is unresolved',async()=>{
 let resolve!:(value:unknown)=>void;let request:Record<string,unknown>={};f.rpc.mockImplementation((name,args)=>{expect(name).toBe('create_tournament_with_levels_v1');request=args;return new Promise(r=>{resolve=r;});});
 render(<OpsTournaments/>);await open();fill();const button=within(screen.getByRole('dialog')).getByRole('button',{name:'Tạo giải'});fireEvent.click(button);fireEvent.click(button);expect(f.rpc).toHaveBeenCalledOnce();expect(f.success).not.toHaveBeenCalled();await act(async()=>resolve({data:ack(request),error:null}));await waitFor(()=>expect(f.success).toHaveBeenCalledOnce());
});
it('fails closed before any create when the pending request cannot be retained',async()=>{
 render(<OpsTournaments/>);await open();fill();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('storage blocked');});submit();await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Không lưu được yêu cầu tạo an toàn'));expect(f.rpc).not.toHaveBeenCalled();expect(f.success).not.toHaveBeenCalled();
});
