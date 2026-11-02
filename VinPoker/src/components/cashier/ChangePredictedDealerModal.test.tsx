import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChangePredictedDealerModal from "./ChangePredictedDealerModal";
import type { DealerAttendance } from "@/hooks/useDealerSwing";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
const context = { actorId: "actor", clubId: "club", sessionId: "session", assignmentId: "assignment",
  version: 3, swingDueAt: "2026-10-15T20:00:00Z" };
function props() { return { open: true, onOpenChange: vi.fn(), tableName: "TEST table", context, slot0: null,
  currentTableAttendanceId: "serving", dealers: [{ id: "candidate", status: "checked_in", current_state: "available",
    last_released_at: null, dealers: { full_name: "TEST candidate" } } as DealerAttendance],
  assignedTableNameByAttendanceId: {}, restMinutes: 15, onChanged: vi.fn() }; }
beforeEach(() => { rpc.mockReset(); sessionStorage.clear(); });
afterEach(()=>{cleanup();vi.useRealTimers();});
describe("exact next-dealer intent modal", () => {
  it('bounds a hung write and receipt lookup without discarding or reissuing the original intent',async()=>{
    vi.useFakeTimers();const p=props();rpc.mockReturnValue(new Promise(()=>{}));
    render(<ChangePredictedDealerModal {...p}/>);
    fireEvent.click(screen.getByRole('button',{name:/TEST candidate/}));
    fireEvent.click(screen.getByRole('button',{name:'Đổi & CHỐT'}));
    const original=rpc.mock.calls[0][1],stored=sessionStorage.getItem(sessionStorage.key(0)!);
    expect(screen.getByRole('button',{name:'Kiểm tra biên nhận'})).toBeDisabled();
    await act(async()=>vi.advanceTimersByTimeAsync(20001));
    expect(screen.getByRole('button',{name:'Kiểm tra biên nhận'})).toBeEnabled();
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(stored);expect(rpc).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'Kiểm tra biên nhận'}));
    await act(async()=>vi.advanceTimersByTimeAsync(10001));
    expect(screen.getByRole('button',{name:'Kiểm tra biên nhận'})).toBeEnabled();
    expect(rpc.mock.calls[1]).toEqual(['get_dealer_next_intent_receipt_v1',original]);
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(stored);expect(p.onChanged).not.toHaveBeenCalled();
  });
  it('does not acknowledge a late writer response after its deadline; only exact receipt reconciliation resolves it',async()=>{
    vi.useFakeTimers();const p=props();let finish!:(v:unknown)=>void;
    rpc.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));render(<ChangePredictedDealerModal {...p}/>);
    fireEvent.click(screen.getByRole('button',{name:/TEST candidate/}));fireEvent.click(screen.getByRole('button',{name:'Đổi & CHỐT'}));
    const args=rpc.mock.calls[0][1];await act(async()=>vi.advanceTimersByTimeAsync(20001));
    const terminal={data:{outcome:'changed',table_session_id:args.p_table_session_id,assignment_id:args.p_assignment_id,request_id:args.p_request_id},error:null};
    await act(async()=>finish(terminal));expect(p.onChanged).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(1);
    rpc.mockResolvedValueOnce(terminal);fireEvent.click(screen.getByRole('button',{name:'Kiểm tra biên nhận'}));
    await act(async()=>{});expect(p.onChanged).toHaveBeenCalledOnce();expect(sessionStorage.length).toBe(0);
    expect(rpc.mock.calls[1]).toEqual(['get_dealer_next_intent_receipt_v1',args]);
  });
  it("receipt read denied after lost response does not discard unresolved mutation", async () => {
    const p = props(); rpc.mockResolvedValueOnce({ data: null, error: { message: "lost response" } });
    render(<ChangePredictedDealerModal {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /TEST candidate/ }));
    fireEvent.click(screen.getByRole("button", { name: "Đổi & CHỐT" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Kiểm tra biên nhận" })).toBeEnabled());
    const stored = sessionStorage.getItem(sessionStorage.key(0)!);
    rpc.mockResolvedValueOnce({ data: { outcome: "forbidden" }, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra biên nhận" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(stored);
    expect(p.onChanged).not.toHaveBeenCalled();
  });
  it("late committed response after unmount cannot notify a different view", async () => {
    const p = props(); let complete!: (value: unknown) => void;
    rpc.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const view = render(<ChangePredictedDealerModal {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /TEST candidate/ }));
    fireEvent.click(screen.getByRole("button", { name: "Đổi & CHỐT" }));
    const args = rpc.mock.calls[0][1]; view.unmount();
    complete({ data: { outcome: "changed", table_session_id: args.p_table_session_id,
      assignment_id: args.p_assignment_id, request_id: args.p_request_id }, error: null });
    await Promise.resolve();
    expect(p.onChanged).not.toHaveBeenCalled();
    expect(p.onOpenChange).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(1);
  });
  it("does not acknowledge a success-shaped receipt for another session", async () => {
    const p = props(); rpc.mockResolvedValue({ data: { outcome: "changed", table_session_id: "old-session" }, error: null });
    render(<ChangePredictedDealerModal {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /TEST candidate/ }));
    fireEvent.click(screen.getByRole("button", { name: "Đổi & CHỐT" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Kiểm tra biên nhận" })).toBeEnabled());
    expect(p.onChanged).not.toHaveBeenCalled();
    expect(p.onOpenChange).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(1);
  });
  it("uses exact-session operator intent without a planner slot", async () => {
    const p = props(); rpc.mockImplementation(async (_name, args) => ({ data: { outcome: "changed",
      table_session_id: args.p_table_session_id, assignment_id: args.p_assignment_id, request_id: args.p_request_id }, error: null }));
    render(<ChangePredictedDealerModal {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /TEST candidate/ }));
    fireEvent.click(screen.getByRole("button", { name: "Đổi & CHỐT" }));
    await waitFor(() => expect(p.onChanged).toHaveBeenCalledOnce());
    expect(rpc.mock.calls[0][0]).toBe("operator_plan_next_dealer_v1");
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_table_session_id: "session", p_assignment_id: "assignment",
      p_expected_assignment_version: 3, p_next_attendance_id: "candidate" });
    expect(sessionStorage.length).toBe(0);
  });
  it("lost response and reopen read receipt with original version, never reissue automatically", async () => {
    const p = props(); rpc.mockResolvedValueOnce({ data: null, error: { message: "lost response" } });
    const view = render(<ChangePredictedDealerModal {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /TEST candidate/ }));
    fireEvent.click(screen.getByRole("button", { name: "Đổi & CHỐT" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Kiểm tra biên nhận" })).toBeEnabled());
    const original = rpc.mock.calls[0][1]; view.unmount();
    rpc.mockResolvedValueOnce({ data: { outcome: "not_recorded" }, error: null });
    render(<ChangePredictedDealerModal {...p} context={{ ...context, version: 4 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra biên nhận" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Gửi lại đúng yêu cầu" })).toBeEnabled());
    expect(rpc.mock.calls[1]).toEqual(["get_dealer_next_intent_receipt_v1", original]);
    expect(p.onChanged).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: { outcome: "race_lost" }, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Gửi lại đúng yêu cầu" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(3));
    expect(rpc.mock.calls[2]).toEqual(["operator_plan_next_dealer_v1", original]);
  });
});
