import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import {StrictMode} from 'react';

afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllEnvs();});

// ---- configurable backend state (vi.hoisted so the mock factory can read it) ----
const h = vi.hoisted(() => ({
  readSignals:[] as AbortSignal[],
  tour: {
    id: "t1", buy_in: 1_000_000, rake_amount: 200_000, prize_pool: null as number | null,
    itm_places: null as number | null, registration_closed_at: null as string | null,
    live_status: null as string | null, event_id: null as string | null, club_id: "c1",
    operations_mode: "standard",
    planned_itm_percent: null as number | null, planned_payout_archetype: null as string | null,
    planned_min_cash_x: null as number | null, planned_rounding_unit: null as number | null,
  },
  prizes: [] as any[],
  appliedRun: null as any,
  draftRun: null as any,
  draftRead: null as null | (() => Promise<any>),
  entriesCount: 10,
  entryStatuses: null as (string | null)[] | null,
  tourRead: null as null | ((id: string) => Promise<any>),
  prizesError: null as { message: string } | null,
  runError: null as { message: string } | null,
  entriesError: null as { message: string } | null,
  tournamentsUpdateError: null as { message: string } | null,
  // RETURNING rows của UPDATE tournaments (RLS lọc → []). Mặc định 1 row = update thành công.
  tournamentsUpdateRows: [{ id: "t1" }] as { id: string }[],
  lastTournamentsUpdatePayload: null as any,
  prepareResult: null as Record<string,unknown>|null,
  preparedRun: null as unknown,
  auth:{user:{id:'u1'},session:{access_token:'local-u1'}} as {user:{id:string}|null;session:{access_token:string}|null},
  invoke: vi.fn(async (_n: string, _o: any): Promise<any> => ({
    data: { result: { rows: [{ position: 1, amount: 7_600_000, percentage: 76 }, { position: 2, amount: 2_400_000, percentage: 24 }], itmPlaces: 2, effectiveFloor: 2_400_000, archetype: "DAILY", warnings: [] }, prizePool: 10_000_000 },
    error: null,
  })),
  rpc: vi.fn(async (name: string, _a: any): Promise<any> => {
    if (name === "get_tournament_prizes") return { data: h.prizes, error: h.prizesError };
    if (name === "prepare_payout_snapshot") return { data: h.prepareResult, error: null };
    if (name === "save_tournament_prizes_v2") return { data: { status: "saved" }, error: null };
    return { data: null, error: null };
  }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>h.auth}));
// Mutable feature flags — the panel reads FEATURES.payoutCustomMode for the CUSTOM gate.
const flags = vi.hoisted(() => ({ payoutCustomMode: false, payoutCustomTemplates: false, payoutPlannedSettings: false, satelliteAwardsV1: false }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: flags }));
vi.mock("../SatelliteAwardPlanPanel", () => ({ SatelliteAwardPlanPanel: () => <div>Satellite awards isolated</div> }));
vi.mock("@/integrations/supabase/client", () => {
  const makeChain = (table: string) => {
    const chain: any = {};
    let isUpdate = false;
    let id = "";
    let status = "";
    let entryFilter = "";
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((key: string, value: string) => { if (key === "id") id = value; if (key === "status") status = value; return chain; });
    chain.neq = vi.fn((key: string, value: string) => { entryFilter = `${key}.neq.${value}`; return chain; });
    chain.or = vi.fn((filter: string) => { entryFilter = filter; return chain; });
    chain.abortSignal = vi.fn((signal:AbortSignal)=>{h.readSignals.push(signal);return chain;});
    chain.single = vi.fn(async () => (table === "tournaments" ? h.tourRead ? h.tourRead(id) : { data: h.tour, error: null } : { data: null, error: null }));
    chain.maybeSingle = vi.fn(async () => (table === "tournament_payout_runs" ? id && status === 'draft_snapshot' && h.draftRead ? h.draftRead() : { data: id ? h.draftRun?.id === id ? h.draftRun : h.preparedRun : status === 'draft_snapshot' ? h.draftRun : h.appliedRun, error: h.runError } : { data: null, error: null }));
    chain.order = vi.fn(() => chain);
    chain.insert = vi.fn(async () => ({ data: null, error: null }));
    chain.update = vi.fn((payload: any) => { isUpdate = true; if (table === "tournaments") h.lastTournamentsUpdatePayload = payload; return chain; });
    chain.delete = vi.fn(() => chain);
    chain.then = (resolve: any) => resolve(
      table === "tournaments" && isUpdate
        ? { data: h.tournamentsUpdateError ? null : h.tournamentsUpdateRows, error: h.tournamentsUpdateError }
        : { data: [], count: table === "tournament_entries" && h.entryStatuses
          ? h.entryStatuses.filter(status => entryFilter === "status.is.null,status.not.in.(void,voided,cancelled,canceled,refunded,rejected)"
            ? status === null || !["void", "voided", "cancelled", "canceled", "refunded", "rejected"].includes(status)
            : status !== null && status !== "cancelled").length
          : h.entriesCount, error: table === "tournament_entries" ? h.entriesError : null },
    ); // entries/templates/planned-save awaited directly
    return chain;
  };
  return { supabase: { from: vi.fn((t: string) => makeChain(t)), rpc:(...args:Parameters<typeof h.rpc>)=>{
    const response=h.rpc(...args);return Object.assign(response,{abortSignal:(signal:AbortSignal)=>{h.readSignals.push(signal);return response;}});
  }, functions: { invoke: h.invoke }, auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } }, error: null })) } } };
});

import { PayoutEnginePanel } from "../PayoutEnginePanel";
import { toast } from "sonner";

beforeAll(() => {
  (globalThis as any).ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  Element.prototype.scrollIntoView ||= () => {};
  (Element.prototype as any).hasPointerCapture ||= () => false;
  (Element.prototype as any).releasePointerCapture ||= () => {};
});

beforeEach(() => {
  localStorage.clear();sessionStorage.clear();h.tour.id='t1';
  vi.stubEnv('VITE_SUPABASE_URL','http://127.0.0.1:54329');
  h.readSignals=[];
  h.auth={user:{id:'u1'},session:{access_token:'local-u1'}};
  h.tour.registration_closed_at = null; h.tour.live_status = null; h.tour.event_id = null; h.tour.operations_mode = "standard";
  h.tour.planned_itm_percent = null; h.tour.planned_payout_archetype = null;
  h.tour.planned_min_cash_x = null; h.tour.planned_rounding_unit = null;
  h.prizes = []; h.appliedRun = null; h.entriesCount = 10; h.tournamentsUpdateError = null;
  h.entryStatuses = null;
  h.draftRun = null;
  h.draftRead = null;
  h.prizesError = null; h.runError = null; h.entriesError = null;
  h.tourRead = null;
  h.tournamentsUpdateRows = [{ id: "t1" }];
  // Match the actual prepare RPC's frozen response, not only its run_id.
  h.prepareResult={status:'prepared',run_id:'run-1',entries_snapshot:10,buy_in_snapshot:1000000,rake_snapshot:200000,
    prize_pool_snapshot:10000000,effective_floor:2400000,itm_percent:0.15,archetype:'DAILY',min_cash_x:2,rounding_unit:100000};
  h.preparedRun=null;
  flags.payoutCustomMode = false; flags.payoutCustomTemplates = false; flags.payoutPlannedSettings = false; flags.satelliteAwardsV1 = false;
  h.invoke.mockClear(); h.rpc.mockClear();
  (toast.error as any).mockClear(); (toast.success as any).mockClear();
  h.invoke.mockImplementation(async () => ({ data: { result: { rows: [{ position: 1, amount: 7_600_000, percentage: 76 }, { position: 2, amount: 2_400_000, percentage: 24 }], itmPlaces: 2, effectiveFloor: 2_400_000, archetype: "DAILY", warnings: [] }, prizePool: 10_000_000 }, error: null }));
  h.rpc.mockImplementation(async (name: string) => {
    if (name === "get_tournament_prizes") return { data: h.prizes, error: h.prizesError };
    if (name === "prepare_payout_snapshot") return { data: h.prepareResult, error: null };
    if (name === "save_tournament_prizes_v2") return { data: { status: "saved" }, error: null };
    return { data: null, error: null };
  });
});

const officialState = () => {
  h.tour.registration_closed_at = "2026-06-29T00:00:00Z";
  h.prizes = [{ position: 1, percentage: 76, amount: 7_600_000 }, { position: 2, percentage: 24, amount: 2_400_000 }];
  h.appliedRun = { id: "run-1", tournament_id: "t1", status: "applied", source: "close", entries_snapshot: 10, itm_places: 2, prize_pool_snapshot: 10_000_000 };
};

const existingDraft = () => ({id:'run-1',tournament_id:'t1',status:'draft_snapshot',
  entries_snapshot:10,buy_in_snapshot:1000000,rake_snapshot:200000,prize_pool_snapshot:10000000,
  effective_floor:1800000,itm_percent:0.2,archetype:'MULTI',min_cash_x:1.5,rounding_unit:1000,custom_percents:null});

describe('PayoutEnginePanel — official snapshot versus editable forecast',()=>{
  it('identifies the saved style independently of the generator defaults',async()=>{
    officialState();h.appliedRun={...h.appliedRun,archetype:'MULTI'};
    render(<PayoutEnginePanel tournamentId="t1"/>);
    expect(await screen.findByText('Kiểu chia đã chốt: MULTI')).toBeInTheDocument();
    expect(screen.getByText('Cấu hình dự kiến — không thay thế payout chính thức')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveTextContent('DAILY');
  });
  it('does not substitute current DAILY defaults for missing legacy snapshot style',async()=>{
    officialState();render(<PayoutEnginePanel tournamentId="t1"/>);
    expect(await screen.findByText('Kiểu chia đã chốt: chưa xác minh')).toBeInTheDocument();
  });
  it('renders an explicitly separate preview after an official payout exists',async()=>{
    officialState();render(<PayoutEnginePanel tournamentId="t1"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Xem trước (Dự kiến)'}));
    expect(await screen.findByText('DỰ KIẾN — không thay thế payout chính thức')).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.getByText('PAYOUT CHÍNH THỨC')).toBeInTheDocument();
    expect(h.rpc.mock.calls.some(call=>call[0]==='prepare_payout_snapshot')).toBe(false);
  });
  it('does not claim registration is open when previewing an already frozen draft',async()=>{
    h.tour.registration_closed_at='2026-10-24T00:00:00Z';h.draftRun=existingDraft();
    render(<PayoutEnginePanel tournamentId="t1"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Xem trước (Dự kiến)'}));
    expect(await screen.findByText('DỰ KIẾN — không thay đổi bản nháp đã chốt')).toBeInTheDocument();
    expect(h.rpc.mock.calls.some(call=>call[0]==='prepare_payout_snapshot')).toBe(false);
  });
});

describe('PayoutEnginePanel — explicit frozen draft recovery',()=>{
  it('reviews a frozen draft rather than silently replacing it with current generator defaults',async()=>{
    h.draftRun=existingDraft();
    render(<PayoutEnginePanel tournamentId="t1"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Xem & tiếp tục bản nháp'}));
    const dialog=screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/MULTI/)).toBeInTheDocument();
    expect(within(dialog).getByText(/20%/)).toBeInTheDocument();
    expect(h.rpc.mock.calls.some(call=>call[0]==='prepare_payout_snapshot')).toBe(false);
    expect(h.invoke).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button',{name:'Hủy'}));
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it('applies only the reviewed existing run, without another prepare',async()=>{
    h.draftRun=existingDraft();
    h.invoke.mockImplementation(async()=>{h.draftRun=null;officialState();return {data:{mode:'official',run_id:'run-1'},error:null};});
    render(<PayoutEnginePanel tournamentId="t1"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Xem & tiếp tục bản nháp'}));
    await act(async()=>{fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'Áp dụng bản nháp đã xem'}));});
    expect(h.invoke).toHaveBeenCalledWith('compute-payouts',{body:{mode:'official',run_id:'run-1'}});
    expect(h.rpc.mock.calls.some(call=>call[0]==='prepare_payout_snapshot')).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('Đã đối chiếu payout chính thức đã lưu.');
  });
  it.each([
    {tournament_id:'other'}, {entries_snapshot:0}, {rounding_unit:0}, {prize_pool_snapshot:null},
    {archetype:'UNKNOWN'}, {archetype:'CUSTOM',custom_percents:[{position:1,percent_bp:9999}]},
  ])('blocks malformed or out-of-scope frozen data: %j',async(overrides)=>{
    h.draftRun={...existingDraft(),...overrides};
    render(<PayoutEnginePanel tournamentId="t1"/>);
    expect(await screen.findByText(/Dữ liệu bản nháp payout không hợp lệ/)).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Xem & tiếp tục bản nháp'})).toBeNull();
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it('recovers a lost prepare response by reading the saved draft, not preparing again',async()=>{
    const normal=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async(name,args)=>{
      if(name==='prepare_payout_snapshot'){h.draftRun=existingDraft();return {data:null,error:{message:'lost prepare response'}};}
      return normal(name,args);
    });
    render(<PayoutEnginePanel tournamentId="t1"/>);
    fireEvent.click(await screen.findByRole('button',{name:/Đóng đăng ký & tạo payout/}));
    await act(async()=>{fireEvent.click(within(screen.getByRole('alertdialog')).getByText(/Đóng đăng ký & tạo$/));});
    expect(await screen.findByRole('button',{name:'Xem & tiếp tục bản nháp'})).toBeInTheDocument();
    expect(h.rpc.mock.calls.filter(call=>call[0]==='prepare_payout_snapshot')).toHaveLength(1);
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it('does not compute if frozen settings change after the confirmation opened',async()=>{
    h.draftRun=existingDraft();
    render(<PayoutEnginePanel tournamentId="t1"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Xem & tiếp tục bản nháp'}));
    h.draftRun={...h.draftRun,prize_pool_snapshot:9000000};
    await act(async()=>{fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'Áp dụng bản nháp đã xem'}));});
    expect(h.invoke).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
  it('shows the actual frozen CUSTOM ladder even when generator CUSTOM is off',async()=>{
    h.draftRun={...existingDraft(),archetype:'CUSTOM',itm_percent:0.3,effective_floor:0,
      custom_percents:[{position:1,percent_bp:6000},{position:2,percent_bp:2500},{position:3,percent_bp:1500}]};
    render(<PayoutEnginePanel tournamentId="t1"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Xem & tiếp tục bản nháp'}));
    expect(within(screen.getByRole('alertdialog')).getByText('Hạng 1: 60% · Hạng 2: 25% · Hạng 3: 15%')).toBeInTheDocument();
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it.each(['actor','session','logout'])('retires a pending draft revalidation after %s changes',async(change)=>{
    h.draftRun=existingDraft();let finish!:(result:any)=>void;
    h.draftRead=()=>new Promise(resolve=>{finish=resolve;});
    const view=render(<PayoutEnginePanel tournamentId="t1"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Xem & tiếp tục bản nháp'}));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'Áp dụng bản nháp đã xem'}));
    await waitFor(()=>expect(finish).toBeTypeOf('function'));
    h.auth=change==='actor'?{user:{id:'u2'},session:{access_token:'local-u2'}}:change==='session'
      ?{user:{id:'u1'},session:{access_token:'local-u1-new'}}:{user:null,session:null};
    view.rerender(<PayoutEnginePanel tournamentId="t1"/>);
    await act(async()=>{finish({data:existingDraft(),error:null});});
    expect(h.invoke).not.toHaveBeenCalled();expect(toast.success).not.toHaveBeenCalled();
  });
  it('bounds a hung draft revalidation without computing or creating another snapshot',async()=>{
    vi.useFakeTimers();h.draftRun=existingDraft();h.draftRead=()=>new Promise(()=>{});
    render(<PayoutEnginePanel tournamentId="t1"/>);
    await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    fireEvent.click(screen.getByRole('button',{name:'Xem & tiếp tục bản nháp'}));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button',{name:'Áp dụng bản nháp đã xem'}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.rpc.mock.calls.some(call=>call[0]==='prepare_payout_snapshot')).toBe(false);
    expect(toast.error).toHaveBeenCalled();
    expect(screen.getByRole('button',{name:'Xem & tiếp tục bản nháp'})).toBeEnabled();
  });
});

describe("PayoutEnginePanel — Satellite routing", () => {
  it("does not read one-day payout sources for a Satellite", async () => {
    flags.satelliteAwardsV1 = true;
    h.tour.operations_mode = "satellite";
    render(<PayoutEnginePanel tournamentId="t1" />);
    expect(await screen.findByText("Satellite awards isolated")).toBeTruthy();
    expect(h.rpc.mock.calls.some((call) => call[0] === "get_tournament_prizes")).toBe(false);
  });
});

describe("PayoutEnginePanel — load failures", () => {
  it.each([
    { statuses: ["registered", "busted", "void", "voided", "cancelled", "canceled", "refunded", "rejected"], count: 2 },
    { statuses: [null, "seated", "cancelled"], count: 2 },
    { statuses: [null], count: 1 },
  ])('counts the canonical eligible statuses, including legacy NULL: $statuses', async ({ statuses, count }) => {
    h.entryStatuses = statuses;
    render(<PayoutEnginePanel tournamentId="t1" />);
    expect(await screen.findByText(`đang có ${count} (đã trả tiền)`)).toBeInTheDocument();
  });
  it('keeps the restarted StrictMode read active and ignores the aborted first load',async()=>{
    let calls=0,resolve!:(value:unknown)=>void;
    h.tourRead=async()=>++calls===1?new Promise(done=>{resolve=done;}):{data:structuredClone(h.tour),error:null};
    render(<StrictMode><PayoutEnginePanel tournamentId="t1"/></StrictMode>);
    await screen.findByRole('button',{name:'Xem trước (Dự kiến)'});
    expect(h.readSignals[0].aborted).toBe(true);
    expect(h.readSignals.at(-1)?.aborted).toBe(false);
    await act(async()=>{resolve({data:{...h.tour,buy_in:9999999},error:null});});
    fireEvent.click(screen.getByRole('button',{name:'Xem trước (Dự kiến)'}));
    await waitFor(()=>expect(h.invoke).toHaveBeenCalled());
    expect(h.invoke.mock.calls[0][1].body.rounding_unit).toBe(100000);
  });
  it('bounds the main payout batch after a successful Satellite mode preflight',async()=>{
    vi.useFakeTimers();flags.satelliteAwardsV1=true;let reads=0;
    h.tourRead=async()=>++reads===1?{data:structuredClone(h.tour),error:null}:new Promise(()=>{});
    render(<PayoutEnginePanel tournamentId="t1"/>);
    await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
    expect(screen.getByText('Hết thời gian tải dữ liệu payout. Vui lòng tải lại.')).toBeInTheDocument();
    expect(h.readSignals.every(signal=>signal.aborted)).toBe(true);
  });
  it.each([false,true])('bounds a hung read and offers explicit retry (satellite preflight %s)',async(preflight)=>{
    vi.useFakeTimers();flags.satelliteAwardsV1=preflight;
    let resolve!:(value:unknown)=>void;
    h.tourRead=()=>new Promise(done=>{resolve=done;});
    render(<PayoutEnginePanel tournamentId="t1"/>);
    await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
    expect(screen.getByText('Hết thời gian tải dữ liệu payout. Vui lòng tải lại.')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Thử lại'})).toBeEnabled();
    expect(h.readSignals.length).toBeGreaterThan(0);
    expect(h.readSignals.every(signal=>signal.aborted)).toBe(true);
    await act(async()=>{resolve({data:{...h.tour,buy_in:9999999},error:null});});
    expect(screen.getByText('Hết thời gian tải dữ liệu payout. Vui lòng tải lại.')).toBeInTheDocument();
    h.tourRead=async()=>({data:structuredClone(h.tour),error:null});
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));});
    expect(screen.getByRole('button',{name:'Xem trước (Dự kiến)'})).toBeEnabled();
    expect(screen.queryByText('Hết thời gian tải dữ liệu payout. Vui lòng tải lại.')).toBeNull();
  });
  it('aborts pending payout source reads when the panel unmounts',()=>{
    h.tourRead=()=>new Promise(()=>{});
    const view=render(<PayoutEnginePanel tournamentId="t1"/>);
    view.unmount();
    expect(h.readSignals.length).toBeGreaterThan(0);
    expect(h.readSignals.every(signal=>signal.aborted)).toBe(true);
  });
  it.each(["prizes", "run", "entries"] as const)("blocks payout actions when %s fails to load", async (source) => {
    if (source === "prizes") h.prizesError = { message: "prizes failed" };
    if (source === "run") h.runError = { message: "run failed" };
    if (source === "entries") h.entriesError = { message: "entries failed" };
    render(<PayoutEnginePanel tournamentId="t1" />);
    expect(await screen.findByText(`${source} failed`)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Thử lại/ })).toBeTruthy();
    expect(screen.queryByText(/Xem trước/)).toBeNull();
  });
});

describe("PayoutEnginePanel — failed reads do not become empty payout data", () => {
  it.each([
    ["null row", [null]],
    ["array row", [[1, 10, 100]]],
    ["negative position", [{ position: -1, amount: 10, percentage: 100 }]],
    ["non-finite position", [{ position: Infinity, amount: 10, percentage: 100 }]],
    ["fractional position", [{ position: 1.5, amount: 10, percentage: 100 }]],
    ["negative amount", [{ position: 1, amount: -1, percentage: 100 }]],
    ["non-finite amount", [{ position: 1, amount: Infinity, percentage: 100 }]],
    ["NaN amount", [{ position: 1, amount: "NaN", percentage: 100 }]],
    ["duplicate rank", [{ position: 1, amount: 5, percentage: 50 }, { position: 1, amount: 5, percentage: 50 }]],
    ["missing rank", [{ position: 2, amount: 10, percentage: 100 }]],
    ["negative percentage", [{ position: 1, amount: 10, percentage: -1 }]],
    ["non-finite percentage", [{ position: 1, amount: 10, percentage: Infinity }]],
    ["bad percentage", [{ position: 1, amount: 10, percentage: 101 }]],
    ["null percentage", [{ position: 1, amount: 10, percentage: null }]],
  ])("blocks malformed official prize rows: %s", async (_case, prizes) => {
    h.prizes = prizes;
    render(<PayoutEnginePanel tournamentId="t1" />);
    expect(await screen.findByText(/Dữ liệu payout chính thức không hợp lệ/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xem trước/ })).not.toBeInTheDocument();
  });
  const validRun = { id: "run-1", tournament_id: "t1", status: "applied", source: "close", entries_snapshot: 10, itm_places: 1, prize_pool_snapshot: 10 };
  it.each([
    { ...validRun, prize_pool_snapshot: "NaN" },
    { ...validRun, itm_places: 2 },
    { ...validRun, source: "unknown" },
    { ...validRun, entries_snapshot: -1 },
    { ...validRun, status: "draft_snapshot" },
    { ...validRun, tournament_id: "other-tournament" },
    { ...validRun, id: " " },
    { ...validRun, entries_snapshot: 0 },
    { ...validRun, entries_snapshot: 1, itm_places: 2 },
  ])("blocks malformed applied run: %j", async (run) => {
    h.prizes = [{ position: 1, amount: 10, percentage: 100 }];
    h.appliedRun = run;
    render(<PayoutEnginePanel tournamentId="t1" />);
    expect(await screen.findByText(/Dữ liệu payout chính thức không hợp lệ/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xem trước/ })).not.toBeInTheDocument();
  });
  it.each(["prizesError", "runError", "entriesError"] as const)("shows %s and blocks payout actions", async (key) => {
    h[key] = { message: `Không tải được ${key}` };
    render(<PayoutEnginePanel tournamentId="t1" />);
    expect(await screen.findByText(`Không tải được ${key}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Thử lại/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xem trước/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Đóng đăng ký & tạo payout/ })).not.toBeInTheDocument();
    expect(h.invoke).not.toHaveBeenCalled();
    h[key] = null;
    fireEvent.click(screen.getByRole("button", { name: /Thử lại/ }));
    expect(await screen.findByRole("button", { name: /Xem trước/ })).toBeEnabled();
  });
  it.each([NaN, -1, 1.5])("rejects invalid entry count %s rather than treating it as zero", async count => {
    h.entriesCount = count;
    render(<PayoutEnginePanel tournamentId="t1" />);
    expect(await screen.findByText(/Không tải được dữ liệu payout đầy đủ/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xem trước/ })).not.toBeInTheDocument();
  });
  it("discards a late response from a previously selected tournament", async () => {
    let finish!: (result: any) => void;
    h.tourRead = id => id === "t1" ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve({ data: { ...h.tour, id: "t2", buy_in: 6000000 }, error: null });
    const view = render(<PayoutEnginePanel tournamentId="t1" />);
    await waitFor(() => expect(finish).toBeDefined());
    view.rerender(<PayoutEnginePanel tournamentId="t2" />);
    await screen.findByRole("button", { name: /Xem trước/ });
    await act(async () => { finish({ data: { ...h.tour, event_id: "old-event" }, error: null }); });
    fireEvent.click(screen.getByRole("button", { name: /Xem trước/ }));
    await waitFor(() => expect(h.invoke).toHaveBeenCalled());
    expect(h.invoke.mock.calls[0][1].body.tournament_id).toBe("t2");
  });
});

describe("PayoutEnginePanel — preview is forecast-only (does NOT close registration)", () => {
  it("Xem trước calls compute-payouts mode=preview and NEVER prepare_payout_snapshot", async () => {
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    fireEvent.click(screen.getByText(/Xem trước/));
    await waitFor(() => expect(h.invoke).toHaveBeenCalled());
    expect(h.invoke.mock.calls[0][0]).toBe("compute-payouts");
    expect(h.invoke.mock.calls[0][1].body.mode).toBe("preview");
    // critically: no snapshot / close happened
    expect(h.rpc.mock.calls.some((c) => c[0] === "prepare_payout_snapshot")).toBe(false);
    // estimated banner shows
    expect(await screen.findByText(/DỰ KIẾN/)).toBeInTheDocument();
  });
});

describe("PayoutEnginePanel — official requires EXPLICIT confirmation (one-way)", () => {
  it('resumes a matching numeric-string snapshot without creating a different run',async()=>{
    h.prepareResult={...h.prepareResult,status:'resumed',entries_snapshot:'10',prize_pool_snapshot:'10000000',min_cash_x:'2'};
    render(<PayoutEnginePanel tournamentId="t1"/>);
    fireEvent.click(await screen.findByRole('button',{name:/Đóng đăng ký & tạo payout/}));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText(/Đóng đăng ký & tạo$/));
    await waitFor(()=>expect(h.invoke).toHaveBeenCalledWith('compute-payouts',{body:{mode:'official',run_id:'run-1'}}));
    expect(h.rpc.mock.calls.filter(call=>call[0]==='prepare_payout_snapshot')).toHaveLength(1);
  });
  it.each([false,true])('checks the frozen CUSTOM ladder, not only its number of places (matches %s)',async(matches)=>{
    flags.payoutCustomMode=true;flags.payoutPlannedSettings=true;h.tour.planned_payout_archetype='CUSTOM';
    h.prepareResult={...h.prepareResult,status:'resumed',archetype:'CUSTOM',itm_percent:0.3,effective_floor:0};
    h.preparedRun={id:'run-1',tournament_id:'t1',status:'draft_snapshot',custom_percents:(matches?[5000,3000,2000]:[6000,2500,1500]).map((percent_bp,index)=>({position:index+1,percent_bp}))};
    render(<PayoutEnginePanel tournamentId="t1"/>);
    await screen.findByText('CUSTOM — CLB tự cấu hình');
    fireEvent.click(screen.getByRole('button',{name:/Đóng đăng ký & tạo payout/}));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText(/Đóng đăng ký & tạo$/));
    if(matches)await waitFor(()=>expect(h.invoke).toHaveBeenCalled());
    else{await waitFor(()=>expect(toast.error).toHaveBeenCalled());expect(h.invoke).not.toHaveBeenCalled();}
  });
  it.each([
    ['different resumed style',{status:'resumed',archetype:'MULTI'}],
    ['different resumed entry count',{status:'resumed',entries_snapshot:9}],
    ['different pool',{prize_pool_snapshot:9000000}],
    ['different min-cash',{min_cash_x:3}],
    ['different rounding',{rounding_unit:1000000}],
    ['unknown outcome',{status:'unknown'}],
    ['missing frozen fields',{entries_snapshot:undefined}],
  ])('does not apply %s behind the displayed confirmation',async(_case,overrides)=>{
    h.prepareResult={...h.prepareResult,...overrides};
    render(<PayoutEnginePanel tournamentId="t1"/>);
    fireEvent.click(await screen.findByRole('button',{name:/Đóng đăng ký & tạo payout/}));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText(/Đóng đăng ký & tạo$/));
    await waitFor(()=>expect(toast.error).toHaveBeenCalled());
    expect(h.invoke).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it('reloads already-applied facts without computing the run again',async()=>{
    h.prepareResult={...h.prepareResult,status:'already_applied'};
    render(<PayoutEnginePanel tournamentId="t1"/>);
    fireEvent.click(await screen.findByRole('button',{name:/Đóng đăng ký & tạo payout/}));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText(/Đóng đăng ký & tạo$/));
    await waitFor(()=>expect(h.rpc.mock.calls.some(call=>call[0]==='prepare_payout_snapshot')).toBe(true));
    await waitFor(()=>expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(h.invoke).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it('does not continue the second write after the tournament panel unmounts during prepare',async()=>{
    let finish!:(value:unknown)=>void;
    const normalRpc=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation((name,args)=>name==='prepare_payout_snapshot'?new Promise(resolve=>{finish=resolve;}):normalRpc(name,args));
    const view=render(<PayoutEnginePanel tournamentId="t1"/>);
    fireEvent.click(await screen.findByRole('button',{name:/Đóng đăng ký & tạo payout/}));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText(/Đóng đăng ký & tạo$/));
    await waitFor(()=>expect(finish).toBeDefined());view.unmount();
    await act(async()=>{finish({data:h.prepareResult,error:null});});
    expect(h.invoke).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it.each(['actor','session','logout'])('does not continue prepare under a changed %s',async(change)=>{
    let finish!:(value:unknown)=>void;
    const normalRpc=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation((name,args)=>name==='prepare_payout_snapshot'?new Promise(resolve=>{finish=resolve;}):normalRpc(name,args));
    const view=render(<PayoutEnginePanel tournamentId="t1"/>);
    fireEvent.click(await screen.findByRole('button',{name:/Đóng đăng ký & tạo payout/}));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText(/Đóng đăng ký & tạo$/));
    await waitFor(()=>expect(finish).toBeDefined());
    h.auth=change==='logout'?{user:null,session:null}:{user:{id:change==='actor'?'u2':'u1'},session:{access_token:'changed-session'}};
    view.rerender(<PayoutEnginePanel tournamentId="t1"/>);
    await act(async()=>{finish({data:h.prepareResult,error:null});});
    expect(h.invoke).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it('confirms paid entries, not the editable forecast count',async()=>{
    render(<PayoutEnginePanel tournamentId="t1"/>);
    await screen.findByRole('button',{name:/Đóng đăng ký & tạo payout/});
    fireEvent.change(screen.getAllByRole('spinbutton')[0],{target:{value:'20'}});
    fireEvent.click(screen.getByRole('button',{name:/Đóng đăng ký & tạo payout/}));
    expect(within(screen.getByRole('alertdialog')).getByText(/chốt 10 entry.*10.000.000đ/)).toBeInTheDocument();
  });
  it('offers the official pool override reason when the forecast happens to match the manual amount',async()=>{
    render(<PayoutEnginePanel tournamentId="t1"/>);
    await screen.findByRole('button',{name:/Đóng đăng ký & tạo payout/});
    fireEvent.change(screen.getAllByRole('spinbutton')[0],{target:{value:'20'}});
    fireEvent.change(screen.getByPlaceholderText('auto = 20.000.000'),{target:{value:'20000000'}});
    expect(screen.getByPlaceholderText('Lý do sửa prize pool (bắt buộc)')).toBeInTheDocument();
  });
  it('shows unverified authority as a temporary verification failure, not missing permission',async()=>{
    h.invoke.mockResolvedValue({data:{error:'PAYOUT_AUTHORITY_UNVERIFIED'},error:null});
    render(<PayoutEnginePanel tournamentId="t1"/>);
    fireEvent.click(await screen.findByRole('button',{name:'Xem trước (Dự kiến)'}));
    await waitFor(()=>expect(toast.error).toHaveBeenCalled());
    const message=String(vi.mocked(toast.error).mock.calls.at(-1)?.[0]);
    expect(message).toContain('Chưa xác minh được quyền');
    expect(message).not.toContain('Bạn không có quyền');
    expect(toast.success).not.toHaveBeenCalled();
  });
  it('blocks further payout actions if reconciliation after a failed compute cannot be read',async()=>{
    let reads=0;
    h.tourRead=async()=>++reads===1?{data:structuredClone(h.tour),error:null}:{data:null,error:{message:'503 reconciliation read failed'}};
    h.invoke.mockResolvedValue({data:null,error:{message:'503 compute failed'}});
    render(<PayoutEnginePanel tournamentId="t1"/>);
    fireEvent.click(await screen.findByRole('button',{name:/Đóng đăng ký & tạo payout/}));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText(/Đóng đăng ký & tạo$/));
    expect(await screen.findByText('503 reconciliation read failed')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Đóng đăng ký & tạo payout/})).toBeNull();
    expect(screen.getByRole('button',{name:'Thử lại'})).toBeEnabled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it.each(['edge error','prepare response loss'])('refreshes the canonical registration state after %s',async(fault)=>{
    // HTTP returns a detached snapshot, not the mutable backing fixture object.
    h.tourRead=async()=>({data:structuredClone(h.tour),error:null});
    h.rpc.mockImplementation(async(name:string)=>{
      if(name==='get_tournament_prizes')return {data:[],error:null};
      if(name==='prepare_payout_snapshot'){
        h.tour.registration_closed_at='2026-10-21T07:00:00Z';
        return fault==='prepare response loss'?{data:null,error:{message:'503 after prepare commit'}}:{data:h.prepareResult,error:null};
      }
      return {data:null,error:null};
    });
    h.invoke.mockResolvedValue({data:null,error:{message:'503 compute failed'}});
    render(<PayoutEnginePanel tournamentId="t1"/>);
    fireEvent.click(await screen.findByRole('button',{name:/Đóng đăng ký & tạo payout/}));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText(/Đóng đăng ký & tạo$/));
    await waitFor(()=>expect(toast.error).toHaveBeenCalled());
    expect(await screen.findByText('Đã đóng đăng ký — chưa tạo payout')).toBeInTheDocument();
    expect(screen.queryByText('Đăng ký đang mở')).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
    expect(h.rpc.mock.calls.filter(call=>call[0]==='prepare_payout_snapshot')).toHaveLength(1);
    expect(h.invoke).toHaveBeenCalledTimes(fault==='edge error'?1:0);
  });
  it("clicking the close button opens a confirm dialog; prepare runs only after confirm", async () => {
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    fireEvent.click(screen.getByRole("button", { name: /Đóng đăng ký & tạo payout/ }));
    // dialog open, warns one-way — but prepare NOT called yet
    expect(await screen.findByText(/MỘT CHIỀU/)).toBeInTheDocument();
    expect(h.rpc.mock.calls.some((c) => c[0] === "prepare_payout_snapshot")).toBe(false);
    // confirm
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByText(/Đóng đăng ký & tạo$/));
    await waitFor(() => expect(h.rpc.mock.calls.some((c) => c[0] === "prepare_payout_snapshot")).toBe(true));
    await waitFor(() => expect(h.invoke.mock.calls.some((c) => c[1].body.mode === "official")).toBe(true));
  });
});

describe('PayoutEnginePanel — compute outcome readback',()=>{
  const confirm=async()=>{
    fireEvent.click(await screen.findByRole('button',{name:/Đóng đăng ký & tạo payout/}));
    await act(async()=>{fireEvent.click(within(screen.getByRole('alertdialog')).getByText(/Đóng đăng ký & tạo$/));});
  };
  it.each([null,{}, {mode:'preview'}, {mode:'official',run_id:'other-run'}, {mode:'official',run_id:'run-1'}])('does not report applied without a matching canonical run (%j)',async(data)=>{
    h.invoke.mockResolvedValue({data,error:null});
    render(<PayoutEnginePanel tournamentId="t1"/>);await confirm();
    await waitFor(()=>expect(h.invoke).toHaveBeenCalledTimes(1));
    await screen.findByRole('button',{name:/Đóng đăng ký & tạo payout/});
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
  it('waits for verified applied run and prizes before reporting success',async()=>{
    let reads=0,finish!:(value:unknown)=>void;
    h.tourRead=async()=>++reads===1?{data:structuredClone(h.tour),error:null}:new Promise(resolve=>{finish=resolve;});
    h.invoke.mockImplementation(async()=>{officialState();return {data:{mode:'official',run_id:'run-1'},error:null};});
    render(<PayoutEnginePanel tournamentId="t1"/>);await confirm();
    await waitFor(()=>expect(finish).toBeDefined());
    expect(toast.success).not.toHaveBeenCalled();
    await act(async()=>{finish({data:structuredClone(h.tour),error:null});});
    await waitFor(()=>expect(toast.success).toHaveBeenCalledTimes(1));
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
  it('recovers a lost compute response from the exact applied run without a second compute',async()=>{
    h.invoke.mockImplementation(async()=>{officialState();return {data:null,error:{message:'503 response lost after commit'}};});
    render(<PayoutEnginePanel tournamentId="t1"/>);await confirm();
    await screen.findByText('PAYOUT CHÍNH THỨC');
    await waitFor(()=>expect(toast.success).toHaveBeenCalledTimes(1));
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.rpc.mock.calls.filter(call=>call[0]==='prepare_payout_snapshot')).toHaveLength(1);
  });
  it('verifies an already-applied run without another compute',async()=>{
    const normalRpc=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async(name,args)=>{
      if(name==='prepare_payout_snapshot'){officialState();return {data:{...h.prepareResult,status:'already_applied'},error:null};}
      return normalRpc(name,args);
    });
    render(<PayoutEnginePanel tournamentId="t1"/>);await confirm();
    await screen.findByText('PAYOUT CHÍNH THỨC');
    await waitFor(()=>expect(toast.success).toHaveBeenCalledTimes(1));
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it.each(['actor','session','logout'])('retires compute completion after changed %s',async(change)=>{
    let finish!:(value:unknown)=>void;
    h.invoke.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const view=render(<PayoutEnginePanel tournamentId="t1"/>);await confirm();
    await waitFor(()=>expect(finish).toBeDefined());
    h.auth=change==='logout'?{user:null,session:null}:{user:{id:change==='actor'?'u2':'u1'},session:{access_token:'new-compute-session'}};
    view.rerender(<PayoutEnginePanel tournamentId="t1"/>);
    await act(async()=>{finish({data:{mode:'official',run_id:'run-1'},error:null});});
    expect(toast.success).not.toHaveBeenCalled();
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(['unavailable','different run','malformed prizes'])('never reports success when reconciliation is %s',async(problem)=>{
    let reads=0;
    h.tourRead=async()=>++reads===1?{data:structuredClone(h.tour),error:null}
      :problem==='unavailable'?{data:null,error:{message:'503 applied read unavailable'}}:{data:structuredClone(h.tour),error:null};
    h.invoke.mockImplementation(async()=>{
      officialState();
      if(problem==='different run')h.appliedRun.id='other-run';
      if(problem==='malformed prizes')h.prizes[0].amount=1;
      return {data:{mode:'official',run_id:'run-1'},error:null};
    });
    render(<PayoutEnginePanel tournamentId="t1"/>);await confirm();
    await waitFor(()=>expect(h.invoke).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("PayoutEnginePanel — manual edit requires a reason", () => {
  it("save is disabled with an empty reason and enables once a reason is entered (sum matches)", async () => {
    manualOfficialState();
    render(<PayoutEnginePanel tournamentId={manualScope.tour} />);
    await screen.findByText(/PAYOUT CHÍNH THỨC/);
    fireEvent.click(screen.getByRole("button", { name: /Chỉnh tay/ }));
    const save = await screen.findByRole("button", { name: /Lưu chỉnh tay/ });
    expect(save).toBeDisabled(); // no reason yet (sum already matches the locked pool)
    fireEvent.change(screen.getByPlaceholderText(/Lý do chỉnh tay/), { target: { value: "sửa lỗi nhập cơ cấu giải đã duyệt" } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(h.rpc.mock.calls.some((c) => c[0] === "save_tournament_prizes_v3")).toBe(true));
  });
});

const manualScope={actor:'e7020000-0000-4000-8000-000000000001',tour:'e7020000-0000-4000-8000-000000000002',
  previous:'e7020000-0000-4000-8000-000000000003',next:'e7020000-0000-4000-8000-000000000004',request:'e7020000-0000-4000-8000-000000000005'};
const manualOfficialState=()=>{
  officialState();h.tour.id=manualScope.tour;h.auth={user:{id:manualScope.actor},session:{access_token:'LOCAL_MANUAL_ACTOR'}};
  h.appliedRun={...h.appliedRun,id:manualScope.previous,tournament_id:manualScope.tour};
};
const manualSaved=(args:Record<string,unknown>)=>({status:'saved',actor_id:manualScope.actor,tournament_id:manualScope.tour,
  request_id:args.p_request_id??manualScope.request,previous_run_id:manualScope.previous,run_id:manualScope.next,itm_places:2});
const startManual=async()=>{
  fireEvent.click(await screen.findByRole('button',{name:'Chỉnh tay'}));
  fireEvent.change(screen.getByPlaceholderText(/Lý do chỉnh tay/),{target:{value:'LOCAL702 confirmed correction'}});
  fireEvent.click(screen.getByRole('button',{name:'Lưu chỉnh tay'}));
};

describe('PayoutEnginePanel — durable manual edit intent',()=>{
  it('explicit retry looks up the receipt and resends exactly the original intent, not a new key',async()=>{
    manualOfficialState();const normal=h.rpc.getMockImplementation()!;let writes=0;
    h.rpc.mockImplementation(async(name,args)=>{
      if(name==='save_tournament_prizes_v3'){
        writes++;
        if(writes===1)return {data:null,error:{message:'503 unknown'}};
        h.appliedRun={...h.appliedRun,id:manualScope.next,source:'manual_edit',supersedes_run_id:manualScope.previous};
        return {data:manualSaved(args),error:null};
      }
      if(name==='get_tournament_payout_edit_receipt_v1')return {data:{status:'not_found',actor_id:manualScope.actor,
        tournament_id:manualScope.tour,request_id:args.p_request_id},error:null};
      return normal(name,args);
    });
    render(<PayoutEnginePanel tournamentId={manualScope.tour}/>);await startManual();
    const retry=await screen.findByRole('button',{name:'Gửi lại đúng yêu cầu'});
    await waitFor(()=>expect(retry).not.toBeDisabled());
    expect(writes).toBe(1);fireEvent.click(retry);
    await waitFor(()=>expect(toast.success).toHaveBeenCalled());
    const calls=h.rpc.mock.calls.filter(call=>call[0]==='save_tournament_prizes_v3');
    expect(calls).toHaveLength(2);expect(calls[1][1]).toEqual(calls[0][1]);
    expect(h.rpc.mock.calls.filter(call=>call[0]==='get_tournament_payout_edit_receipt_v1')).toHaveLength(2);
  });
  it('server-confirmed cancellation retains the original key and permits a fresh editor only afterwards',async()=>{
    manualOfficialState();const normal=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async(name,args)=>{
      if(name==='save_tournament_prizes_v3')return {data:null,error:{message:'503 unknown'}};
      if(name==='cancel_tournament_payout_edit_v1')return {data:{status:'cancelled',actor_id:manualScope.actor,
        tournament_id:manualScope.tour,request_id:args.p_request_id,previous_run_id:manualScope.previous},error:null};
      return normal(name,args);
    });
    render(<PayoutEnginePanel tournamentId={manualScope.tour}/>);await startManual();
    const cancel=await screen.findByRole('button',{name:'Hủy yêu cầu an toàn'});
    await waitFor(()=>expect(cancel).not.toBeDisabled());fireEvent.click(cancel);
    await waitFor(()=>expect(toast.success).toHaveBeenCalledWith('Đã hủy yêu cầu chỉnh tay; thao tác đến muộn không thể ghi.'));
    const write=h.rpc.mock.calls.find(call=>call[0]==='save_tournament_prizes_v3')!;
    const cancelled=h.rpc.mock.calls.find(call=>call[0]==='cancel_tournament_payout_edit_v1')!;
    expect(cancelled[1]).toEqual(write[1]);expect(screen.getByRole('button',{name:'Chỉnh tay'})).not.toBeDisabled();
    expect(Object.keys(localStorage).filter(key=>key.startsWith('vinpoker:payout-edit:'))).toHaveLength(0);
  });
  it('an unconfirmed cancellation keeps the unresolved intent and blocks a fresh edit',async()=>{
    manualOfficialState();const normal=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async(name,args)=>name==='save_tournament_prizes_v3'||name==='cancel_tournament_payout_edit_v1'
      ?{data:null,error:{message:'503 unknown'}}:normal(name,args));
    render(<PayoutEnginePanel tournamentId={manualScope.tour}/>);await startManual();
    const cancel=await screen.findByRole('button',{name:'Hủy yêu cầu an toàn'});
    await waitFor(()=>expect(cancel).not.toBeDisabled());fireEvent.click(cancel);
    await waitFor(()=>expect(h.rpc.mock.calls.some(call=>call[0]==='cancel_tournament_payout_edit_v1')).toBe(true));
    await waitFor(()=>expect(cancel).not.toBeDisabled());
    expect(toast.success).not.toHaveBeenCalled();expect(screen.getByText(/Chỉnh tay đang chờ xác minh/)).toBeInTheDocument();
    expect(Object.keys(localStorage).filter(key=>key.startsWith('vinpoker:payout-edit:'))).toHaveLength(1);
  });
  it('ignores a late response from the previous actor and leaves that actors journal recoverable',async()=>{
    manualOfficialState();const normal=h.rpc.getMockImplementation()!;
    let finish!:(value:unknown)=>void;let sent:Record<string,unknown>={};
    h.rpc.mockImplementation(async(name,args)=>{
      if(name==='save_tournament_prizes_v3'){sent=args;return new Promise(resolve=>{finish=resolve;});}
      return normal(name,args);
    });
    const view=render(<PayoutEnginePanel tournamentId={manualScope.tour}/>);await startManual();
    await waitFor(()=>expect(finish).toBeDefined());
    h.auth={user:{id:manualScope.next},session:{access_token:'LOCAL_OTHER_ACTOR'}};
    view.rerender(<PayoutEnginePanel tournamentId={manualScope.tour}/>);
    await act(async()=>{finish({data:manualSaved(sent),error:null});});
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.queryByText(/Chỉnh tay đang chờ xác minh/)).not.toBeInTheDocument();
    expect(Object.keys(localStorage).filter(key=>key.startsWith('vinpoker:payout-edit:'))).toHaveLength(1);
    expect(h.rpc.mock.calls.filter(call=>call[0]==='save_tournament_prizes_v3')).toHaveLength(1);
  });
  it('clears the intent only after the saved run and exact ladder are read back',async()=>{
    manualOfficialState();const normal=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async(name,args)=>{
      if(name==='save_tournament_prizes_v3'){
        h.appliedRun={...h.appliedRun,id:manualScope.next,source:'manual_edit',supersedes_run_id:manualScope.previous};
        return {data:manualSaved(args),error:null};
      }
      return normal(name,args);
    });
    render(<PayoutEnginePanel tournamentId={manualScope.tour}/>);await startManual();
    await waitFor(()=>expect(toast.success).toHaveBeenCalledWith('Đã đối chiếu chỉnh tay payout đã lưu.'));
    expect(screen.queryByText(/Chỉnh tay đang chờ xác minh/)).not.toBeInTheDocument();
    expect(Object.keys(localStorage).filter(key=>key.startsWith('vinpoker:payout-edit:'))).toHaveLength(0);
    expect(h.rpc.mock.calls.filter(call=>call[0]==='save_tournament_prizes_v3')).toHaveLength(1);
  });
  it('recovers a committed write from its exact receipt without resending the writer',async()=>{
    manualOfficialState();const normal=h.rpc.getMockImplementation()!;let sent:Record<string,unknown>={};
    h.rpc.mockImplementation(async(name,args)=>{
      if(name==='save_tournament_prizes_v3'){
        sent=args;h.appliedRun={...h.appliedRun,id:manualScope.next,source:'manual_edit',supersedes_run_id:manualScope.previous};
        return {data:null,error:{message:'503 after commit'}};
      }
      if(name==='get_tournament_payout_edit_receipt_v1')return {data:{status:'found',actor_id:manualScope.actor,
        tournament_id:manualScope.tour,request_id:sent.p_request_id,intent:{reason:sent.p_reason,
          rows:(sent.p_rows as {position:number;amount:number}[]).map(row=>({amount:row.amount,position:row.position})),
          expected_run_id:sent.p_expected_run_id,tournament_id:sent.p_tournament_id},result:manualSaved(sent)},error:null};
      return normal(name,args);
    });
    render(<PayoutEnginePanel tournamentId={manualScope.tour}/>);await startManual();
    await waitFor(()=>expect(toast.success).toHaveBeenCalledWith('Đã đối chiếu chỉnh tay payout đã lưu.'));
    expect(h.rpc.mock.calls.filter(call=>call[0]==='save_tournament_prizes_v3')).toHaveLength(1);
    expect(h.rpc.mock.calls.filter(call=>call[0]==='get_tournament_payout_edit_receipt_v1')).toHaveLength(1);
  });
  it('sends expected actor/run plus durable request ID to the fenced writer, never legacyv2',async()=>{
    manualOfficialState();render(<PayoutEnginePanel tournamentId={manualScope.tour}/>);await startManual();
    await waitFor(()=>expect(h.rpc.mock.calls.some(call=>call[0].startsWith('save_tournament_prizes'))).toBe(true));
    const call=h.rpc.mock.calls.find(call=>call[0]==='save_tournament_prizes_v3');
    expect(call).toBeDefined();expect(call![1].p_expected_actor).toBe(manualScope.actor);
    expect(call![1].p_expected_run_id).toBe(manualScope.previous);
    expect(call![1].p_request_id).toMatch(/^[a-f0-9-]{36}$/i);
    expect(h.rpc.mock.calls.some(call=>call[0]==='save_tournament_prizes_v2')).toBe(false);
  });
  it.each([null,{status:'unrecognized'}])('does not claim success or discard an unknown result %j',async(data)=>{
    manualOfficialState();const normal=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async(name,args)=>name.startsWith('save_tournament_prizes')?{data,error:null}:normal(name,args));
    render(<PayoutEnginePanel tournamentId={manualScope.tour}/>);await startManual();
    await waitFor(()=>expect(h.rpc.mock.calls.some(call=>call[0].startsWith('save_tournament_prizes'))).toBe(true));
    await act(async()=>{await Promise.resolve();});
    expect(toast.success).not.toHaveBeenCalled();
    expect(await screen.findByText(/Chỉnh tay đang chờ xác minh/)).toBeInTheDocument();
  });
  it('does not trust a saved acknowledgement while canonical readback still has the old run',async()=>{
    manualOfficialState();const normal=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async(name,args)=>name.startsWith('save_tournament_prizes')?{data:manualSaved(args),error:null}:normal(name,args));
    render(<PayoutEnginePanel tournamentId={manualScope.tour}/>);await startManual();
    await waitFor(()=>expect(h.rpc.mock.calls.some(call=>call[0].startsWith('save_tournament_prizes'))).toBe(true));
    await act(async()=>{await Promise.resolve();});
    expect(toast.success).not.toHaveBeenCalled();
    expect(await screen.findByText(/Chỉnh tay đang chờ xác minh/)).toBeInTheDocument();
  });
  it('restores unresolved intent on remount without automatically sending another writer',async()=>{
    manualOfficialState();const normal=h.rpc.getMockImplementation()!;
    h.rpc.mockImplementation(async(name,args)=>name.startsWith('save_tournament_prizes')?{data:null,error:{message:'503 after commit'}}:normal(name,args));
    const view=render(<PayoutEnginePanel tournamentId={manualScope.tour}/>);await startManual();
    await waitFor(()=>expect(h.rpc.mock.calls.some(call=>call[0].startsWith('save_tournament_prizes'))).toBe(true));
    await act(async()=>{await Promise.resolve();});view.unmount();
    render(<PayoutEnginePanel tournamentId={manualScope.tour}/>);
    expect(await screen.findByText(/Chỉnh tay đang chờ xác minh/)).toBeInTheDocument();
    expect(h.rpc.mock.calls.filter(call=>call[0].startsWith('save_tournament_prizes'))).toHaveLength(1);
  });
});

describe("PayoutEnginePanel — backend error codes surface as friendly messages", () => {
  it("NOT_AUTHORIZED on preview", async () => {
    h.invoke.mockImplementation(async () => ({ data: { error: "NOT_AUTHORIZED" }, error: null }));
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    fireEvent.click(screen.getByText(/Xem trước/));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect((toast.error as any).mock.calls.at(-1)[0]).toMatch(/NOT_AUTHORIZED/);
  });

  it("RUN_NOT_DRAFT / REGISTRATION_NOT_CLOSED on official; SUM_MISMATCH on manual edit", async () => {
    // official → prepare ok, but the Edge official apply returns RUN_NOT_DRAFT
    h.invoke.mockImplementation(async (_n, o: any) => (o.body.mode === "official" ? { data: { error: "RUN_NOT_DRAFT" }, error: null } : { data: { result: { rows: [], itmPlaces: 0, effectiveFloor: 0, archetype: "DAILY", warnings: [] } }, error: null }));
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    fireEvent.click(screen.getByRole("button", { name: /Đóng đăng ký & tạo payout/ }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByText(/Đóng đăng ký & tạo$/));
    await waitFor(() => expect((toast.error as any).mock.calls.some((c: any[]) => /RUN_NOT_DRAFT/.test(c[0]))).toBe(true));

    // manual edit → save returns SUM_MISMATCH (force via rpc), reason present + sum matches client-side
    manualOfficialState();
    h.rpc.mockImplementation(async (name: string) => {
      if (name === "get_tournament_prizes") return { data: h.prizes, error: null };
      if (name === "save_tournament_prizes_v3") return { data: null, error: { message: "SUM_MISMATCH" } };
      return { data: null, error: null };
    });
    render(<PayoutEnginePanel tournamentId={manualScope.tour} />);
    await screen.findAllByText(/PAYOUT CHÍNH THỨC/);
    fireEvent.click(screen.getAllByRole("button", { name: /Chỉnh tay/ })[0]);
    const reason = screen.getByPlaceholderText(/Lý do chỉnh tay/);
    fireEvent.change(reason, { target: { value: "test" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu chỉnh tay/ }));
    await waitFor(() => expect((toast.error as any).mock.calls.some((c: any[]) => /SUM_MISMATCH/.test(c[0]))).toBe(true));
  });
});

describe("PayoutEnginePanel — native CUSTOM mode is gated by FEATURES.payoutCustomMode", () => {
  const openStyleSelect = () => {
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown", code: "ArrowDown" });
  };

  it("CUSTOM style is HIDDEN when payoutCustomMode = false", async () => {
    flags.payoutCustomMode = false;
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    openStyleSelect();
    expect(screen.queryByText(/CUSTOM — CLB tự cấu hình/)).not.toBeInTheDocument();
  });

  it("CUSTOM style is VISIBLE when payoutCustomMode = true", async () => {
    flags.payoutCustomMode = true;
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    openStyleSelect();
    expect(await screen.findByText(/CUSTOM — CLB tự cấu hình/)).toBeInTheDocument();
  });
});

describe("PayoutEnginePanel — CUSTOM import/templates gated by FEATURES.payoutCustomTemplates", () => {
  const selectCustom = async () => {
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(await screen.findByText(/CUSTOM — CLB tự cấu hình/));
    await screen.findByText(/Cơ cấu % tự cấu hình/); // CUSTOM builder is now visible
  };

  it("import + save-template UI is HIDDEN when payoutCustomTemplates = false (even in CUSTOM)", async () => {
    flags.payoutCustomMode = true; flags.payoutCustomTemplates = false;
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    await selectCustom();
    expect(screen.queryByRole("button", { name: /Tải file/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lưu mẫu/ })).not.toBeInTheDocument();
  });

  it("import + save-template UI is VISIBLE when payoutCustomTemplates = true", async () => {
    flags.payoutCustomMode = true; flags.payoutCustomTemplates = true;
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    await selectCustom();
    expect(await screen.findByRole("button", { name: /Tải file/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lưu mẫu/ })).toBeInTheDocument();
  });
});

describe("PayoutEnginePanel — LIVE STANDARD is no longer offered (superseded by default banding)", () => {
  it("LIVE STANDARD never appears in the Kiểu giải dropdown", async () => {
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown", code: "ArrowDown" });
    expect(screen.queryByText(/LIVE STANDARD/)).not.toBeInTheDocument();
  });
});

describe("PayoutEnginePanel — planned settings gated by FEATURES.payoutPlannedSettings", () => {
  it("save-default button HIDDEN when payoutPlannedSettings = false", async () => {
    flags.payoutPlannedSettings = false;
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    expect(screen.queryByRole("button", { name: /Lưu mặc định cho giải này/ })).not.toBeInTheDocument();
  });

  it("OFF: does NOT pre-fill from planned_* even when the tournament has them saved", async () => {
    flags.payoutPlannedSettings = false;
    h.tour.planned_payout_archetype = "INTL"; h.tour.planned_itm_percent = 0.3;
    h.tour.planned_min_cash_x = 1.5; h.tour.planned_rounding_unit = 1_000_000;
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    expect((screen.getByRole("spinbutton", { name: "ITM %" }) as HTMLInputElement).value).toBe("15"); // untouched default
  });

  it("ON: pre-fills kiểu giải/ITM%/min-cash/làm tròn from planned_*", async () => {
    flags.payoutPlannedSettings = true;
    h.tour.planned_payout_archetype = "INTL"; h.tour.planned_itm_percent = 0.3;
    h.tour.planned_min_cash_x = 1.5; h.tour.planned_rounding_unit = 1_000_000;
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    await waitFor(() => expect((screen.getByRole("spinbutton", { name: "ITM %" }) as HTMLInputElement).value).toBe("30"));
    expect((screen.getByRole("spinbutton", { name: "Min-cash ×" }) as HTMLInputElement).value).toBe("1.5");
    expect((screen.getByRole("spinbutton", { name: "Làm tròn (đ)" }) as HTMLInputElement).value).toBe("1000000");
    expect(screen.getByRole("combobox")).toHaveTextContent(/INTL/);
  });

  it("save-default button VISIBLE when ON, writes planned_* via tournaments.update", async () => {
    flags.payoutPlannedSettings = true;
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    const btn = screen.getByRole("button", { name: /Lưu mặc định cho giải này/ });
    fireEvent.click(btn);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(h.lastTournamentsUpdatePayload).toEqual({
      planned_itm_percent: 0.15, planned_payout_archetype: "DAILY", planned_min_cash_x: 2, planned_rounding_unit: 100000,
    });
  });

  it("RLS-denied save surfaces a friendly message (not the raw Postgres error)", async () => {
    flags.payoutPlannedSettings = true;
    h.tournamentsUpdateError = { message: "new row violates row-level security policy for table tournaments" };
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    fireEvent.click(screen.getByRole("button", { name: /Lưu mặc định cho giải này/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect((toast.error as any).mock.calls.at(-1)[0]).toMatch(/không có quyền lưu mặc định/);
  });

  it("zero-row RLS-filtered save (no error, data=[]) shows error toast — NOT fake success", async () => {
    // UPDATE bị RLS USING lọc hết row: PostgREST trả data=[] KHÔNG error. Trước fix, code
    // toast success giả. Sau fix: bắt data.length===0 → báo không có quyền.
    flags.payoutPlannedSettings = true;
    h.tournamentsUpdateRows = [];
    render(<PayoutEnginePanel tournamentId="t1" />);
    await screen.findByText(/Cơ cấu giải thưởng/);
    fireEvent.click(screen.getByRole("button", { name: /Lưu mặc định cho giải này/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect((toast.error as any).mock.calls.at(-1)[0]).toMatch(/Không có quyền lưu mặc định/);
    expect(toast.success).not.toHaveBeenCalled();
  });

  for(const rows of [[{id:'other-tour'}],[{id:'t1'},{id:'other-tour'}],{status:'ok'}])it(`does not confirm planned settings from an unexpected RETURNING payload ${JSON.stringify(rows)}`,async()=>{
    flags.payoutPlannedSettings=true;
    h.tournamentsUpdateRows=rows as unknown as typeof h.tournamentsUpdateRows;
    render(<PayoutEnginePanel tournamentId="t1"/>);
    await screen.findByText(/Cơ cấu giải thưởng/);
    fireEvent.click(screen.getByRole('button',{name:/Lưu mặc định cho giải này/}));
    await waitFor(()=>expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});
