import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ live: vi.fn(), final: vi.fn(), notify: [] as Array<() => void>, remove: vi.fn(), client: {} }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => mock.client }));
vi.mock("./tourRevenueRead", async original => ({ ...await original<typeof import("./tourRevenueRead")>(), loadLiveTourRevenue: mock.live, loadFinalTourRevenue: mock.final }));
import TourRevenuePanel from "./TourRevenuePanel";
const tour = { tournamentId: "tour-a", name: "Flight A", eventDay: "2026-11-04", registrationClosedAt: null as string | null,
  buyState: "open" as const,
  provisional: true, paidBuys: 9, waitingSeatBuys: 0, uniquePlayers: 8, refundedBuys: 0, unavailableBuys: 0,
  rake: 90000, serviceFee: 45000, platformFee: 0, collected: 1035000 };
const payload = (clubId = "club-a", rake = 90000) => ({ clubId, asOf: "2026-10-29T09:28:00Z", tours: [{ ...tour, rake }] });
beforeEach(() => {
  mock.notify = []; mock.remove.mockReset(); mock.live.mockReset(); mock.final.mockReset();
  const channel = { on: vi.fn((_event: unknown, _filter: unknown, fn: () => void) => { mock.notify.push(fn); return channel; }), subscribe: vi.fn(() => channel) };
  mock.client = { channel: vi.fn(() => channel), removeChannel: mock.remove };
  mock.live.mockResolvedValue(payload()); mock.final.mockResolvedValue({ status: "buy_open", canExport: false, snapshot: null, capturedAt: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("shows provisional paid rake and blocks official export while buy is open", async () => {
  render(<TourRevenuePanel clubId="club-a" />);
  expect(await screen.findByText("90.000 đ")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Xuất báo cáo rake đã chốt" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Đang mở buy · số tạm thu có thể thay đổi.")).toBeTruthy();
});
it("does not describe legacy completed tours with no close marker as open buy", async () => {
  mock.live.mockResolvedValue({ ...payload(), tours: [{ ...tour, buyState: "terminal" }] });
  render(<TourRevenuePanel clubId="club-a" />);
  expect(await screen.findByText(/Giải đã kết thúc hoặc bị hủy/)).toBeTruthy();
  expect(screen.queryByText("Đang mở buy · số tạm thu có thể thay đổi.")).toBeNull();
  expect((screen.getByRole("button", { name: "Xuất báo cáo rake đã chốt" }) as HTMLButtonElement).disabled).toBe(true);
});
it("refreshes on registration events, then removes its subscription on unmount", async () => {
  const view = render(<TourRevenuePanel clubId="club-a" />);
  await screen.findByText("90.000 đ"); mock.live.mockResolvedValue(payload("club-a", 100000));
  await act(async () => { mock.notify[0](); });
  expect(await screen.findByText("100.000 đ")).toBeTruthy();
  view.unmount(); expect(mock.remove).toHaveBeenCalledTimes(1);
});
it("polls when realtime is unavailable without overlapping requests", async () => {
  vi.useFakeTimers(); let resolve: (value: unknown) => void = () => {};
  mock.live.mockImplementation(() => new Promise(r => { resolve = r; }));
  render(<TourRevenuePanel clubId="club-a" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(mock.live).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(payload()); });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(mock.live).toHaveBeenCalledTimes(2);
});
it("clears failed reads instead of displaying old money as current", async () => {
  render(<TourRevenuePanel clubId="club-a" />); await screen.findByText("90.000 đ");
  mock.live.mockRejectedValue(new Error("unavailable"));
  await act(async () => { mock.notify[0](); });
  expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được rake");
  expect(screen.queryByText("90.000 đ")).toBeNull();
});
it("hides another club immediately and ignores its late response", async () => {
  let resolveA: (value: unknown) => void = () => {};
  mock.live.mockImplementation((_client: unknown, club: string) => club === "club-a" ? new Promise(r => { resolveA = r; }) : Promise.resolve(payload("club-b", 200000)));
  const view = render(<TourRevenuePanel key="a" clubId="club-a" />);
  view.rerender(<TourRevenuePanel key="b" clubId="club-b" />);
  expect(await screen.findByText("200.000 đ")).toBeTruthy();
  await act(async () => { resolveA(payload()); });
  expect(screen.queryByText("90.000 đ")).toBeNull();
});
it("rechecks the snapshot at export click and never exports the live figure", async () => {
  const closed = "2026-10-29T09:28:00Z";
  mock.live.mockResolvedValue({ ...payload(), tours: [{ ...tour, buyState: "closed", rake: 100000, registrationClosedAt: closed }] });
  const report = { status: "final", canExport: true, capturedAt: closed, snapshot: { ...tour, buyState: "closed", provisional: false, registrationClosedAt: closed } };
  mock.final.mockResolvedValue(report);
  const create = vi.fn(() => "blob:report"); Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const view = render(<TourRevenuePanel clubId="club-a" />);
  const button = await screen.findByRole("button", { name: "Xuất báo cáo rake đã chốt" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  mock.final.mockResolvedValueOnce({ status: "closure_changed", canExport: false, snapshot: null, capturedAt: null });
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("Chưa xuất được");
  expect(click).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  expect(mock.final).toHaveBeenCalledTimes(3);
  expect(create).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("link", { name: "Tải lại file CSV đã chuẩn bị" }).getAttribute("href")).toBe("blob:report");
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:report");
});
