import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRpc = vi.hoisted(() => vi.fn());
const handRevision = vi.hoisted(() => ({ value: 7, mode:'ready', finish:null as ((value:unknown)=>void)|null }));
const auth = vi.hoisted(() => ({ user: { id: 'actor-a' } as {id:string}|null, session: null as {access_token:string}|null }));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>auth}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mockRpc,
  from: vi.fn(() => {
    const query = {
      eq: () => query,
      maybeSingle: () => handRevision.mode==='hang'?new Promise(resolve=>{handRevision.finish=resolve;}):Promise.resolve(
        handRevision.mode==='error'?{data:null,error:{message:'503 read TEST'}}:{ data: { id: "hand", source_revision: handRevision.value }, error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
    };
    return { select: () => query };
  }),
} }));
import { supabase } from "@/integrations/supabase/client";
import { DealerFloorAlertControls } from "./DealerFloorAlertControls";

const props = { tournamentId: "tournament", tournamentTableId: "table", handId: "hand", enabled: true };

beforeEach(() => {
  mockRpc.mockReset();
  handRevision.value = 7;
  handRevision.mode='ready';handRevision.finish=null;
  auth.user={id:'actor-a'};auth.session=null;
  window.sessionStorage.clear();
});
afterEach(()=>{cleanup();vi.useRealTimers();});

describe("Dealer Floor operational alert", () => {
  it.each(['hang','error'])('explains an unverified hand revision after %s without a mutation',async(mode)=>{
    if(mode==='hang')vi.useFakeTimers();
    handRevision.mode=mode;
    await act(async()=>{render(<DealerFloorAlertControls {...props}/>);});
    if(mode==='hang')await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
    expect(screen.getByRole('status')).toHaveTextContent('Chưa xác minh được phiên bản hand');
    expect(screen.getByRole('button',{name:'Báo sai hand'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Gọi Floor'})).toBeEnabled();
    expect(mockRpc).not.toHaveBeenCalled();
    if(mode==='hang'){
      await act(async()=>handRevision.finish?.({data:{id:'hand',source_revision:7},error:null}));
      expect(screen.getByRole('button',{name:'Báo sai hand'})).toBeDisabled();
      expect(screen.getByRole('status')).toHaveTextContent('Chưa xác minh được phiên bản hand');
    }
  });
  it.each([null,{}, {ok:true}, {ok:true,alert_id:'different-alert',request_id:'different-request'},
    {ok:false,error:'request_key_conflict'}])('keeps the original intent for an unconfirmed receipt %j',async(data)=>{
    mockRpc.mockResolvedValueOnce({data,error:null});
    render(<DealerFloorAlertControls {...props} handId={null}/>);
    fireEvent.click(screen.getByRole('button',{name:'Gọi Floor'}));
    await screen.findByText(/Chưa biết máy chủ đã nhận chưa/);
    const original=mockRpc.mock.calls[0][1];
    expect(window.sessionStorage.getItem('dealer-floor-alert:actor-a:tournament:table')).toContain(original.p_request_id);
    expect(screen.getByRole('button',{name:'Gọi Floor'})).toBeDisabled();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
  it.each(['Gọi Floor','Báo sai hand'])('bounds a hung %s report and recovers using the same request without automatic retry',async(button)=>{
    vi.useFakeTimers();let finish!:(value:unknown)=>void;
    mockRpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    await act(async()=>{render(<DealerFloorAlertControls {...props} handId={button==='Gọi Floor'?null:'hand'}/>);});
    fireEvent.click(screen.getByRole('button',{name:button}));
    const original=mockRpc.mock.calls[0][1];
    await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});
    expect(screen.getByRole('status')).toHaveTextContent('Chưa biết máy chủ đã nhận chưa');
    expect(screen.getByRole('button',{name:'Gọi Floor'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'Kiểm tra lại yêu cầu đang chờ'})).toBeEnabled();
    expect(mockRpc).toHaveBeenCalledTimes(1);
    await act(async()=>finish({data:{ok:true,alert_id:'late-alert',request_id:original.p_request_id},error:null}));
    expect(screen.queryByText(/Đã gửi Floor/)).toBeNull();
    expect(window.sessionStorage.getItem('dealer-floor-alert:actor-a:tournament:table')).toContain(original.p_request_id);
    mockRpc.mockImplementationOnce(async()=>({data:{ok:true,alert_id:'late-alert',request_id:original.p_request_id},error:null}));
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Kiểm tra lại yêu cầu đang chờ'})));
    expect(mockRpc.mock.calls[1][1]).toEqual(original);
    expect(screen.getByRole('status')).toHaveTextContent('Đã gửi Floor');
    expect(window.sessionStorage.length).toBe(0);
  });
  it.each(['legacy','wrong-scope'])('preserves an unverified %s intent and blocks new keys',async(kind)=>{
    const key=kind==='legacy'?'dealer-floor-alert:tournament:table':'dealer-floor-alert:actor-a:tournament:table';
    const raw=JSON.stringify({actorId:kind==='legacy'?undefined:'actor-a',requestId:'saved-request',
      tournamentId:kind==='legacy'?'tournament':'foreign-tour',tournamentTableId:'table',handId:'hand',
      sourceRevision:7,kind:'wrong_action',message:''});
    window.sessionStorage.setItem(key,raw);
    render(<DealerFloorAlertControls {...props}/>);
    expect(screen.getByRole('button',{name:'Gọi Floor'})).toBeDisabled();
    expect(screen.getByText(/Có yêu cầu cũ chưa xác minh được tài khoản hoặc phạm vi/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Gọi Floor'}));
    expect(mockRpc).not.toHaveBeenCalled();expect(window.sessionStorage.getItem(key)).toBe(raw);
  });

  it('ignores a response from a previous session incarnation without discarding its request',async()=>{
    let resolve!:(result:unknown)=>void;
    mockRpc.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
    const view=render(<DealerFloorAlertControls {...props}/>);
    fireEvent.click(screen.getByRole('button',{name:'Gọi Floor'}));
    const request=mockRpc.mock.calls[0][1] as {p_request_id:string};
    auth.session={access_token:'SYNTHETIC_SESSION_NOT_FOR_STORAGE_KEYS'};
    await act(async()=>view.rerender(<DealerFloorAlertControls {...props}/>));
    await act(async()=>resolve({data:{ok:true,alert_id:'old-session-alert',request_id:request.p_request_id},error:null}));
    expect(screen.queryByText(/Đã gửi Floor/)).toBeNull();
    expect(screen.getByRole('button',{name:'Kiểm tra lại yêu cầu đang chờ'})).toBeEnabled();
    const key=window.sessionStorage.key(0)!;
    expect(window.sessionStorage.getItem(key)).toContain(request.p_request_id);
    expect(key+window.sessionStorage.getItem(key)).not.toContain('SYNTHETIC_SESSION_NOT_FOR_STORAGE_KEYS');
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('does not expose or resend actor A pending intent after switching to actor B on the same table',async()=>{
    mockRpc.mockRejectedValueOnce(new Error('response lost'));
    const view=render(<DealerFloorAlertControls {...props}/>);
    fireEvent.click(screen.getByRole('button',{name:'Gọi Floor'}));
    await screen.findByText(/Chưa biết máy chủ đã nhận chưa/);
    const original=mockRpc.mock.calls[0][1] as {p_request_id:string};
    auth.user={id:'actor-b'};
    await act(async()=>view.rerender(<DealerFloorAlertControls {...props}/>));
    expect(screen.queryByText(`Mã yêu cầu: ${original.p_request_id}`)).toBeNull();
    expect(screen.getByRole('button',{name:'Gọi Floor'})).toBeEnabled();
    auth.user={id:'actor-a'};
    await act(async()=>view.rerender(<DealerFloorAlertControls {...props}/>));
    expect(screen.getByText(`Mã yêu cầu: ${original.p_request_id}`)).toBeTruthy();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('disables alerts while signed out instead of sending under an unverified actor',async()=>{
    auth.user=null;render(<DealerFloorAlertControls {...props}/>);
    fireEvent.click(screen.getByRole('button',{name:'Gọi Floor'}));
    expect(mockRpc).not.toHaveBeenCalled();
    expect(screen.getByRole('button',{name:'Gọi Floor'})).toBeDisabled();
  });

  it("keeps an unknown request with its original table instead of blocking another table",async()=>{
    mockRpc.mockRejectedValueOnce(new Error('response lost'));
    const view=render(<DealerFloorAlertControls {...props}/>);
    fireEvent.click(screen.getByRole('button',{name:'Gọi Floor'}));
    await screen.findByText(/Chưa biết máy chủ đã nhận chưa/);
    const request=mockRpc.mock.calls[0][1] as {p_request_id:string};
    await act(async()=>view.rerender(<DealerFloorAlertControls {...props} tournamentId="other-tour" tournamentTableId="other-table"/>));
    expect(screen.getByRole('button',{name:'Gọi Floor'})).toBeEnabled();
    expect(screen.queryByRole('button',{name:'Kiểm tra lại yêu cầu đang chờ'})).toBeNull();
    await act(async()=>view.rerender(<DealerFloorAlertControls {...props}/>));
    expect(screen.getByText(`Mã yêu cầu: ${request.p_request_id}`)).toBeTruthy();
    expect(screen.getByRole('button',{name:'Kiểm tra lại yêu cầu đang chờ'})).toBeEnabled();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("ignores a late success from the previous table and retains its unresolved key",async()=>{
    let resolve!:(result:unknown)=>void;
    mockRpc.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
    const view=render(<DealerFloorAlertControls {...props}/>);
    fireEvent.click(screen.getByRole('button',{name:'Gọi Floor'}));
    const request=mockRpc.mock.calls[0][1] as {p_request_id:string};
    view.rerender(<DealerFloorAlertControls {...props} tournamentId="other-tour" tournamentTableId="other-table"/>);
    await act(async()=>resolve({data:{ok:true,alert_id:'old-alert',request_id:request.p_request_id},error:null}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Gọi Floor'})).toBeEnabled());
    expect(screen.queryByText(/Đã gửi Floor/)).toBeNull();
    expect(window.sessionStorage.getItem('dealer-floor-alert:actor-a:tournament:table')).toContain(request.p_request_id);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("does not discard an unresolved whole-hand intent when the current hand changes",async()=>{
    mockRpc.mockRejectedValueOnce(new Error('response lost'));
    const view=render(<DealerFloorAlertControls {...props}/>);
    await waitFor(()=>expect(screen.getByRole('button',{name:'Báo sai hand'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'Báo sai hand'}));
    await screen.findByText(/Chưa biết máy chủ đã nhận chưa/);
    const original=mockRpc.mock.calls[0][1] as {p_request_id:string};
    await act(async()=>view.rerender(<DealerFloorAlertControls {...props} handId="next-hand"/>));
    mockRpc.mockImplementationOnce(async(_name,args:{p_request_id:string})=>({data:{ok:true,alert_id:'alert-original',request_id:args.p_request_id},error:null}));
    fireEvent.click(screen.getByRole('button',{name:'Kiểm tra lại yêu cầu đang chờ'}));
    await screen.findByText(/Đã gửi Floor/);
    expect(mockRpc.mock.calls[1][1]).toEqual(original);
    expect(mockRpc.mock.calls[1][1].p_hand_id).toBe('hand');
  });

  it("does not contact the server before the capability is enabled", () => {
    render(<DealerFloorAlertControls {...props} enabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Gọi Floor" }));
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("sends from manual mode without Voice and requires a matching receipt", async () => {
    mockRpc.mockImplementation((async (_name, args: { p_request_id: string }) => ({
      data: { ok: true, alert_id: "alert-1", request_id: args.p_request_id }, error: null,
    })) as never);
    render(<DealerFloorAlertControls {...props} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Gọi Floor" }));
    await screen.findByText(/Đã gửi Floor/);
    expect(supabase.rpc).toHaveBeenCalledWith("report_tracker_floor_operational_alert_v2", expect.objectContaining({
      p_kind: "call_floor", p_hand_id: "hand", p_action_id: null, p_message: "",
    }));
    expect(window.sessionStorage.length).toBe(0);
  });

  it("supports a table-level request before any hand starts", async () => {
    mockRpc.mockImplementation((async (_name, args: { p_request_id: string }) => ({
      data: { ok: true, alert_id: "alert-1", request_id: args.p_request_id }, error: null,
    })) as never);
    render(<DealerFloorAlertControls {...props} handId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Gọi Floor" }));
    await screen.findByText(/Đã gửi Floor/);
    expect(supabase.rpc).toHaveBeenCalledWith("report_tracker_floor_operational_alert_v2", expect.objectContaining({
      p_hand_id: null, p_action_id: null,
    }));
  });

  it("reports the whole hand without forcing the operator to select an action", async () => {
    mockRpc.mockImplementation((async (_name, args: { p_request_id: string }) => ({
      data: { ok: true, alert_id: "alert-1", request_id: args.p_request_id }, error: null,
    })) as never);
    render(<DealerFloorAlertControls {...props} />);
    const reportButton = screen.getByRole("button", { name: "Báo sai hand" });
    await waitFor(() => expect(reportButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(reportButton);
    await screen.findByText(/Đã gửi Floor/);
    expect(supabase.rpc).toHaveBeenCalledWith("report_tracker_wrong_hand_v1", expect.objectContaining({
      p_hand_id: "hand", p_expected_source_revision: 7,
    }));
  });

  it("requires an active hand before reporting a wrong hand", async () => {
    mockRpc.mockImplementation((async (_name, args: { p_request_id: string }) => ({
      data: { ok: true, alert_id: "alert-1", request_id: args.p_request_id, correction_pending: true }, error: null,
    })) as never);
    render(<DealerFloorAlertControls {...props} handId={null} />);
    expect(screen.getByRole("button", { name: "Báo sai hand" }).hasAttribute("disabled")).toBe(true);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("reloads the source revision and asks for review after a stale report", async () => {
    mockRpc
      .mockImplementationOnce(async () => {
        handRevision.value = 8;
        return { data: { ok: false, error: "stale_source_revision" }, error: null } as never;
      })
      .mockImplementationOnce((async (_name, args: { p_request_id: string }) => ({
        data: { ok: true, alert_id: "alert-2", request_id: args.p_request_id }, error: null,
      })) as never);
    render(<DealerFloorAlertControls {...props} />);
    const reportButton = screen.getByRole("button", { name: "Báo sai hand" });
    await waitFor(() => expect(reportButton.hasAttribute("disabled")).toBe(false));

    fireEvent.click(reportButton);

    await screen.findByText(/Hand đã thay đổi trên máy chủ.*Đã tải phiên bản mới/i);
    expect(window.sessionStorage.length).toBe(0);
    await waitFor(() => expect(reportButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(reportButton);
    await screen.findByText(/Đã gửi Floor/);
    expect(mockRpc.mock.calls[1][1]).toEqual(expect.objectContaining({
      p_expected_source_revision: 8,
    }));
  });

  it("does not send when the request key cannot be retained", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      await act(async()=>{render(<DealerFloorAlertControls {...props} />);});
      fireEvent.click(screen.getByRole("button", { name: "Gọi Floor" }));
      expect(screen.getByText(/Chưa gửi yêu cầu: không lưu được mã/)).toBeTruthy();
      expect(supabase.rpc).not.toHaveBeenCalled();
    } finally {
      storage.mockRestore();
    }
  });

  it("keeps the same request after an uncertain response and reload", async () => {
    mockRpc.mockRejectedValueOnce(new Error("network lost"));
    const { unmount } = render(<DealerFloorAlertControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Vấn đề hiển thị" }));
    await screen.findByText(/Chưa biết máy chủ đã nhận chưa/);
    const firstCall = mockRpc.mock.calls[0][1] as { p_request_id: string };
    expect(window.sessionStorage.length).toBe(1);
    unmount();

    mockRpc.mockImplementation((async (_name, args: { p_request_id: string }) => ({
      data: { ok: true, alert_id: "alert-1", request_id: args.p_request_id }, error: null,
    })) as never);
    render(<DealerFloorAlertControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra lại yêu cầu đang chờ" }));
    await waitFor(() => expect(screen.getByText(/Đã gửi Floor/)).toBeTruthy());
    const retry = mockRpc.mock.calls[1][1] as { p_request_id: string; p_kind: string };
    expect(retry.p_request_id).toBe(firstCall.p_request_id);
    expect(retry.p_kind).toBe("display_issue");
    expect(window.sessionStorage.length).toBe(0);
  });

  it("retries a whole-hand report with the same request and revision after response loss", async () => {
    mockRpc.mockRejectedValueOnce(new Error("response lost"));
    const { unmount } = render(<DealerFloorAlertControls {...props} />);
    const reportButton = screen.getByRole("button", { name: "Báo sai hand" });
    await waitFor(() => expect(reportButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(reportButton);
    await screen.findByText(/Chưa biết máy chủ đã nhận chưa/);
    const first = mockRpc.mock.calls[0][1] as {
      p_request_id: string;
      p_expected_source_revision: number;
    };
    unmount();

    mockRpc.mockImplementationOnce((async (_name, args: { p_request_id: string }) => ({
      data: { ok: true, duplicate: true, alert_id: "alert-1", request_id: args.p_request_id }, error: null,
    })) as never);
    render(<DealerFloorAlertControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra lại yêu cầu đang chờ" }));
    await screen.findByText(/Đã gửi Floor/);
    const retry = mockRpc.mock.calls[1][1] as {
      p_request_id: string;
      p_expected_source_revision: number;
    };
    expect(retry).toEqual(expect.objectContaining({
      p_request_id: first.p_request_id,
      p_expected_source_revision: first.p_expected_source_revision,
    }));
  });

  it.each(["tracker_lock_not_owned", "actor_not_allowed"])("retains an uncertain request after %s before retry", async (reason) => {
    mockRpc.mockRejectedValueOnce(new Error("network lost"));
    render(<DealerFloorAlertControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Gọi Floor" }));
    await screen.findByText(/Chưa biết máy chủ đã nhận chưa/);
    const firstCall = mockRpc.mock.calls[0][1] as { p_request_id: string };

    mockRpc.mockResolvedValueOnce({
      data: { ok: false, error: reason }, error: null,
    } as never);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra lại yêu cầu đang chờ" }));
    await screen.findByText(/Không còn quyền xác minh yêu cầu cũ/);
    expect(screen.getByText(`Mã yêu cầu: ${firstCall.p_request_id}`)).toBeTruthy();
    expect(window.sessionStorage.length).toBe(1);
    expect(screen.getByRole("button", { name: "Gọi Floor" }).hasAttribute("disabled")).toBe(true);
  });
});
