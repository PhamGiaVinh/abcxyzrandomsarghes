import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

type QueryFixture = {
  select: () => QueryFixture; is: () => QueryFixture; in: (column:string,values:string[]) => QueryFixture; order: () => QueryFixture; abortSignal: (signal:AbortSignal) => QueryFixture;
  then: (resolve: (value: unknown) => unknown,reject?:(reason:unknown)=>unknown) => Promise<unknown>;
};
type ChannelFixture = {
  on: (event: string, filter: { table: string }, callback: () => void) => ChannelFixture;
  subscribe: () => ChannelFixture;
};

const db = vi.hoisted(() => ({ rpc: vi.fn(), read:vi.fn(), signals:[] as AbortSignal[], actor: "owner", session:{access_token:'synthetic-a'}, laneMounts:0, status: "live", liveStatus: null as string | null, honorStatuses:false, closeReport:false,
  callbacks: new Map<string, () => void>(), childCallback: undefined as (() => void) | undefined }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: db.actor },session:db.session }) }));
vi.mock("react-i18next", async () => {
  const { default: viLocale } = await import("@/i18n/locales/vi.json");
  return { useTranslation: () => ({ t: (key: string) => key.startsWith("tournamentLive.statusLabels.")
    ? viLocale.tournamentLive.statusLabels[key.split(".").at(-1) as keyof typeof viLocale.tournamentLive.statusLabels] : key }) };
});
vi.mock("@/lib/featureFlags", () => ({ FEATURES: {trackerVoiceInput:true,get closeReport(){return db.closeReport;}} }));
vi.mock("@/components/tracker/TableAppearanceEditor", () => ({ TableAppearanceEditor: () => null }));
vi.mock("./tournament-live/ClockPanel", () => ({ ClockPanel: () => null }));
vi.mock("./tournament-live/handinput/unified/TrackerHandInputBoundary", () => ({ TrackerHandInputBoundary: () => null }));
vi.mock("./tournament-live/LeaderboardPanel", () => ({ LeaderboardPanel: () => null }));
vi.mock("./tournament-live/PlayersGroupedPanel", () => ({ PlayersGroupedPanel: ({ onTournamentChanged }: { onTournamentChanged?: () => void }) =>
  <button onClick={() => onTournamentChanged?.()}>confirmed-player-restore</button> }));
vi.mock("./tournament-live/BlindEditorPanel", () => ({ BlindEditorPanel: () => null }));
vi.mock("./tournament-live/FloorTableMapPanel", () => ({ FloorTableMapPanel: ({ onParticipationChanged, refreshTrigger }: { onParticipationChanged?: () => void; refreshTrigger: number }) => {
  db.childCallback = onParticipationChanged;
  return <><button onClick={() => onParticipationChanged?.()}>confirmed-seat-change</button><span>child-refresh:{refreshTrigger}</span></>;
} }));
vi.mock("./tournament-live/PrizesTab", () => ({ PrizesTab: () => null }));
vi.mock("./tournament-live/TournamentLiveView", () => ({ TournamentLiveView: () => null }));
vi.mock("./tournament-live/HandHistoryPanel", () => ({ HandHistoryPanel: () => null }));
vi.mock("./tournament-live/RegistrationQueuePanel", () => ({ RegistrationQueuePanel: ({ tournamentStatus }: { tournamentStatus?: string }) => <span>queue-status:{tournamentStatus}</span> }));
vi.mock("./tournament-live/TrackerFloorAlertLane", async () => {
  const React=await import('react');
  return {TrackerFloorAlertLane:()=>{const[instance]=React.useState(()=>++db.laneMounts);return <span data-testid="alert-lane-instance">{instance}</span>;}};
});
vi.mock("./tournament-live/TvDisplaysPanel", () => ({ TvDisplaysPanel: () => null }));
vi.mock("@/components/td-ai/TdAiTabPanel", () => ({ TdAiTabPanel: () => null }));
vi.mock("./tournament-live/CloseReportDialog", () => ({ default: () => null }));
vi.mock("@/components/floor/FloorTournamentsLanding", () => ({ FloorTournamentsLanding: ({ onSelect }: { onSelect: (id: string) => void }) =>
  <button onClick={() => onSelect("a")}>select-a</button> }));
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const Context = React.createContext<(id: string) => void>(() => {});
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Select: ({ children, onValueChange }: { children?: ReactNode; onValueChange: (id: string) => void }) => <Context.Provider value={onValueChange}>{children}</Context.Provider>,
    SelectContent: Wrapper, SelectTrigger: Wrapper, SelectValue: Wrapper,
    SelectItem: ({ children, value }: { children?: ReactNode; value: string }) => {
      const select = React.useContext(Context);
      return <button onClick={() => select(value)}>{children}</button>;
    } };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: db.rpc,
  from: () => {
    let statuses:string[]=[];
    const query: QueryFixture = { select: () => query, is: () => query, in: (column,values) => {if(column==='status')statuses=values;return query;},
      order: () => query,abortSignal:signal=>{db.signals.push(signal);return query;},
      then: (resolve: (value: unknown) => unknown,reject?:(reason:unknown)=>unknown) => (db.read.getMockImplementation()?db.read():Promise.resolve({ data: ["a", "b"].map((id) => ({ id, name: `Tour ${id}`, club_id: "club",
        status: db.status, live_status: db.liveStatus, players_remaining: 99, average_stack: 123 })).filter(row=>!db.honorStatuses||statuses.includes(row.status)), error: null })).then(resolve,reject) };
    return query;
  },
  channel: () => {
    const channel: ChannelFixture = { on: (_event: string, filter: { table: string }, callback: () => void) => {
      db.callbacks.set(filter.table, callback); return channel;
    }, subscribe: () => channel };
    return channel;
  }, removeChannel: vi.fn(),
} }));
import TournamentLivePanel from "./TournamentLivePanel";
const payload = (id: string, remaining = 8) => ({ tournament_id: id, average_stack: 9750000,
  counts: { total_entries: 11, re_entries: 0, remaining, seated: 8, waiting: 0, busted: 3,
    anomaly_entries: 0, anomaly_seats: 0, live_entry_stack: 78000000, seated_stack: 78000000, waiting_stack: 0 } });
const props = { clubIds: ["club"], clubs: [{ id: "club", name: "Club" }], mode: "floor" as const };
beforeEach(() => { db.rpc.mockReset();db.read.mockReset();db.signals=[]; db.callbacks.clear(); db.actor = "owner";db.session={access_token:'synthetic-a'};db.laneMounts=0; db.status = "live"; db.liveStatus = null;db.honorStatuses=false;db.closeReport=false;
  db.rpc.mockImplementation((_name, args) => Promise.resolve({ data: payload(args.p_tournament_id), error: null })); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Floor selected-tour canonical summary integration", () => {
  it("passes the completed catalog status into the registration queue", async () => {
    db.status = "completed";
    render(<TournamentLivePanel {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "select-a" }));
    await screen.findByRole("button", { name: "confirmed-seat-change" });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Hàng chờ" }), { button: 0, ctrlKey: false });
    expect(await screen.findByText("queue-status:completed")).toBeInTheDocument();
  });
  it('opens the completed Floor tour workspace and its existing close report',async()=>{
    db.status='completed';db.honorStatuses=true;db.closeReport=true;
    render(<TournamentLivePanel {...props}/>);
    fireEvent.click(await screen.findByRole('button',{name:'select-a'}));
    expect(await screen.findByRole('button',{name:'confirmed-seat-change'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Xem báo cáo chốt giải'})).toBeInTheDocument();
  });
  it('keeps completed tours outside the other active-only workspaces',async()=>{
    db.status='completed';db.honorStatuses=true;
    render(<TournamentLivePanel {...props} mode="full"/>);
    expect(await screen.findByText('Không có giải active')).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'confirmed-seat-change'})).not.toBeInTheDocument();
  });
  it('ends a hung tournament list read and permits explicit retry',async()=>{
    vi.useFakeTimers();db.read.mockImplementation(()=>new Promise(()=>{}));
    render(<TournamentLivePanel {...props} mode="full"/>);
    await act(async()=>{await vi.advanceTimersByTimeAsync(10_001);});
    expect(screen.getByText('Không tải được danh sách giải')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Làm mới'})).toBeEnabled();
    expect(db.signals.every(signal=>signal.aborted)).toBe(true);
    db.read.mockResolvedValue({data:[],error:null});
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Làm mới'}));});
    expect(screen.getByText('Không có giải active')).toBeInTheDocument();
  });
  it('surfaces a rejected list read without leaving refresh disabled',async()=>{
    db.read.mockRejectedValue(new Error('LOCAL_LIST_READ_REJECTED'));
    render(<TournamentLivePanel {...props} mode="full"/>);
    expect(await screen.findByText('LOCAL_LIST_READ_REJECTED')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Làm mới'})).toBeEnabled();
  });
  it.each([null,{},[{id:'a',name:'OTHER_CLUB_TOUR',club_id:'another-club',status:'live'}]])('rejects malformed or foreign-club list %j',async(data)=>{
    db.read.mockResolvedValue({data,error:null});
    render(<TournamentLivePanel {...props} mode="full"/>);
    expect(await screen.findByText('Không tải được danh sách giải')).toBeInTheDocument();
    expect(screen.queryByText('Không có giải active')).not.toBeInTheDocument();
    expect(screen.queryByText('OTHER_CLUB_TOUR')).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Làm mới'})).toBeEnabled();
  });
  it('discards the prior credential list after a refreshed credential read completes',async()=>{
    let release!:(value:unknown)=>void;
    db.read.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
    const view=render(<TournamentLivePanel {...props} mode="full"/>);
    await act(async()=>{});
    db.read.mockResolvedValue({data:[{id:'new',name:'CURRENT_REQUEST',club_id:'club',status:'live'}],error:null});
    db.session.access_token='synthetic-new-credential';
    await act(async()=>view.rerender(<TournamentLivePanel {...props} mode="full"/>));
    expect(await screen.findAllByText('CURRENT_REQUEST')).not.toHaveLength(0);
    await act(async()=>release({data:[{id:'old',name:'OLD_REQUEST',club_id:'club',status:'live'}],error:null}));
    expect(screen.queryByText('OLD_REQUEST')).not.toBeInTheDocument();
    expect(screen.getAllByText('CURRENT_REQUEST')).not.toHaveLength(0);
  });
  it.each(['actor','session'])('retires the alert lane after a %s change, not an ordinary rerender',async(kind)=>{
    const view=render(<TournamentLivePanel {...props}/>);
    fireEvent.click(await screen.findByRole('button',{name:'select-a'}));
    const original=(await screen.findByTestId('alert-lane-instance')).textContent;
    if(kind==='actor')db.actor='other-owner';else db.session={access_token:'synthetic-b'};
    await act(async()=>view.rerender(<TournamentLivePanel {...props}/>));
    const current=screen.getByTestId('alert-lane-instance').textContent;
    expect(current).not.toBe(original);
    await act(async()=>view.rerender(<TournamentLivePanel {...props}/>));
    expect(screen.getByTestId('alert-lane-instance')).toHaveTextContent(current!);
  });
  it("ignores a settled child callback from the previous actor scope", async () => {
    const view = render(<TournamentLivePanel {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "select-a" }));
    await waitFor(() => expect(screen.getByText(/playersRemaining\s*:\s*8\s*·\s*AVG:/)).toBeInTheDocument());
    const oldCallback = db.childCallback!;
    db.actor = "other-owner";
    view.rerender(<TournamentLivePanel {...props} />);
    await waitFor(() => expect(screen.getByText(/playersRemaining\s*:\s*8\s*·\s*AVG:/)).toBeInTheDocument());
    const before = db.rpc.mock.calls.length;
    await act(async () => oldCallback());
    expect(db.rpc.mock.calls.length).toBe(before);
    fireEvent.click(screen.getByRole("button", { name: "confirmed-seat-change" }));
    await waitFor(() => expect(db.rpc.mock.calls.length).toBe(before + 1));
  });
  it("refreshes canonical header after a confirmed child mutation without waiting for Realtime", async () => {
    render(<TournamentLivePanel {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "select-a" }));
    await waitFor(() => expect(screen.getByText(/playersRemaining.*8/)).toBeInTheDocument());
    const before = db.rpc.mock.calls.length;
    const childRefresh = screen.getByText(/child-refresh:/).textContent;
    db.rpc.mockImplementation((_name, args) => Promise.resolve({ data: payload(args.p_tournament_id, 7), error: null }));
    fireEvent.click(screen.getByRole("button", { name: "confirmed-seat-change" }));
    await waitFor(() => expect(screen.getByText(/playersRemaining\s*:\s*7\s*·\s*AVG:/)).toBeInTheDocument());
    expect(screen.queryByText(/playersRemaining.*8/)).not.toBeInTheDocument();
    expect(db.rpc.mock.calls.length).toBe(before + 1);
    expect(screen.getByText(/child-refresh:/).textContent).toBe(childRefresh);
    expect(db.rpc.mock.calls.every(([name]) => name === "get_tournament_participation_counts_v1")).toBe(true);
  });
  it("reloads the canonical header after the player restore callback without a Realtime event", async () => {
    render(<TournamentLivePanel {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "select-a" }));
    await waitFor(() => expect(screen.getByText(/playersRemaining.*8/)).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Người chơi" }), { button: 0, ctrlKey: false });
    const before = db.rpc.mock.calls.length;
    db.rpc.mockImplementation((_name, args) => Promise.resolve({ data: { ...payload(args.p_tournament_id, 9), average_stack: 8000000 }, error: null }));
    fireEvent.click(await screen.findByRole("button", { name: "confirmed-player-restore" }));
    await waitFor(() => expect(screen.getByText(/playersRemaining\s*:\s*9\s*·\s*AVG:\s*8[.,]000[.,]000/)).toBeInTheDocument());
    expect(db.rpc.mock.calls.length).toBeGreaterThan(before);
    expect(db.rpc.mock.calls.every(([name]) => name === "get_tournament_participation_counts_v1")).toBe(true);
    expect(screen.queryByText(/playersRemaining.*99/)).not.toBeInTheDocument();
  });
  it("displays registering from the server rather than treating catalog active as playing", async () => {
    db.status = "active"; db.liveStatus = "registering";
    render(<TournamentLivePanel {...props} />);
    await screen.findByRole("button", { name: /Tour a.*Đang đăng ký/ });
    fireEvent.click(screen.getByRole("button", { name: "select-a" }));
    await waitFor(() => expect(screen.getByText(/playersRemaining.*8/)).toBeInTheDocument());
    expect(screen.getAllByText(/Đang đăng ký/)).toHaveLength(3);
    expect(screen.queryByText("Đang chơi")).not.toBeInTheDocument();
    expect(db.rpc.mock.calls.every(([name]) => name === "get_tournament_participation_counts_v1")).toBe(true);
  });
  it.each([
    ["active", "playing", "Đang chơi"],
    ["active", "paused", "Tạm dừng"],
    ["active", null, "Đang hoạt động"],
    ["active", "", "Chưa xác định"],
    ["completed", "playing", "Đã kết thúc"],
    ["cancelled", "playing", "Đã hủy"],
  ])("renders catalog=%s/live=%s honestly", async (status, liveStatus, label) => {
    db.status = status!; db.liveStatus = liveStatus;
    render(<TournamentLivePanel {...props} />);
    await screen.findByRole("button", { name: new RegExp(`Tour a.*${label}`) });
    fireEvent.click(screen.getByRole("button", { name: "select-a" }));
    await waitFor(() => expect(screen.getByText(/playersRemaining.*8/)).toBeInTheDocument());
    expect(screen.getAllByText(new RegExp(label!))).toHaveLength(3);
  });
  it("does not expose an old club registering tour in the attention lane after club scope changes", async () => {
    db.status = "active"; db.liveStatus = "registering";
    const view = render(<TournamentLivePanel {...props} mode="tracker" />);
    await waitFor(() => expect(screen.getByText("Cần chú ý")).toBeInTheDocument());
    view.rerender(<TournamentLivePanel {...props} mode="tracker" clubIds={["other"]} />);
    await waitFor(() => expect(screen.queryByText("Cần chú ý")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", {name:/Tour a.*Đang đăng ký/})).not.toBeInTheDocument();
  });
  it("uses canonical participation on Tracker selection cards rather than stored tournament counters", async () => {
    render(<TournamentLivePanel {...props} mode="tracker" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Tour a.*8.*9.750.000/ })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Tour a.*99.*123/ })).not.toBeInTheDocument();
  });
  it("never substitutes stored counters when an overview read fails and clears cards outside the current club", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "503" } });
    const { rerender } = render(<TournamentLivePanel {...props} mode="tracker" />);
    await waitFor(() => expect(screen.getAllByRole("status").filter((node) => node.textContent === "common.participationUnavailable")).toHaveLength(2));
    expect(screen.queryByRole("button", { name: /Tour a.*99.*123/ })).not.toBeInTheDocument();
    await act(async () => rerender(<TournamentLivePanel {...props} mode="tracker" clubIds={["other"]} />));
    expect(screen.queryByRole("button", { name: /Tour a.*common.participationUnavailable/ })).not.toBeInTheDocument();
  });
  it("renders canonical counts and never stale counters after picker/club changes", async () => {
    const { rerender } = render(<TournamentLivePanel {...props} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "select-a" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "select-a" }));
    await waitFor(() => expect(screen.getByText(/playersRemaining.*8/)).toBeInTheDocument());
    expect(screen.queryByText(/playersRemaining.*99/)).not.toBeInTheDocument();
    let resolveB!: (value: unknown) => void;
    db.rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: /Tour b/ }));
    expect(screen.queryByText(/playersRemaining.*8/)).not.toBeInTheDocument();
    await act(async () => resolveB({ data: payload("b", 2), error: null }));
    await waitFor(() => expect(screen.getByText(/playersRemaining.*2/)).toBeInTheDocument());
    await act(async () => { rerender(<TournamentLivePanel {...props} clubIds={["other"]} />); });
    expect(screen.queryByText(/playersRemaining.*2/)).not.toBeInTheDocument();
  });
  it("coalesces entry events and exposes failed refresh without cached fallback", async () => {
    render(<TournamentLivePanel {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "select-a" }));
    await waitFor(() => expect(screen.getByText(/playersRemaining.*8/)).toBeInTheDocument());
    db.rpc.mockResolvedValue({ data: null, error: { message: "503" } });
    const before = db.rpc.mock.calls.length;
    act(() => { for (let i = 0; i < 20; i++) db.callbacks.get("tournament_entries")!(); });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("common.participationUnavailable"));
    expect(db.rpc.mock.calls.length).toBe(before + 1);
    expect(screen.queryByText(/playersRemaining.*8/)).not.toBeInTheDocument();
    expect(screen.queryByText(/playersRemaining.*99/)).not.toBeInTheDocument();
  });
  it("does not postpone refresh indefinitely under a continuous event stream", async () => {
    render(<TournamentLivePanel {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "select-a" }));
    await waitFor(() => expect(screen.getByText(/playersRemaining.*8/)).toBeInTheDocument());
    const before = db.rpc.mock.calls.length;
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        db.callbacks.get("tournament_entries")!();
        await vi.advanceTimersByTimeAsync(90);
      });
    }
    expect(db.rpc.mock.calls.length).toBeGreaterThanOrEqual(before + 2);
    expect(screen.getByText(/playersRemaining.*8/)).toBeInTheDocument();
  });
});

it('retires the selected operational subtree when the canonical active list no longer contains the completed tour',async()=>{
 render(<TournamentLivePanel {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'select-a'}));
 await screen.findByRole('button',{name:'confirmed-seat-change'});
 db.read.mockResolvedValue({data:[],error:null});
 await act(async()=>{db.callbacks.get('tournaments')?.();});
 await waitFor(()=>expect(screen.queryByRole('button',{name:'confirmed-seat-change'})).toBeNull());
 expect(screen.queryByRole('button',{name:'Tất cả giải'})).toBeNull();
 expect(screen.getByRole('button',{name:'select-a'})).toBeInTheDocument();
});

it('keeps selected child state but explicitly reports a failed active-list refresh and supports manual recovery',async()=>{
 render(<TournamentLivePanel {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'select-a'}));
 const instance=(await screen.findByTestId('alert-lane-instance')).textContent;
 db.read.mockResolvedValue({data:null,error:{message:'LOCAL_LIST_REFRESH_503'}});
 await act(async()=>{db.callbacks.get('tournaments')?.();});
 expect(screen.getByRole('alert')).toHaveTextContent('Danh sách giải chưa được cập nhật');
 expect(screen.getByTestId('alert-lane-instance')).toHaveTextContent(instance!);
 expect(screen.getByRole('button',{name:'confirmed-seat-change'})).toBeInTheDocument();
 db.read.mockResolvedValue({data:[],error:null});
 fireEvent.click(screen.getByRole('button',{name:'Tải lại danh sách giải'}));
 await waitFor(()=>expect(screen.queryByRole('button',{name:'confirmed-seat-change'})).not.toBeInTheDocument());
 expect(screen.queryByText('Danh sách giải chưa được cập nhật')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'select-a'})).toBeInTheDocument();
});


it('retains selected child through a pending retry and same-tour metadata recovery',async()=>{
 render(<TournamentLivePanel {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'select-a'}));
 const instance=(await screen.findByTestId('alert-lane-instance')).textContent;
 db.read.mockResolvedValue({data:null,error:{message:'LOCAL_SELECTED_LIST_503'}});
 await act(async()=>{db.callbacks.get('tournaments')?.();});
 expect(screen.getByRole('alert')).toHaveTextContent('Danh sách giải chưa được cập nhật');
 let release!:(value:unknown)=>void;
 db.read.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 fireEvent.click(screen.getByRole('button',{name:'Tải lại danh sách giải'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Tải lại danh sách giải'})).toBeDisabled());
 expect(screen.getByTestId('alert-lane-instance')).toHaveTextContent(instance!);
 expect(screen.getByRole('button',{name:'confirmed-seat-change'})).toBeInTheDocument();
 await act(async()=>release({data:[{id:'a',name:'Tour a refreshed',club_id:'club',status:'active',live_status:'paused'}],error:null}));
 await waitFor(()=>expect(screen.queryByText('Danh sách giải chưa được cập nhật')).not.toBeInTheDocument());
 expect(screen.getByRole('button',{name:'Tour a refreshed Tạm dừng · Club'})).toBeInTheDocument();
 expect(screen.getByTestId('alert-lane-instance')).toHaveTextContent(instance!);
 expect(db.laneMounts).toBe(1);
 expect(screen.getByRole('button',{name:'confirmed-seat-change'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Làm mới'})).toBeEnabled();
});
