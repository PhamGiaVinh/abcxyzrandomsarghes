import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssuanceCard } from "./IssuanceCard";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("sonner", () => ({ toast: { success: mocks.toast } }));
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const props = { actorId: id, clubId: id, tournamentId: id, templates: [{ id, name: "TEST stack", issued_count: 0 }], coupling: true, opsStarted: false, busy: false, setBusy: vi.fn(), reload: vi.fn() };
function receipt(args: Record<string, unknown>) { return { status: "ok", actor_id: args.p_expected_actor, club_id: id, tournament_id: id,
  request_id: args.p_request_id, stack_template_id: id, issued_count: args.p_issued_count, revision: Number(args.p_expected_revision) + 1, coupled: true,
  payload: { stack_template_id: id, issued_count: args.p_issued_count, expected_revision: args.p_expected_revision } }; }
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); mocks.rpc.mockImplementation(async (name, args) => ({ error: null, data: name === "get_chip_issuance_state_v1"
  ? { status: "ok", actor_id: args.p_expected_actor, club_id: id, tournament_id: id, stack_template_id: id, issued_count: 0, revision: 0 }
  : name === "get_chip_issuance_receipt_v1" ? { status: "committed", result: receipt(args) } : receipt(args) })); });
afterEach(() => { vi.useRealTimers(); cleanup(); });
async function ready() { await waitFor(() => expect(screen.getByLabelText("Số bộ TEST stack")).toBeEnabled()); fireEvent.change(screen.getByLabelText("Số bộ TEST stack"), { target: { value: "8" } }); }
const writes = () => mocks.rpc.mock.calls.filter(([name]) => name === "chip_ops_set_issuance_v2");
describe("issuance intent lifecycle", () => {
  it("sends integer intent once and never calls retired writer", async () => {
    render(<IssuanceCard {...props} />); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Lưu TEST stack" }));
    fireEvent.click(screen.getByRole("button", { name: /Lưu TEST stack|Gửi lại nguyên yêu cầu TEST stack/ }));
    await waitFor(() => expect(props.reload).toHaveBeenCalledOnce());
    expect(writes()).toHaveLength(1); expect(writes()[0][1]).toMatchObject({ p_expected_actor: id, p_expected_revision: 0, p_issued_count: 8 });
    expect(mocks.rpc.mock.calls.some(([name]) => name === "chip_ops_set_issuance")).toBe(false);
  });
  it.each(["1.5", "", "-1", "2147483648"])("rejects invalid count %s before dispatch", async count => {
    render(<IssuanceCard {...props} />); await ready(); fireEvent.change(screen.getByLabelText("Số bộ TEST stack"), { target: { value: count } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu TEST stack" })); await screen.findByRole("alert"); expect(writes()).toHaveLength(0);
  });
  it("recovers original request after remount by read only", async () => {
    const original = mocks.rpc.getMockImplementation()!;
    let laterOperation = false;
    mocks.rpc.mockImplementation(async (name, args) => {
      if (name === "chip_ops_set_issuance_v2") { laterOperation = true; throw Error("lost"); }
      const result = await original(name, args);
      return name === "get_chip_issuance_state_v1" && laterOperation ? { ...result, data: { ...result.data, issued_count: 9, revision: 2 } } : result;
    });
    const first = render(<IssuanceCard {...props} />); await ready(); fireEvent.click(screen.getByRole("button", { name: "Lưu TEST stack" }));
    await screen.findByRole("alert"); const args = writes()[0][1]; first.unmount();
    render(<IssuanceCard {...props} />); await screen.findByRole("button", { name: "Đối chiếu TEST stack" });
    expect(screen.getByLabelText("Số bộ TEST stack")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Đối chiếu TEST stack" })); await waitFor(() => expect(props.reload).toHaveBeenCalledOnce());
    expect(writes()).toHaveLength(1); expect(mocks.rpc.mock.calls.find(([name]) => name === "get_chip_issuance_receipt_v1")?.[1]).toEqual(args);
    await waitFor(() => expect(screen.getByLabelText("Số bộ TEST stack")).toHaveValue(9)); // Old receipt8 is not current inventory9.
  });
  it("does not dispatch when journal storage fails", async () => {
    render(<IssuanceCard {...props} />); await ready();
    const failure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("storage disabled"); });
    try { fireEvent.click(screen.getByRole("button", { name: "Lưu TEST stack" })); await screen.findByRole("alert"); expect(writes()).toHaveLength(0); }
    finally { failure.mockRestore(); }
  });
  it("a stale widget cannot overwrite a newer resolved journal", async () => {
    const original = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name, args) => { if (name === "chip_ops_set_issuance_v2") throw Error("unknown"); return original(name, args); });
    render(<IssuanceCard {...props} />); await ready(); fireEvent.click(screen.getByRole("button", { name: "Lưu TEST stack" }));
    await screen.findByRole("alert");
    const key = sessionStorage.key(0)!, prior = JSON.parse(sessionStorage.getItem(key)!);
    const newer = JSON.stringify({ ...prior, requestId: other, resolved: true });
    sessionStorage.setItem(key, newer); // Another widget has settled its newer request.
    fireEvent.click(screen.getByRole("button", { name: "Gửi lại nguyên yêu cầu TEST stack" }));
    expect(writes()).toHaveLength(1); expect(sessionStorage.getItem(key)).toBe(newer);
  });
  it("retains unknown intent on mismatched receipt", async () => {
    const original = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name, args) => name === "chip_ops_set_issuance_v2" ? { error: null, data: { ...receipt(args), request_id: other } } : original(name, args));
    render(<IssuanceCard {...props} />); await ready(); fireEvent.click(screen.getByRole("button", { name: "Lưu TEST stack" }));
    await screen.findByRole("alert"); expect(props.reload).not.toHaveBeenCalled(); expect(screen.getByLabelText("Số bộ TEST stack")).toBeDisabled();
    expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!).resolved).not.toBe(true);
  });
  it("times out hung mutation without auto retry or accepting late success", async () => {
    const original = mocks.rpc.getMockImplementation()!; let complete!: (value: unknown) => void;
    mocks.rpc.mockImplementation((name, args) => name === "chip_ops_set_issuance_v2" ? new Promise(resolve => { complete = resolve; }) : original(name, args));
    render(<IssuanceCard {...props} />); await ready(); vi.useFakeTimers(); fireEvent.click(screen.getByRole("button", { name: "Lưu TEST stack" }));
    const saved = sessionStorage.getItem(sessionStorage.key(0)!);
    await act(async () => { await vi.advanceTimersByTimeAsync(20001); });
    expect(screen.getByRole("alert")).toHaveTextContent("Chưa biết server"); expect(writes()).toHaveLength(1);
    await act(async () => { complete({ data: receipt(writes()[0][1]), error: null }); });
    expect(props.reload).not.toHaveBeenCalled(); expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(saved);
  });
  it("old actor lifetime cannot settle after account switch", async () => {
    const original = mocks.rpc.getMockImplementation()!; let complete!: (value: unknown) => void;
    mocks.rpc.mockImplementation((name, args) => name === "chip_ops_set_issuance_v2" ? new Promise(resolve => { complete = resolve; }) : original(name, args));
    const view = render(<IssuanceCard {...props} />); await ready(); fireEvent.click(screen.getByRole("button", { name: "Lưu TEST stack" }));
    view.rerender(<IssuanceCard {...props} actorId={other} />);
    await act(async () => { complete({ data: receipt(writes()[0][1]), error: null }); });
    expect(props.reload).not.toHaveBeenCalled(); expect(mocks.toast).not.toHaveBeenCalled();
  });
});
