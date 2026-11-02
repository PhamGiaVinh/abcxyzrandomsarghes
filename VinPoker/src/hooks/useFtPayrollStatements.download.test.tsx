import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({rpc:vi.fn(),invoke:vi.fn(),fetch:vi.fn(),create:vi.fn(),auth:{user:{id:'owner'},session:{access_token:'LOCAL_FT_A'},loading:false}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>f.auth}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...a:unknown[])=>f.rpc(...a),functions:{invoke:(...a:unknown[])=>f.invoke(...a)}}}));
vi.mock('@/lib/featureFlags',()=>({FEATURES:{payrollStatementPdfAllClubs:true}}));
import {useFtPayrollStatements} from './useFtPayrollStatements';
const id='55555555-5555-4555-8555-555555555555',dealer='44444444-4444-4444-8444-444444444444';
const row={statement_id:id,dealer_id:dealer,state:'finalized',statement_version:1,statement_hash:'a'.repeat(64),source_fingerprint:'b'.repeat(64),finalized_at:'2026-10-31T00:00:00Z',pdf_status:'not_generated',pdf_failure_code:null,pdf_rendered_at:null};
const rollout={allowed:true,master_enabled:true,all_clubs_enabled:true,allowlisted:true,reason:'ENABLED'};
const deferred=()=>{let resolve!:(value:any)=>void;const promise=new Promise<any>(r=>{resolve=r;});return{promise,resolve};};
beforeEach(()=>{
 vi.useFakeTimers();f.rpc.mockReset();f.invoke.mockReset();f.fetch.mockReset();f.create.mockReset();f.create.mockReturnValue('blob:LOCAL_TEST');
 f.auth={user:{id:'owner'},session:{access_token:'LOCAL_FT_A'},loading:false};
 f.rpc.mockImplementation(async(name:string)=>({data:name==='get_dealer_payroll_statement_rollout'?rollout:[row],error:null}));
 f.invoke.mockResolvedValue({data:{statement_id:id,download_url:'http://127.0.0.1/LOCAL_TEST.pdf',download_filename:`phieu-luong-202610-${id}.pdf`},error:null});
 vi.stubGlobal('fetch',f.fetch);vi.stubGlobal('URL',Object.assign(class extends URL {},{createObjectURL:f.create,revokeObjectURL:vi.fn()}));
 vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function mount(periodId:string|null='period'){
 const view=renderHook(()=>useFtPayrollStatements({clubId:'club',periodId,periodStatus:'locked',canFinalize:true,dealerIds:[dealer]}));
 await act(async()=>vi.advanceTimersByTimeAsync(1));expect(view.result.current.availability).toBe('ready');return view;
}
it('downloads one verified PDF and reconciles without invoking the renderer again',async()=>{
 const blob=new Blob(['%PDF-1.4 LOCAL TEST'],{type:'application/pdf'});f.fetch.mockResolvedValue({ok:true,blob:async()=>blob});const view=await mount();
 let ok=false;await act(async()=>{ok=await view.result.current.generatePdf(dealer);});
 expect(ok).toBe(true);expect(f.create).toHaveBeenCalledWith(blob);expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);expect(f.invoke).toHaveBeenCalledTimes(1);
 expect(f.fetch.mock.calls[0][1].credentials).toBe('omit');expect(f.fetch.mock.calls[0][1].signal.aborted).toBe(true);
});
it.each([false,'text/html'])('does not save an unsuccessful or non-PDF response %j',async(kind)=>{
 f.fetch.mockResolvedValue({ok:kind!==false,blob:async()=>new Blob(['LOCAL TEST'],{type:'text/html'})});const view=await mount();
 await act(async()=>{await expect(view.result.current.generatePdf(dealer)).rejects.toThrow('PAYROLL_PDF_DOWNLOAD_FAILED');});expect(f.create).not.toHaveBeenCalled();
});
it.each(['statement','filename'])('rejects another statement %s before requesting its signed URL',async(kind)=>{
 const other='66666666-6666-4666-8666-666666666666';f.invoke.mockResolvedValue({data:{statement_id:kind==='statement'?other:id,download_url:'http://127.0.0.1/LOCAL_TEST.pdf',download_filename:`phieu-luong-202610-${kind==='filename'?other:id}.pdf`},error:null});
 const view=await mount();await act(async()=>{await expect(view.result.current.generatePdf(dealer)).rejects.toThrow('PAYROLL_PDF_SIGNED_URL_FAILED');});
 expect(f.fetch).not.toHaveBeenCalled();expect(f.create).not.toHaveBeenCalled();
});
it.each(['headers','body'])('bounds a stalled PDF %s and never saves its late body',async(stage)=>{
 const late=deferred();f.fetch.mockReturnValue(stage==='headers'?late.promise:Promise.resolve({ok:true,blob:()=>late.promise}));const view=await mount();
 let outcome='pending';act(()=>{void view.result.current.generatePdf(dealer).then(()=>{outcome='success';},e=>{outcome=e.message;});});
 await act(async()=>vi.advanceTimersByTimeAsync(20001));expect(outcome).not.toBe('pending');expect(outcome).not.toBe('success');
 expect(f.fetch.mock.calls[0][1].signal.aborted).toBe(true);
 expect(view.result.current.statusFor(dealer)).not.toBe('PDF_GENERATING');
 await act(async()=>late.resolve(stage==='headers'?{ok:true,blob:async()=>new Blob(['pdf'],{type:'application/pdf'})}:new Blob(['pdf'],{type:'application/pdf'})));
 expect(f.create).not.toHaveBeenCalled();expect(f.invoke).toHaveBeenCalledTimes(1);
});
it.each(['headers','body'])('does not download after a session changes while awaiting PDF %s',async(stage)=>{
 const late=deferred();f.fetch.mockReturnValue(stage==='headers'?late.promise:Promise.resolve({ok:true,blob:()=>late.promise}));const view=await mount();
 let outcome='pending';act(()=>{void view.result.current.generatePdf(dealer).then(()=>{outcome='success';},()=>{outcome='rejected';});});
 await act(async()=>vi.advanceTimersByTimeAsync(1));f.auth={...f.auth,session:{access_token:'LOCAL_FT_B'}};view.rerender();
 await act(async()=>late.resolve(stage==='headers'?{ok:true,blob:async()=>new Blob(['pdf'],{type:'application/pdf'})}:new Blob(['pdf'],{type:'application/pdf'})));
 expect(outcome).not.toBe('success');expect(f.create).not.toHaveBeenCalled();
});
it('clears a transient rollout error after an unsaved-period background recovery',async()=>{
 f.rpc.mockResolvedValueOnce({data:null,error:{code:'LOCAL_TEST_READ'}});const view=renderHook(()=>useFtPayrollStatements({clubId:'club',periodId:null,periodStatus:null,canFinalize:false,dealerIds:[dealer]}));
 await act(async()=>vi.advanceTimersByTimeAsync(1));expect(view.result.current.error).toBeTruthy();
 await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(view.result.current.availability).toBe('ready');expect(view.result.current.error).toBeNull();
});
