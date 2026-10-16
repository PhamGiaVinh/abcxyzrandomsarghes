import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  tourIs: vi.fn(),
  tours: [] as Array<{ id: string; name: string; start_time: string; status: string; deleted_at?: string | null }>,
  refund: null as null | { id: string; amount: number; status: "requested"; reason: string },
  openShift: null as null | {id:string;opening_cash:number;opened_at:string},
  clubId:'club-a',
  auth:{user:{id:'e1120000-0000-4000-8000-000000000001'},session:{access_token:'TEST-only-cash-token'},loading:false},
}));

vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = {
    rpc: mock.rpc,
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
        limit: () => Promise.resolve({ data: table === "tournaments" ? mock.tours.filter(tour => !liveToursOnly || !tour.deleted_at) : [
          { id: "shift-a", opened_at: "2026-09-15T08:00:00Z", closed_at: "2026-09-15T16:00:00Z", counted_cash: 100, variance_cash: 0 },
          { id: "shift-b", opened_at: "2026-09-14T08:00:00Z", closed_at: "2026-09-14T16:00:00Z", counted_cash: 200, variance_cash: 0 },
        ], error: null }),
        maybeSingle: () => Promise.resolve({ data: table === "cashier_refund_requests" ? mock.refund : table === "cashier_till_shifts" ? mock.openShift : null, error: null }),
      };
      return query;
    },
  };
  return { useSupabaseClient: () => client };
});
vi.mock("@/ops/auth/OpsCapabilityProvider", () => ({
  useOpsCapabilities: () => ({
    loading: false, scopeError: null, isSuperAdmin: false,
    cashierClubIds: [mock.clubId], clubs: [{ id: mock.clubId, name: "Club A" }],
  }),
}));
vi.mock("@/ops/workspace/OpsWorkspaceProvider", () => ({
  useOpsWorkspace: () => ({ selectedClubId: mock.clubId }),
}));
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
function prepareCash(reply:(args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>){
  mock.clubId=cashClub;mock.tours=[{id:cashTour,name:'Tour A',start_time:'2026-10-16T10:00:00Z',status:'registering'}];
  mock.openShift={id:'shift-open',opening_cash:0,opened_at:'2026-10-16T08:00:00Z'};
  sessionStorage.setItem(`cashier-tour:${cashClub}`,cashTour);
  const fallback=mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation((name:string,args:unknown)=>{
    if(name==='resolve_cashier_cash_buyin_intent_v1')return reply(args as Record<string,unknown>);
    if(name==='cashier_tour_worklist_v1')return Promise.resolve({error:null,data:{ok:true,enabled:true,
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
    mock.tours = [];
    mock.refund = null;
    mock.openShift = null;
    mock.clubId='club-a';mock.auth={user:{id:'e1120000-0000-4000-8000-000000000001'},session:{access_token:'TEST-only-cash-token'},loading:false};
    localStorage.clear();
    const tails=new Map<string,Promise<unknown>>();
    Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(name:string,callback:()=>unknown)=>{
      const next=(tails.get(name)??Promise.resolve()).catch(()=>{}).then(callback);tails.set(name,next);return next;
    }}});
    sessionStorage.removeItem("cashier-tour:club-a");
    mock.rpc.mockReset();
    mock.tourIs.mockClear();
    mock.rpc.mockImplementation((name: string, args: { p_shift_id?: string }) => {
      if (name === "cashier_shift_summary_v1") return Promise.resolve({ data: {
        ok: true, shift_id: args.p_shift_id, totals: { cash_adjustments: 0 },
      }, error: null });
      if (name === "cashier_tour_issues_v1") return Promise.resolve({ data: {
        ok: true, sepay_unavailable: false, shown: 0, rows: [],
      }, error: null });
      return Promise.resolve({ data: { ok: true }, error: null });
    });
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
      if(name==='cashier_tour_worklist_v1')return Promise.resolve({error:null,data:{ok:true,enabled:true,
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
      return Promise.resolve({ data: { ok: true, shift_id: args.p_shift_id, totals: { cash_adjustments: 0 } }, error: null });
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
    mock.rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "cashier_tour_worklist_v1"
      ? { ok: true, enabled: true, updated_at: "2026-09-15T09:00:00Z",
          counts: { counter: 0, completed: 0, waiting_seat: 1, needs_review: 0, total: 1 },
          rows: [{ id: "registration-a", tournament_id: "tour-a", status: "pending", player_name: "Khách chờ",
            phone: null, member_card_id: null, reference_code: "TEST-WAIT", total_pay: 6600000,
            received: 6600000, bucket: "waiting_seat", receipt_code: null, table_number: null,
            seat_number: null, legacy_detail_missing: false, cashier_seating_error: null }] }
      : name === "cashier_tour_issues_v1" ? { ok: true, sepay_unavailable: false, shown: 0, rows: [] }
        : { ok: true, totals: { cash_adjustments: 0 } }, error: null }));
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
});
