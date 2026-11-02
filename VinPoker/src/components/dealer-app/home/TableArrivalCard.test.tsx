import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TableArrivalCard } from "./TableArrivalCard";

const state = vi.hoisted(() => ({ rpc: vi.fn(), live: true, actor: "actor-a" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...args: unknown[]) => state.rpc(...args) } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: state.actor } }) }));
vi.mock("@/lib/dealerApp/dataSource", () => ({ dealerDataSource: () => state.live ? "live" : "mock" }));
const row = { assignment_id: "assignment-a", table_session_id: "session-a", table_name: "Bàn 4", acknowledged_at: null,
  attendance_id: "attendance-a", dispatch_at: "2026-10-30T05:00:00+00:00", incoming: false };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><TableArrivalCard dealerId="dealer-a" /></QueryClientProvider>) };
}
describe("dealer arrival acknowledgement", () => {
  beforeEach(() => {
    state.live = true; state.actor = "actor-a"; state.rpc.mockReset();
    state.rpc.mockResolvedValue({ data: [row], error: null });
  });
  it("never queries or simulates success in preview mode", () => {
    state.live = false;
    const view = mount();
    expect(view.container).toBeEmptyDOMElement();
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("sends exact assignment/session and displays confirmed server readback", async () => {
    let acknowledged = false;
    state.rpc.mockImplementation(async (name: string, args: unknown) => {
      if (name === "dealer_ack_table_arrival_v1") {
        expect(args).toEqual({ p_assignment_id: "assignment-a", p_table_session_id: "session-a",
          p_attendance_id: "attendance-a", p_dispatch_at: row.dispatch_at });
        acknowledged = true;
        return { data: { ...row, acknowledged_at: "2026-10-30T05:00:00Z" }, error: null };
      }
      return { data: [{ ...row, acknowledged_at: acknowledged ? "2026-10-30T05:00:00Z" : null }], error: null };
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Sẵn sàng/ }));
    expect(await screen.findByText("Đã xác nhận đến bàn")).toBeInTheDocument();
    expect(state.rpc.mock.calls.every(([name]) => ["dealer_get_table_arrivals_v1", "dealer_ack_table_arrival_v1"].includes(name))).toBe(true);
  });
  it("disables the action while acknowledgement is in flight", async () => {
    let resolve!: (value: unknown) => void;
    state.rpc.mockImplementation((name: string) => name === "dealer_ack_table_arrival_v1"
      ? new Promise((r) => { resolve = r; }) : Promise.resolve({ data: [row], error: null }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Sẵn sàng/ }));
    expect(await screen.findByRole("button", { name: "Đang xác nhận…" })).toBeDisabled();
    await act(async () => resolve({ data: { ...row, acknowledged_at: "2026-10-30T05:00:00Z" }, error: null }));
  });
  it("does not claim success after a stale-assignment rejection", async () => {
    state.rpc.mockImplementation(async (name: string) => name === "dealer_ack_table_arrival_v1"
      ? { data: null, error: { message: "dealer_arrival_stale_assignment" } } : { data: [row], error: null });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Sẵn sàng/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa xác nhận được");
    expect(screen.queryByText("Đã xác nhận đến bàn")).not.toBeInTheDocument();
  });
  it("shows unavailable rather than an empty assignment list on malformed response", async () => {
    state.rpc.mockResolvedValue({ data: [{}], error: null });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa tải được phân công bàn");
    expect(screen.queryByRole("button", { name: /Sẵn sàng/ })).not.toBeInTheDocument();
  });
  it("has no arrival button after the server returns no active assignment", async () => {
    state.rpc.mockResolvedValue({ data: [], error: null });
    const view = mount();
    await waitFor(() => expect(view.container).toBeEmptyDOMElement());
  });
  it("shows the incoming dispatch before automatic handover", async () => {
    state.rpc.mockResolvedValue({ data: [{ ...row, incoming: true }], error: null });
    mount();
    expect(await screen.findByText("Phân công tiếp theo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sẵn sàng/ })).toBeEnabled();
  });
  it("rejects a receipt for a different dispatch without showing success", async () => {
    state.rpc.mockImplementation(async (name: string) => name === "dealer_ack_table_arrival_v1"
      ? { data: { ...row, dispatch_at: "2026-10-30T06:00:00Z", acknowledged_at: "2026-10-30T06:00:01Z" }, error: null }
      : { data: [row], error: null });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Sẵn sàng/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa xác nhận được");
    expect(screen.queryByText("Đã xác nhận đến bàn")).not.toBeInTheDocument();
  });
});
