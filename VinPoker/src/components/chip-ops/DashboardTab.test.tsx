import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rpc: vi.fn(), signals: [] as AbortSignal[],status:'live',seats:10,level:null as number|null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: (...args: unknown[]) => {
    const request=Object.assign(Promise.resolve(db.rpc(...args)),{abortSignal:(signal:AbortSignal)=>{db.signals.push(signal);return request;}});
    return request;
  },
  from: (table: string) => {
    const result = { data: table === "tournaments" ? { status: db.status, players_remaining: 10, average_stack: 7802500,current_level:db.level }
      : table==='tournament_levels'?{small_blind:100,big_blind:200,ante:0,is_break:false}
      : Array.from({ length: db.seats }, (_, i) => ({ player_name: `Seat ${i}`, chip_count: i === 0 ? 78025000 : 0 })), error: null };
    const query = { select: () => query, eq: () => query, abortSignal:(signal:AbortSignal)=>{db.signals.push(signal);return query;}, order: () => Promise.resolve(result), maybeSingle: () => Promise.resolve(result) };
    return query;
  },
} }));
import { DashboardTab } from "./DashboardTab";

const inv = { denominations: [], total_value: 0, reconciled: true };
beforeEach(() => {db.status='live';db.seats=10;db.level=null;db.signals=[];db.rpc.mockReset();db.rpc.mockResolvedValue({ data: { tournament_id: "tour", average_stack: 9750000,
  counts: { total_entries: 11, re_entries: 0, remaining: 8, seated: 8, waiting: 0, busted: 3,
    anomaly_entries: 0, anomaly_seats: 2, live_entry_stack: 78000000, seated_stack: 78000000, waiting_stack: 0 } }, error: null });});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
describe("Chip overview canonical participation", () => {
  it.each(['completed','cancelled'])('does not request operational color-up or flag expected empty seats for %s tour',async status=>{
    db.status=status;db.seats=0;db.level=1;
    db.rpc.mockResolvedValue({data:{tournament_id:'tour',average_stack:180000,counts:{total_entries:9,re_entries:1,remaining:1,seated:0,waiting:1,busted:8,
      anomaly_entries:0,anomaly_seats:0,live_entry_stack:180000,seated_stack:0,waiting_stack:180000}},error:null});
    render(<DashboardTab tournamentId='tour' inv={{...inv,denominations:[{denomination_id:'test100',value:100,color:null,issued_count_total:10}],total_value:1000}}
      denoms={[{id:'test100',value:100,color:null}]}/>);
    await screen.findByText('180.000');
    expect(screen.getByText('Giải đã đóng; không còn ghế hoạt động.')).toBeInTheDocument();
    expect(screen.queryByText(/Đến hạn color-up/)).not.toBeInTheDocument();
    expect(screen.queryByText('color-up')).not.toBeInTheDocument();
  });
  it('does not hide inconsistent active seats in a completed tour',async()=>{
    db.status='completed';
    render(<DashboardTab tournamentId='tour' inv={inv} denoms={[]}/>);
    await screen.findByText('9.750.000');
    expect(screen.getByText(/Ghế đang active và entry hợp lệ chưa khớp/)).toBeInTheDocument();
    expect(screen.queryByText('Giải đã đóng; không còn ghế hoạt động.')).not.toBeInTheDocument();
  });
  it('retains active-tour mismatch and color-up guidance rather than masking them',async()=>{
    db.seats=0;db.level=1;
    render(<DashboardTab tournamentId='tour' inv={{...inv,denominations:[{denomination_id:'test100',value:100,color:null,issued_count_total:10}],total_value:1000}}
      denoms={[{id:'test100',value:100,color:null}]}/>);
    await screen.findByText('9.750.000');
    expect(screen.getByText(/Đến hạn color-up/)).toBeInTheDocument();
    expect(screen.getByText(/Ghế đang active và entry hợp lệ chưa khớp/)).toBeInTheDocument();
  });
  it('does not poll offline and recovers on online without a mutation',async()=>{
    const online=vi.spyOn(navigator,'onLine','get').mockReturnValue(false);
    render(<DashboardTab tournamentId='tour' inv={inv} denoms={[]}/>);
    expect(screen.getByRole('alert')).toBeInTheDocument();expect(db.rpc).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    await act(async()=>{window.dispatchEvent(new Event('online'));});
    await screen.findByText('9.750.000');expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("bounds a hung read, aborts transport and can recover without accepting its late result", async()=>{
    vi.useFakeTimers();let finishOld!:(v:unknown)=>void;
    db.rpc.mockImplementationOnce(()=>new Promise(resolve=>{finishOld=resolve;}));
    render(<DashboardTab tournamentId="tour" inv={inv} denoms={[]}/>);
    await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
    await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được dữ liệu chip trên ghế.');
    expect(db.signals[0]?.aborted).toBe(true);
    await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
    expect(screen.getByText('9.750.000')).toBeInTheDocument();
    await act(async()=>{finishOld({data:null,error:{message:'late 503'}});});
    expect(screen.getByText('9.750.000')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it("keeps physical occupied seats separate from canonical remaining and average", async () => {
    render(<DashboardTab tournamentId="tour" inv={inv} denoms={[]} />);
    await waitFor(() => expect(screen.getByText("9.750.000")).toBeInTheDocument());
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("10 ghế đang active")).toBeInTheDocument();
    expect(screen.queryByText("7.802.500")).not.toBeInTheDocument();
  });
  it("does not fall back to stored counters when canonical read fails", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "503" } });
    render(<DashboardTab tournamentId="tour" inv={inv} denoms={[]} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("7.802.500")).not.toBeInTheDocument();
  });
  it("ignores a late canonical response from the previous tournament", async () => {
    let finishOld!: (value: unknown) => void;
    db.rpc.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
    const { rerender } = render(<DashboardTab tournamentId="old" inv={inv} denoms={[]} />);
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith("get_tournament_participation_counts_v1", { p_tournament_id: "old" }));
    await act(async () => rerender(<DashboardTab tournamentId="tour" inv={inv} denoms={[]} />));
    await screen.findByText("9.750.000");
    await act(async () => finishOld({ data: null, error: { message: "late 503" } }));
    expect(screen.getByText("9.750.000")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
