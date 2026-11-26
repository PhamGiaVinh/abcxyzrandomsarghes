import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PropsWithChildren} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({rpc:vi.fn(),enabled:true,auth:{user:{id:'owner'},session:{access_token:'TEST_SESSION'},loading:false}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>f.auth}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>f.rpc(...args)}}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{get staffSalaryAdjustments(){return f.enabled;}}}));
import {useSalaryAdjustments} from './useSalaryAdjustments';
const clients:QueryClient[]=[];
const request={id:'request',base_run_id:'base',staff_id:'staff',amount_vnd:200000,gross_delta_vnd:200000,state:'pending',source_fingerprint:'a'.repeat(64),child_run_id:null,created_at:'2026-11-26T12:00Z',approved_at:null,approved_by:null};
const packet=()=>({club_id:'club',period_year:2026,period_month:11,requests:[request]});
const input={requestId:'request',baseRunId:'base',staffId:'staff'};
function mount(owner=true){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);const wrapper=({children}:PropsWithChildren)=><QueryClientProvider client={client}>{children}</QueryClientProvider>;return renderHook(()=>useSalaryAdjustments('live','club',2026,11,owner),{wrapper});}
beforeEach(()=>{f.enabled=true;f.auth={user:{id:'owner'},session:{access_token:'TEST_SESSION'},loading:false};f.rpc.mockReset();f.rpc.mockResolvedValue({data:packet(),error:null});});
afterEach(()=>{cleanup();clients.splice(0).forEach(client=>client.clear());});
it('reads pending metadata without creating a payable or calling a writer',async()=>{
 const h=mount();await waitFor(()=>expect(h.result.current.data?.requests[0].amount_vnd).toBe(200000));
 expect(f.rpc).toHaveBeenCalledExactlyOnceWith('get_staff_salary_adjustments_v1',{p_club_id:'club',p_year:2026,p_month:11});
});
it('makes no request while the new action flag is OFF and rejects a captured approval',async()=>{
 f.enabled=false;const h=mount();expect(h.result.current.data).toBeUndefined();
 await expect(h.result.current.approve.mutateAsync(input)).rejects.toThrow();expect(f.rpc).not.toHaveBeenCalled();
});
it('does not offer accountant approval even with a valid pending request',async()=>{
 const h=mount(false);await waitFor(()=>expect(h.result.current.data).toBeDefined());
 await expect(h.result.current.approve.mutateAsync(input)).rejects.toThrow();expect(f.rpc.mock.calls.every(([fn])=>fn==='get_staff_salary_adjustments_v1')).toBe(true);
});
it('rechecks the pending request and sends only its ID to owner approval',async()=>{
 f.rpc.mockImplementation(async(fn:string)=>({data:fn==='approve_staff_salary_adjustment_v1'?{status:'approved',idempotent:false,request_id:'request',run_id:'request',base_run_id:'base',amount_vnd:200000}:packet(),error:null}));
 const h=mount();await waitFor(()=>expect(h.result.current.data).toBeDefined());
 await act(async()=>{await h.result.current.approve.mutateAsync(input);});
 expect(f.rpc).toHaveBeenCalledWith('approve_staff_salary_adjustment_v1',{p_request_id:'request'});
 expect(f.rpc.mock.calls.filter(([fn])=>fn==='approve_staff_salary_adjustment_v1')).toHaveLength(1);
});
it.each(['wrong-club','wrong-staff','superseded','wrong-receipt'])('refuses inconsistent approval evidence: %s',async(kind)=>{
 let phase='initial';f.rpc.mockImplementation(async(fn:string)=>{
  if(fn==='approve_staff_salary_adjustment_v1')return {data:{status:'approved',request_id:'other',run_id:'other',base_run_id:'base',amount_vnd:200000},error:null};
  const data=packet();if(phase==='confirm'){
   if(kind==='wrong-club')data.club_id='other';
   if(kind==='wrong-staff')data.requests=[{...request,staff_id:'other'}];
   if(kind==='superseded')data.requests=[{...request,state:'superseded'}];
  }return {data,error:null};
 });
 const h=mount();await waitFor(()=>expect(h.result.current.data).toBeDefined());phase='confirm';
 await act(async()=>{await expect(h.result.current.approve.mutateAsync(input)).rejects.toThrow();});
 if(kind!=='wrong-receipt')expect(f.rpc.mock.calls.some(([fn])=>fn==='approve_staff_salary_adjustment_v1')).toBe(false);
});
it('rejects an old captured approval after session rotation without sending a writer',async()=>{
 const h=mount();await waitFor(()=>expect(h.result.current.data).toBeDefined());const old=h.result.current.approve.mutateAsync;
 f.auth={...f.auth,session:{access_token:'NEW_TEST_SESSION'}};h.rerender();
 await expect(old(input)).rejects.toThrow();expect(f.rpc.mock.calls.some(([fn])=>fn==='approve_staff_salary_adjustment_v1')).toBe(false);
});
it('sends no approval when a held confirmation read resolves after the view unmounts',async()=>{
 const h=mount();await waitFor(()=>expect(h.result.current.data).toBeDefined());let release!:(value:unknown)=>void;
 f.rpc.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 let outcome!:Promise<unknown>;
 act(()=>{outcome=h.result.current.approve.mutateAsync(input).then(()=>null,error=>error);});
 await waitFor(()=>expect(release).toBeTypeOf('function'));h.unmount();
 release({data:packet(),error:null});expect(await outcome).toBeInstanceOf(Error);
 expect(f.rpc.mock.calls.some(([fn])=>fn==='approve_staff_salary_adjustment_v1')).toBe(false);
});
