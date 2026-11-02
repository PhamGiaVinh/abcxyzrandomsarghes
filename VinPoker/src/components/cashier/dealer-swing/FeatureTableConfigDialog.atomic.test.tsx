import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const io=vi.hoisted(()=>({rpc:vi.fn(),success:vi.fn(),error:vi.fn(),close:vi.fn(),user:{id:'febf2b51-fdb7-42ff-886c-b3bb1fffdc3e'},token:'local-test'}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:io.user,session:{access_token:io.token}})}));
vi.mock('sonner',()=>({toast:{success:io.success,error:io.error}}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:io.rpc,from:()=>{
 const b={select:()=>b,eq:()=>b,maybeSingle:()=>b,abortSignal:()=>b,then:(resolve)=>Promise.resolve({data:{value:false},error:null}).then(resolve)};return b;
}}}));
import {FeatureTableConfigDialog} from './FeatureTableConfigDialog';
const club='d4427834-5f5f-48ef-bde5-e2dc388ed00b',table='e532db28-8841-48b0-8972-a9355f1dabe3';
const props={open:true,onOpenChange:io.close,clubId:club,tableId:table,tableName:'TEST100',dealers:[]};
const originalLocks=Object.getOwnPropertyDescriptor(navigator,'locks');
beforeEach(()=>{
 localStorage.clear();io.rpc.mockReset();io.close.mockReset();io.success.mockReset();io.error.mockReset();io.token='local-test';io.user.id='febf2b51-fdb7-42ff-886c-b3bb1fffdc3e';
 vi.stubEnv('VITE_SUPABASE_URL','http://127.0.0.1:54329');
 // Model only the browser lock API; actual cross-tab/native locks are separate acceptance.
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:string,callback:()=>unknown)=>callback()}});
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='get_table_dealer_rules')return {data:{club_id:club,as_of:'2026-10-25T00:00:00Z',tables:[]},error:null};
  if(name==='save_table_dealer_profile_v2')return {data:{status:'saved',actor_id:args.p_expected_actor,club_id:club,table_id:table,request_id:args.p_request_id,
   profile:{table_mode:args.p_table_mode,is_final:args.p_is_final,allow_override:args.p_allow_override,members:args.p_members}},error:null};
  return {data:null,error:null};
 });
});
afterEach(()=>{cleanup();vi.useRealTimers();if(originalLocks)Object.defineProperty(navigator,'locks',originalLocks);else Reflect.deleteProperty(navigator,'locks');});
it('bounds the dialog and scrolls long pending content on narrow screens',async()=>{
 render(<FeatureTableConfigDialog {...props}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Lưu'})).toBeEnabled());
 expect(screen.getByRole('dialog')).toHaveClass('max-h-[calc(100dvh-2rem)]','overflow-y-auto');
 expect(screen.getByRole('dialog').querySelector('fieldset')).toHaveClass('min-w-0');
 expect(screen.getByLabelText('Giờ bắt đầu dự kiến (sắp ra mắt)')).toHaveClass('min-w-0');
});
it('uses one canonical atomic save, never the two legacy writes',async()=>{
 render(<FeatureTableConfigDialog {...props}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Lưu'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Lưu'}));
 await waitFor(()=>expect(io.rpc).toHaveBeenCalledWith('save_table_dealer_profile_v2',expect.objectContaining({p_club_id:club,p_table_id:table,p_request_id:expect.any(String)})));
 expect(io.rpc.mock.calls.some(([name])=>['set_table_dealer_mode','set_table_dealer_pool'].includes(name))).toBe(false);
 await waitFor(()=>expect(io.close).toHaveBeenCalledWith(false));
});
it('keeps an unknown write open with a durable intent and a read-only recovery action',async()=>{
 const normal=io.rpc.getMockImplementation()!;
 io.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>name==='save_table_dealer_profile_v2'
  ?Promise.resolve({data:null,error:{message:'503 response lost'}}):normal(name,args));
 render(<FeatureTableConfigDialog {...props}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Lưu'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Lưu'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Kiểm tra kết quả lưu'})).toBeEnabled());
 expect(io.close).not.toHaveBeenCalled();expect(io.success).not.toHaveBeenCalled();
 expect(Object.keys(localStorage).some(k=>k.startsWith('vinpoker:dealer-profile:v1:'))).toBe(true);
});
it('reloads pending intent and recovers by receipt without another write',async()=>{
 const normal=io.rpc.getMockImplementation()!;let saved:Record<string,unknown>|undefined;
 io.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  if(name==='save_table_dealer_profile_v2'){saved=args;return Promise.resolve({data:null,error:{message:'lost response'}});}
  if(name==='get_table_dealer_profile_receipt_v2')return Promise.resolve({data:{status:'receipt_found',actor_id:args.p_expected_actor,result:{status:'saved',actor_id:saved!.p_expected_actor,club_id:club,table_id:table,request_id:saved!.p_request_id,
   profile:{table_mode:saved!.p_table_mode,is_final:saved!.p_is_final,allow_override:saved!.p_allow_override,members:saved!.p_members}}},error:null});
  return normal(name,args);
 });
 const first=render(<FeatureTableConfigDialog {...props}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Lưu'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Lưu'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Kiểm tra kết quả lưu'})).toBeEnabled());first.unmount();
 render(<FeatureTableConfigDialog {...props}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Kiểm tra kết quả lưu'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Kiểm tra kết quả lưu'}));
 await waitFor(()=>expect(io.close).toHaveBeenCalledWith(false));
 expect(io.rpc.mock.calls.filter(([n])=>n==='save_table_dealer_profile_v2')).toHaveLength(1);
 expect(io.rpc.mock.calls.filter(([n])=>n==='get_table_dealer_profile_receipt_v2')).toHaveLength(1);
});
it('checks a missing receipt before an explicit same-key retry',async()=>{
 const normal=io.rpc.getMockImplementation()!;let writes=0;
 io.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  if(name==='save_table_dealer_profile_v2'&&++writes===1)return Promise.resolve({data:null,error:{message:'503'}});
  if(name==='get_table_dealer_profile_receipt_v2')return Promise.resolve({data:{status:'receipt_not_found',actor_id:args.p_expected_actor},error:null});
  return normal(name,args);
 });
 render(<FeatureTableConfigDialog {...props}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Lưu'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Lưu'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Gửi lại cùng mã'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Gửi lại cùng mã'}));
 await waitFor(()=>expect(io.close).toHaveBeenCalledWith(false));
 const calls=io.rpc.mock.calls.filter(([n])=>n==='save_table_dealer_profile_v2');expect(calls).toHaveLength(2);expect(calls[0][1]).toEqual(calls[1][1]);
});
it('rejects a malformed success receipt without closing or discarding intent',async()=>{
 const normal=io.rpc.getMockImplementation()!;
 io.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>name==='save_table_dealer_profile_v2'?Promise.resolve({data:{status:'saved'},error:null}):normal(name,args));
 render(<FeatureTableConfigDialog {...props}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Lưu'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Lưu'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Kiểm tra kết quả lưu'})).toBeEnabled());expect(io.close).not.toHaveBeenCalled();expect(io.success).not.toHaveBeenCalled();
});
it('does not publish an old credential completion into the new scope',async()=>{
 const normal=io.rpc.getMockImplementation()!;let complete!:(value:unknown)=>void;let args:Record<string,unknown>={};
 io.rpc.mockImplementation((name:string,a:Record<string,unknown>)=>{if(name==='save_table_dealer_profile_v2'){args=a;return new Promise(resolve=>{complete=resolve;});}return normal(name,a);});
 const view=render(<FeatureTableConfigDialog {...props}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Lưu'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Lưu'}));
 await waitFor(()=>expect(complete).toBeDefined());
 io.token='different-incarnation';io.user.id='675fe35e-60a8-4452-bb90-e79486d54da6';view.rerender(<FeatureTableConfigDialog {...props}/>);
 await act(async()=>{complete({data:{status:'saved',actor_id:args.p_expected_actor,club_id:club,table_id:table,request_id:args.p_request_id,
  profile:{table_mode:args.p_table_mode,is_final:args.p_is_final,allow_override:args.p_allow_override,members:args.p_members}},error:null});});
 expect(io.close).not.toHaveBeenCalled();expect(io.success).not.toHaveBeenCalled();
 expect(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('vinpoker:dealer-profile:v1:'))!)!).state).toBe('pending');
});
it('bounds a stalled initial read and never enables save from unverified data',async()=>{
 vi.useFakeTimers();const normal=io.rpc.getMockImplementation()!;
 io.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>name==='get_table_dealer_rules'?new Promise(()=>{}):normal(name,args));
 render(<FeatureTableConfigDialog {...props}/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(20_001);});
 expect(screen.getByRole('alert')).toHaveTextContent('Không xác minh được cấu hình');
 expect(screen.getByRole('button',{name:'Lưu'})).toBeDisabled();expect(io.rpc.mock.calls).toHaveLength(1);
});
it('does not turn a malformed or foreign-club read into an empty editable profile',async()=>{
 io.rpc.mockResolvedValue({data:{club_id:crypto.randomUUID(),as_of:'2026-10-25T00:00:00Z',tables:[]},error:null});
 render(<FeatureTableConfigDialog {...props}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Không xác minh được cấu hình');
 expect(screen.getByRole('button',{name:'Lưu'})).toBeDisabled();expect(io.close).not.toHaveBeenCalled();
});
it.each(['saved','cancelled'] as const)('reports the actual %s outcome returned by cancel',async status=>{
 const normal=io.rpc.getMockImplementation()!;
 io.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  if(name==='save_table_dealer_profile_v2')return Promise.resolve({data:null,error:{message:'unknown transport outcome'}});
  if(name==='cancel_table_dealer_profile_v2')return Promise.resolve({data:{status,actor_id:args.p_expected_actor,club_id:club,table_id:table,request_id:args.p_request_id,
   profile:{table_mode:args.p_table_mode,is_final:args.p_is_final,allow_override:args.p_allow_override,members:args.p_members}},error:null});
  return normal(name,args);
 });
 render(<FeatureTableConfigDialog {...props}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Lưu'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Lưu'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Hủy yêu cầu chưa ghi'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Hủy yêu cầu chưa ghi'}));
 await waitFor(()=>expect(io.close).toHaveBeenCalledWith(false));
 expect(io.success).toHaveBeenCalledWith(status==='saved'?'Đã xác minh cấu hình bàn đã lưu':'Đã hủy yêu cầu chưa ghi; cấu hình không bị thay đổi.');
 const write=io.rpc.mock.calls.find(([name])=>name==='save_table_dealer_profile_v2')!;
 const cancel=io.rpc.mock.calls.find(([name])=>name==='cancel_table_dealer_profile_v2')!;expect(cancel[1]).toEqual(write[1]);
});
it('does not settle a cancelled receipt belonging to another actor',async()=>{
 const normal=io.rpc.getMockImplementation()!;
 io.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>{
  if(name==='save_table_dealer_profile_v2')return Promise.resolve({data:null,error:{message:'503'}});
  if(name==='cancel_table_dealer_profile_v2')return Promise.resolve({data:{status:'cancelled',actor_id:crypto.randomUUID(),club_id:club,table_id:table,request_id:args.p_request_id,
   profile:{table_mode:args.p_table_mode,is_final:args.p_is_final,allow_override:args.p_allow_override,members:args.p_members}},error:null});
  return normal(name,args);
 });
 render(<FeatureTableConfigDialog {...props}/>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Lưu'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Lưu'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Hủy yêu cầu chưa ghi'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Hủy yêu cầu chưa ghi'}));
 await waitFor(()=>expect(io.rpc.mock.calls.filter(([name])=>name==='cancel_table_dealer_profile_v2')).toHaveLength(1));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Hủy yêu cầu chưa ghi'})).toBeEnabled());
 expect(io.close).not.toHaveBeenCalled();expect(io.success).not.toHaveBeenCalled();
});
