import {createElement,type ReactNode} from 'react';
import {act,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({rpc:vi.fn(),success:vi.fn(),error:vi.fn(),invalidate:vi.fn(),actor:'actor',session:{access_token:'staff-invite-old'}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:f.actor},session:f.session})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:f.rpc}}));
vi.mock('sonner',()=>({toast:{success:f.success,error:f.error}}));
import {useStaffRedeemCode} from './useStaffRedeemCode';
const receipt={status:'ok',staff_id:'11111111-1111-4111-8111-111111111111',club_id:'22222222-2222-4222-8222-222222222222'};
function wrapper(){const client=new QueryClient({defaultOptions:{mutations:{retry:false}}});
 vi.spyOn(client,'invalidateQueries').mockImplementation(f.invalidate);
 return({children}:{children:ReactNode})=>createElement(QueryClientProvider,{client},children);}
beforeEach(()=>{vi.clearAllMocks();f.actor='actor';f.session={access_token:'staff-invite-old'};f.rpc.mockReset();f.invalidate.mockResolvedValue(undefined);});
describe('staff invite canonical receipt boundary',()=>{
 it.each([['actor','success'],['session','success'],['unmount','success'],['actor','error'],['session','error'],['unmount','error']])('does not publish an old invite %s/%s completion',async(change,outcome)=>{
  let finish!:(value:unknown)=>void;
  f.rpc.mockImplementation(()=>new Promise(done=>{finish=done;}));
  const h=renderHook(()=>useStaffRedeemCode(),{wrapper:wrapper()});let pending!:Promise<unknown>;
  act(()=>{pending=h.result.current.mutateAsync('TEST12345678').catch(error=>error);});
  await waitFor(()=>expect(f.rpc).toHaveBeenCalledTimes(1));
  if(change==='actor')f.actor='other';else if(change==='session')f.session={access_token:'staff-invite-new'};
  if(change==='unmount')h.unmount();else h.rerender();
  await act(async()=>{finish(outcome==='success'?{data:receipt,error:null}:{data:null,error:{message:'OLD_SESSION_TEST_ERROR'}});await pending;});
  expect(f.success).not.toHaveBeenCalled();expect(f.error).not.toHaveBeenCalled();expect(f.invalidate).not.toHaveBeenCalled();h.unmount();
 });
 it.each([null,{}, {...receipt,status:'unknown'},{...receipt,staff_id:'bad'},{...receipt,club_id:null}])('does not announce a link for malformed receipt',async(data)=>{
  f.rpc.mockResolvedValue({data,error:null});const h=renderHook(()=>useStaffRedeemCode(),{wrapper:wrapper()});let failure:unknown;
  await act(async()=>{try{await h.result.current.mutateAsync('TEST12345678');}catch(error){failure=error;}});
  expect(failure).toBeInstanceOf(Error);expect(f.success).not.toHaveBeenCalled();expect(f.invalidate).not.toHaveBeenCalled();h.unmount();
 });
 it('confirms only the canonical success receipt and refreshes staff queries',async()=>{
  f.rpc.mockResolvedValue({data:receipt,error:null});const h=renderHook(()=>useStaffRedeemCode(),{wrapper:wrapper()});
  await act(async()=>{await h.result.current.mutateAsync(' TEST12345678 ');});
  expect(f.rpc).toHaveBeenCalledWith('staff_redeem_link_code',{p_code:'TEST12345678'});expect(f.success).toHaveBeenCalledTimes(1);
  expect(f.invalidate).toHaveBeenCalledWith({queryKey:['staffApp']});h.unmount();
 });
 it.each([{data:{error:'EXPIRED'},error:null},{data:null,error:{message:'503 TEST'}},{data:null,error:{code:'42883',message:'missing'}}])('does not confirm server or transport denial',async(response)=>{
  f.rpc.mockResolvedValue(response);const h=renderHook(()=>useStaffRedeemCode(),{wrapper:wrapper()});
  await act(async()=>{try{await h.result.current.mutateAsync('TEST12345678');}catch{/* expected denial */}});
  expect(f.success).not.toHaveBeenCalled();expect(f.error).toHaveBeenCalledTimes(1);expect(f.rpc).toHaveBeenCalledTimes(1);h.unmount();
 });
});
