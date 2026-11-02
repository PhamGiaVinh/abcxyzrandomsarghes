import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {persistCashPaymentIntent} from '@/lib/cashPaymentIntent';

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  refundReadFn: vi.fn(),
  bootstrapFailure:'' as ''|'toursNull'|'closedNull'|'hangTours',
  bootstrapSignals:[] as AbortSignal[],
  signals:[] as Array<{name:string;args:unknown;signal:AbortSignal}>,
  tourIs: vi.fn(),
  tours: [] as Array<{ id: string; name: string; start_time: string; status: string; deleted_at?: string | null }>,
  refund: null as null | { id: string; amount: number; status: "requested"; reason: string },
  openShift: null as null | {id:string;opening_cash:number;opened_at:string},
  closedMoney:{counted_cash:100 as number|null,variance_cash:0 as number|null},
  clubId:'club-a',
  search:'',
  scopeError:null as string|null,
  cashierGranted:true,
  refreshScope:vi.fn(),
  auth:{user:{id:'e1120000-0000-4000-8000-000000000001'},session:{access_token:'TEST-only-cash-token'},loading:false},
}));

vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = {
    rpc: (name:string,args:unknown) => {
      const result=Promise.resolve(mock.rpc(name,args));
      return Object.assign(result,{abortSignal:(signal:AbortSignal)=>{mock.signals.push({name,args,signal});return result;}});
    },
    from: (table: string) => {
      let closed = false;
      let liveToursOnly = false;
      const query = {
        select: () => query,
        eq: () => query,
        is: (...args: unknown[]) => {
          if (table === "tournaments") {
            mock.tourIs(...args);
            liveToursOnly = args[0] === "deleted_at" && args[1] === null;
          }
          return query;
        },
        not: () => { closed = true; return query; },
        order: () => query,
        abortSignal: (signal:AbortSignal) => {mock.bootstrapSignals.push(signal);return query;},
        limit: () => table==='tournaments'&&mock.bootstrapFailure==='hangTours'?new Promise(()=>{}):Promise.resolve({ data: table==='tournaments'&&mock.bootstrapFailure==='toursNull'||table==='cashier_till_shifts'&&closed&&mock.bootstrapFailure==='closedNull'?null:table === "tournaments" ? mock.tours.filter(tour => !liveToursOnly || !tour.deleted_at) : [
          { id: "shift-a", opened_at: "2026-09-15T08:00:00Z", closed_at: "2026-09-15T16:00:00Z", ...mock.closedMoney },
          { id: "shift-b", opened_at: "2026-09-14T08:00:00Z", closed_at: "2026-09-14T16:00:00Z", counted_cash: 200, variance_cash: 0 },
        ], error: null }),
        maybeSingle: () => table === "cashier_refund_requests" ? mock.refundReadFn() : Promise.resolve({ data: table === "cashier_till_shifts" ? mock.openShift : null, error: null }),
      };
      return query;
    },
  };
  return { useSupabaseClient: () => client };
});
vi.mock("@/ops/auth/OpsCapabilityProvider", () => ({
  useOpsCapabilities: () => ({
    loading: false, scopeError: mock.scopeError, isSuperAdmin: false, refresh:mock.refreshScope,
    cashierClubIds: mock.cashierGranted?[mock.clubId]:[], clubs: [{ id: mock.clubId, name: "Club A" }],
  }),
}));
vi.mock("@/ops/workspace/OpsWorkspaceProvider", () => ({
  useOpsWorkspace: () => ({ selectedClubId: mock.clubId }),
}));
vi.mock('react-router-dom',()=>({useSearchParams:()=>[new URLSearchParams(mock.search)]}));
vi.mock('@/ops/auth/OpsAuthProvider',()=>({useOpsAuth:()=>mock.auth}));
vi.mock("@/ops/opsMutations", () => ({
  assertMutationOk: (data: unknown) => data,
}));
vi.mock("@/lib/featureFlags", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/featureFlags")>(),
  OPS_TOUR_CASHIER_ENABLED: true,
}));
vi.mock("@/components/tournament/seat/SeatReceiptDialog", () => ({ SeatReceiptDialog: () => null }));

import TourCashierWorkbench from "./TourCashierWorkbench";
const cashClub='e1120000-0000-4000-8000-000000000002',cashTour='e1120000-0000-4000-8000-000000000003',cashRegistration='e1120000-0000-4000-8000-000000000004';
const summary=(shiftId:string)=>({ok:true,club_id:mock.clubId,shift_id:shiftId,
  totals:{cash_in:0,cash_out:0,bank_in:0,bank_out:0,unallocated_bank:0,cash_adjustments:0}});
function prepareCash(reply:(args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>){
  mock.clubId=cashClub;mock.tours=[{id:cashTour,name:'Tour A',start_time:'2026-10-16T10:00:00Z',status:'registering'}];
  mock.openShift={id:'shift-open',opening_cash:0,opened_at:'2026-10-16T08:00:00Z'};
  sessionStorage.setItem(`cashier-tour:${cashClub}`,cashTour);
  const fallback=mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation((name:string,args:unknown)=>{
    if(name==='resolve_cashier_cash_buyin_intent_v1')return reply(args as Record<string,unknown>);
    if(name==='cashier_tour_worklist_v1')return Promise.resolve({error:null,data:{ok:true,enabled:true,updated_at:'2026-10-20T00:00:00Z',
      counts:{counter:1,completed:0,waiting_seat:0,needs_review:0,total:1},rows:[{
        id:cashRegistration,tournament_id:cashTour,status:'pending',player_name:'TEST-CASH-PLAYER',
        reference_code:'TEST-CASH-REF',total_pay:100000,received:0,bucket:'counter',legacy_detail_missing:false,
        receipt_code:null,table_number:null,seat_number:null,
      }]}});
    return fallback(name,args);
  });
}

describe("closed Cashier shift correction", () => {
  beforeEach(() => {
    mock.bootstrapFailure='';mock.bootstrapSignals=[];
    mock.tours = [];
    mock.refund = null;
    mock.refundReadFn.mockReset().mockImplementation(()=>Promise.resolve({data:mock.refund,error:null}));
    mock.openShift = null;
    mock.closedMoney={counted_cash:100,variance_cash:0};
    mock.clubId='club-a';mock.auth={user:{id:'e1120000-0000-4000-8000-000000000001'},session:{access_token:'TEST-only-cash-token'},loading:false};
    mock.search='';
    mock.scopeError=null;mock.cashierGranted=true;mock.refreshScope.mockReset();
    localStorage.clear();
    const tails=new Map<string,Promise<unknown>>();
    Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(name:string,callback:()=>unknown)=>{
      const next=(tails.get(name)??Promise.resolve()).catch(()=>{}).then(callback);tails.set(name,next);return next;
    }}});
    sessionStorage.removeItem("cashier-tour:club-a");
    mock.rpc.mockReset();
    mock.signals=[];
    mock.tourIs.mockClear();
    mock.rpc.mockImplementation((name: string, args: { p_shift_id?: string }) => {
      if (name === "cashier_shift_summary_v1") return Promise.resolve({ data: summary(args.p_shift_id!), error: null });
      if (name === "cashier_tour_issues_v1") return Promise.resolve({ data: {
        ok: true, sepay_unavailable: false, shown: 0, rows: [],
      }, error: null });
      return Promise.resolve({ data: { ok: true }, error: null });
    });
  });

  it.each(['toursNull','closedNull'] as const)('rejects unverified bootstrap list %s and retries explicitly',async(mode)=>{
    mock.bootstrapFailure=mode;render(<TourCashierWorkbench/>);
    expect(await screen.findByText('Không tải được danh sách tour hoặc ca thu ngân. Bấm Làm mới để thử lại.')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Mở ca'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Mở ca'}));
    expect(mock.rpc.mock.calls.some(([name])=>name==='cashier_open_shift_v1')).toBe(false);
    mock.bootstrapFailure='';fireEvent.click(screen.getByRole('button',{name:'Làm mới'}));
    await waitFor(()=>expect(screen.queryByText('Không tải được danh sách tour hoặc ca thu ngân. Bấm Làm mới để thử lại.')).not.toBeInTheDocument());
  });

  it('bounds hung bootstrap reads and aborts all three owned requests',async()=>{
    vi.useFakeTimers();mock.bootstrapFailure='hangTours';
    try{render(<TourCashierWorkbench/>);await act(async()=>{await vi.advanceTimersByTimeAsync(10_000);});
      expect(screen.getByText('Không tải được danh sách tour hoặc ca thu ngân. Bấm Làm mới để thử lại.')).toBeInTheDocument();
      expect(mock.bootstrapSignals).toHaveLength(3);expect(mock.bootstrapSignals.every(s=>s.aborted)).toBe(true);
    }finally{cleanup();vi.useRealTimers();}
  });

  it('keeps exact pending payment read recovery available when bootstrap is unverified',async()=>{
    prepareCash(async()=>({data:{ok:true,status:'unknown'},error:null}));mock.bootstrapFailure='closedNull';
    const intent={actor_id:mock.auth.user.id,club_id:cashClub,tournament_id:cashTour,registration_id:cashRegistration,amount:100,
      request_id:'e1120000-0000-4000-8000-000000000099'};
    persistCashPaymentIntent(localStorage,intent);render(<TourCashierWorkbench/>);
    await screen.findByText('Không tải được danh sách tour hoặc ca thu ngân. Bấm Làm mới để thử lại.');
    const read=screen.getByRole('button',{name:'Kiểm tra khoản thu trước'});expect(read).toBeEnabled();
    fireEvent.click(read);await waitFor(()=>expect(mock.rpc.mock.calls.some(([name,args])=>name==='resolve_cashier_cash_buyin_intent_v1'
      &&(args as {p_action:string}).p_action==='read')).toBe(true));
    expect(mock.rpc.mock.calls.filter(([name])=>name==='resolve_cashier_cash_buyin_intent_v1').every(([,args])=>(args as {p_action:string}).p_action==='read')).toBe(true);
  });

  it('does not turn a failed capability read into permission denial and offers explicit safe retry',()=>{
    mock.scopeError='Scope read unavailable';
    render(<TourCashierWorkbench/>);
    expect(screen.queryByText('Không có quyền Cashier tại CLB đã chọn.')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh được quyền Cashier');
    fireEvent.click(screen.getByRole('button',{name:'Thử tải lại quyền Cashier'}));
    expect(mock.refreshScope).toHaveBeenCalledTimes(1);
    expect(mock.tourIs).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('shows distinct registration references for re-entry even when contact/card matches, and labels issued receipt seats',async()=>{
    prepareCash(()=>Promise.reject(new Error('display must not collect')));
    const fallback=mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation((name:string,args:{p_bucket?:string})=>name==='cashier_tour_worklist_v1'
      ?Promise.resolve({error:null,data:{ok:true,enabled:true,updated_at:'2026-10-20T00:00:00Z',counts:{counter:0,completed:2,waiting_seat:0,needs_review:0,total:2},rows:args.p_bucket==='all'
        ?['TEST-ENTRY-A','TEST-REENTRY-B'].map((reference,index)=>({id:`registration-${index}`,tournament_id:cashTour,status:'confirmed',player_name:'Same TEST player',
          phone:'TEST-contact',member_card_id:'TEST-card',reference_code:reference,total_pay:100000,received:100000,bucket:'completed',legacy_detail_missing:false,
          receipt_code:`TEST-receipt-${index}`,table_number:30,seat_number:index+1})):[]}})
      :fallback(name,args));
    render(<TourCashierWorkbench/>);
    fireEvent.click(await screen.findByRole('button',{name:'Tất cả · 2'}));
    const first=await screen.findByRole('button',{name:/TEST-ENTRY-A/});
    const second=screen.getByRole('button',{name:/TEST-REENTRY-B/});
    expect(within(first).getByText(/Phiếu đã cấp: bàn 30, ghế 1/)).toBeInTheDocument();
    expect(within(second).getByText(/Phiếu đã cấp: bàn 30, ghế 2/)).toBeInTheDocument();
    expect(mock.rpc.mock.calls.some(([name])=>name==='resolve_cashier_cash_buyin_intent_v1')).toBe(false);
  });
  it('explicitly labels server-projected archived receipt seats as history',async()=>{
    prepareCash(()=>Promise.reject(new Error('read only')));
    const fallback=mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation((name:string,args:{p_bucket?:string})=>name==='cashier_tour_worklist_v1'
      ?Promise.resolve({error:null,data:{ok:true,enabled:true,updated_at:'2026-10-20T00:00:00Z',counts:{counter:0,completed:1,waiting_seat:0,needs_review:0,total:1},rows:args.p_bucket==='all'
        ?[{id:cashRegistration,tournament_id:cashTour,status:'confirmed',player_name:'Archived TEST player',reference_code:'TEST-ARCHIVED',total_pay:100000,received:100000,
          bucket:'completed',legacy_detail_missing:false,receipt_code:'TEST-OLD-RECEIPT',table_number:31,seat_number:9,receipt_is_historical:true}]:[]}})
      :fallback(name,args));
    render(<TourCashierWorkbench/>);
    fireEvent.click(await screen.findByRole('button',{name:'Tất cả · 1'}));
    expect(await screen.findByText(/Phiếu lịch sử: bàn 31, ghế 9/)).toBeInTheDocument();
  });

  it('retains genuine permission denial after a successful scope read confirms no Cashier role',()=>{
    mock.cashierGranted=false;
    render(<TourCashierWorkbench/>);
    expect(screen.getByText('Không có quyền Cashier tại CLB đã chọn.')).toBeInTheDocument();
    expect(screen.queryByText(/Chưa xác minh được quyền Cashier/)).toBeNull();
    expect(mock.tourIs).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('opens the exact booking registration/tour instead of a different stored serving tour, without collecting money',async()=>{
    prepareCash(()=>Promise.reject(new Error('must not dispatch')));
    const other='e1120000-0000-4000-8000-000000000099';
    mock.tours.push({id:other,name:'Stored other tour',start_time:'2026-10-16T12:00:00Z',status:'registering'});
    sessionStorage.setItem(`cashier-tour:${cashClub}`,other);
    mock.search=`?club=${cashClub}&bookingTour=${cashTour}&bookingRegistration=${cashRegistration}`;
    render(<TourCashierWorkbench/>);
    await screen.findByRole('dialog',{name:'Chi tiết buy-in TEST-CASH-PLAYER'});
    expect(mock.rpc.mock.calls.filter(([name])=>name==='cashier_tour_worklist_v1')[0][1]).toMatchObject({p_tournament_id:cashTour,p_query:cashRegistration,p_bucket:'all'});
    expect(mock.rpc.mock.calls.some(([name])=>name==='resolve_cashier_cash_buyin_intent_v1')).toBe(false);
  });
  it('does not substitute another registration returned for a booking handoff',async()=>{
    prepareCash(()=>Promise.reject(new Error('must not dispatch')));
    mock.search=`?club=${cashClub}&bookingTour=${cashTour}&bookingRegistration=e1120000-0000-4000-8000-000000000098`;
    render(<TourCashierWorkbench/>);
    expect(await screen.findByText('Không xác minh được đúng đăng ký từ chat. Chưa thể thu tiền; tải lại hoặc mở quầy không kèm ngữ cảnh chat.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mock.rpc.mock.calls.some(([name])=>name==='resolve_cashier_cash_buyin_intent_v1')).toBe(false);
  });
  it('rejects a partial booking handoff rather than silently using the stored tour',async()=>{
    prepareCash(()=>Promise.reject(new Error('must not dispatch')));
    mock.search=`?club=${cashClub}&bookingTour=${cashTour}`;
    render(<TourCashierWorkbench/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Liên kết từ chat không hợp lệ');
    expect(mock.rpc.mock.calls.some(([name])=>name==='cashier_tour_worklist_v1')).toBe(false);
  });
  it.each(['wrong-tour','duplicate'])('rejects a %s response for an exact booking registration',async(kind)=>{
    prepareCash(()=>Promise.reject(new Error('must not dispatch')));
    const normal=mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation(async(name,args)=>{
      const result=await normal(name,args);
      if(name!=='cashier_tour_worklist_v1')return result;
      const row=result.data.rows[0];
      return {...result,data:{...result.data,rows:kind==='duplicate'?[row,row]:[{...row,tournament_id:'another-tour'}]}};
    });
    mock.search=`?club=${cashClub}&bookingTour=${cashTour}&bookingRegistration=${cashRegistration}`;
    render(<TourCashierWorkbench/>);
    await screen.findByText('Không xác minh được đúng đăng ký từ chat. Chưa thể thu tiền; tải lại hoặc mở quầy không kèm ngữ cảnh chat.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mock.rpc.mock.calls.some(([name])=>name==='resolve_cashier_cash_buyin_intent_v1')).toBe(false);
  });
  it('retires the old selected registration immediately when the booking URL retargets',async()=>{
    prepareCash(()=>Promise.reject(new Error('must not dispatch')));
    mock.search=`?club=${cashClub}&bookingTour=${cashTour}&bookingRegistration=${cashRegistration}`;
    const view=render(<TourCashierWorkbench/>);
    await screen.findByRole('dialog',{name:'Chi tiết buy-in TEST-CASH-PLAYER'});
    mock.search=`?club=${cashClub}&bookingTour=${cashTour}&bookingRegistration=e1120000-0000-4000-8000-000000000098`;
    view.rerender(<TourCashierWorkbench/>);
    expect(screen.queryByRole('dialog')).toBeNull();
    await screen.findByText('Không xác minh được đúng đăng ký từ chat. Chưa thể thu tiền; tải lại hoặc mở quầy không kèm ngữ cảnh chat.');
    expect(mock.rpc.mock.calls.some(([name])=>name==='resolve_cashier_cash_buyin_intent_v1')).toBe(false);
  });

  it.each(['null-money','string-money','wrong-shift','wrong-club'])('does not present %s current-shift summary as verified money',async(kind)=>{
    prepareCash(()=>Promise.reject(new Error('must not dispatch')));
    const normal=mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation((name,args)=>{
      if(name!=='cashier_shift_summary_v1')return normal(name,args);
      const value=summary(args.p_shift_id);
      return Promise.resolve({data:{...value,
        shift_id:kind==='wrong-shift'?'another-shift':value.shift_id,
        club_id:kind==='wrong-club'?'another-club':value.club_id,
        totals:{...value.totals,cash_in:kind==='null-money'?null:kind==='string-money'?'120000':0}},error:null});
    });
    render(<TourCashierWorkbench/>);
    await screen.findByText(/Không đọc được báo cáo ca/);
    expect(screen.queryByRole('region',{name:'Báo cáo ca hiện tại'})).not.toBeInTheDocument();
    expect(mock.rpc.mock.calls.some(([name])=>name==='cashier_close_shift_v1')).toBe(false);
  });

  it('rejects a closed-shift summary with a missing adjustment amount instead of allowing an adjustment against it',async()=>{
    const normal=mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation((name,args)=>name==='cashier_shift_summary_v1'
      ?Promise.resolve({data:{...summary(args.p_shift_id),totals:{...summary(args.p_shift_id).totals,cash_adjustments:null}},error:null})
      :normal(name,args));
    render(<TourCashierWorkbench/>);
    await screen.findByText(/Không đọc được ca vừa chốt/);
    expect(screen.getByRole('button',{name:'Ghi điều chỉnh'})).toBeDisabled();
    expect(screen.queryByText(/Điều chỉnh ghi bổ sung: 0/)).not.toBeInTheDocument();
  });

  it('preserves real zero totals and signed adjustment amounts in valid scoped summaries',async()=>{
    prepareCash(()=>Promise.reject(new Error('must not dispatch')));
    const normal=mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation((name,args)=>name==='cashier_shift_summary_v1'
      ?Promise.resolve({data:{...summary(args.p_shift_id),totals:{...summary(args.p_shift_id).totals,cash_adjustments:-25000}},error:null})
      :normal(name,args));
    render(<TourCashierWorkbench/>);
    const current=await screen.findByRole('region',{name:'Báo cáo ca hiện tại'});
    expect(within(current).getAllByText('0 VND')).toHaveLength(4);
    expect(await screen.findByText(/Điều chỉnh ghi bổ sung: -25.000 VND/)).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Ghi điều chỉnh'})).toBeEnabled();
  });

  it('does not replace absent closed-shift counted cash or variance with zero',async()=>{
    mock.closedMoney={counted_cash:null,variance_cash:null};
    render(<TourCashierWorkbench/>);
    await screen.findByText(/Thực đếm chưa xác minh · Chênh lệch chưa xác minh/);
    expect(screen.queryByText(/Thực đếm 0 VND · Chênh lệch 0 VND/)).not.toBeInTheDocument();
  });

  it('coordinates two instances through one shared journal before either payment settles',async()=>{
    let finish!:(value:{data:unknown;error:unknown})=>void;
    prepareCash(()=>new Promise(resolve=>{finish=resolve;}));
    const lock=vi.spyOn(navigator.locks,'request');
    const first=render(<TourCashierWorkbench/>),second=render(<TourCashierWorkbench/>);
    const a=within(first.container),b=within(second.container);
    fireEvent.click(await a.findByRole('button',{name:/TEST-CASH-PLAYER/}));
    fireEvent.click(await b.findByRole('button',{name:/TEST-CASH-PLAYER/}));
    fireEvent.change(a.getByRole('textbox',{name:'Nhận tiền mặt (VND)'}),{target:{value:'10000'}});
    fireEvent.change(b.getByRole('textbox',{name:'Nhận tiền mặt (VND)'}),{target:{value:'10000'}});
    await act(async()=>{
      fireEvent.click(a.getByRole('button',{name:'Ghi nhận tiền mặt'}));
      fireEvent.click(b.getByRole('button',{name:'Ghi nhận tiền mặt'}));
    });
    const calls=mock.rpc.mock.calls.filter(([name])=>name==='resolve_cashier_cash_buyin_intent_v1');
    expect(calls).toHaveLength(1);expect(lock).toHaveBeenCalledTimes(2);
    expect(lock.mock.calls[0][0]).toBe(lock.mock.calls[1][0]);
    await act(async()=>{finish({data:{ok:true,status:'unknown',intent:calls[0][1].p_intent},error:null});});
    expect(a.getByRole('button',{name:'Ghi nhận tiền mặt'})).toBeDisabled();
    expect(b.getByRole('button',{name:'Ghi nhận tiền mặt'})).toBeDisabled();
  });

  it('ignores late payment success from the previous authenticated actor',async()=>{
    let finish!:(value:{data:unknown;error:unknown})=>void;
    prepareCash(()=>new Promise(resolve=>{finish=resolve;}));
    const view=render(<TourCashierWorkbench/>);
    fireEvent.click(await screen.findByRole('button',{name:/TEST-CASH-PLAYER/}));
    fireEvent.click(screen.getByRole('button',{name:'Ghi nhận tiền mặt'}));
    await waitFor(()=>expect(mock.rpc.mock.calls.filter(([name])=>name==='resolve_cashier_cash_buyin_intent_v1')).toHaveLength(1));
    const intent=mock.rpc.mock.calls.find(([name])=>name==='resolve_cashier_cash_buyin_intent_v1')![1].p_intent;
    mock.auth={user:{id:'e1120000-0000-4000-8000-000000000091'},session:{access_token:'TEST-only-other-cash-token'},loading:false};
    view.rerender(<TourCashierWorkbench/>);
    await act(async()=>{finish({data:{ok:true,status:'recorded',intent,result:{ok:true,payment_state:'paid'}},error:null});});
    expect(screen.queryByText(/Đã xác minh khoản thu/)).not.toBeInTheDocument();
    const pending=JSON.parse(localStorage.getItem(`vp:cash-payment:v1:${intent.actor_id}:${intent.club_id}`)!);
    expect(pending.state).toBe('pending');
    expect(localStorage.getItem(`vp:cash-payment:v1:${mock.auth.user.id}:${cashClub}`)).toBeNull();
  });

  it.each(['actor','session'])('discards selected player and cash draft when %s changes within the same club',async(kind)=>{
    prepareCash(()=>Promise.reject(new Error('must not dispatch')));
    const view=render(<TourCashierWorkbench/>);
    fireEvent.click(await screen.findByRole('button',{name:/TEST-CASH-PLAYER/}));
    fireEvent.change(screen.getByRole('textbox',{name:'Nhận tiền mặt (VND)'}),{target:{value:'12345'}});
    mock.auth={...mock.auth,user:{id:kind==='actor'?'e1120000-0000-4000-8000-000000000091':mock.auth.user.id},
      session:{access_token:'TEST-only-replaced-session'}};
    await act(async()=>{view.rerender(<TourCashierWorkbench/>);});
    expect(screen.queryByRole('textbox',{name:'Nhận tiền mặt (VND)'})).not.toBeInTheDocument();
    expect(mock.rpc.mock.calls.some(([name])=>name==='resolve_cashier_cash_buyin_intent_v1')).toBe(false);
  });

  it('keeps the selected player and cash draft during a stable-scope rerender',async()=>{
    prepareCash(()=>Promise.reject(new Error('must not dispatch')));
    const view=render(<TourCashierWorkbench/>);
    fireEvent.click(await screen.findByRole('button',{name:/TEST-CASH-PLAYER/}));
    fireEvent.change(screen.getByRole('textbox',{name:'Nhận tiền mặt (VND)'}),{target:{value:'12345'}});
    await act(async()=>{view.rerender(<TourCashierWorkbench/>);});
    expect(screen.getByRole('textbox',{name:'Nhận tiền mặt (VND)'})).toHaveValue('12345');
    expect(mock.rpc.mock.calls.some(([name])=>name==='resolve_cashier_cash_buyin_intent_v1')).toBe(false);
  });

  it('bounds a hung worklist, does not overlap polling, and ignores its late result',async()=>{
    vi.useFakeTimers();
    let resolveRead!:(result:unknown)=>void;
    try{
      prepareCash(()=>Promise.reject(new Error('must not dispatch')));
      const normal=mock.rpc.getMockImplementation()!;
      mock.rpc.mockImplementation((name,args)=>name==='cashier_tour_worklist_v1'
        ?new Promise(resolve=>{resolveRead=resolve;}):normal(name,args));
      await act(async()=>{render(<TourCashierWorkbench/>);});
      expect(mock.rpc.mock.calls.filter(([name])=>name==='cashier_tour_worklist_v1')).toHaveLength(1);
      await act(async()=>{await vi.advanceTimersByTimeAsync(11000);});
      expect(mock.rpc.mock.calls.filter(([name])=>name==='cashier_tour_worklist_v1')).toHaveLength(1);
      expect(screen.queryByText('Đang tải danh sách tour…')).not.toBeInTheDocument();
      expect(screen.getByText(/Không xác minh được danh sách tour/)).toBeInTheDocument();
      await act(async()=>{resolveRead({error:null,data:{ok:true,enabled:true,updated_at:'2026-10-20T00:00:00Z',
        counts:{counter:0,completed:0,waiting_seat:0,needs_review:0,total:0},rows:[]}});});
      expect(screen.getByText(/Không xác minh được danh sách tour/)).toBeInTheDocument();
      expect(screen.queryByText('Không có khách trong nhóm này.')).not.toBeInTheDocument();
    }finally{cleanup();vi.useRealTimers();}
  });

  it('bounds hung SePay issue reads, stops polling and ignores late empty results until explicit refresh',async()=>{
    vi.useFakeTimers();let complete!:(result:unknown)=>void;
    try{
      prepareCash(()=>Promise.reject(new Error('must not dispatch')));
      const normal=mock.rpc.getMockImplementation()!;let hold=true;
      mock.rpc.mockImplementation((name,args)=>name==='cashier_tour_issues_v1'&&args.p_tournament_id===cashTour&&hold
        ?new Promise(resolve=>{complete=resolve;}):normal(name,args));
      await act(async()=>{render(<TourCashierWorkbench/>);});
      fireEvent.click(screen.getByRole('button',{name:/Chuyển khoản cần xử lý/}));
      const calls=()=>mock.rpc.mock.calls.filter(([name,args])=>name==='cashier_tour_issues_v1'&&args.p_tournament_id===cashTour);
      expect(calls()).toHaveLength(1);
      await act(async()=>{await vi.advanceTimersByTimeAsync(11000);});
      expect(calls()).toHaveLength(1);
      expect(screen.getAllByRole('alert').some(el=>el.textContent?.includes('Chưa tải được danh sách'))).toBe(true);
      expect(mock.signals.find(item=>item.name==='cashier_tour_issues_v1'&&(item.args as {p_tournament_id:string}).p_tournament_id===cashTour)?.signal.aborted).toBe(true);
      await act(async()=>{complete({data:{ok:true,sepay_unavailable:false,shown:0,rows:[]},error:null});await vi.advanceTimersByTimeAsync(20000);});
      expect(screen.queryByText('Chưa có khoản nào trong nhóm này.')).not.toBeInTheDocument();
      expect(calls()).toHaveLength(1);
      hold=false;await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Làm mới'}));});
      expect(screen.getByText('Chưa có khoản nào trong nhóm này.')).toBeInTheDocument();
      expect(mock.rpc.mock.calls.some(([name])=>name==='resolve_cashier_cash_buyin_intent_v1')).toBe(false);
    }finally{cleanup();vi.useRealTimers();}
  });

  it('polls SePay issues ten seconds after completion, not from the start of a slow read',async()=>{
    vi.useFakeTimers();let complete!:(result:unknown)=>void;
    try{
      prepareCash(()=>Promise.reject(new Error('must not dispatch')));
      const normal=mock.rpc.getMockImplementation()!;let hold=true;
      mock.rpc.mockImplementation((name,args)=>name==='cashier_tour_issues_v1'&&args.p_tournament_id===cashTour&&hold
        ?new Promise(resolve=>{complete=resolve;}):normal(name,args));
      await act(async()=>{render(<TourCashierWorkbench/>);});
      await act(async()=>{await vi.advanceTimersByTimeAsync(4000);hold=false;complete({data:{ok:true,sepay_unavailable:false,shown:0,rows:[]},error:null});});
      await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});
      const calls=()=>mock.rpc.mock.calls.filter(([name,args])=>name==='cashier_tour_issues_v1'&&args.p_tournament_id===cashTour);
      expect(calls()).toHaveLength(1);
      await act(async()=>{await vi.advanceTimersByTimeAsync(4000);});
      expect(calls()).toHaveLength(2);
    }finally{cleanup();vi.useRealTimers();}
  });

  it('schedules healthy worklist polling after completion rather than overlapping the request',async()=>{
    vi.useFakeTimers();let complete!:(result:unknown)=>void;
    try{
      prepareCash(()=>Promise.reject(new Error('must not dispatch')));
      const normal=mock.rpc.getMockImplementation()!;let first=true;
      mock.rpc.mockImplementation((name,args)=>{
        if(name==='cashier_tour_worklist_v1'&&first){first=false;return new Promise(resolve=>{complete=resolve;});}
        return normal(name,args);
      });
      await act(async()=>{render(<TourCashierWorkbench/>);});
      await act(async()=>{await vi.advanceTimersByTimeAsync(4000);complete({error:null,data:{ok:true,enabled:true,
        updated_at:'2026-10-20T00:00:00Z',counts:{counter:0,completed:0,waiting_seat:0,needs_review:0,total:0},rows:[]}});});
      await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});
      expect(mock.rpc.mock.calls.filter(([name])=>name==='cashier_tour_worklist_v1')).toHaveLength(1);
      await act(async()=>{await vi.advanceTimersByTimeAsync(4000);});
      expect(mock.rpc.mock.calls.filter(([name])=>name==='cashier_tour_worklist_v1')).toHaveLength(2);
    }finally{cleanup();vi.useRealTimers();}
  });

  it('clears stale payment selection on rejected polling and recovers only after explicit refresh',async()=>{
    vi.useFakeTimers();
    try{
      prepareCash(()=>Promise.reject(new Error('must not dispatch')));
      const normal=mock.rpc.getMockImplementation()!;let reads=0;
      mock.rpc.mockImplementation((name,args)=>{
        if(name==='cashier_tour_worklist_v1'&&++reads===2)return Promise.reject(new Error('TEST transport failure'));
        return normal(name,args);
      });
      await act(async()=>{render(<TourCashierWorkbench/>);});
      fireEvent.click(screen.getByRole('button',{name:/TEST-CASH-PLAYER/}));
      fireEvent.change(screen.getByRole('textbox',{name:'Nhận tiền mặt (VND)'}),{target:{value:'12345'}});
      await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
      expect(screen.getByText(/Không xác minh được danh sách tour/)).toBeInTheDocument();
      expect(screen.queryByRole('textbox',{name:'Nhận tiền mặt (VND)'})).not.toBeInTheDocument();
      await act(async()=>{await vi.advanceTimersByTimeAsync(20000);});
      expect(mock.rpc.mock.calls.filter(([name])=>name==='cashier_tour_worklist_v1')).toHaveLength(2);
      await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Làm mới'}));});
      expect(screen.queryByText(/Không xác minh được danh sách tour/)).not.toBeInTheDocument();
      expect(screen.getByRole('button',{name:/TEST-CASH-PLAYER/})).toBeInTheDocument();
      expect(mock.rpc.mock.calls.some(([name])=>name==='resolve_cashier_cash_buyin_intent_v1')).toBe(false);
    }finally{cleanup();vi.useRealTimers();}
  });

  it('pauses worklist polling while hidden or offline and resumes without overlapping a pending read',async()=>{
    vi.useFakeTimers();
    const visible=vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
    const online=vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
    try{
      prepareCash(()=>Promise.reject(new Error('must not dispatch')));
      await act(async()=>{render(<TourCashierWorkbench/>);});
      visible.mockReturnValue('hidden');
      await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(20000);});
      expect(mock.rpc.mock.calls.filter(([name])=>name==='cashier_tour_worklist_v1')).toHaveLength(1);
      visible.mockReturnValue('visible');online.mockReturnValue(false);
      await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('offline'));});
      expect(mock.rpc.mock.calls.filter(([name])=>name==='cashier_tour_worklist_v1')).toHaveLength(1);
      const normal=mock.rpc.getMockImplementation()!;let complete!:(result:unknown)=>void;
      mock.rpc.mockImplementation((name,args)=>name==='cashier_tour_worklist_v1'
        ?new Promise(resolve=>{complete=resolve;}):normal(name,args));
      online.mockReturnValue(true);
      await act(async()=>{window.dispatchEvent(new Event('online'));});
      await act(async()=>{window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));});
      expect(mock.rpc.mock.calls.filter(([name])=>name==='cashier_tour_worklist_v1')).toHaveLength(2);
      await act(async()=>{complete({data:{ok:true,enabled:true,updated_at:'2026-10-20T00:00:00Z',rows:[],counts:{counter:0,completed:0,waiting_seat:0,needs_review:0,total:0}},error:null});});
    }finally{cleanup();visible.mockRestore();online.mockRestore();vi.useRealTimers();}
  });

  it('does not dispatch cash if durable journal storage cannot be read',async()=>{
    prepareCash(()=>Promise.reject(new Error('must not dispatch')));
    const original=Storage.prototype.getItem;
    const read=vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(key){
      if(key.startsWith('vp:cash-payment:'))throw new Error('TEST storage unavailable');
      return original.call(this,key);
    });
    try{
      const view=render(<TourCashierWorkbench/>);
      await screen.findByText(/Không đọc được journal khoản thu/);
      fireEvent.click(await screen.findByRole('button',{name:/TEST-CASH-PLAYER/}));
      expect(screen.getByRole('button',{name:'Ghi nhận tiền mặt'})).toBeDisabled();
      expect(mock.rpc.mock.calls.some(([name])=>name==='resolve_cashier_cash_buyin_intent_v1')).toBe(false);
      await act(async()=>{view.unmount();});
    }finally{read.mockRestore();}
  });

  it('fails closed without an origin-wide Web Lock instead of pretending localStorage is atomic',async()=>{
    prepareCash(()=>Promise.reject(new Error('must not dispatch')));
    Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});
    render(<TourCashierWorkbench/>);
    fireEvent.click(await screen.findByRole('button',{name:/TEST-CASH-PLAYER/}));
    fireEvent.click(screen.getByRole('button',{name:'Ghi nhận tiền mặt'}));
    await screen.findByText(/chưa hỗ trợ khóa journal giữa các tab/);
    expect(mock.rpc.mock.calls.some(([name])=>name==='resolve_cashier_cash_buyin_intent_v1')).toBe(false);
    expect(localStorage.getItem(`vp:cash-payment:v1:${mock.auth.user.id}:${cashClub}`)).toBeNull();
  });

  it('never replaces an unknown cash-payment request key after closing and reopening its detail',async()=>{
    const tour='e1120000-0000-4000-8000-000000000003',registration='e1120000-0000-4000-8000-000000000004';
    mock.clubId='e1120000-0000-4000-8000-000000000002';
    mock.tours=[{id:tour,name:'Tour A',start_time:'2026-10-16T10:00:00Z',status:'registering'}];
    mock.openShift={id:'shift-open',opening_cash:0,opened_at:'2026-10-16T08:00:00Z'};
    sessionStorage.setItem(`cashier-tour:${mock.clubId}`,tour);
    const fallback=mock.rpc.getMockImplementation()!;
    let cashReply:((args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>)=()=>Promise.reject(new TypeError('TEST response lost after possible commit'));
    mock.rpc.mockImplementation((name:string,args:unknown)=>{
      if(name==='resolve_cashier_cash_buyin_intent_v1')return cashReply(args as Record<string,unknown>);
      if(name==='cashier_tour_worklist_v1')return Promise.resolve({error:null,data:{ok:true,enabled:true,updated_at:'2026-10-20T00:00:00Z',
        counts:{counter:1,completed:0,waiting_seat:0,needs_review:0,total:1},rows:[{
          id:registration,tournament_id:tour,status:'pending',player_name:'TEST-CASH-PLAYER',
          reference_code:'TEST-CASH-REF',total_pay:100000,received:0,bucket:'counter',legacy_detail_missing:false,
          receipt_code:null,table_number:null,seat_number:null,
        }]}});
      return fallback(name,args);
    });
    const view=render(<TourCashierWorkbench/>);
    fireEvent.click(await screen.findByRole('button',{name:/TEST-CASH-PLAYER/}));
    fireEvent.change(screen.getByRole('textbox',{name:'Nhận tiền mặt (VND)'}),{target:{value:'10000'}});
    fireEvent.click(screen.getByRole('button',{name:'Ghi nhận tiền mặt'}));
    await screen.findByText(/Chưa xác minh được khoản thu trước/);
    await waitFor(()=>expect(screen.getByRole('button',{name:'Đóng · khách tiếp theo'})).toBeEnabled());
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Đóng · khách tiếp theo'}));});
    expect(screen.queryByRole('button',{name:'Đóng · khách tiếp theo'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/TEST-CASH-PLAYER/}));
    fireEvent.change(screen.getByRole('textbox',{name:'Nhận tiền mặt (VND)'}),{target:{value:'10000'}});
    fireEvent.click(screen.getByRole('button',{name:'Ghi nhận tiền mặt'}));
    expect(screen.getByRole('button',{name:'Ghi nhận tiền mặt'})).toBeDisabled();
    const attempts=mock.rpc.mock.calls.filter(([name])=>name==='resolve_cashier_cash_buyin_intent_v1');
    expect(attempts).toHaveLength(1);expect(attempts[0][1].p_action).toBe('record');
    expect(attempts[0][1].p_intent).toMatchObject({registration_id:registration,amount:10000});
    expect(mock.rpc.mock.calls.some(([name])=>name==='cashier_record_cash_buyin_v1')).toBe(false);
    view.unmount();render(<TourCashierWorkbench/>);
    fireEvent.click(await screen.findByRole('button',{name:/TEST-CASH-PLAYER/}));
    expect(screen.getByRole('button',{name:'Ghi nhận tiền mặt'})).toBeDisabled();
    cashReply=args=>Promise.resolve({data:{ok:true,status:'unknown',intent:args.p_intent},error:null});
    fireEvent.click(screen.getByRole('button',{name:'Kiểm tra khoản thu trước'}));
    await screen.findByText(/Chưa xác minh được khoản thu trước/);
    await waitFor(()=>expect(screen.getByRole('button',{name:'Đóng yêu cầu chưa ghi nhận'})).toBeEnabled());
    expect(mock.rpc.mock.calls.filter(([name,args])=>name==='resolve_cashier_cash_buyin_intent_v1'&&args.p_action==='record')).toHaveLength(1);
    cashReply=args=>Promise.resolve({data:{ok:true,status:'cancelled',intent:args.p_intent,result:{ok:false,error:'cash_intent_cancelled'}},error:null});
    fireEvent.click(screen.getByRole('button',{name:'Đóng yêu cầu chưa ghi nhận'}));
    await screen.findByText(/Đã đóng yêu cầu chưa ghi nhận/);
    expect(screen.queryByRole('button',{name:'Kiểm tra khoản thu trước'})).not.toBeInTheDocument();
    const reconciliations=mock.rpc.mock.calls.filter(([name])=>name==='resolve_cashier_cash_buyin_intent_v1');
    expect(reconciliations.map(([,args])=>args.p_action)).toEqual(['record','read','cancel']);
    for(const [,args] of reconciliations)expect(args.p_intent).toEqual(attempts[0][1].p_intent);
  });

  it("excludes soft-deleted tours before restoring a stored Cashier selection", async () => {
    mock.tours = [
      { id: "tour-a", name: "Tour A", start_time: "2026-09-15T10:00:00Z", status: "registering" },
      { id: "deleted-tour", name: "Deleted tour", start_time: "2026-09-14T10:00:00Z", status: "active", deleted_at: "2026-09-15T09:00:00Z" },
    ];
    sessionStorage.setItem("cashier-tour:club-a", "deleted-tour");
    render(<TourCashierWorkbench />);
    await screen.findByRole("button", { name: /^Tour A ·/ });
    expect(screen.queryByRole("button", { name: /^Deleted tour ·/ })).not.toBeInTheDocument();
    expect(mock.tourIs).toHaveBeenCalledWith("deleted_at", null);
    expect(mock.rpc.mock.calls.some(([name]) => name === "cashier_tour_worklist_v1")).toBe(false);
    expect(mock.rpc.mock.calls.some(([name]) => /record|open|adjust|complete/.test(name))).toBe(false);
  });

  it("targets the selected historical shift, not only the latest closed shift", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TourCashierWorkbench />);
    const selector = await screen.findByRole("combobox", { name: "Chọn ca đã chốt" });
    fireEvent.change(selector, { target: { value: "shift-b" } });
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("cashier_shift_summary_v1", { p_shift_id: "shift-b" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Số tiền (VND)" }), { target: { value: "100000" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Lý do" }), { target: { value: "Sửa sai kiểm đếm" } });
    fireEvent.click(screen.getByRole("button", { name: "Ghi điều chỉnh" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("cashier_adjust_shift_v1", expect.objectContaining({
      p_shift_id: "shift-b", p_direction: "in", p_amount: 100000,
    })));
    vi.restoreAllMocks();
  });

  it("shows a confirmed registration without a receipt as requiring review, never another payment", async () => {
    mock.tours = [{ id: "tour-a", name: "Tour A", start_time: "2026-09-15T10:00:00Z", status: "registering" }];
    sessionStorage.setItem("cashier-tour:club-a", "tour-a");
    mock.rpc.mockImplementation((name: string, args: { p_bucket?: string; p_shift_id?: string }) => {
      if (name === "cashier_tour_worklist_v1") return Promise.resolve({ data: {
        ok: true, enabled: true, updated_at: "2026-09-15T09:00:00Z",
        counts: { counter: 0, completed: 0, waiting_seat: 0, needs_review: 1, total: 1 },
        rows: args.p_bucket === "needs_review" ? [{
          id: "registration-a", tournament_id: "tour-a", status: "confirmed", player_name: "Người chơi cũ",
          phone: null, member_card_id: null, reference_code: "TEST-REF", total_pay: 2300000,
          received: 0, bucket: "needs_review", receipt_code: null, table_number: null,
          seat_number: null, legacy_detail_missing: true, cashier_seating_error: null,
        }] : [],
      }, error: null });
      if (name === "cashier_tour_issues_v1") return Promise.resolve({ data: {
        ok: true, sepay_unavailable: false, shown: 0, rows: [],
      }, error: null });
      return Promise.resolve({ data: summary(args.p_shift_id!), error: null });
    });
    render(<TourCashierWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "Cần xử lý · 1" }));
    fireEvent.click(await screen.findByRole("button", { name: /Người chơi cũ/ }));
    await screen.findByText("Chỉ hoàn đúng khoản đã ghi trong sổ giao dịch. Khách ở hàng chờ, chưa có ghế/chip hoạt động, không cần Floor xác nhận.");
    expect(screen.getByText("Đăng ký đã xác nhận nhưng không tìm thấy phiếu hiện hành. Không thu thêm tiền; báo Floor và đối soát kiểm tra.")).toBeInTheDocument();
    expect(screen.getByText("Không thu thêm")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ghi nhận tiền mặt" })).not.toBeInTheDocument();
    const detail = within(screen.getByRole("dialog", { name: /Người chơi cũ/ }));
    fireEvent.change(detail.getByRole("textbox", { name: "Lý do" }), { target: { value: "Hoàn tiền khách chờ" } });
    expect(detail.getByRole("button", { name: "Yêu cầu hoàn tiền" })).toBeEnabled();
  });

  it("lets Cashier record a verified waiting-seat refund without a Floor click", async () => {
    mock.tours = [{ id: "tour-a", name: "Tour A", start_time: "2026-09-15T10:00:00Z", status: "registering" }];
    mock.refund = { id: "refund-a", amount: 6600000, status: "requested", reason: "Khách chờ hoàn tiền" };
    sessionStorage.setItem("cashier-tour:club-a", "tour-a");
    mock.rpc.mockImplementation((name: string,args:{p_shift_id?:string}) => Promise.resolve({ data: name === "cashier_tour_worklist_v1"
      ? { ok: true, enabled: true, updated_at: "2026-09-15T09:00:00Z",
          counts: { counter: 0, completed: 0, waiting_seat: 1, needs_review: 0, total: 1 },
          rows: [{ id: "registration-a", tournament_id: "tour-a", status: "pending", player_name: "Khách chờ",
            phone: null, member_card_id: null, reference_code: "TEST-WAIT", total_pay: 6600000,
            received: 6600000, bucket: "waiting_seat", receipt_code: null, table_number: null,
            seat_number: null, legacy_detail_missing: false, cashier_seating_error: null }] }
      : name === "cashier_tour_issues_v1" ? { ok: true, sepay_unavailable: false, shown: 0, rows: [] }
        : name==='cashier_shift_summary_v1'?summary(args.p_shift_id!):{ok:true}, error: null }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TourCashierWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "Chờ ghế · 1" }));
    fireEvent.click(await screen.findByRole("button", { name: /Khách chờ/ }));
    const detail = within(screen.getByRole("dialog", { name: /Khách chờ/ }));
    fireEvent.change(await detail.findByRole("textbox", { name: "Chuyển khoản" }), { target: { value: "6600000" } });
    fireEvent.change(detail.getByRole("textbox", { name: "Mã giao dịch hoàn qua ngân hàng (nếu có)" }), { target: { value: "TEST-RETURN" } });
    fireEvent.change(detail.getByRole("textbox", { name: "Bằng chứng chi hoàn" }), { target: { value: "Đã chuyển khoản cho khách TEST" } });
    fireEvent.click(detail.getByRole("button", { name: "Ghi nhận đã chi hoàn" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledWith("cashier_complete_refund_v1", expect.objectContaining({
      p_refund_id: "refund-a", p_cash_amount: 0, p_bank_amount: 6600000,
    })));
    vi.restoreAllMocks();
  });
  it.each(['countsNull','countNegative','countNaN','enabledMissing','timestampInvalid'] as const)('rejects malformed Cashier worklist metadata and recovers by manual refresh: %s',async(mode)=>{
    prepareCash(async()=>({data:null,error:null}));const fallback=mock.rpc.getMockImplementation()!;let broken=true;
    mock.rpc.mockImplementation((name,args)=>{
      if(name!=='cashier_tour_worklist_v1')return fallback(name,args);
      const good={ok:true,enabled:true,updated_at:'2026-10-20T00:00:00Z',counts:{counter:0,completed:0,waiting_seat:0,needs_review:0,total:0},rows:[]};
      const invalid=mode==='countsNull'?{...good,counts:null}:mode==='countNegative'?{...good,counts:{...good.counts,total:-1}}:mode==='countNaN'?{...good,counts:{...good.counts,total:NaN}}:mode==='enabledMissing'?{...good,enabled:undefined}:{...good,updated_at:'invalid-date'};
      return Promise.resolve({data:broken?invalid:good,error:null});
    });
    render(<TourCashierWorkbench/>);
    expect(await screen.findByText('Không xác minh được danh sách tour. Bấm Làm mới để thử lại.')).toBeInTheDocument();
    expect(screen.queryByText('Tất cả · 0')).toBeNull();broken=false;
    fireEvent.click(screen.getByRole('button',{name:'Làm mới'}));
    expect(await screen.findByRole('button',{name:'Tất cả · 0'})).toBeInTheDocument();
    expect(screen.queryByText('Không xác minh được danh sách tour. Bấm Làm mới để thử lại.')).toBeNull();
    expect(mock.rpc.mock.calls.some(([name])=>name==='resolve_cashier_cash_buyin_intent_v1')).toBe(false);
  });

  it.each(['hang','reject','malformed'] as const)('bounds other-tour lookup reads and permits explicit refresh recovery: %s',async(mode)=>{
    prepareCash(async()=>({data:null,error:null}));const fallback=mock.rpc.getMockImplementation()!;let resolve!:(v:unknown)=>void;let broken=true;
    mock.rpc.mockImplementation((name,args)=>name==='cashier_lookup_tour_v1'
      ?broken?mode==='hang'?new Promise(r=>{resolve=r;}):mode==='reject'?Promise.reject(new Error('TEST lookup unavailable')):Promise.resolve({data:{ok:true,rows:{}},error:null})
      :Promise.resolve({data:{ok:true,rows:[]},error:null}):fallback(name,args));
    render(<TourCashierWorkbench/>);await screen.findByRole('button',{name:'Chờ tại quầy · 1'});
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});try{
      fireEvent.change(screen.getByPlaceholderText('Quét QR, thẻ hội viên, mã CK; hoặc tìm tên, số điện thoại'),{target:{value:'TEST-query'}});
      await act(async()=>{await vi.advanceTimersByTimeAsync(10_251);});
      expect(screen.getByText(/Không đọc được đăng ký ở tour khác.*Làm mới/)).toBeInTheDocument();
      const lookupCalls=()=>mock.rpc.mock.calls.filter(([name])=>name==='cashier_lookup_tour_v1');expect(lookupCalls()).toHaveLength(1);
      if(mode==='hang')await act(async()=>{resolve({data:{ok:true,rows:[{registration_id:'late',tournament_id:'late-tour',tournament_name:'Late TEST tour',player_name:'Late TEST player'}]},error:null});});
      expect(screen.queryByRole('button',{name:'Xem đăng ký tour này'})).toBeNull();
      broken=false;fireEvent.click(screen.getByRole('button',{name:'Làm mới'}));
      await act(async()=>{await vi.advanceTimersByTimeAsync(251);});
      expect(lookupCalls()).toHaveLength(2);expect(screen.queryByText(/Không đọc được đăng ký ở tour khác.*Làm mới/)).toBeNull();
      expect(mock.rpc.mock.calls.some(([name])=>name==='resolve_cashier_cash_buyin_intent_v1')).toBe(false);
    }finally{cleanup();vi.useRealTimers();}
  });

  it.each(['hang','reject'] as const)('bounds selecting an other-tour registration and ignores late selection before explicit retry: %s',async(mode)=>{
    prepareCash(async()=>({data:null,error:null}));const fallback=mock.rpc.getMockImplementation()!;let broken=true;let resolve!:(v:unknown)=>void;
    const row={id:'other-registration',tournament_id:'other-tour',status:'pending',player_name:'Other TEST player',reference_code:'OTHER-TEST-REF',total_pay:100000,received:0,bucket:'counter',legacy_detail_missing:false,receipt_code:null,table_number:null,seat_number:null};
    const good={data:{ok:true,enabled:true,updated_at:'2026-10-20T00:00:00Z',counts:{counter:1,completed:0,waiting_seat:0,needs_review:0,total:1},rows:[row]},error:null};
    mock.rpc.mockImplementation((name,args)=>name==='cashier_lookup_tour_v1'?Promise.resolve({data:{ok:true,rows:[{registration_id:row.id,tournament_id:row.tournament_id,tournament_name:'Other TEST tour',player_name:row.player_name}]},error:null})
      :name==='cashier_tour_worklist_v1'&&args.p_tournament_id==='other-tour'?broken?mode==='hang'?new Promise(r=>{resolve=r;}):Promise.reject(new Error('TEST select offline')):Promise.resolve(good):fallback(name,args));
    render(<TourCashierWorkbench/>);await screen.findByRole('button',{name:'Chờ tại quầy · 1'});
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});try{
      fireEvent.change(screen.getByPlaceholderText('Quét QR, thẻ hội viên, mã CK; hoặc tìm tên, số điện thoại'),{target:{value:'OTHER'}});
      await act(async()=>{await vi.advanceTimersByTimeAsync(251);});
      fireEvent.click(screen.getByRole('button',{name:'Xem đăng ký tour này'}));
      await act(async()=>{await vi.advanceTimersByTimeAsync(10_001);});
      expect(screen.getByText(/Không đọc được đăng ký thuộc tour này.*Xem đăng ký tour này/)).toBeInTheDocument();
      if(mode==='hang')await act(async()=>{resolve(good);});
      expect(screen.queryByRole('dialog',{name:/Other TEST player/})).toBeNull();
      broken=false;await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Xem đăng ký tour này'}));});
      expect(screen.getByRole('dialog',{name:/Other TEST player/})).toBeInTheDocument();
      expect(mock.rpc.mock.calls.some(([name])=>name==='resolve_cashier_cash_buyin_intent_v1')).toBe(false);
    }finally{cleanup();vi.useRealTimers();}
  });

  it.each(['hang','reject'] as const)('bounds refund status reads without overlapping or accepting a late result: %s',async(mode)=>{
    prepareCash(async()=>({data:null,error:null}));const fallback=mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation((name,args)=>name==='cashier_tour_worklist_v1'?Promise.resolve({data:{ok:true,enabled:true,updated_at:'2026-10-20T00:00:00Z',counts:{counter:0,completed:1,waiting_seat:0,needs_review:0,total:1},rows:[{id:cashRegistration,tournament_id:cashTour,status:'confirmed',player_name:'Refund read TEST',reference_code:'REFUND-READ-TEST',total_pay:100000,received:100000,bucket:'completed',legacy_detail_missing:false,receipt_code:null,table_number:null,seat_number:null}]},error:null}):fallback(name,args));
    let resolve!:(v:unknown)=>void;mock.refundReadFn.mockImplementation(()=>mode==='hang'?new Promise(r=>{resolve=r;}):Promise.reject(new Error('TEST refund transport unavailable')));
    render(<TourCashierWorkbench/>);await screen.findByRole('button',{name:'Tất cả · 1'});
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});try{
      fireEvent.click(screen.getByRole('button',{name:'Đã tự hoàn tất · 1'}));await act(async()=>{});
      fireEvent.click(screen.getByRole('button',{name:/Refund read TEST Còn/}));await act(async()=>{});
      expect(mock.refundReadFn).toHaveBeenCalledTimes(1);
      await act(async()=>{await vi.advanceTimersByTimeAsync(10_001);});
      expect(mock.refundReadFn).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Không đọc được trạng thái hoàn tiền/)).toBeInTheDocument();
      if(mode==='hang')await act(async()=>{resolve({data:{id:'late-refund',amount:100000,status:'paid',reason:'Late TEST'},error:null});});
      expect(screen.queryByText(/Đã ghi nhận hoàn/)).toBeNull();
      mock.refundReadFn.mockResolvedValue({data:null,error:null});
      fireEvent.click(screen.getByRole('button',{name:'Đóng · khách tiếp theo'}));
      fireEvent.click(screen.getByRole('button',{name:/Refund read TEST Còn/}));await act(async()=>{});
      expect(screen.getByRole('button',{name:'Yêu cầu hoàn tiền'})).toBeInTheDocument();
      expect(mock.rpc.mock.calls.some(([name])=>name==='cashier_request_refund_v1'||name==='cashier_complete_refund_v1')).toBe(false);
    }finally{cleanup();vi.useRealTimers();}
  });

  it('polls healthy refund status ten seconds after completion instead of request start',async()=>{
    prepareCash(async()=>({data:null,error:null}));let resolve!:(v:unknown)=>void;
    mock.refundReadFn.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue({data:null,error:null});
    render(<TourCashierWorkbench/>);await screen.findByRole('button',{name:'Chờ tại quầy · 1'});
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});try{
      fireEvent.click(screen.getByRole('button',{name:/TEST-CASH-PLAYER Còn/}));await act(async()=>{});
      await act(async()=>{await vi.advanceTimersByTimeAsync(4000);resolve({data:null,error:null});});
      await act(async()=>{await vi.advanceTimersByTimeAsync(9999);});expect(mock.refundReadFn).toHaveBeenCalledTimes(1);
      await act(async()=>{await vi.advanceTimersByTimeAsync(1);});expect(mock.refundReadFn).toHaveBeenCalledTimes(2);
      expect(mock.rpc.mock.calls.some(([name])=>name==='cashier_complete_refund_v1')).toBe(false);
    }finally{cleanup();vi.useRealTimers();}
  });

  it.each(['amountNull','amountNegative','amountUnsafe','statusUnknown','array'] as const)('rejects malformed refund records before exposing completion actions: %s',async(mode)=>{
    prepareCash(async()=>({data:null,error:null}));const fallback=mock.rpc.getMockImplementation()!;
    mock.rpc.mockImplementation((name,args)=>name==='cashier_tour_worklist_v1'?Promise.resolve({data:{ok:true,enabled:true,updated_at:'2026-10-20T00:00:00Z',counts:{counter:0,completed:1,waiting_seat:0,needs_review:0,total:1},rows:[{id:cashRegistration,tournament_id:cashTour,status:'confirmed',player_name:'Invalid refund TEST',reference_code:'REFUND-SCHEMA-TEST',total_pay:100000,received:100000,bucket:'completed',legacy_detail_missing:false,receipt_code:null,table_number:null,seat_number:null}]},error:null}):fallback(name,args));
    const valid={id:'refund-schema',amount:100000,status:'requested',reason:'Refund schema TEST'};
    const invalid=mode==='amountNull'?{...valid,amount:null}:mode==='amountNegative'?{...valid,amount:-1}:mode==='amountUnsafe'?{...valid,amount:Number.MAX_SAFE_INTEGER+1}:mode==='statusUnknown'?{...valid,status:'unknown'}:[valid];
    mock.refundReadFn.mockResolvedValue({data:invalid,error:null});render(<TourCashierWorkbench/>);
    fireEvent.click(await screen.findByRole('button',{name:'Đã tự hoàn tất · 1'}));
    fireEvent.click(await screen.findByRole('button',{name:/Invalid refund TEST Còn/}));
    expect(await screen.findByText(/Không đọc được trạng thái hoàn tiền/)).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Ghi nhận đã chi hoàn'})).toBeNull();
    expect(screen.queryByRole('button',{name:'Yêu cầu hoàn tiền'})).toBeNull();
    expect(mock.rpc.mock.calls.some(([name])=>name==='cashier_complete_refund_v1'||name==='cashier_request_refund_v1')).toBe(false);
  });

  it('pauses refund polling while hidden or offline and resumes only one read',async()=>{
    prepareCash(async()=>({data:null,error:null}));let visible='visible';let online=true;
    const visibility=vi.spyOn(document,'visibilityState','get').mockImplementation(()=>visible as DocumentVisibilityState);
    const network=vi.spyOn(navigator,'onLine','get').mockImplementation(()=>online);
    render(<TourCashierWorkbench/>);await screen.findByRole('button',{name:'Chờ tại quầy · 1'});
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});try{
      fireEvent.click(screen.getByRole('button',{name:/TEST-CASH-PLAYER Còn/}));await act(async()=>{});
      expect(mock.refundReadFn).toHaveBeenCalledTimes(1);
      visible='hidden';document.dispatchEvent(new Event('visibilitychange'));
      await act(async()=>{await vi.advanceTimersByTimeAsync(20_000);});expect(mock.refundReadFn).toHaveBeenCalledTimes(1);
      online=false;visible='visible';document.dispatchEvent(new Event('visibilitychange'));
      await act(async()=>{});expect(mock.refundReadFn).toHaveBeenCalledTimes(1);
      mock.refundReadFn.mockImplementation(()=>new Promise(()=>{}));online=true;
      await act(async()=>{window.dispatchEvent(new Event('online'));});expect(mock.refundReadFn).toHaveBeenCalledTimes(2);
      await act(async()=>{window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));});
      expect(mock.refundReadFn).toHaveBeenCalledTimes(2);
    }finally{cleanup();visibility.mockRestore();network.mockRestore();vi.useRealTimers();}
  });

});
