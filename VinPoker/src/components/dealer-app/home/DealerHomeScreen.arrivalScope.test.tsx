import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DealerHomeScreen } from "./DealerHomeScreen";

const state = vi.hoisted(() => ({ selected: "dealer-a", rpc: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "linked-user" } }) }));
vi.mock("@/hooks/dealer/useDealerLink", () => ({ useDealerLink: () => ({
  dealer: { dealerId: state.selected, clubId: state.selected === "dealer-a" ? "club-a" : "club-b", fullName: "Dealer TEST" },
  isDealer: true, loading: false,
}) }));
vi.mock("@/hooks/dealer/useTodayShift", () => ({ useTodayShift: () => ({ data: null, isLoading: false }) }));
vi.mock("@/hooks/dealer/useWeeklySchedule", () => ({ useWeeklySchedule: () => ({ data: [] }) }));
vi.mock("@/lib/dealerApp/dataSource", () => ({ dealerDataSource: () => "live" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...args: unknown[]) => state.rpc(...args) } }));
vi.mock("./QuickActionGrid", () => ({ QuickActionGrid: () => null }));
vi.mock("./UpcomingShiftList", () => ({ UpcomingShiftList: () => null }));

const arrival = (suffix: string) => ({
  assignment_id: `assignment-${suffix}`, table_session_id: `session-${suffix}`,
  attendance_id: `attendance-${suffix}`, dispatch_at: "2026-10-30T05:00:00+00:00",
  incoming: true, acknowledged_at: null, table_name: `Bàn ${suffix.toUpperCase()}`,
});
beforeEach(() => { state.selected = "dealer-a"; state.rpc.mockReset(); });

it("keeps a late arrival response scoped to the original club when the dealer switches membership", async () => {
  let resolveAck!: (value: unknown) => void;
  state.rpc.mockImplementation((name: string, args: Record<string, string>) => {
    if (name === "dealer_ack_table_arrival_v1") return new Promise((r) => { resolveAck = r; });
    return Promise.resolve({ data: [arrival(args.p_dealer_id === "dealer-a" ? "a" : "b")], error: null });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><DealerHomeScreen /></QueryClientProvider>;
  const view = render(tree());
  expect(await screen.findByText("Bàn A")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Sẵn sàng/ }));
  expect(await screen.findByRole("button", { name: "Đang xác nhận…" })).toBeDisabled();
  state.selected = "dealer-b";
  view.rerender(tree());
  expect(await screen.findByText("Bàn B")).toBeInTheDocument();
  await act(async () => resolveAck({ data: { ...arrival("a"), acknowledged_at: "2026-10-30T05:01:00Z" }, error: null }));
  expect(screen.getByText("Bàn B")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Sẵn sàng/ })).toBeEnabled();
  expect(screen.queryByText("Đã xác nhận đến bàn")).not.toBeInTheDocument();
  const writes = state.rpc.mock.calls.filter(([name]) => name === "dealer_ack_table_arrival_v1");
  expect(writes).toHaveLength(1);
  expect(writes[0][1]).toEqual({ p_assignment_id: "assignment-a", p_table_session_id: "session-a",
    p_attendance_id: "attendance-a", p_dispatch_at: arrival("a").dispatch_at });
});
