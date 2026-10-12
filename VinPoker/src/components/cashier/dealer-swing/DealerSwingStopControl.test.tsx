import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ actorId: "actor-a", rpc: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: state.actorId } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc } }));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
import { DealerSwingStopControl } from "./DealerSwingStopControl";
function response(enabled = false) {
  const args = state.rpc.mock.calls.at(-1)![1];
  return { error: null, data: { ok: true, receipt: { actor_id: args.p_expected_actor_id,
    club_id: args.p_club_id, request_id: args.p_request_id, auto_swing_enabled: false, outcome: "applied" },
    current_state: { club_id: args.p_club_id, auto_swing_enabled: enabled } } };
}

describe("shared emergency Swing OFF", () => {
  beforeEach(() => { sessionStorage.clear(); state.actorId = "actor-a"; state.rpc.mockReset(); state.success.mockReset(); state.error.mockReset(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it("submits explicit OFF and never toggles on, even after repeated clicks", async () => {
    let finish!: (result: ReturnType<typeof response>) => void;
    state.rpc.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onStopped = vi.fn();
    render(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    fireEvent.click(screen.getByRole("button", { name: "⏹ Dừng Swing" }));
    const confirm = screen.getByRole("button", { name: /^Dừng$/ });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(state.rpc).toHaveBeenCalledOnce();
    expect(state.rpc).toHaveBeenCalledWith("operator_stop_dealer_swing_v1", {
      p_club_id: "club-a", p_expected_actor_id: "actor-a", p_request_id: expect.any(String),
    });
    finish(response());
    await waitFor(() => expect(onStopped).toHaveBeenCalledOnce());
  });
  it("does not acknowledge a denied write", async () => {
    state.rpc.mockResolvedValue({ error: null, data: { ok: false, error: "actor_not_allowed" } });
    const onStopped = vi.fn();
    render(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    fireEvent.click(screen.getByRole("button", { name: "⏹ Dừng Swing" }));
    fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("quyền Dealer Control"));
    expect(onStopped).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Dừng$/ })).toBeInTheDocument();
  });

  it("does not acknowledge a late club A response after A to B to A", async () => {
    let finish!: (result: ReturnType<typeof response>) => void;
    state.rpc.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onStopped = vi.fn();
    const view = render(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    fireEvent.click(screen.getByRole("button", { name: "⏹ Dừng Swing" }));
    fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ }));
    view.rerender(<DealerSwingStopControl clubId="club-b" onStopped={onStopped} />);
    view.rerender(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    await act(async () => { finish(response()); });
    expect(onStopped).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
  });

  it("does not acknowledge a response after unmount", async () => {
    let finish!: (result: ReturnType<typeof response>) => void;
    state.rpc.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onStopped = vi.fn();
    const view = render(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    fireEvent.click(screen.getByRole("button", { name: "⏹ Dừng Swing" }));
    fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ }));
    view.unmount();
    await act(async () => { finish(response()); });
    expect(onStopped).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
  });

  it("closes old confirmation and ignores the old response after actor changes in the same club", async () => {
    let finish!: (result: ReturnType<typeof response>) => void;
    state.rpc.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onStopped = vi.fn();
    const view = render(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    fireEvent.click(screen.getByRole("button", { name: "⏹ Dừng Swing" }));
    fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ }));
    state.actorId = "actor-b";
    view.rerender(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await act(async () => { finish(response()); });
    expect(onStopped).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
  });

  it("retains the same key after lost response and remount, without automatic retry", async () => {
    state.rpc.mockRejectedValueOnce(new Error("TEST response lost"));
    const onStopped = vi.fn();
    const view = render(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    fireEvent.click(screen.getByRole("button", { name: "⏹ Dừng Swing" }));
    fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ }));
    await screen.findByRole("alert");
    const original = state.rpc.mock.calls[0][1];
    expect(state.rpc).toHaveBeenCalledOnce();
    view.unmount();
    state.rpc.mockImplementation(async () => response());
    render(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    fireEvent.click(screen.getByRole("button", { name: "⏹ Dừng Swing" }));
    fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ }));
    await waitFor(() => expect(onStopped).toHaveBeenCalledOnce());
    expect(state.rpc.mock.calls[1][1]).toEqual(original);
    expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!).resolved).toBe(true);
  });

  it("old OFF receipt with current ON requires a new explicit intent", async () => {
    state.rpc.mockImplementation(async () => response(true));
    const onStopped = vi.fn();
    render(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    fireEvent.click(screen.getByRole("button", { name: "⏹ Dừng Swing" }));
    fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("hiện đang ON"));
    const original = state.rpc.mock.calls[0][1].p_request_id;
    expect(onStopped).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
    expect(state.rpc).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(2));
    expect(state.rpc.mock.calls[1][1].p_request_id).not.toBe(original);
  });

  it("rejects mismatched receipt without clearing the unresolved intent", async () => {
    state.rpc.mockImplementation(async () => ({ ...response(), data: { ...response().data,
      receipt: { ...response().data.receipt, actor_id: "actor-other" } } }));
    const onStopped = vi.fn();
    render(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    fireEvent.click(screen.getByRole("button", { name: "⏹ Dừng Swing" }));
    fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("không khớp"));
    expect(sessionStorage.length).toBe(1);
    expect(onStopped).not.toHaveBeenCalled();
  });

  it("does not send when the durable request cannot be stored", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("TEST storage unavailable"); });
    render(<DealerSwingStopControl clubId="club-a" onStopped={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "⏹ Dừng Swing" }));
    fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ }));
    await screen.findByRole("alert");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("does not clear or acknowledge a newer same-scope widget intent", async () => {
    let finish!: (result: ReturnType<typeof response>) => void;
    state.rpc.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const onStopped = vi.fn();
    render(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    fireEvent.click(screen.getByRole("button", { name: "⏹ Dừng Swing" }));
    fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ }));
    const oldResponse = response();
    const key = sessionStorage.key(0)!;
    const newer = { actorId: "actor-a", clubId: "club-a", requestId: crypto.randomUUID(), resolved: true };
    // The sibling has reconciled both the old intent and its next intent.
    sessionStorage.setItem(key, JSON.stringify(newer));
    await act(async () => { finish(oldResponse); });
    expect(screen.getByRole("alert")).toHaveTextContent("mới hơn");
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(newer);
    expect(onStopped).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
  });

  it("bounded wait retains intent and ignores a late response after explicit recovery", async () => {
    vi.useFakeTimers();
    let finish!: (result: ReturnType<typeof response>) => void;
    state.rpc.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const onStopped = vi.fn();
    render(<DealerSwingStopControl clubId="club-a" onStopped={onStopped} />);
    fireEvent.click(screen.getByRole("button", { name: "⏹ Dừng Swing" }));
    fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ }));
    const original = state.rpc.mock.calls[0][1];
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(screen.getByRole("alert")).toHaveTextContent("Chưa xác minh");
    expect(screen.getByRole("button", { name: /^Dừng$/ })).toBeEnabled();
    expect(state.rpc).toHaveBeenCalledOnce();
    state.rpc.mockImplementation(async () => response(true));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ })); });
    expect(state.rpc.mock.calls[1][1]).toEqual(original);
    expect(screen.getByRole("alert")).toHaveTextContent("hiện đang ON");
    await act(async () => { finish(response(false)); });
    expect(onStopped).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("hiện đang ON");
  });

  it("two mounted controls share unknown intent and fence the older reply after a newer completion", async () => {
    const finishes: Array<(value: ReturnType<typeof response>) => void> = [];
    state.rpc.mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
    const stoppedA = vi.fn(), stoppedB = vi.fn();
    const a = render(<DealerSwingStopControl clubId="club-a" onStopped={stoppedA} />);
    const b = render(<DealerSwingStopControl clubId="club-a" onStopped={stoppedB} />);
    fireEvent.click(a.container.querySelector("button")!);
    fireEvent.click(screen.getByRole("button", { name: /^Dừng$/ }));
    const oldReply = response();
    fireEvent.click(b.container.querySelector("button")!);
    const dialogs = screen.getAllByRole("button", { name: /^Dừng$/, hidden: true });
    fireEvent.click(dialogs.find(button => !button.hasAttribute("disabled"))!);
    expect(state.rpc.mock.calls[1][1]).toEqual(state.rpc.mock.calls[0][1]);
    await act(async () => { finishes[0](oldReply); });
    fireEvent.click(a.container.querySelector("button")!);
    fireEvent.click(screen.getAllByRole("button", { name: /^Dừng$/, hidden: true }).find(button => !button.hasAttribute("disabled"))!);
    expect(state.rpc.mock.calls[2][1].p_request_id).not.toBe(state.rpc.mock.calls[0][1].p_request_id);
    await act(async () => { finishes[2](response()); });
    await act(async () => { finishes[1](oldReply); });
    expect(stoppedA).toHaveBeenCalledTimes(2);
    expect(stoppedB).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("mới hơn");
  });
});
