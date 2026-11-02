import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ actor: "owner", read: vi.fn(), rpc: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mock.actor ? { id: mock.actor } : null }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, from: () => ({ select: () => ({ eq: (_key: string, id: string) => ({ maybeSingle: () => mock.read(id) }) }) }) } }));
import { TournamentBuyCloseControl } from "./TournamentBuyCloseControl";
const open = (id = "tour-a") => ({ data: { id, name: "Tour A", status: "live", live_status: "running", registration_closed_at: null }, error: null });
const closedAt = "2026-10-29T10:00:00Z";
beforeEach(() => { mock.actor = "owner"; mock.read.mockReset(); mock.rpc.mockReset(); mock.read.mockImplementation(id => Promise.resolve(open(id))); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function confirm() {
  fireEvent.click(await screen.findByRole("button", { name: "Đóng buy" }));
  fireEvent.click(screen.getByRole("button", { name: "Xác nhận đóng buy" }));
}

it("requires an irreversible-action confirmation and never writes on cancel", async () => {
  render(<TournamentBuyCloseControl tournamentId="tour-a" />);
  fireEvent.click(await screen.findByRole("button", { name: "Đóng buy" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("Thao tác một chiều");
  fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
  expect(mock.rpc).not.toHaveBeenCalled();
});
it("sends one canonical command even for double confirm", async () => {
  let finish: (value: unknown) => void = () => {};
  mock.rpc.mockImplementation(() => new Promise(r => { finish = r; }));
  render(<TournamentBuyCloseControl tournamentId="tour-a" />);
  await confirm();
  fireEvent.click(screen.getByRole("button", { name: "Đang đóng buy…" }));
  expect(mock.rpc).toHaveBeenCalledTimes(1);
  expect(mock.rpc).toHaveBeenCalledWith("close_tournament_buy_v1", { p_tournament_id: "tour-a" });
  await act(async () => { finish({ data: { status: "closed", registrationClosedAt: closedAt }, error: null }); });
  expect(screen.getByText(/Đã đóng buy lúc/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Đóng buy" }) as HTMLButtonElement).disabled).toBe(true);
});
it("shows paid waiting-seat rejection without claiming closure", async () => {
  mock.rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "buy_close_paid_registration_waiting_seat" } });
  render(<TournamentBuyCloseControl tournamentId="tour-a" />); await confirm();
  expect(await screen.findByRole("alert")).toHaveTextContent("Còn buy đã thu đang chờ xếp chỗ");
  expect(screen.queryByText(/Đã đóng buy lúc/)).toBeNull();
});
it("keeps a transport error unresolved until a read proves closure", async () => {
  mock.rpc.mockRejectedValue(new Error("response lost"));
  render(<TournamentBuyCloseControl tournamentId="tour-a" />); await confirm();
  expect(await screen.findByText(/Chưa xác minh được kết quả đóng buy/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Kiểm tra trạng thái buy" }));
  await screen.findByText(/Chưa xác minh được kết quả đóng buy/);
  expect((screen.getByRole("button", { name: "Đóng buy" }) as HTMLButtonElement).disabled).toBe(true);
  mock.read.mockResolvedValue({ data: { ...open().data, registration_closed_at: closedAt }, error: null });
  fireEvent.click(screen.getByRole("button", { name: "Kiểm tra trạng thái buy" }));
  expect(await screen.findByText(/Đã đóng buy lúc/)).toBeTruthy();
  expect(mock.rpc).toHaveBeenCalledTimes(1);
});
it("does not carry a late old actor mutation into another tournament", async () => {
  let finish: (value: unknown) => void = () => {};
  mock.rpc.mockImplementation(() => new Promise(r => { finish = r; }));
  const view = render(<TournamentBuyCloseControl tournamentId="tour-a" />); await confirm();
  mock.actor = "another-owner"; view.rerender(<TournamentBuyCloseControl tournamentId="tour-b" />);
  await waitFor(() => expect((screen.getByRole("button", { name: "Đóng buy" }) as HTMLButtonElement).disabled).toBe(false));
  await act(async () => { finish({ data: { status: "closed", registrationClosedAt: closedAt }, error: null }); });
  expect(screen.queryByText(/Đã đóng buy lúc/)).toBeNull();
});
it("does not offer a write without authentication or a valid scoped read", async () => {
  mock.actor = ""; const view = render(<TournamentBuyCloseControl tournamentId="tour-a" />);
  expect(mock.read).not.toHaveBeenCalled(); expect(screen.queryByRole("button")).toBeNull();
  mock.actor = "owner"; mock.read.mockResolvedValue(open("different-tour"));
  view.rerender(<TournamentBuyCloseControl tournamentId="tour-a" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Chưa tải được trạng thái buy");
  expect((screen.getByRole("button", { name: "Đóng buy" }) as HTMLButtonElement).disabled).toBe(true);
});
it("does not reopen or close a terminal tournament", async () => {
  mock.read.mockResolvedValue({ data: { ...open().data, status: "completed" }, error: null });
  render(<TournamentBuyCloseControl tournamentId="tour-a" />);
  expect(await screen.findByText(/Giải đã kết thúc hoặc bị hủy/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Đóng buy" }) as HTMLButtonElement).disabled).toBe(true);
  expect(mock.rpc).not.toHaveBeenCalled();
});
