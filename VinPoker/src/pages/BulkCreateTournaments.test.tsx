import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,renderHook,screen,waitFor} from '@testing-library/react';
const h=vi.hoisted(()=>({insert:vi.fn(),rpc:vi.fn(),error:vi.fn(),success:vi.fn(),navigate:vi.fn(),invoke:vi.fn(),clubs:vi.fn(),loading:false,rolesLoading:false,rolesError:null as string|null,authError:null as string|null,isAdmin:true,actor:'00000000-0000-4000-8000-000000000001',session:{access_token:'LOCAL_TEST'}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:h.actor},session:h.session,loading:h.loading,rolesLoading:h.rolesLoading,rolesError:h.rolesError,authError:h.authError,isAdmin:h.isAdmin})}));
vi.mock('react-router-dom',()=>({useNavigate:()=>h.navigate}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
vi.mock('sonner',()=>({toast:{error:h.error,success:h.success,info:vi.fn()}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:h.rpc,auth:{getUser:async()=>({data:{user:{id:h.actor}}})},functions:{invoke:h.invoke},
 from:(table:string)=>{const data=table==='user_roles'?[{role:'super_admin'}]:[{id:'00000000-0000-4000-8000-000000000003',name:'TEST'}];
 const q={select:()=>q,eq:()=>q,abortSignal:()=>q,order:()=>q,then:(resolve:(v:unknown)=>unknown,reject?:(reason:unknown)=>unknown)=>(table==='clubs'?h.clubs():Promise.resolve({data})).then(resolve,reject),insert:h.insert};return q;}}}));
import BulkCreateTournaments from './BulkCreateTournaments';
import {BulkScheduleDialog} from '@/components/floor/BulkScheduleDialog';
import {useScheduleBatchCreate} from '@/hooks/useScheduleBatchCreate';
beforeEach(()=>{h.actor='00000000-0000-4000-8000-000000000001';h.loading=false;h.rolesLoading=false;h.rolesError=null;h.authError=null;h.isAdmin=true;h.navigate.mockReset();h.clubs.mockReset().mockResolvedValue({data:[{id:'00000000-0000-4000-8000-000000000003',name:'TEST'}],error:null});sessionStorage.clear();h.rpc.mockReset();h.insert.mockReset();h.error.mockReset();h.success.mockReset();h.invoke.mockReset();vi.stubGlobal('URL',{createObjectURL:()=> 'blob:TEST',revokeObjectURL:vi.fn()});
 h.rpc.mockImplementation(async(_name:string,r)=>({data:{ok:true,actor_id:r.p_expected_actor_id,request_id:r.p_request_id,count:r.p_rows.length,
 tournaments:r.p_rows.map((row:{club_id:string},i:number)=>({ok:true,actor_id:r.p_expected_actor_id,request_id:`00000000-0000-4000-8000-${String(20+i).padStart(12,'0')}`,club_id:row.club_id,tournament_id:`00000000-0000-4000-8000-${String(50+i).padStart(12,'0')}`,level_count:0}))},error:null}));
 vi.stubGlobal('FileReader',class {result='data:image/png;base64,TEST';onload?:()=>void;readAsDataURL(){queueMicrotask(()=>this.onload?.());}});
 h.invoke.mockResolvedValue({data:{tournaments:[{name:'Invalid date TEST',start_time:'not-a-date',buy_in:100000,starting_stack:20000,game_type:'nlh'}]},error:null});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('explains schedule-only creation and missing blind readiness in both producers',async()=>{
 const view=render(<BulkCreateTournaments/>);await screen.findByText('bulkCreate.title');
 expect(screen.getByText(/Chỉ tạo lịch giải.*cấu hình blind/)).toBeTruthy();
 view.unmount();render(<BulkScheduleDialog clubs={[]} defaultClubId="club" multiClub={false} onCreated={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Tạo từ ảnh lịch'}));
 expect(screen.getByText(/Chỉ tạo lịch giải.*cấu hình blind/)).toBeTruthy();
});
it('does not treat an unavailable role read as a permission denial or expose the editor',async()=>{
 h.rolesError='role_read_unavailable';h.isAdmin=false;
 render(<BulkCreateTournaments/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Không xác minh được quyền');
 expect(h.navigate).not.toHaveBeenCalled();expect(h.clubs).not.toHaveBeenCalled();
 expect(screen.queryByText('bulkCreate.title')).toBeNull();
});
it('waits for confirmed roles before loading clubs',async()=>{
 h.rolesLoading=true;h.isAdmin=false;const view=render(<BulkCreateTournaments/>);
 expect(screen.getByRole('status')).toHaveAttribute('aria-label','Đang xác minh quyền');
 expect(screen.queryByText('bulkCreate.title')).toBeNull();expect(h.clubs).not.toHaveBeenCalled();
 h.rolesLoading=false;h.isAdmin=true;view.rerender(<BulkCreateTournaments/>);
 await screen.findByText('bulkCreate.title');expect(h.clubs).toHaveBeenCalledTimes(1);
});
it('does not discard a confirmed admin role when unrelated memberships are unavailable',async()=>{
 h.rolesError='Chưa xác minh được đầy đủ quyền CLB.';h.isAdmin=true;
 render(<BulkCreateTournaments/>);await screen.findByText('bulkCreate.title');
 expect(h.navigate).not.toHaveBeenCalled();
});
it('denies a confirmed non-admin without reading clubs',async()=>{
 h.isAdmin=false;render(<BulkCreateTournaments/>);
 await waitFor(()=>expect(h.navigate).toHaveBeenCalledWith('/'));
 expect(h.error).toHaveBeenCalledWith('bulkCreate.adminOnly');expect(h.clubs).not.toHaveBeenCalled();
});
it('represents a successful empty club response separately from network failure',async()=>{
 h.clubs.mockResolvedValueOnce({data:[],error:null});render(<BulkCreateTournaments/>);
 expect(await screen.findByRole('status')).toHaveTextContent('Không có CLB đã được duyệt');
 expect(screen.queryByRole('alert')).toBeNull();expect(screen.queryByText('bulkCreate.title')).toBeNull();
});
it('catches rejected club requests without hanging or exposing the editor',async()=>{
 h.clubs.mockRejectedValueOnce(new Error('offline'));render(<BulkCreateTournaments/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được danh sách CLB');
 expect(screen.queryByText('bulkCreate.title')).toBeNull();
});
it('bounds a hanging club read and ignores its late result after timeout',async()=>{
 vi.useFakeTimers();let resolve!:(value:unknown)=>void;
 h.clubs.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 try{
  render(<BulkCreateTournaments/>);
  await act(async()=>{await Promise.resolve();});
  await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
  expect(screen.getByRole('alert')).toHaveTextContent('Không tải được danh sách CLB');
  await act(async()=>{resolve({data:[{id:'old',name:'OLD'}],error:null});});
  expect(screen.queryByText('bulkCreate.title')).toBeNull();
 }finally{vi.useRealTimers();}
});
it('ignores the old actor club response after account switch',async()=>{
 let resolve!:(value:unknown)=>void;h.clubs.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const view=render(<BulkCreateTournaments/>);await waitFor(()=>expect(h.clubs).toHaveBeenCalledTimes(1));
 h.actor='00000000-0000-4000-8000-000000000009';h.clubs.mockResolvedValue({data:[],error:null});
 view.rerender(<BulkCreateTournaments/>);
 await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Không có CLB đã được duyệt'));
 await act(async()=>{resolve({data:[{id:'old',name:'OLD'}],error:null});});
 expect(screen.getByRole('status')).toHaveTextContent('Không có CLB đã được duyệt');
 expect(screen.queryByText('bulkCreate.title')).toBeNull();
});
it('shows a club read failure and explicitly retries without treating it as empty',async()=>{
 h.clubs.mockResolvedValueOnce({data:null,error:{message:'503'}});
 render(<BulkCreateTournaments/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được danh sách CLB');
 expect(screen.queryByText('bulkCreate.title')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));
 await screen.findByText('bulkCreate.title');expect(h.clubs).toHaveBeenCalledTimes(2);
});
it.each([
 [null,{id:'00000000-0000-4000-8000-000000000003',name:'TEST'}],
 [{id:'',name:'TEST'}],
 [{id:'00000000-0000-4000-8000-000000000003',name:null}],
 [{id:'00000000-0000-4000-8000-000000000003',name:{label:'TEST'}}],
])('blocks the import editor when club rows are unreadable: %j',async(...rows)=>{
 h.clubs.mockResolvedValueOnce({data:rows,error:null});render(<BulkCreateTournaments/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được danh sách CLB');
 expect(screen.queryByText('bulkCreate.title')).toBeNull();expect(h.invoke).not.toHaveBeenCalled();expect(h.insert).not.toHaveBeenCalled();expect(h.rpc).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));await screen.findByText('bulkCreate.title');expect(h.clubs).toHaveBeenCalledTimes(2);
});
it('rejects invalid parsed date before any write and never leaves creating stuck',async()=>{
 const view=render(<BulkCreateTournaments/>);await screen.findByText('bulkCreate.title');
 fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[new File(['TEST'],'test.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'bulkCreate.analyzeAi'}));
 const create=await screen.findByRole('button',{name:'bulkCreate.createCount'});fireEvent.click(create);
 await waitFor(()=>expect(h.error).toHaveBeenCalledWith('bulkCreate.rowValidation'));
 expect(h.insert).not.toHaveBeenCalled();expect(create).toHaveProperty('disabled',false);
});
it('preserves a valid parsed date in the existing insert path',async()=>{
 h.invoke.mockResolvedValue({data:{tournaments:[{name:'Valid date TEST',start_time:'2026-10-18T10:00:00+07:00',buy_in:100000,starting_stack:20000,game_type:'nlh'}]},error:null});
 h.insert.mockResolvedValue({error:null});const view=render(<BulkCreateTournaments/>);await screen.findByText('bulkCreate.title');
 fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[new File(['TEST'],'test.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'bulkCreate.analyzeAi'}));
 fireEvent.click(await screen.findByRole('button',{name:'bulkCreate.createCount'}));
 await waitFor(()=>expect(h.rpc).toHaveBeenCalledTimes(1));expect(h.insert).not.toHaveBeenCalled();
 expect(h.rpc).toHaveBeenCalledWith('create_tournament_schedule_batch_v1',expect.objectContaining({p_rows:[expect.objectContaining({name:'Valid date TEST',start_time:'2026-10-18T03:00:00.000Z',buy_in:100000,starting_stack:20000})]}));
});
it.each([{buy_in:'not-money',starting_stack:20000},{buy_in:100000,starting_stack:null}])('rejects malformed amount/stack instead of inventing defaults: %j',async(values)=>{
 h.invoke.mockResolvedValue({data:{tournaments:[{name:'Malformed TEST',start_time:'2026-10-18T10:00:00+07:00',game_type:'nlh',...values}]},error:null});
 const view=render(<BulkCreateTournaments/>);await screen.findByText('bulkCreate.title');
 fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[new File(['TEST'],'test.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'bulkCreate.analyzeAi'}));
 await waitFor(()=>expect(h.error).toHaveBeenCalled());expect(screen.queryByRole('button',{name:'bulkCreate.createCount'})).toBeNull();
 expect(h.insert).not.toHaveBeenCalled();
});
it('rejects malformed OCR in the Floor bulk dialog as well',async()=>{
 h.invoke.mockResolvedValue({data:{tournaments:[{name:'Malformed TEST',start_time:'2026-10-18T10:00:00+07:00',buy_in:null,starting_stack:20000,game_type:'nlh'}]},error:null});
 render(<BulkScheduleDialog clubs={[]} defaultClubId="club" multiClub={false} onCreated={()=>{}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Tạo từ ảnh lịch'}));
 fireEvent.change(document.querySelector('input[type="file"]')!,{target:{files:[new File(['TEST'],'test.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'Phân tích bằng AI'}));
 await waitFor(()=>expect(h.error).toHaveBeenCalledWith('Phân tích lỗi: SCHEDULE_BUY_IN_INVALID'));
 expect(screen.queryByRole('button',{name:'Tạo 1 giải'})).toBeNull();expect(h.insert).not.toHaveBeenCalled();
});
it('does not start a second batch while the first image is awaiting OCR',async()=>{
 let resolve!:(v:unknown)=>void;h.invoke.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}))
  .mockResolvedValue({data:{tournaments:[]},error:null});
 const view=render(<BulkCreateTournaments/>);await screen.findByText('bulkCreate.title');
 fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[new File(['A'],'a.png',{type:'image/png'}),new File(['B'],'b.png',{type:'image/png'})]}});
 const analyze=await screen.findByRole('button',{name:'bulkCreate.analyzeAi'});fireEvent.click(analyze);
 await waitFor(()=>expect(h.invoke).toHaveBeenCalledTimes(1));
 await act(async()=>{fireEvent.click(analyze);});expect(h.invoke).toHaveBeenCalledTimes(1);
 await act(async()=>{resolve({data:{tournaments:[]},error:null});});
 await waitFor(()=>expect(h.invoke).toHaveBeenCalledTimes(2));
});
it('does not resurrect preview rows after their source image is removed',async()=>{
 let resolve!:(v:unknown)=>void;h.invoke.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const view=render(<BulkCreateTournaments/>);await screen.findByText('bulkCreate.title');
 fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[new File(['A'],'a.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'bulkCreate.analyzeAi'}));await waitFor(()=>expect(h.invoke).toHaveBeenCalledTimes(1));
 fireEvent.click(view.container.querySelector('img')!.parentElement!.querySelector('button')!);
 await act(async()=>{resolve({data:{tournaments:[{name:'Removed TEST',start_time:'2026-10-18T10:00:00+07:00',buy_in:100000,starting_stack:20000,game_type:'nlh'}]},error:null});});
 expect(screen.queryByRole('button',{name:'bulkCreate.createCount'})).toBeNull();
});
it('releases the analysis lock after failure so an explicit retry can succeed',async()=>{
 h.invoke.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({data:{tournaments:[]},error:null});
 const view=render(<BulkCreateTournaments/>);await screen.findByText('bulkCreate.title');
 fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[new File(['A'],'a.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'bulkCreate.analyzeAi'}));await waitFor(()=>expect(h.error).toHaveBeenCalled());
 const analyze=screen.getByRole('button',{name:'bulkCreate.analyzeAi'});await waitFor(()=>expect(analyze).toHaveProperty('disabled',false));fireEvent.click(analyze);
 await waitFor(()=>expect(h.invoke).toHaveBeenCalledTimes(2));
});
it('retains batch intent after lost response and reload only reads its receipt',async()=>{
 h.invoke.mockResolvedValue({data:{tournaments:[{name:'Recovery TEST',start_time:'2026-10-18T10:00:00+07:00',buy_in:100000,starting_stack:20000,game_type:'nlh'}]},error:null});
 h.rpc.mockRejectedValueOnce(new Error('lost commit response')).mockRejectedValueOnce(new Error('receipt unavailable'));
 const first=render(<BulkCreateTournaments/>);await screen.findByText('bulkCreate.title');
 fireEvent.change(first.container.querySelector('input[type="file"]')!,{target:{files:[new File(['A'],'a.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'bulkCreate.analyzeAi'}));
 fireEvent.click(await screen.findByRole('button',{name:'bulkCreate.createCount'}));
 await screen.findByRole('alert');expect(h.rpc).toHaveBeenCalledTimes(2);expect(sessionStorage.length).toBe(1);
 expect(screen.getByRole('button',{name:'bulkCreate.createCount'})).toHaveProperty('disabled',true);
 const original=h.rpc.mock.calls[0][1];first.unmount();
 render(<BulkCreateTournaments/>);const recover=await screen.findByRole('button',{name:'bulkCreate.checkReceipt'});
 expect(h.rpc).toHaveBeenCalledTimes(2);fireEvent.click(recover);
 await waitFor(()=>expect(sessionStorage.length).toBe(0));
 expect(h.rpc).toHaveBeenCalledTimes(3);expect(h.rpc.mock.calls[2]).toEqual(['get_tournament_schedule_batch_receipt_v1',original]);expect(h.insert).not.toHaveBeenCalled();
});
it('does not settle the old actor journal when a completion arrives after account switch',async()=>{
 const success=h.rpc.getMockImplementation()!;let resolve!:(v:unknown)=>void;let args:Record<string,unknown>={};
 h.rpc.mockImplementationOnce((_name:string,request)=>{args=request;return new Promise(r=>{resolve=r;});});
 const hook=renderHook(()=>useScheduleBatchCreate());await waitFor(()=>expect(hook.result.current.blocked).toBe(false));
 let task!:Promise<string[]|null>;
 act(()=>{task=hook.result.current.submit([{club_id:'00000000-0000-4000-8000-000000000003',name:'Actor TEST',start_time:'2026-10-18T10:00:00+07:00',buy_in:100000,starting_stack:20000,game_type:'nlh',location:null}]);});
 await waitFor(()=>expect(h.rpc).toHaveBeenCalledTimes(1));h.actor='00000000-0000-4000-8000-000000000009';hook.rerender();
 await act(async()=>{resolve(await success('create_tournament_schedule_batch_v1',args));await task;});
 expect(sessionStorage.length).toBe(1);expect(hook.result.current.pending).toBeNull();expect(hook.result.current.error).toBeNull();
});
it('preserves editable drafts after server confirms an uncommitted batch is cancelled',async()=>{
 h.invoke.mockResolvedValue({data:{tournaments:[{name:'Cancel TEST',start_time:'2026-10-18T10:00:00+07:00',buy_in:100000,starting_stack:20000,game_type:'nlh'}]},error:null});
 h.rpc.mockRejectedValueOnce(new Error('no response')).mockRejectedValueOnce(new Error('no receipt'))
  .mockImplementationOnce(async(_name:string,r)=>({data:{ok:true,outcome:'cancelled',actor_id:r.p_expected_actor_id,request_id:r.p_request_id,count:r.p_rows.length},error:null}));
 const view=render(<BulkCreateTournaments/>);await screen.findByText('bulkCreate.title');
 fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[new File(['A'],'a.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'bulkCreate.analyzeAi'}));
 fireEvent.click(await screen.findByRole('button',{name:'bulkCreate.createCount'}));await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'bulkCreate.cancelPendingBatch'}));
 await waitFor(()=>expect(sessionStorage.length).toBe(0));expect(screen.getByDisplayValue('Cancel TEST')).toBeTruthy();
 expect(screen.getByRole('button',{name:'bulkCreate.createCount'})).toHaveProperty('disabled',false);
 expect(h.rpc.mock.calls[2][0]).toBe('cancel_tournament_schedule_batch_v1');expect(h.insert).not.toHaveBeenCalled();
});
it('clears prior account OCR drafts when the authenticated actor changes',async()=>{
 h.invoke.mockResolvedValue({data:{tournaments:[{name:'Prior actor private TEST',start_time:'2026-10-18T10:00:00+07:00',buy_in:100000,starting_stack:20000,game_type:'nlh'}]},error:null});
 const view=render(<BulkCreateTournaments/>);await screen.findByText('bulkCreate.title');
 fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[new File(['A'],'a.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'bulkCreate.analyzeAi'}));await screen.findByDisplayValue('Prior actor private TEST');
 h.actor='00000000-0000-4000-8000-000000000009';view.rerender(<BulkCreateTournaments/>);
 await waitFor(()=>expect(screen.queryByDisplayValue('Prior actor private TEST')).toBeNull());expect(h.rpc).not.toHaveBeenCalled();
});
it('stops queued OCR uploads after the actor changes',async()=>{
 let resolve!:(v:unknown)=>void;
 h.invoke.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue({data:{tournaments:[]},error:null});
 const view=render(<BulkCreateTournaments/>);await screen.findByText('bulkCreate.title');
 fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[new File(['A'],'a.png',{type:'image/png'}),new File(['B'],'b.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'bulkCreate.analyzeAi'}));
 await waitFor(()=>expect(h.invoke).toHaveBeenCalledTimes(1));
 h.actor='00000000-0000-4000-8000-000000000009';view.rerender(<BulkCreateTournaments/>);
 expect(h.invoke.mock.calls[0][1].signal.aborted).toBe(true);
 await act(async()=>{resolve({data:{tournaments:[]},error:null});});
 expect(h.invoke).toHaveBeenCalledTimes(1);
});
it('stops queued Floor OCR uploads after the club changes',async()=>{
 let resolve!:(v:unknown)=>void;
 h.invoke.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue({data:{tournaments:[]},error:null});
 const props={clubs:[],multiClub:false,onCreated:()=>{}};
 const view=render(<BulkScheduleDialog {...props} defaultClubId="club-a"/>);
 fireEvent.click(screen.getByRole('button',{name:'Tạo từ ảnh lịch'}));
 fireEvent.change(document.querySelector('input[type="file"]')!,{target:{files:[new File(['A'],'a.png',{type:'image/png'}),new File(['B'],'b.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'Phân tích bằng AI'}));
 await waitFor(()=>expect(h.invoke).toHaveBeenCalledTimes(1));
 view.rerender(<BulkScheduleDialog {...props} defaultClubId="club-b"/>);
 expect(h.invoke.mock.calls[0][1].signal.aborted).toBe(true);
 await act(async()=>{resolve({data:null,error:{message:'cancelled transport'}});});
 expect(h.invoke).toHaveBeenCalledTimes(1);
 expect(h.error).not.toHaveBeenCalled();
});
it('resets Floor drafts on default-club change before creating into the new club',async()=>{
 h.invoke.mockResolvedValue({data:{tournaments:[{name:'Floor scope TEST',start_time:'2026-10-18T10:00:00+07:00',buy_in:100000,starting_stack:20000,game_type:'nlh'}]},error:null});
 const props={clubs:[],multiClub:false,onCreated:()=>{}};
 const view=render(<BulkScheduleDialog {...props} defaultClubId="00000000-0000-4000-8000-000000000003"/>);
 fireEvent.click(screen.getByRole('button',{name:'Tạo từ ảnh lịch'}));
 fireEvent.change(document.querySelector('input[type="file"]')!,{target:{files:[new File(['A'],'a.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'Phân tích bằng AI'}));await screen.findByDisplayValue('Floor scope TEST');
 view.rerender(<BulkScheduleDialog {...props} defaultClubId="00000000-0000-4000-8000-000000000004"/>);
 fireEvent.click(screen.getByRole('button',{name:'Tạo từ ảnh lịch'}));expect(screen.queryByDisplayValue('Floor scope TEST')).toBeNull();
 fireEvent.change(document.querySelector('input[type="file"]')!,{target:{files:[new File(['B'],'b.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'Phân tích bằng AI'}));
 fireEvent.click(await screen.findByRole('button',{name:'Tạo 1 giải'}));await waitFor(()=>expect(h.rpc).toHaveBeenCalledTimes(1));
 expect(h.rpc.mock.calls[0][1].p_rows[0].club_id).toBe('00000000-0000-4000-8000-000000000004');expect(h.insert).not.toHaveBeenCalled();
});
it('supplies an accessible description for the Floor scheduling dialog',()=>{
 const warn=vi.spyOn(console,'warn');
 try {
  render(<BulkScheduleDialog clubs={[]} defaultClubId="00000000-0000-4000-8000-000000000003" multiClub={false} onCreated={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Tạo từ ảnh lịch'}));
  const dialog=screen.getByRole('dialog');const description=dialog.getAttribute('aria-describedby');
  expect(description).toBeTruthy();expect(document.getElementById(description!)).toHaveTextContent('Tải ảnh lịch giải');
  expect(warn.mock.calls.some(([message])=>String(message).includes('Missing `Description`'))).toBe(false);
 }finally{warn.mockRestore();}
});
it('allows clearing the imported timestamp and blocks creation until corrected',async()=>{
 h.invoke.mockResolvedValue({data:{tournaments:[{name:'Clear timestamp TEST',start_time:'2026-10-18T10:00:00+07:00',buy_in:100000,starting_stack:20000,game_type:'nlh'}]},error:null});
 const view=render(<BulkCreateTournaments/>);await screen.findByText('bulkCreate.title');
 fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[new File(['A'],'a.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'bulkCreate.analyzeAi'}));
 await screen.findByDisplayValue('Clear timestamp TEST');
 const timestamp=view.container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
 fireEvent.change(timestamp,{target:{value:''}});
 expect(timestamp.value).toBe('');
 fireEvent.click(screen.getByRole('button',{name:'bulkCreate.createCount'}));
 expect(h.error).toHaveBeenCalledWith('bulkCreate.rowValidation');expect(h.rpc).not.toHaveBeenCalled();
});
it.each(['page','floor'] as const)('releases removed and unmounted image previews exactly once: %s',async(producer)=>{
 const create=vi.fn().mockReturnValueOnce('blob:TEST:1').mockReturnValueOnce('blob:TEST:2'),revoke=vi.fn();
 vi.stubGlobal('URL',{createObjectURL:create,revokeObjectURL:revoke});
 const view=render(producer==='page'?<BulkCreateTournaments/>:<BulkScheduleDialog clubs={[]} defaultClubId="00000000-0000-4000-8000-000000000003" multiClub={false} onCreated={()=>{}}/>);
 if(producer==='page')await screen.findByText('bulkCreate.title');else fireEvent.click(screen.getByRole('button',{name:'Tạo từ ảnh lịch'}));
 fireEvent.change(document.querySelector('input[type="file"]')!,{target:{files:[new File(['A'],'a.png',{type:'image/png'}),new File(['B'],'b.png',{type:'image/png'})]}});
 const first=document.querySelector('img[src="blob:TEST:1"]')!;
 fireEvent.click(first.parentElement!.querySelector('button')!);
 expect(revoke.mock.calls).toEqual([['blob:TEST:1']]);
 expect(document.querySelector('img[src="blob:TEST:2"]')).not.toBeNull();
 view.unmount();expect(revoke.mock.calls).toEqual([['blob:TEST:1'],['blob:TEST:2']]);
 expect(h.invoke).not.toHaveBeenCalled();expect(h.rpc).not.toHaveBeenCalled();
});
it('releases Floor previews after a confirmed batch clears its images without unmounting',async()=>{
 const revoke=vi.fn(),created=vi.fn();vi.stubGlobal('URL',{createObjectURL:()=> 'blob:TEST:success',revokeObjectURL:revoke});
 h.invoke.mockResolvedValue({data:{tournaments:[{name:'Preview lifecycle TEST',start_time:'2026-10-18T10:00:00+07:00',buy_in:100000,starting_stack:20000,game_type:'nlh'}]},error:null});
 const view=render(<BulkScheduleDialog clubs={[]} defaultClubId="00000000-0000-4000-8000-000000000003" multiClub={false} onCreated={created}/>);
 fireEvent.click(screen.getByRole('button',{name:'Tạo từ ảnh lịch'}));
 fireEvent.change(document.querySelector('input[type="file"]')!,{target:{files:[new File(['A'],'a.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'Phân tích bằng AI'}));
 fireEvent.click(await screen.findByRole('button',{name:'Tạo 1 giải'}));
 await waitFor(()=>expect(created).toHaveBeenCalledOnce());expect(revoke.mock.calls).toEqual([['blob:TEST:success']]);
 view.unmount();expect(revoke).toHaveBeenCalledOnce();
});
it('also releases Floor previews when a lost batch response is reconciled without reload',async()=>{
 const revoke=vi.fn(),created=vi.fn();vi.stubGlobal('URL',{createObjectURL:()=> 'blob:TEST:recovered',revokeObjectURL:revoke});
 h.invoke.mockResolvedValue({data:{tournaments:[{name:'Recovered preview TEST',start_time:'2026-10-18T10:00:00+07:00',buy_in:100000,starting_stack:20000,game_type:'nlh'}]},error:null});
 h.rpc.mockRejectedValueOnce(new Error('lost response')).mockRejectedValueOnce(new Error('receipt unavailable'));
 const view=render(<BulkScheduleDialog clubs={[]} defaultClubId="00000000-0000-4000-8000-000000000003" multiClub={false} onCreated={created}/>);
 fireEvent.click(screen.getByRole('button',{name:'Tạo từ ảnh lịch'}));
 fireEvent.change(document.querySelector('input[type="file"]')!,{target:{files:[new File(['A'],'a.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'Phân tích bằng AI'}));fireEvent.click(await screen.findByRole('button',{name:'Tạo 1 giải'}));
 await screen.findByRole('alert');expect(revoke).not.toHaveBeenCalled();
 expect(screen.getByRole('dialog')).toHaveClass('grid-cols-1');
 for(const name of ['bulkCreate.checkReceipt','bulkCreate.cancelPendingBatch']){
  expect(screen.getByRole('button',{name})).toHaveClass('max-w-full','whitespace-normal','h-auto');
 }
 fireEvent.click(screen.getByRole('button',{name:'bulkCreate.checkReceipt'}));
 await waitFor(()=>expect(created).toHaveBeenCalledOnce());expect(revoke.mock.calls).toEqual([['blob:TEST:recovered']]);
 view.unmount();expect(revoke).toHaveBeenCalledOnce();
});

it.each(['page','floor'] as const)('bounds stalled schedule OCR and ignores late preview before explicit retry: %s',async(producer)=>{
 let resolve!:(v:unknown)=>void;h.invoke.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue({data:{tournaments:[]},error:null});
 const view=render(producer==='page'?<BulkCreateTournaments/>:<BulkScheduleDialog clubs={[]} defaultClubId="club" multiClub={false} onCreated={()=>{}}/>);
 if(producer==='page')await screen.findByText('bulkCreate.title');else fireEvent.click(screen.getByRole('button',{name:'Tạo từ ảnh lịch'}));
 fireEvent.change(document.querySelector('input[type="file"]')!,{target:{files:[new File(['A'],'timeout.png',{type:'image/png'})]}});
 const label=producer==='page'?'bulkCreate.analyzeAi':'Phân tích bằng AI';
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});try{
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:label}));});expect(h.invoke).toHaveBeenCalledTimes(1);
 await act(async()=>{await vi.advanceTimersByTimeAsync(60_001);});
 expect(h.invoke.mock.calls[0][1].signal.aborted).toBe(true);
 expect(h.error).toHaveBeenCalled();
 expect(screen.getByRole('button',{name:label})).toHaveProperty('disabled',false);
 await act(async()=>{resolve({data:{tournaments:[{name:'Late timeout TEST',start_time:'2030-01-01T10:00:00+07:00',buy_in:100000,starting_stack:20000,game_type:'nlh'}]},error:null});});
 expect(screen.queryByDisplayValue('Late timeout TEST')).toBeNull();
 expect(h.invoke).toHaveBeenCalledTimes(1);expect(h.rpc).not.toHaveBeenCalled();expect(h.insert).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
 fireEvent.click(screen.getByRole('button',{name:label}));await waitFor(()=>expect(h.invoke).toHaveBeenCalledTimes(2));
 view.unmount();
});

it.each(['partial','failed','success'] as const)('reports OCR completion truthfully and preserves successful drafts: %s',async(outcome)=>{
 const valid={data:{tournaments:[{name:'Retained OCR TEST',start_time:'2030-01-01T10:00:00+07:00',buy_in:100000,starting_stack:20000,game_type:'nlh'}]},error:null};
 h.invoke.mockReset();if(outcome==='partial')h.invoke.mockResolvedValueOnce(valid).mockRejectedValueOnce(new Error('OCR unavailable'));
 else if(outcome==='failed')h.invoke.mockRejectedValue(new Error('OCR unavailable'));else h.invoke.mockResolvedValue({data:{tournaments:[]},error:null});
 const view=render(<BulkCreateTournaments/>);await screen.findByText('bulkCreate.title');
 fireEvent.change(view.container.querySelector('input[type="file"]')!,{target:{files:[new File(['A'],'a.png',{type:'image/png'}),new File(['B'],'b.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'bulkCreate.analyzeAi'}));
 await waitFor(()=>expect(h.invoke).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(screen.getByRole('button',{name:'bulkCreate.analyzeAi'})).toHaveProperty('disabled',outcome==='success'));
 if(outcome==='success')expect(h.success).toHaveBeenCalledWith('bulkCreate.processDone');else expect(h.success).not.toHaveBeenCalled();
 if(outcome==='partial')expect(screen.getByDisplayValue('Retained OCR TEST')).toBeTruthy();
 expect(h.error).toHaveBeenCalledTimes(outcome==='failed'?2:outcome==='partial'?1:0);
 expect(h.rpc).not.toHaveBeenCalled();expect(h.insert).not.toHaveBeenCalled();
});
it.each(['page','floor'] as const)('does not turn cleared buy-in into a free schedule: %s',async(producer)=>{
 h.invoke.mockResolvedValue({data:{tournaments:[{name:'Blank buy-in TEST',start_time:'2026-10-18T10:00:00+07:00',buy_in:100000,starting_stack:20000,game_type:'nlh'}]},error:null});
 const view=render(producer==='page'?<BulkCreateTournaments/>:<BulkScheduleDialog clubs={[]} defaultClubId="00000000-0000-4000-8000-000000000003" multiClub={false} onCreated={()=>{}}/>);
 if(producer==='floor')fireEvent.click(screen.getByRole('button',{name:'Tạo từ ảnh lịch'}));else await screen.findByText('bulkCreate.title');
 fireEvent.change(document.querySelector('input[type="file"]')!,{target:{files:[new File(['TEST'],'test.png',{type:'image/png'})]}});
 fireEvent.click(await screen.findByRole('button',{name:producer==='page'?'bulkCreate.analyzeAi':'Phân tích bằng AI'}));await screen.findByDisplayValue('Blank buy-in TEST');
 const buyIn=screen.getByDisplayValue('100000');fireEvent.change(buyIn,{target:{value:''}});expect(buyIn).toHaveValue(null);
 const create=screen.getByRole('button',{name:producer==='page'?'bulkCreate.createCount':/Tạo 1 giải/});fireEvent.click(create);await act(async()=>{});
 expect(h.rpc).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);
 fireEvent.change(buyIn,{target:{value:'100000'}});
 const stack=screen.getByDisplayValue('20000');fireEvent.change(stack,{target:{value:''}});expect(stack).toHaveValue(null);fireEvent.click(create);await act(async()=>{});
 expect(h.rpc).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);
 fireEvent.change(stack,{target:{value:'20000'}});
 fireEvent.change(buyIn,{target:{value:'0'}});fireEvent.click(create);
 await waitFor(()=>expect(h.rpc).toHaveBeenCalledTimes(1));expect(h.rpc.mock.calls[0][1].p_rows[0].buy_in).toBe(0);view.unmount();
});
