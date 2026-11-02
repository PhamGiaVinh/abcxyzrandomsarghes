import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const invokeMock = vi.fn();
const ftAuth = vi.hoisted(() => ({ value: { user: { id: 'owner-a' }, session: { access_token: 'TEST_FT_SESSION_A' }, loading: false } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ftAuth.value }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { payrollStatementPdfAllClubs: false } }));

import { useFtPayrollStatements } from "@/hooks/useFtPayrollStatements";

const hsop = "22222222-2222-2222-2222-222222222222";
const period = "33333333-3333-4333-8333-333333333333";
const dealer = "44444444-4444-4444-8444-444444444444";

const rolloutOn = {
  allowed: true,
  master_enabled: true,
  all_clubs_enabled: false,
  allowlisted: true,
  reason: "ENABLED",
};

const onlinePreview = {
  view: {
    statement_id: "55555555-5555-4555-8555-555555555555",
    statement_hash: "a".repeat(64),
    draft: true,
    brand_name: "VINPOKER",
    club_name: "HSOP",
    period_label: "Tháng 08/2026",
    dealer: { full_name: "Nguyễn Minh Anh", department: "Dealer", job_title: "Dealer", bank_account_number: "0338356589", bank_name: "VPBank", hire_date: "15/04/2024", employment_type: "Chính thức" },
    metrics: [], income_lines: [], rate_segments: [], deduction_lines: [],
    gross_amount: "0", deduction_amount: "0", net_amount: "0", finalized_label: "—",
  },
};

describe("useFtPayrollStatements", () => {
  beforeEach(() => {
    ftAuth.value = { user: { id: 'owner-a' }, session: { access_token: 'TEST_FT_SESSION_A' }, loading: false };
    rpcMock.mockReset();
    // Automatic recovery may issue another read after a timeout. Preserve the
    // SDK response envelope for reads not explicitly scripted by a test.
    rpcMock.mockResolvedValue({ data: null, error: { code: 'LOCAL_UNSCRIPTED_READ' } });
    invokeMock.mockReset();
    sessionStorage.clear();
  });

  it("fails closed when rollout cannot be verified", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "XX000" } });
    const { result } = renderHook(() => useFtPayrollStatements({
      clubId: hsop,
      periodId: period,
      periodStatus: "locked",
      canFinalize: true,
      dealerIds: [dealer],
    }));
    await waitFor(() => expect(result.current.availability).toBe("unknown"));
    expect(result.current.statusFor(dealer)).toBe("UNKNOWN");
    expect(result.current.canFinalize).toBe(false);
  });

  it("treats a successful empty list as draft", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: rolloutOn, error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useFtPayrollStatements({
      clubId: hsop,
      periodId: period,
      periodStatus: "locked",
      canFinalize: true,
      dealerIds: [dealer],
    }));
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    expect(result.current.statusFor(dealer)).toBe("DRAFT");
    expect(result.current.counts.draft).toBe(1);
  });

  it("does not call finalize for a cashier-only actor", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: rolloutOn, error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useFtPayrollStatements({
      clubId: hsop,
      periodId: period,
      periodStatus: "locked",
      canFinalize: false,
      dealerIds: [dealer],
    }));
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    rpcMock.mockClear();
    await act(async () => expect(await result.current.finalize(dealer)).toBe(false));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("turns an uncertain finalize and failed reconciliation into UNKNOWN", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: rolloutOn, error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useFtPayrollStatements({
      clubId: hsop,
      periodId: period,
      periodStatus: "locked",
      canFinalize: true,
      dealerIds: [dealer],
    }));
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { code: "TIMEOUT" } })
      .mockResolvedValueOnce({ data: null, error: { code: "NETWORK" } });
    await act(async () => { await result.current.finalize(dealer); });
    expect(result.current.statusFor(dealer)).toBe("UNKNOWN");
  });

  it("reconciles a rejected finalize transport without retrying or discarding its request identity", async () => {
    rpcMock.mockResolvedValueOnce({data:rolloutOn,error:null}).mockResolvedValueOnce({data:[],error:null});
    const {result}=renderHook(()=>useFtPayrollStatements({clubId:hsop,periodId:period,periodStatus:'locked',canFinalize:true,dealerIds:[dealer]}));
    await waitFor(()=>expect(result.current.availability).toBe('ready'));
    rpcMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await act(async()=>{await expect(result.current.finalize(dealer)).resolves.toBe(false);});
    expect(result.current.statusFor(dealer)).toBe('UNKNOWN');
    const calls=rpcMock.mock.calls.filter(([name])=>name==='finalize_full_time_payroll_statement');
    expect(calls).toHaveLength(1);
    expect(sessionStorage.getItem(`payroll-statement-request:${hsop}:${period}:${dealer}`)).toBe(calls[0][1].p_request_id);
    expect(rpcMock.mock.calls.at(-1)?.[0]).toBe('list_full_time_payroll_statements_for_period');
  });

  it("fails closed when an explicit rollout refresh rejects", async () => {
    rpcMock.mockResolvedValueOnce({data:rolloutOn,error:null}).mockResolvedValueOnce({data:[],error:null});
    const {result}=renderHook(()=>useFtPayrollStatements({clubId:hsop,periodId:period,periodStatus:'locked',canFinalize:true,dealerIds:[dealer]}));
    await waitFor(()=>expect(result.current.availability).toBe('ready'));
    rpcMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await act(async()=>{await expect(result.current.refresh()).resolves.toBeUndefined();});
    expect(result.current.availability).toBe('unknown');
    expect(result.current.canFinalize).toBe(false);
  });

  it("accepts only the reconciled server statement after a lost finalize response", async () => {
    rpcMock.mockResolvedValueOnce({data:rolloutOn,error:null}).mockResolvedValueOnce({data:[],error:null});
    const {result}=renderHook(()=>useFtPayrollStatements({clubId:hsop,periodId:period,periodStatus:'locked',canFinalize:true,dealerIds:[dealer]}));
    await waitFor(()=>expect(result.current.availability).toBe('ready'));
    rpcMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({data:[{
      statement_id:'55555555-5555-4555-8555-555555555555',dealer_id:dealer,state:'finalized',statement_version:1,
      statement_hash:'a'.repeat(64),source_fingerprint:'b'.repeat(64),finalized_at:'2026-10-21T00:00:00Z',
      pdf_status:'not_generated',pdf_failure_code:null,pdf_rendered_at:null,
    }],error:null});
    await act(async()=>{await expect(result.current.finalize(dealer)).resolves.toBe(true);});
    expect(result.current.statusFor(dealer)).toBe('FINALIZED');
    expect(rpcMock.mock.calls.filter(([name])=>name==='finalize_full_time_payroll_statement')).toHaveLength(1);
    expect(sessionStorage.getItem(`payroll-statement-request:${hsop}:${period}:${dealer}`)).toBeNull();
  });

  it("requests a server-built online draft view without passing payroll values", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: rolloutOn, error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    invokeMock.mockResolvedValueOnce({ data: onlinePreview, error: null });
    const { result } = renderHook(() => useFtPayrollStatements({
      clubId: hsop,
      periodId: period,
      periodStatus: "locked",
      canFinalize: true,
      dealerIds: [dealer],
    }));
    await waitFor(() => expect(result.current.availability).toBe("ready"));
    await expect(result.current.previewDraft(dealer)).resolves.toMatchObject({ draft: true, club_name: "HSOP" });
    expect(invokeMock).toHaveBeenCalledWith("render-payroll-statement", {
      body: { mode: "preview_ft_view", club_id: hsop, dealer_id: dealer, payroll_period_id: period },
    });
  });

  it("does not let an older same-period list overwrite the latest finalized statement", async () => {
    let resolveOlder!: (value:unknown)=>void;
    let lists=0;
    const record={statement_id:'55555555-5555-4555-8555-555555555555',dealer_id:dealer,state:'finalized',statement_version:1,
      statement_hash:'a'.repeat(64),source_fingerprint:'b'.repeat(64),finalized_at:'2026-10-21T00:00:00Z',
      pdf_status:'not_generated',pdf_failure_code:null,pdf_rendered_at:null};
    rpcMock.mockImplementation((name:string)=>name==='get_dealer_payroll_statement_rollout'
      ?Promise.resolve({data:rolloutOn,error:null}):++lists===1?new Promise(resolve=>{resolveOlder=resolve;}):Promise.resolve({data:[record],error:null}));
    const {result}=renderHook(()=>useFtPayrollStatements({clubId:hsop,periodId:period,periodStatus:'locked',canFinalize:true,dealerIds:[dealer]}));
    await waitFor(()=>expect(lists).toBe(1));
    await act(async()=>{await result.current.refresh();});
    expect(result.current.statusFor(dealer)).toBe('FINALIZED');
    await act(async()=>resolveOlder({data:[],error:null}));
    expect(result.current.statusFor(dealer)).toBe('FINALIZED');
    expect(result.current.availability).toBe('ready');
  });

  it("does not let an old finalize reconciliation override a newer verified refresh", async () => {
    rpcMock.mockResolvedValueOnce({data:rolloutOn,error:null}).mockResolvedValueOnce({data:[],error:null});
    const {result}=renderHook(()=>useFtPayrollStatements({clubId:hsop,periodId:period,periodStatus:'locked',canFinalize:true,dealerIds:[dealer]}));
    await waitFor(()=>expect(result.current.availability).toBe('ready'));
    let resolveOld!: (value:unknown)=>void;
    rpcMock.mockResolvedValueOnce({data:{ok:true},error:null}).mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
    let pending!:Promise<boolean>;
    await act(async()=>{pending=result.current.finalize(dealer);});
    await waitFor(()=>expect(resolveOld).toBeDefined());
    rpcMock.mockResolvedValueOnce({data:rolloutOn,error:null}).mockResolvedValueOnce({data:[{
      statement_id:'55555555-5555-4555-8555-555555555555',dealer_id:dealer,state:'finalized',statement_version:1,
      statement_hash:'a'.repeat(64),source_fingerprint:'b'.repeat(64),finalized_at:'2026-10-21T00:00:00Z',
      pdf_status:'not_generated',pdf_failure_code:null,pdf_rendered_at:null,
    }],error:null});
    await act(async()=>{await result.current.refresh();});
    expect(result.current.statusFor(dealer)).toBe('FINALIZED');
    await act(async()=>{resolveOld({data:[],error:null});expect(await pending).toBe(false);});
    expect(result.current.statusFor(dealer)).toBe('FINALIZED');
    expect(rpcMock.mock.calls.filter(([name])=>name==='finalize_full_time_payroll_statement')).toHaveLength(1);
    expect(sessionStorage.getItem(`payroll-statement-request:${hsop}:${period}:${dealer}`)).not.toBeNull();
  });

  for(const historyOnly of [false,true]) it(`handles replaced statement history without treating it as current (${historyOnly})`,async()=>{
    const current={statement_id:'55555555-5555-4555-8555-555555555555',dealer_id:dealer,state:'finalized',statement_version:1,
      statement_hash:'a'.repeat(64),source_fingerprint:'b'.repeat(64),finalized_at:'2026-10-21T00:00:00Z',
      pdf_status:'not_generated',pdf_failure_code:null,pdf_rendered_at:null};
    const historical={...current,statement_id:'66666666-6666-4666-8666-666666666666',state:'replaced',finalized_at:'2026-10-20T00:00:00Z',pdf_status:'ready'};
    rpcMock.mockResolvedValueOnce({data:rolloutOn,error:null}).mockResolvedValueOnce({data:historyOnly?[historical]:[current,historical],error:null});
    const {result}=renderHook(()=>useFtPayrollStatements({clubId:hsop,periodId:period,periodStatus:'locked',canFinalize:true,dealerIds:[dealer]}));
    await waitFor(()=>expect(result.current.availability).not.toBe('loading'));
    if(historyOnly){expect(result.current.availability).toBe('unknown');expect(result.current.canFinalize).toBe(false);}
    else {expect(result.current.statusFor(dealer)).toBe('FINALIZED');
      invokeMock.mockResolvedValueOnce({data:{...onlinePreview,view:{...onlinePreview.view,draft:false}},error:null});
      await result.current.previewFinal(dealer);
      expect(invokeMock).toHaveBeenCalledWith('render-payroll-statement',{body:{mode:'preview_view',statement_id:current.statement_id}});
    }
  });

  for(const stage of ['rollout','list']) it(`bounds a hung ${stage} read and ignores its late result after manual recovery`,async()=>{
    vi.useFakeTimers();
    let resolveLate!: (value:unknown)=>void;
    const hung=new Promise(resolve=>{resolveLate=resolve;});
    if(stage==='list')rpcMock.mockResolvedValueOnce({data:rolloutOn,error:null});
    rpcMock.mockReturnValueOnce(hung);
    const view=renderHook(()=>useFtPayrollStatements({clubId:hsop,periodId:period,periodStatus:'locked',canFinalize:true,dealerIds:[dealer]}));
    try{
      await act(async()=>{});
      expect(view.result.current.availability).toBe('loading');
      await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
      expect(view.result.current.availability).toBe('unknown');
      expect(view.result.current.canFinalize).toBe(false);
      rpcMock.mockResolvedValueOnce({data:rolloutOn,error:null}).mockResolvedValueOnce({data:[],error:null});
      await act(async()=>{await view.result.current.refresh();});
      expect(view.result.current.availability).toBe('ready');
      await act(async()=>resolveLate({data:stage==='rollout'?{...rolloutOn,allowed:false}:null,error:null}));
      expect(view.result.current.availability).toBe('ready');
      expect(rpcMock.mock.calls.some(([name])=>name==='finalize_full_time_payroll_statement')).toBe(false);
    }finally{view.unmount();vi.useRealTimers();}
  });
});

describe('FT statement continuous reporting',()=>{
 beforeEach(()=>{rpcMock.mockReset();invokeMock.mockReset();sessionStorage.clear();ftAuth.value={user:{id:'owner-a'},session:{access_token:'TEST_FT_SESSION_A'},loading:false};});
 const record=()=>({statement_id:'55555555-5555-4555-8555-555555555555',dealer_id:dealer,state:'finalized',statement_version:1,
  statement_hash:'a'.repeat(64),source_fingerprint:'b'.repeat(64),finalized_at:'2026-10-31T00:00:00Z',pdf_status:'not_generated',pdf_failure_code:null,pdf_rendered_at:null});
 it('observes a remote finalized FT statement while the report stays open',async()=>{
  vi.useFakeTimers();let rows:unknown[]=[];
  rpcMock.mockImplementation(async(name:string)=>({data:name==='get_dealer_payroll_statement_rollout'?rolloutOn:rows,error:null}));
  const view=renderHook(()=>useFtPayrollStatements({clubId:hsop,periodId:period,periodStatus:'locked',canFinalize:true,dealerIds:[dealer]}));
  try{
   await act(async()=>vi.advanceTimersByTimeAsync(1));expect(view.result.current.statusFor(dealer)).toBe('DRAFT');
   rows=[record()];await act(async()=>vi.advanceTimersByTimeAsync(5000));
   expect(view.result.current.statusFor(dealer)).toBe('FINALIZED');
   expect(view.result.current.records[dealer].statement_hash).toBe('a'.repeat(64));
   expect(rpcMock.mock.calls.some(([name])=>name==='finalize_full_time_payroll_statement')).toBe(false);
  }finally{view.unmount();vi.useRealTimers();}
 });
 it('does not invalidate an in-flight finalize with an automatic report refresh',async()=>{
  vi.useFakeTimers();let finish!:(value:unknown)=>void;let rows:unknown[]=[];
  rpcMock.mockImplementation((name:string)=>name==='finalize_full_time_payroll_statement'?new Promise(resolve=>{finish=resolve;}):Promise.resolve({data:name==='get_dealer_payroll_statement_rollout'?rolloutOn:rows,error:null}));
  const view=renderHook(()=>useFtPayrollStatements({clubId:hsop,periodId:period,periodStatus:'locked',canFinalize:true,dealerIds:[dealer]}));
  try{
   await act(async()=>vi.advanceTimersByTimeAsync(1));let pending!:Promise<boolean>;
   act(()=>{pending=view.result.current.finalize(dealer);});await act(async()=>vi.advanceTimersByTimeAsync(5000));
   expect(rpcMock.mock.calls.filter(([name])=>name==='get_dealer_payroll_statement_rollout')).toHaveLength(1);
   rows=[record()];await act(async()=>{finish({data:{ok:true},error:null});expect(await pending).toBe(true);});
   expect(view.result.current.statusFor(dealer)).toBe('FINALIZED');
   expect(rpcMock.mock.calls.filter(([name])=>name==='finalize_full_time_payroll_statement')).toHaveLength(1);
  }finally{view.unmount();vi.useRealTimers();}
 });
 it('reconciles a committed finalize whose response hangs without sending another write',async()=>{
  vi.useFakeTimers();let committed=false;let late!:(value:unknown)=>void;
  rpcMock.mockImplementation((name:string)=>{
   if(name==='finalize_full_time_payroll_statement'){committed=true;return new Promise(resolve=>{late=resolve;});}
   return Promise.resolve({data:name==='get_dealer_payroll_statement_rollout'?rolloutOn:committed?[record()]:[],error:null});
  });
  const view=renderHook(()=>useFtPayrollStatements({clubId:hsop,periodId:period,periodStatus:'locked',canFinalize:true,dealerIds:[dealer]}));
  try{
   await act(async()=>vi.advanceTimersByTimeAsync(1));let outcome:boolean|undefined;
   act(()=>{void view.result.current.finalize(dealer).then(value=>{outcome=value;});});
   await act(async()=>vi.advanceTimersByTimeAsync(20001));expect(outcome).toBe(true);
   expect(view.result.current.statusFor(dealer)).toBe('FINALIZED');
   expect(rpcMock.mock.calls.filter(([name])=>name==='finalize_full_time_payroll_statement')).toHaveLength(1);
   await act(async()=>late({data:{ok:true},error:null}));expect(outcome).toBe(true);
  }finally{view.unmount();vi.useRealTimers();}
 }); it('recovers report status when PDF generation hangs without automatically dispatching another request',async()=>{
  vi.useFakeTimers();let generated=false;let late!:(value:unknown)=>void;
  rpcMock.mockImplementation(async(name:string)=>({data:name==='get_dealer_payroll_statement_rollout'?rolloutOn:[{...record(),pdf_status:generated?'ready':'not_generated'}],error:null}));
  invokeMock.mockImplementation(()=>{generated=true;return new Promise(resolve=>{late=resolve;});});
  const view=renderHook(()=>useFtPayrollStatements({clubId:hsop,periodId:period,periodStatus:'locked',canFinalize:true,dealerIds:[dealer]}));
  try{
   await act(async()=>vi.advanceTimersByTimeAsync(1));let outcome:string|undefined;
   act(()=>{void view.result.current.generatePdf(dealer).then(()=>{outcome='downloaded';},()=>{outcome='unconfirmed-download';});});
   await act(async()=>vi.advanceTimersByTimeAsync(20001));expect(outcome).toBe('unconfirmed-download');
   expect(view.result.current.statusFor(dealer)).toBe('PDF_READY');expect(invokeMock).toHaveBeenCalledTimes(1);
   await act(async()=>late({data:null,error:null}));expect(view.result.current.statusFor(dealer)).toBe('PDF_READY');
  }finally{view.unmount();vi.useRealTimers();}
 });
 it.each(['renewed session','mutated token','different actor','auth loading'])('hides old FT records and fences captured actions after %s',async kind=>{
  rpcMock.mockImplementation(async(name:string)=>({data:name==='get_dealer_payroll_statement_rollout'?rolloutOn:[record()],error:null}));
  const view=renderHook(()=>useFtPayrollStatements({clubId:hsop,periodId:period,periodStatus:'locked',canFinalize:true,dealerIds:[dealer]}));
  await waitFor(()=>expect(view.result.current.statusFor(dealer)).toBe('FINALIZED'));
  const oldFinalize=view.result.current.finalize,oldRefresh=view.result.current.refresh;
  const oldPreview=view.result.current.previewFinal,oldPdf=view.result.current.generatePdf;
  rpcMock.mockImplementation(()=>new Promise(()=>{}));
  if(kind==='mutated token')ftAuth.value.session.access_token='TEST_FT_SESSION_B';
  else if(kind==='different actor')ftAuth.value={...ftAuth.value,user:{id:'owner-b'}};
  else if(kind==='auth loading')ftAuth.value={...ftAuth.value,loading:true};
  else ftAuth.value={...ftAuth.value,session:{access_token:'TEST_FT_SESSION_B'}};
  view.rerender();
  expect(view.result.current.records).toEqual({});expect(view.result.current.canFinalize).toBe(false);
  const calls=rpcMock.mock.calls.length;
  await act(async()=>{expect(await oldFinalize(dealer)).toBe(false);await oldRefresh();});
  await expect(oldPreview(dealer)).rejects.toThrow('PAYROLL_STATEMENT_UNAVAILABLE');
  await expect(oldPdf(dealer)).rejects.toThrow('PAYROLL_STATEMENT_UNAVAILABLE');
  expect(invokeMock).not.toHaveBeenCalled();
  expect(rpcMock).toHaveBeenCalledTimes(calls);view.unmount();
 });
 it.each(['draft','final'] as const)('rejects a late %s preview after the session changes',async mode=>{
  rpcMock.mockImplementation(async(name:string)=>({data:name==='get_dealer_payroll_statement_rollout'?rolloutOn:[record()],error:null}));
  let late!:(value:unknown)=>void;invokeMock.mockImplementation(()=>new Promise(resolve=>{late=resolve;}));
  const view=renderHook(()=>useFtPayrollStatements({clubId:hsop,periodId:period,periodStatus:'locked',canFinalize:true,dealerIds:[dealer]}));
  await waitFor(()=>expect(view.result.current.availability).toBe('ready'));
  const pending=mode==='draft'?view.result.current.previewDraft(dealer):view.result.current.previewFinal(dealer);
  const rejected=expect(pending).rejects.toThrow('PAYROLL_STATEMENT_UNAVAILABLE');
  ftAuth.value={...ftAuth.value,session:{access_token:'TEST_FT_SESSION_B'}};view.rerender();
  await act(async()=>{late({data:{view:{...onlinePreview.view,draft:mode==='draft'}},error:null});});
  await rejected;view.unmount();
 });
 it('rejects a final preview with a different immutable statement identity',async()=>{
  rpcMock.mockImplementation(async(name:string)=>({data:name==='get_dealer_payroll_statement_rollout'?rolloutOn:[record()],error:null}));
  invokeMock.mockResolvedValue({data:{view:{...onlinePreview.view,draft:false,statement_id:'66666666-6666-4666-8666-666666666666'}},error:null});
  const view=renderHook(()=>useFtPayrollStatements({clubId:hsop,periodId:period,periodStatus:'locked',canFinalize:true,dealerIds:[dealer]}));
  await waitFor(()=>expect(view.result.current.availability).toBe('ready'));
  await expect(view.result.current.previewFinal(dealer)).rejects.toThrow('PAYROLL_STATEMENT_PREVIEW_UNAVAILABLE');view.unmount();
 });
});
