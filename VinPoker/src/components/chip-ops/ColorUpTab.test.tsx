import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), actor: "owner-a" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc, from: h.from } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: h.actor } }) }));
import { ColorUpTab } from "./ColorUpTab";
const key = "vinpoker:color-up-pending:owner-a:club-a:tour-a";
const intent = { fn: "chip_ops_color_up", args: { p_tournament_id: "tour-a", p_denom_removed: "low", p_denom_target: "high", p_target_added: 1, p_level_number: 2, p_idempotency_key: "original-request" } };
const readerArgs = { p_tournament_id: "tour-a", p_operation: "color_up", p_request_key: "original-request",
  p_payload: { tournament: "tour-a", removed: "low", target: "high", added: 1, level: 2 } };
it("does not erase a later journal when the previous receipt arrives", async () => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  let finish!: (value: unknown) => void;
  h.rpc.mockImplementation((name: string) => name === "get_chip_color_up_receipt_v1" ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve({ data: name === "get_current_chip_inventory" ? { denominations: [] } : { operations: [] }, error: null }));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  fireEvent.click(await screen.findByRole("button", { name: "Đối chiếu thao tác" }));
  const later = { ...intent, args: { ...intent.args, p_idempotency_key: "later-request" } };
  sessionStorage.setItem(key, JSON.stringify(later));
  await act(async () => finish({ data: { status: "committed", result: { status: "ok", color_up_operation_id: "op-a", removed_count: 10, target_added: 1 } }, error: null }));
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(later);
});
it("does not overwrite a changed journal or dispatch an old retry", async () => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  const retry = await screen.findByRole("button", { name: "Gửi lại cùng yêu cầu" });
  const later = { ...intent, args: { ...intent.args, p_target_added: 2 } };
  sessionStorage.setItem(key, JSON.stringify(later));
  await act(async () => fireEvent.click(retry));
  expect(h.rpc.mock.calls.filter(([name]) => name === intent.fn)).toHaveLength(0);
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(later);
});
it.each(["get_chip_color_up_receipt_v1", "cancel_chip_color_up_request_v1"])("does not dispatch %s for a superseded local journal", async (operation) => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  const button = await screen.findByRole("button", { name: operation.startsWith("cancel") ? "Hủy yêu cầu đang chờ" : "Đối chiếu thao tác" });
  const later = { ...intent, args: { ...intent.args, p_idempotency_key: "later-request" } };
  sessionStorage.setItem(key, JSON.stringify(later));
  await act(async () => fireEvent.click(button));
  expect(h.rpc.mock.calls.filter(([name]) => name === operation)).toHaveLength(0);
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(later);
  expect(screen.getByRole("button", { name: "Đọc lại yêu cầu đã lưu" })).toBeEnabled();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("ends a hung inventory read without reporting empty setup or accepting late inventory", async () => {
  vi.useFakeTimers();
  let finish!: (value: unknown) => void;
  h.rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" onOpenSetup={vi.fn()} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(screen.getByText(/Không xác minh được tồn chip hoặc lịch sử/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tải lại" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Mở Setup stack" })).not.toBeInTheDocument();
  await act(async () => { finish({ data: { denominations: [] }, error: null }); });
  expect(h.from).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Mở Setup stack" })).not.toBeInTheDocument();
});

it.each(["submit", "receipt", "cancel", "reverse"] as const)("unfreezes hung %s while retaining exact intent and ignoring late success", async (operation) => {
  vi.useFakeTimers();
  const saved = operation === "reverse"
    ? { fn: "chip_ops_reverse_color_up", args: { p_operation_id: "op-a", p_idempotency_key: "reverse-request" } } : intent;
  sessionStorage.setItem(key, JSON.stringify(saved));
  const target = operation === "receipt" ? "get_chip_color_up_receipt_v1" : operation === "cancel" ? "cancel_chip_color_up_request_v1" : saved.fn;
  let finish!: (value: unknown) => void;
  h.rpc.mockImplementation((name: string) => name === target ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve({ data: name === "get_current_chip_inventory" ? { denominations: [] } : { operations: [] }, error: null }));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  await act(async () => {});
  const label = operation === "receipt" ? "Đối chiếu thao tác" : operation === "cancel" ? "Hủy yêu cầu đang chờ" : "Gửi lại cùng yêu cầu";
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: label })); });
  expect(screen.getByRole("button", { name: label })).toBeDisabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(screen.getByRole("button", { name: label })).toBeEnabled();
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(saved);
  const result = operation === "cancel"
    ? { status: "cancelled", error: "REQUEST_CANCELLED", actor_id: "owner-a", request_key: "original-request", operation: "color_up", payload: readerArgs.p_payload }
    : { status: "ok", color_up_operation_id: "op-a", removed_count: 10, target_added: 1, reversed: true };
  await act(async () => { finish({ data: operation === "receipt" || operation === "cancel" ? { status: "committed", result } : result, error: null }); });
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(saved);
  expect(h.rpc.mock.calls.filter(([name]) => name === target)).toHaveLength(1);
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] }
    : name === "get_color_up_history" ? { operations: [] } : { status: "committed", result }, error: null }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Đối chiếu thao tác" })); });
  expect(sessionStorage.getItem(key)).toBeNull();
  if (operation !== "receipt") expect(h.rpc.mock.calls.filter(([name]) => name === target)).toHaveLength(1);
});
it("explains verified empty denominations and navigates to setup without a chip mutation", async () => {
  const openSetup = vi.fn();
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" onOpenSetup={openSetup} />);
  fireEvent.click(await screen.findByRole("button", { name: "Mở Setup stack" }));
  expect(openSetup).toHaveBeenCalledOnce();
  expect(screen.getByText(/Chưa có mệnh giá chip để color-up/)).toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(h.rpc.mock.calls.every(([name]) => name.startsWith("get_"))).toBe(true);
});
it("does not describe a failed inventory read as missing setup", async () => {
  h.rpc.mockResolvedValue({ data: null, error: { status: 503 } });
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" onOpenSetup={vi.fn()} />);
  await screen.findByText(/Không xác minh được tồn chip hoặc lịch sử/);
  expect(screen.queryByRole("button", { name: "Mở Setup stack" })).not.toBeInTheDocument();
});
it("keeps denomination selection for verified nonempty inventory", async () => {
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory"
    ? { denominations: [{ denomination_id: "low", value: 100, color: null, current_count: 10 }] }
    : { operations: [] }, error: null }));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" onOpenSetup={vi.fn()} />);
  await waitFor(() => expect(screen.getAllByRole("combobox")).toHaveLength(2));
  expect(screen.queryByRole("button", { name: "Mở Setup stack" })).not.toBeInTheDocument();
});
it("re-reads a temporarily inaccessible saved journal without losing its identity", async () => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(() => { throw new Error("temporary storage access failure"); });
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  fireEvent.click(await screen.findByRole("button", { name: "Đọc lại yêu cầu đã lưu" }));
  await screen.findByRole("button", { name: "Đối chiếu thao tác" });
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(intent);
  expect(h.rpc.mock.calls.filter(([name]) => name === intent.fn)).toHaveLength(0);
  get.mockRestore();
});
it("does not discard a malformed journal when explicitly re-reading it", async () => {
  sessionStorage.setItem(key, "malformed");
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  fireEvent.click(await screen.findByRole("button", { name: "Đọc lại yêu cầu đã lưu" }));
  await screen.findByRole("button", { name: "Đọc lại yêu cầu đã lưu" });
  expect(sessionStorage.getItem(key)).toBe("malformed");
  expect(h.rpc.mock.calls.filter(([name]) => name === intent.fn)).toHaveLength(0);
});
it.each([true, false])("requires exact actor and payload cancellation proof (valid=%s)", async (valid) => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] }
    : name === "get_color_up_history" ? { operations: [] }
    : { status: "committed", result: { status: "cancelled", error: "REQUEST_CANCELLED", actor_id: valid ? "owner-a" : "owner-b",
      request_key: "original-request", operation: "color_up", payload: readerArgs.p_payload } }, error: null }));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  fireEvent.click(await screen.findByRole("button", { name: "Hủy yêu cầu đang chờ" }));
  await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("cancel_chip_color_up_request_v1", readerArgs));
  if (valid) await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
  else {
    await waitFor(() => expect(screen.getByRole("button", { name: "Hủy yêu cầu đang chờ" })).toBeEnabled());
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(intent);
  }
  expect(h.rpc.mock.calls.filter(([name]) => name === intent.fn)).toHaveLength(0);
});
it("keeps read-only recovery available after journal removal fails and later recovers", async () => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementationOnce(() => { throw new Error("temporary storage failure"); });
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] }
    : name === "get_color_up_history" ? { operations: [] }
    : { status: "committed", result: { status: "ok", color_up_operation_id: "op-a", removed_count: 10, target_added: 1 } }, error: null }));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  fireEvent.click(await screen.findByRole("button", { name: "Đối chiếu thao tác" }));
  await screen.findByText(/Không xác minh được yêu cầu chip đã lưu/);
  expect(screen.getByRole("button", { name: "Đối chiếu thao tác" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Đối chiếu thao tác" }));
  await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
  expect(h.rpc.mock.calls.filter(([name]) => name === intent.fn)).toHaveLength(0);
  remove.mockRestore();
});
it("offers authoritative cancellation after dependency rejection without discarding the request", async () => {
  const reverse = { fn: "chip_ops_reverse_color_up", args: { p_operation_id: "older-op", p_idempotency_key: "reverse-request" } };
  sessionStorage.setItem(key, JSON.stringify(reverse));
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] }
    : name === "get_color_up_history" ? { operations: [] }
    : name === reverse.fn ? { error: "UNDO_DEPENDENCY" } : { status: "unknown" }, error: null }));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  fireEvent.click(await screen.findByRole("button", { name: "Gửi lại cùng yêu cầu" }));
  await waitFor(() => expect(h.rpc).toHaveBeenCalledWith(reverse.fn, reverse.args));
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(reverse);
  expect(await screen.findByRole("button", { name: "Hủy yêu cầu đang chờ" })).toBeEnabled();
});
it.each([
  { data: { error: "Forbidden" }, error: null },
  { data: null, error: { status: 503 } },
  { data: { status: "committed", result: { status: "ok" } }, error: null },
])("retains pending intent on failed or malformed read receipt %j", async (reply) => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  h.rpc.mockImplementation(async (name: string) => name === "get_chip_color_up_receipt_v1" ? reply
    : { data: name === "get_current_chip_inventory" ? { denominations: [] } : { operations: [] }, error: null });
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  const read = await screen.findByRole("button", { name: "Đối chiếu thao tác" });
  await act(async () => fireEvent.click(read));
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(intent);
  expect(h.rpc.mock.calls.filter(([name]) => name === intent.fn)).toHaveLength(0);
});
it("reads reverse receipt using original operation and key without repeating reverse", async () => {
  const reverse = { fn: "chip_ops_reverse_color_up", args: { p_operation_id: "op-a", p_idempotency_key: "reverse-request" } };
  sessionStorage.setItem(key, JSON.stringify(reverse));
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] }
    : name === "get_color_up_history" ? { operations: [] } : { status: "committed", result: { status: "ok", color_up_operation_id: "op-a", reversed: true } }, error: null }));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  const read = await screen.findByRole("button", { name: "Đối chiếu thao tác" });
  await act(async () => fireEvent.click(read));
  expect(h.rpc).toHaveBeenCalledWith("get_chip_color_up_receipt_v1", { p_tournament_id: "tour-a", p_operation: "reverse_color_up",
    p_request_key: "reverse-request", p_payload: { operation: "op-a" } });
  expect(h.rpc.mock.calls.filter(([name]) => name === reverse.fn)).toHaveLength(0);
  expect(sessionStorage.getItem(key)).toBeNull();
});
it("ignores old reader response after account A to B to A remount", async () => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  let finish!: (value: unknown) => void;
  h.rpc.mockImplementation((name: string) => name === "get_chip_color_up_receipt_v1" ? new Promise((resolve) => { finish = resolve; })
    : Promise.resolve({ data: name === "get_current_chip_inventory" ? { denominations: [] } : { operations: [] }, error: null }));
  const view = render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  fireEvent.click(await screen.findByRole("button", { name: "Đối chiếu thao tác" }));
  h.actor = "owner-b";
  view.rerender(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  await screen.findByText("Chưa có color-up nào.");
  h.actor = "owner-a";
  view.rerender(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  await screen.findByRole("button", { name: "Đối chiếu thao tác" });
  await act(async () => finish({ data: { status: "committed", result: { status: "ok", color_up_operation_id: "op-a", removed_count: 10, target_added: 1 } }, error: null }));
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(intent);
  expect(screen.getByRole("button", { name: "Đối chiếu thao tác" }).hasAttribute("disabled")).toBe(false);
});
beforeEach(() => {
  sessionStorage.clear(); h.actor = "owner-a"; h.rpc.mockReset(); h.from.mockReset();
  h.from.mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { current_level: null }, error: null }) }) }) }));
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] } : name === "get_color_up_history" ? { operations: [] } : { status: "ok", color_up_operation_id: "op-a", removed_count: 10, target_added: 1 }, error: null }));
});
it("reconciles a persisted unknown mutation with the identical key and payload", async () => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  fireEvent.click(await screen.findByRole("button", { name: "Gửi lại cùng yêu cầu" }));
  await waitFor(() => expect(h.rpc).toHaveBeenCalledWith(intent.fn, intent.args));
  await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull());
});
it("retains the original receipt on response loss and blocks rapid duplicate dispatch", async () => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  let reject!: (error: Error) => void;
  h.rpc.mockImplementation((name: string) => name === intent.fn ? new Promise((_resolve, fail) => { reject = fail; }) : Promise.resolve({ data: name === "get_current_chip_inventory" ? { denominations: [] } : { operations: [] }, error: null }));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  const retry = await screen.findByRole("button", { name: "Gửi lại cùng yêu cầu" });
  fireEvent.click(retry); fireEvent.click(retry);
  expect(h.rpc.mock.calls.filter(([name]) => name === intent.fn)).toHaveLength(1);
  await act(async () => reject(new TypeError("Failed to fetch")));
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(intent);
  expect(screen.getByRole("button", { name: "Gửi lại cùng yêu cầu" }).hasAttribute("disabled")).toBe(false);
});
it("does not show a failed inventory read as an empty successful history", async () => {
  h.rpc.mockResolvedValue({ data: null, error: { status: 503 } });
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  await screen.findByText(/Không xác minh được tồn chip hoặc lịch sử/);
  expect(screen.queryByText("Chưa có color-up nào.")).toBeNull();
});
it.each(["committed", "unknown"])("reconciles %s receipt without repeating mutation", async (status) => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] }
    : name === "get_color_up_history" ? { operations: [] } : { status, result: { status: "ok", color_up_operation_id: "op-a", removed_count: 10, target_added: 1 } }, error: null }));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  const reconcile = await screen.findByRole("button", { name: "Đối chiếu thao tác" });
  await act(async () => fireEvent.click(reconcile));
  expect(h.rpc).toHaveBeenCalledWith("get_chip_color_up_receipt_v1", readerArgs);
  expect(h.rpc.mock.calls.filter(([name]) => name === intent.fn)).toHaveLength(0);
  if (status === "committed") expect(sessionStorage.getItem(key)).toBeNull();
  else expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(intent);
});
it("keeps original request recovery visible when inventory loading fails", async () => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  h.rpc.mockResolvedValue({ data: null, error: { status: 503 } });
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  await screen.findByText(/Không xác minh được tồn chip hoặc lịch sử/);
  expect(screen.getByRole("button", { name: "Gửi lại cùng yêu cầu" })).toBeTruthy();
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(intent);
  expect(h.rpc.mock.calls.filter(([name]) => name === intent.fn)).toHaveLength(0);
});
it("does not reuse another account's pending mutation", async () => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  h.actor = "owner-b";
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  await screen.findByText("Chưa có color-up nào.");
  expect(screen.queryByRole("button", { name: "Gửi lại cùng yêu cầu" })).toBeNull();
  expect(h.rpc.mock.calls.filter(([name]) => name === intent.fn)).toHaveLength(0);
});
it("does not send a new chip mutation when durable request storage fails", async () => {
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] }
    : name === "get_color_up_history" ? { operations: [{ id: "op-a", level_number: 2, status: "confirmed",
      denom_removed_value: 100, denom_target_value: 1000, removed_count: 10, target_added: 1, rounding_delta: 0 }] }
    : { status: "ok" }, error: null }));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  const reverse = await screen.findByRole("button", { name: "Hoàn tác color-up level 2" });
  const failStorage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });
  try {
    await act(async () => fireEvent.click(reverse));
    expect(h.rpc.mock.calls.filter(([name]) => name === "chip_ops_reverse_color_up")).toHaveLength(0);
  } finally { failStorage.mockRestore(); }
});
it("keeps an unresolved original request when a subsequent response only denies permission", async () => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] }
    : name === "get_color_up_history" ? { operations: [] } : { error: "Forbidden" }, error: null }));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  const reconcile = await screen.findByRole("button", { name: "Gửi lại cùng yêu cầu" });
  await act(async () => fireEvent.click(reconcile));
  expect(h.rpc).toHaveBeenCalledWith(intent.fn, intent.args);
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(intent);
});
it("blocks malformed persisted payload instead of treating it as no pending request", async () => {
  sessionStorage.setItem(key, JSON.stringify({ ...intent, args: { ...intent.args, p_target_added: -1 } }));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  await screen.findByText(/Không xác minh được yêu cầu chip đã lưu/);
  expect(screen.queryByRole("button", { name: "Gửi lại cùng yêu cầu" })).toBeNull();
  expect(h.rpc.mock.calls.filter(([name]) => name === intent.fn)).toHaveLength(0);
  expect(sessionStorage.getItem(key)).not.toBeNull();
});
it("fails closed if pending request storage cannot be read", async () => {
  const failure = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage inaccessible"); });
  try {
    render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
    await screen.findByText(/Không xác minh được yêu cầu chip đã lưu/);
    expect(h.rpc.mock.calls.filter(([name]) => name === "chip_ops_reverse_color_up" || name === intent.fn)).toHaveLength(0);
  } finally { failure.mockRestore(); }
});
it.each([
  { status: "ok" },
  { status: "ok", color_up_operation_id: "op-a", removed_count: 10, target_added: 2 },
  { status: "ok", color_up_operation_id: "op-a", removed_count: -1, target_added: 1 },
])("keeps the pending request for malformed success %j", async (reply) => {
  sessionStorage.setItem(key, JSON.stringify(intent));
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] }
    : name === "get_color_up_history" ? { operations: [] } : reply, error: null }));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  const retry = await screen.findByRole("button", { name: "Gửi lại cùng yêu cầu" });
  await act(async () => fireEvent.click(retry));
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(intent);
});
it.each([
  { status: "ok", color_up_operation_id: "op-other", reversed: true },
  { status: "ok", color_up_operation_id: "op-a" },
])("does not clear reverse intent for unrelated or unproven receipt %j", async (reply) => {
  const reverseIntent = { fn: "chip_ops_reverse_color_up", args: { p_operation_id: "op-a", p_idempotency_key: "reverse-request" } };
  sessionStorage.setItem(key, JSON.stringify(reverseIntent));
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] }
    : name === "get_color_up_history" ? { operations: [] } : reply, error: null }));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  const retry = await screen.findByRole("button", { name: "Gửi lại cùng yêu cầu" });
  await act(async () => fireEvent.click(retry));
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(reverseIntent);
});
it.each([{ reversed: true }, { idempotent: true }])("accepts exact canonical reverse receipt %j", async (proof) => {
  const reverseIntent = { fn: "chip_ops_reverse_color_up", args: { p_operation_id: "op-a", p_idempotency_key: "reverse-request" } };
  sessionStorage.setItem(key, JSON.stringify(reverseIntent));
  h.rpc.mockImplementation(async (name: string) => ({ data: name === "get_current_chip_inventory" ? { denominations: [] }
    : name === "get_color_up_history" ? { operations: [] } : { status: "ok", color_up_operation_id: "op-a", ...proof }, error: null }));
  render(<ColorUpTab tournamentId="tour-a" clubId="club-a" />);
  const retry = await screen.findByRole("button", { name: "Gửi lại cùng yêu cầu" });
  await act(async () => fireEvent.click(retry));
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(h.rpc).toHaveBeenCalledWith(reverseIntent.fn, reverseIntent.args);
});
