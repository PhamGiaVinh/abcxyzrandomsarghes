import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Tournament } from "@/types/tournament";

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
const client = { rpc: state.rpc };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "floor" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc } }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => client }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { floorTableControlV3: false } }));
import { FloorTableMapPanel } from "../FloorTableMapPanel";

beforeEach(() => state.rpc.mockReset().mockResolvedValue({ data: [], error: null }));
afterEach(cleanup);

it.each(["completed", "finished", "cancelled"])("reads %s through the real roster client with live operations disabled", async status => {
  render(<FloorTableMapPanel tournament={{ id: "tour", club_id: "club", name: "TEST", status } as Tournament} refreshTrigger={0} />);
  await screen.findByText("Không còn phiên bàn đang hoạt động.");
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Làm mới" })).toBeEnabled();
  expect(state.rpc).toHaveBeenCalledWith("get_floor_tournament_table_roster_v3", { p_tournament_id: "tour" });
  expect(state.rpc).toHaveBeenCalledTimes(1);
  expect(state.rpc.mock.calls.every(([name]) => String(name).startsWith("get_"))).toBe(true);
});

it("shows roster transport failure instead of claiming zero active sessions", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "LOCAL_ROSTER_UNAVAILABLE" } });
  render(<FloorTableMapPanel tournament={{ id: "tour", club_id: "club", name: "TEST", status: "completed" } as Tournament} refreshTrigger={0} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("LOCAL_ROSTER_UNAVAILABLE");
  expect(screen.queryByText("Không còn phiên bàn đang hoạt động.")).not.toBeInTheDocument();
});
