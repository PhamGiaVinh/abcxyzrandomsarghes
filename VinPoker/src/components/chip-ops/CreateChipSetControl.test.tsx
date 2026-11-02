import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({rpc:vi.fn(),success:vi.fn(),error:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:f.rpc}}));
vi.mock('sonner',()=>({toast:{success:f.success,error:f.error}}));
import {CreateChipSetControl} from './CreateChipSetControl';
import {persistChipSetCreationIntent,readChipSetCreationIntent,type ChipSetCreationIntent} from '@/lib/chipSetCreationIntent';
import {createChipSetupWriteGate} from '@/lib/chipSetupWriteGate';
const scope={actorId:'11111111-1111-4111-8111-111111111111',clubId:'22222222-2222-4222-8222-222222222222',tournamentId:'33333333-3333-4333-8333-333333333333'};
const receipt=(i:ChipSetCreationIntent,outcome='created_bound')=>({status:outcome==='rejected'?'rejected':'ok',outcome,actor_id:i.actorId,club_id:i.clubId,tournament_id:i.tournamentId,
 request_id:i.requestId,set_name:i.name,chip_set_id:outcome==='created_bound'?'44444444-4444-4444-8444-444444444444':null,error:outcome==='rejected'?'NAME_EXISTS':null});
const callbacks=()=>({setBusy:vi.fn(),onPendingChange:vi.fn(),onCommitted:vi.fn()});
beforeEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();sessionStorage.clear();f.rpc.mockResolvedValue({data:null,error:null});});
afterEach(()=>{cleanup();vi.useRealTimers();});
async function enterName(){fireEvent.change(await screen.findByPlaceholderText('VD: Bộ chip giải A'),{target:{value:'TEST'}});}
it('does not persist or dispatch creation while another Setup card owns the gate',async()=>{
 const acquireWrite=createChipSetupWriteGate(vi.fn()),release=acquireWrite()!,cb=callbacks();
 render(<CreateChipSetControl scope={scope} bound={false} busy={false} acquireWrite={acquireWrite} {...cb}/>);await enterName();
 fireEvent.click(screen.getByRole('button',{name:'Tạo & gán'}));
 expect(f.rpc).not.toHaveBeenCalled();expect(readChipSetCreationIntent(sessionStorage,scope)).toBeNull();
 release();fireEvent.click(screen.getByRole('button',{name:'Tạo & gán'}));
 await act(async()=>{});expect(f.rpc).toHaveBeenCalledTimes(1);expect(readChipSetCreationIntent(sessionStorage,scope)).not.toBeNull();
});
it('synchronously gates double-click and persists before the sole atomic RPC',async()=>{
 const cb=callbacks();let finish!:(v:unknown)=>void;
 f.rpc.mockImplementation(()=>{expect(readChipSetCreationIntent(sessionStorage,scope)?.name).toBe('TEST');return new Promise(resolve=>{finish=resolve;});});
 render(<CreateChipSetControl scope={scope} bound={false} busy={false} {...cb}/>);await enterName();
 const button=screen.getByRole('button',{name:'Tạo & gán'});
 act(()=>{fireEvent.click(button);fireEvent.click(button);});
 expect(f.rpc).toHaveBeenCalledTimes(1);expect(f.rpc.mock.calls[0][0]).toBe('chip_ops_create_and_bind_set_v1');
 const i=readChipSetCreationIntent(sessionStorage,scope)!;
 await act(async()=>finish({data:receipt(i),error:null}));
 expect(readChipSetCreationIntent(sessionStorage,scope)).toBeNull();expect(f.success).toHaveBeenCalledTimes(1);expect(cb.onCommitted).toHaveBeenCalledTimes(1);
});
it('keeps the same intent after response loss and NULL lookup on reload, even when metadata is bound',async()=>{
 const cb=callbacks();f.rpc.mockResolvedValue({data:null,error:{code:'503'}});
 const view=render(<CreateChipSetControl scope={scope} bound={false} busy={false} {...cb}/>);await enterName();
 fireEvent.click(screen.getByRole('button',{name:'Tạo & gán'}));await screen.findByRole('alert');
 const i=readChipSetCreationIntent(sessionStorage,scope)!;expect(i).not.toBeNull();view.unmount();
 f.rpc.mockResolvedValue({data:null,error:null});
 render(<CreateChipSetControl scope={scope} bound busy={false} {...cb}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Đối chiếu yêu cầu'})).toBeEnabled());
 expect(readChipSetCreationIntent(sessionStorage,scope)).toEqual(i);expect(screen.queryByRole('button',{name:'Tạo & gán'})).not.toBeInTheDocument();
 f.rpc.mockResolvedValue({data:receipt(i),error:null});
 fireEvent.click(screen.getByRole('button',{name:'Đối chiếu yêu cầu'}));
 await waitFor(()=>expect(cb.onCommitted).toHaveBeenCalledTimes(1));expect(readChipSetCreationIntent(sessionStorage,scope)).toBeNull();
});
it('reports an already committed create truthfully when cancel loses the server race',async()=>{
 const i=persistChipSetCreationIntent(sessionStorage,scope,'TEST'),cb=callbacks();
 render(<CreateChipSetControl scope={scope} bound={false} busy={false} {...cb}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Hủy yêu cầu chưa thực hiện'})).toBeEnabled());
 f.rpc.mockResolvedValue({data:receipt(i),error:null});fireEvent.click(screen.getByRole('button',{name:'Hủy yêu cầu chưa thực hiện'}));
 await waitFor(()=>expect(f.success).toHaveBeenCalledWith('Đã tạo & gán bộ chip.'));
 expect(f.success).not.toHaveBeenCalledWith('Đã hủy yêu cầu chưa thực hiện.');expect(cb.onCommitted).toHaveBeenCalledTimes(1);
});
it('does not send a write when storage fails',async()=>{
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
 render(<CreateChipSetControl scope={scope} bound={false} busy={false} {...callbacks()}/>);await enterName();
 fireEvent.click(screen.getByRole('button',{name:'Tạo & gán'}));await screen.findByRole('alert');expect(f.rpc).not.toHaveBeenCalled();
});
it('keeps an unconfirmed receipt pending and retries the exact request',async()=>{
 const cb=callbacks();f.rpc.mockResolvedValue({data:{status:'ok'},error:null});
 render(<CreateChipSetControl scope={scope} bound={false} busy={false} {...cb}/>);await enterName();
 fireEvent.click(screen.getByRole('button',{name:'Tạo & gán'}));await screen.findByRole('alert');const first=f.rpc.mock.calls[0];
 fireEvent.click(screen.getByRole('button',{name:'Gửi lại nguyên yêu cầu'}));await waitFor(()=>expect(f.rpc).toHaveBeenCalledTimes(2));
 expect(f.rpc.mock.calls[1]).toEqual(first);expect(readChipSetCreationIntent(sessionStorage,scope)).not.toBeNull();expect(f.success).not.toHaveBeenCalled();
});
it('suppresses old actor completion and preserves its journal for later recovery',async()=>{
 let finish!:(v:unknown)=>void;f.rpc.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const cb=callbacks();
 const view=render(<CreateChipSetControl scope={scope} bound={false} busy={false} {...cb}/>);await enterName();
 fireEvent.click(screen.getByRole('button',{name:'Tạo & gán'}));const i=readChipSetCreationIntent(sessionStorage,scope)!;
 view.rerender(<CreateChipSetControl scope={{...scope,actorId:'55555555-5555-4555-8555-555555555555'}} bound={false} busy={false} {...cb}/>);
 expect(screen.getByPlaceholderText('VD: Bộ chip giải A')).toHaveValue('');
 await act(async()=>finish({data:receipt(i),error:null}));expect(f.success).not.toHaveBeenCalled();expect(cb.onCommitted).not.toHaveBeenCalled();
 expect(readChipSetCreationIntent(sessionStorage,scope)).toEqual(i);
});
it('clears only a server-confirmed cancellation, without claiming creation',async()=>{
 const i=persistChipSetCreationIntent(sessionStorage,scope,'TEST'),cb=callbacks();
 render(<CreateChipSetControl scope={scope} bound={false} busy={false} {...cb}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Hủy yêu cầu chưa thực hiện'})).toBeEnabled());
 f.rpc.mockResolvedValue({data:receipt(i,'cancelled'),error:null});
 fireEvent.click(screen.getByRole('button',{name:'Hủy yêu cầu chưa thực hiện'}));
 await waitFor(()=>expect(f.success).toHaveBeenCalledWith('Đã hủy yêu cầu chưa thực hiện.'));
 expect(cb.onCommitted).not.toHaveBeenCalled();expect(readChipSetCreationIntent(sessionStorage,scope)).toBeNull();
});
it('keeps a timed-out durable write pending and ignores its late response after cancellation',async()=>{
 vi.useFakeTimers();let finish!:(v:unknown)=>void;const cb=callbacks();
 f.rpc.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 render(<CreateChipSetControl scope={scope} bound={false} busy={false} {...cb}/>);
 fireEvent.change(screen.getByPlaceholderText('VD: Bộ chip giải A'),{target:{value:'TEST'}});
 fireEvent.click(screen.getByRole('button',{name:'Tạo & gán'}));const i=readChipSetCreationIntent(sessionStorage,scope)!;
 await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});
 expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh');expect(readChipSetCreationIntent(sessionStorage,scope)).toEqual(i);
 f.rpc.mockResolvedValue({data:receipt(i,'cancelled'),error:null});
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Hủy yêu cầu chưa thực hiện'})));
 await act(async()=>finish({data:receipt(i,'cancelled'),error:null}));
 expect(f.success).toHaveBeenCalledTimes(1);expect(cb.onCommitted).not.toHaveBeenCalled();expect(readChipSetCreationIntent(sessionStorage,scope)).toBeNull();
});
