// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {TrackerFloorAlert} from '@/lib/tracker-floor-alerts/trackerFloorAlertsRead';

const { rpc, maybeSingle, voidState, handRow, baseAlert, alertRows, locationFault } = vi.hoisted(() => {
  const baseAlert:TrackerFloorAlert = {
    id: "alert-1",
    tournament_id: "tournament-1",
    tournament_table_id: "table-1",
    physical_table_id: "physical-1",
    hand_id: "hand-1",
    dealer_id: null,
    assignment_id: null,
    dealer_name: "Dealer",
    alert_kind: "wrong_action",
    priority: "urgent",
    status: "open",
    version: 1,
    correction_required: true,
    title: "Sai action",
    message: null,
    source_action_id: "action-original",
    source_action_snapshot: { action_order: 4, action_type: "call", action_amount: 200000 },
    created_at: "2026-09-17T00:00:00Z",
  };

  return {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>): Promise<{data: unknown; error: unknown}> => ({ data: {
      ok: true, alert_id: args.p_alert_id, version: Number(args.p_expected_version)+1, duplicate: false,
      status: ({acknowledge:'acknowledged',start:'in_progress',resolve:'resolved',dismiss:'dismissed'} as Record<string,string>)[String(args.p_transition)],
    }, error: null })),
    maybeSingle: vi.fn(async () => ({ data: handRow.value, error: null })),
    voidState: { value: false },
    handRow: { value: { id: "hand-1", is_voided: true } },
    baseAlert,
    alertRows: { value: [baseAlert] },
    locationFault: {value:false},
  };
});
const channel = { on: vi.fn(), subscribe: vi.fn() };
channel.on.mockReturnValue(channel);

vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = {
    channel: () => channel,
    removeChannel: vi.fn(),
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }) }),
  };
  return { useSupabaseClient: () => client };
});

vi.mock("@/lib/tracker-floor-alerts/trackerFloorAlertsRead", () => ({
  listTrackerFloorAlerts: vi.fn(async () => ({
    ok: true,
    alerts: alertRows.value,
  })),
}));

vi.mock("@/lib/tracker-floor-alerts/useTrackerFloorAlertLocations", () => ({
  useTrackerFloorAlertLocations: () => () => ({ tableNumber: 5, handNumber: 12, handVoided: voidState.value, unavailable:locationFault.value }),
}));

vi.mock("./HandHistoryWorkspace", () => ({
  HandHistoryWorkspace: ({ initialHandId, initialActionId, actorId }: { initialHandId: string; initialActionId: string; actorId?: string }) =>
    <p>{initialHandId} workspace sửa hand · {initialActionId}<span>shell actor:{actorId}</span></p>,
}));

import { TrackerFloorAlertLane as Lane } from "./TrackerFloorAlertLane";
function TrackerFloorAlertLane(props: {tournamentId: string; actorId?: string}) {
  return <Lane {...props} actorId={props.actorId ?? 'test-actor'}/>;
}
import {listTrackerFloorAlerts} from '@/lib/tracker-floor-alerts/trackerFloorAlertsRead';
beforeEach(()=>{
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async(_key:unknown,_options:unknown,fn:()=>unknown)=>await fn())}});
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  channel.on.mockReturnValue(channel);
  voidState.value = false;
  locationFault.value=false;
  handRow.value.is_voided = true;
  alertRows.value = [baseAlert];
  rpc.mockClear();
  maybeSingle.mockClear();
  vi.mocked(listTrackerFloorAlerts).mockReset();
  vi.mocked(listTrackerFloorAlerts).mockImplementation(async()=>({ok:true,alerts:alertRows.value}));
});

describe("TrackerFloorAlertLane", () => {
  it('does not resolve a correction while hand/table metadata is unverified',async()=>{
    locationFault.value=true;alertRows.value=[{...baseAlert,status:'in_progress'}];
    render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1"/></MemoryRouter>);
    expect(await screen.findByText('Không xác minh được bàn/hand — hãy làm mới')).toBeVisible();
    expect(screen.getByRole('button',{name:'Đã xử lý'})).toBeDisabled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('keeps resolve confirmation in the app and does not write when cancelled',async()=>{
    alertRows.value=[{...baseAlert,status:'in_progress'}];
    const native=vi.spyOn(window,'confirm').mockReturnValue(false);
    render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1"/></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:'Đã xử lý'}));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Thao tác này mở lại Voice');
    expect(native).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Giữ cảnh báo'}));
    expect(screen.queryByRole('alertdialog')).toBeNull();expect(rpc).not.toHaveBeenCalled();
  });
  it('requires explicit app confirmation before resolving the exact alert version',async()=>{
    alertRows.value=[{...baseAlert,status:'in_progress'}];
    vi.spyOn(window,'confirm').mockReturnValue(false);
    render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1"/></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:'Đã xử lý'}));
    expect(await screen.findByRole('alertdialog')).toBeVisible();expect(rpc).not.toHaveBeenCalled();
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Xác nhận đã kiểm tra'}));});
    expect(rpc).toHaveBeenCalledWith('transition_tracker_floor_alert',expect.objectContaining({
      p_alert_id:'alert-1',p_expected_version:1,p_transition:'resolve',p_note:null,
    }));
  });
  it('does not resolve a version that changed while confirmation was open',async()=>{
    alertRows.value=[{...baseAlert,status:'in_progress'}];
    render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1"/></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:'Đã xử lý'}));
    await screen.findByRole('alertdialog');
    alertRows.value=[{...baseAlert,status:'in_progress',version:2}];
    const notify=channel.on.mock.calls.at(-1)![2] as ()=>void;
    await act(async()=>{notify();});
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Xác nhận đã kiểm tra'}));});
    expect(rpc).not.toHaveBeenCalled();expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  it('drops confirmation after tournament scope changes without writing the old alert',async()=>{
    alertRows.value=[{...baseAlert,status:'in_progress'}];
    const view=render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1"/></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:'Đã xử lý'}));
    await screen.findByRole('alertdialog');
    alertRows.value=[];
    view.rerender(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-2"/></MemoryRouter>);
    await screen.findByText('Không có cảnh báo bàn đang mở');
    expect(screen.queryByRole('alertdialog')).toBeNull();expect(rpc).not.toHaveBeenCalled();
  });
  it('offers same-intent recovery after a lost transition response and remount',async()=>{
    rpc.mockResolvedValueOnce({data:null,error:{message:'response lost'}} as never);
    const view=render(<MemoryRouter><TrackerFloorAlertLane actorId="test-actor" tournamentId="tournament-1"/></MemoryRouter>);
    const acknowledge=await screen.findByRole('button',{name:'Đã nhận'});
    await act(async()=>{fireEvent.click(acknowledge);});
    expect(rpc).toHaveBeenCalledTimes(1);
    const original=rpc.mock.calls[0]![1];
    view.unmount();
    render(<MemoryRouter><TrackerFloorAlertLane actorId="test-actor" tournamentId="tournament-1"/></MemoryRouter>);
    const recover=await screen.findByRole('button',{name:'Kiểm tra lại yêu cầu cũ'});
    await act(async()=>{fireEvent.click(recover);});
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]![1]).toEqual(original);
  });
  it('ends an initial hung read with an explicit error and permits refresh',async()=>{
    vi.useFakeTimers();
    vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');
    let finish!:(value:Awaited<ReturnType<typeof listTrackerFloorAlerts>>)=>void;
    vi.mocked(listTrackerFloorAlerts).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1"/></MemoryRouter>);
    await act(async()=>{await vi.advanceTimersByTimeAsync(10_001);});
    expect(screen.queryByText('Đang tải cảnh báo')).toBeNull();
    expect(screen.getByText(/Không tải được cảnh báo/)).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Làm mới'})).toBeEnabled();
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Làm mới'}));});
    expect(screen.getByText('Sai action')).toBeInTheDocument();
    await act(async()=>{finish({ok:true,alerts:[{...baseAlert,title:'Late timed-out snapshot'}] as never});});
    expect(screen.queryByText('Late timed-out snapshot')).toBeNull();
    expect(listTrackerFloorAlerts).toHaveBeenCalledTimes(2);
  });
  it('coalesces realtime bursts and discards the invalidated in-flight snapshot',async()=>{
    render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1"/></MemoryRouter>);
    await screen.findByText('Sai action');
    let finish!:(value:Awaited<ReturnType<typeof listTrackerFloorAlerts>>)=>void;
    vi.mocked(listTrackerFloorAlerts).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const notify=channel.on.mock.calls.at(-1)![2] as ()=>void;
    act(()=>{notify();for(let n=0;n<20;n++)notify();});
    expect(listTrackerFloorAlerts).toHaveBeenCalledTimes(2);
    vi.mocked(listTrackerFloorAlerts).mockResolvedValueOnce({ok:true,alerts:[{...baseAlert,title:'Current server snapshot',status:'acknowledged',version:2}] as never});
    await act(async()=>{finish({ok:true,alerts:[{...baseAlert,title:'Obsolete snapshot'}] as never});});
    expect(listTrackerFloorAlerts).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Current server snapshot')).toBeInTheDocument();
    expect(screen.queryByText('Obsolete snapshot')).toBeNull();
  });
  it('does not hide a failed read behind a queued realtime refresh',async()=>{
    let finish!:(value:Awaited<ReturnType<typeof listTrackerFloorAlerts>>)=>void;
    vi.mocked(listTrackerFloorAlerts)
      .mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}))
      .mockImplementationOnce(()=>new Promise(()=>{}));
    render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1"/></MemoryRouter>);
    const notify=channel.on.mock.calls.at(-1)![2] as ()=>void;
    act(()=>notify());
    await act(async()=>finish({ok:false,error:'TEST failed current read'}));
    expect(listTrackerFloorAlerts).toHaveBeenCalledTimes(2);
    expect(screen.getByText('TEST failed current read')).toBeInTheDocument();
    expect(screen.queryByText('Đang tải cảnh báo')).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('blocks retained rows after a queued failed refresh until the next verified read',async()=>{
    render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1"/></MemoryRouter>);
    await screen.findByText('Sai action');
    let fail!:(value:Awaited<ReturnType<typeof listTrackerFloorAlerts>>)=>void;
    let recover!:(value:Awaited<ReturnType<typeof listTrackerFloorAlerts>>)=>void;
    vi.mocked(listTrackerFloorAlerts)
      .mockImplementationOnce(()=>new Promise(resolve=>{fail=resolve;}))
      .mockImplementationOnce(()=>new Promise(resolve=>{recover=resolve;}));
    const notify=channel.on.mock.calls.at(-1)![2] as ()=>void;
    act(()=>{notify();notify();});
    await act(async()=>fail({ok:false,error:'TEST refresh not verified'}));
    expect(screen.getByText('TEST refresh not verified')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Đã nhận'})).toBeDisabled();
    await act(async()=>recover({ok:true,alerts:[baseAlert]}));
    expect(screen.queryByText('TEST refresh not verified')).toBeNull();
    expect(screen.getByRole('button',{name:'Đã nhận'})).toBeEnabled();
    expect(listTrackerFloorAlerts).toHaveBeenCalledTimes(3);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('keeps failed-refresh rows read-only until a successful current read',async()=>{
    render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1"/></MemoryRouter>);
    await screen.findByText('Sai action');
    vi.mocked(listTrackerFloorAlerts).mockResolvedValueOnce({ok:false,error:'TEST backend unavailable'});
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Làm mới'}));});
    expect(screen.getByRole('button',{name:'Đã nhận'})).toBeDisabled();
    let finish!:(value:Awaited<ReturnType<typeof listTrackerFloorAlerts>>)=>void;
    vi.mocked(listTrackerFloorAlerts).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    fireEvent.click(screen.getByRole('button',{name:'Làm mới'}));
    expect(screen.getByRole('button',{name:'Đã nhận'})).toBeDisabled();
    await act(async()=>{finish({ok:true,alerts:[baseAlert] as never});});
    expect(screen.getByRole('button',{name:'Đã nhận'})).toBeEnabled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('passes the owning shell actor to history and retires review on actor change',async()=>{
    const view=render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1" actorId="ops-actor-a"/></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:'Xem toàn bộ action'}));
    expect(screen.getByText('shell actor:ops-actor-a')).toBeInTheDocument();
    view.rerender(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1" actorId="ops-actor-b"/></MemoryRouter>);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(await screen.findByRole('button',{name:'Xem toàn bộ action'}));
    expect(screen.getByText('shell actor:ops-actor-b')).toBeInTheDocument();
  });
  it('ignores a retired scope transition completion without starting another read',async()=>{
    const view=render(<MemoryRouter><TrackerFloorAlertLane key="actor-session-a" tournamentId="tournament-1"/></MemoryRouter>);
    let finish!:(value:{data:{ok:boolean};error:null})=>void;
    rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    fireEvent.click(await screen.findByRole('button',{name:'Đã nhận'}));
    vi.mocked(listTrackerFloorAlerts).mockResolvedValueOnce({ok:true,alerts:[]});
    view.rerender(<MemoryRouter><TrackerFloorAlertLane key="actor-session-b" tournamentId="tournament-1"/></MemoryRouter>);
    await screen.findByText('Không có cảnh báo bàn đang mở');
    const readCount=vi.mocked(listTrackerFloorAlerts).mock.calls.length;
    await act(async()=>finish({data:{ok:true},error:null}));
    expect(vi.mocked(listTrackerFloorAlerts)).toHaveBeenCalledTimes(readCount);
    expect(screen.queryByText('Sai action')).toBeNull();
  });
  it('clears the prior tour alert and open review while the next tour is loading',async()=>{
    const view=render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1"/></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:'Xem toàn bộ action'}));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    vi.mocked(listTrackerFloorAlerts).mockImplementationOnce(()=>new Promise(()=>{}));
    view.rerender(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-2"/></MemoryRouter>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Sai action')).toBeNull();
  });
  it('ignores an earlier tour response after a new tour response wins',async()=>{
    let finish!:(value:Awaited<ReturnType<typeof listTrackerFloorAlerts>>)=>void;
    vi.mocked(listTrackerFloorAlerts).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const view=render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1"/></MemoryRouter>);
    vi.mocked(listTrackerFloorAlerts).mockResolvedValueOnce({ok:true,alerts:[]});
    view.rerender(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-2"/></MemoryRouter>);
    await screen.findByText('Không có cảnh báo bàn đang mở');
    await act(async()=>finish({ok:true,alerts:[baseAlert]}));
    expect(screen.queryByText('Sai action')).toBeNull();
    expect(screen.getByText('Không có cảnh báo bàn đang mở')).toBeInTheDocument();
  });
  it("opens the exact hand action history from a Floor alert deep link", async () => {
    render(
      <MemoryRouter initialEntries={["/ops/floor/tournaments/tournament-1/tables?club=club-1&alert=alert-1"]}>
        <TrackerFloorAlertLane tournamentId="tournament-1" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("hand-1 workspace sửa hand · action-original")).toBeVisible();
    expect(screen.getByText(/Bàn 5 · Hand #12/)).toBeVisible();
    expect(screen.getByText(/Action gốc #4/)).toBeVisible();
  });

  it("only dismisses a voided hand after a fresh server check", async () => {
    voidState.value = true;
    render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1" /></MemoryRouter>);
    const dismiss=await screen.findByRole("button", { name: /Hand đã void: đóng cảnh báo/i });
    await act(async()=>{fireEvent.click(dismiss);});
    expect(await screen.findByRole('alertdialog')).toBeVisible();
    expect(maybeSingle).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Xác nhận đã kiểm tra'}));});
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith("transition_tracker_floor_alert", expect.objectContaining({
      p_alert_id: "alert-1", p_expected_version: 1, p_transition: "dismiss",
    })));
    expect(maybeSingle).toHaveBeenCalledOnce();
  });

  it("labels a whole-hand alert without Dealer or action references", async () => {
    alertRows.value = [{
      ...baseAlert,
      id: "alert-2",
      hand_id: "hand-2",
      dealer_id: null,
      assignment_id: null,
      dealer_name: null,
      priority: "high",
      title: "Báo sai hand",
      source_action_id: null,
      source_action_snapshot: null,
      created_at: "2026-09-17T00:01:00Z",
    }];
    render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1" /></MemoryRouter>);

    expect(await screen.findByText(/Floor \/ Owner/)).toBeVisible();
    expect(screen.getByText(/Action sai chưa được chỉ rõ/)).toBeVisible();
  });

  it("does not clear the alert when the server no longer confirms void", async () => {
    voidState.value = true;
    handRow.value.is_voided = false;
    render(<MemoryRouter><TrackerFloorAlertLane tournamentId="tournament-1" /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Hand đã void: đóng cảnh báo/i }));
    expect(await screen.findByRole('alertdialog')).toBeVisible();
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Xác nhận đã kiểm tra'}));});
    await vi.waitFor(() => expect(maybeSingle).toHaveBeenCalledOnce());
    expect(rpc).not.toHaveBeenCalled();
  });
});
