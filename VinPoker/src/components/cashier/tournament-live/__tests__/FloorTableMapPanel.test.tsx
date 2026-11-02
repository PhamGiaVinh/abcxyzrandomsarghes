// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseClientProvider } from "@/integrations/supabase/SupabaseClientContext";
import type { Tournament } from "@/types/tournament";

const pendingResponse = new Promise<never>(() => {});
const loaded = vi.hoisted(() => ({ ready: false, tables: [] as unknown[], seats: [] as unknown[] }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "test-floor-actor" } }) }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { floorTableControlV3: false } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(() => loaded.ready ? Promise.resolve({ data: [], error: null }) : pendingResponse),
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => loaded.ready ? Promise.resolve({ data: table === "tournament_tables" ? loaded.tables : [], error: null }) : pendingResponse),
      })),
    })),
    functions: {
      invoke: vi.fn(() => loaded.ready ? Promise.resolve({ data: { status: "success", data: loaded.seats }, error: null }) : pendingResponse),
    },
  },
}));

import { FloorTableMapPanel } from "../FloorTableMapPanel";
import { supabase } from "@/integrations/supabase/client";

afterEach(() => { cleanup(); loaded.ready = false; loaded.tables = []; loaded.seats = []; });

describe("FloorTableMapPanel loading state", () => {
  it("renders the table-map skeleton while the tournament tables are loading", () => {
    const { container } = render(
      <SupabaseClientProvider client={supabase as never}>
        <FloorTableMapPanel
          tournament={{
            id: "tournament-1",
            club_id: "club-1",
            name: "Giải TEST",
            status: "live", description: null, swing_duration_minutes: 30, warn_at_minutes: 25,
            crit_at_minutes: 35, created_at: "2026-10-09T00:00:00Z", updated_at: "2026-10-09T00:00:00Z",
            current_level: null, current_blinds: null, current_level_id: null, clock_started_at: null,
            clock_paused_at: null, pause_accumulated: null, players_remaining: null, average_stack: null,
            prize_pool: null, itm_places: null,
          } satisfies Tournament}
          refreshTrigger={0}
        />
      </SupabaseClientProvider>,
    );

    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(18);
  });
});

describe("Floor occupancy table identities", () => {
  it.each([
    { physical: null, seatTable: "logical" },
    { physical: "physical", seatTable: "logical" },
    { physical: "physical", seatTable: "physical" },
  ])("groups the correct seats for legacy physical ID $physical / seat ID $seatTable", async ({ physical, seatTable }) => {
    loaded.ready = true;
    loaded.tables = [{ id: "logical", table_id: physical, table_number: 1, table_name: "Bàn 1", max_seats: 9, status: "active", floor_control_mode: "manual", floor_control_revision: 0 },
      { id: "other", table_id: "other-physical", table_number: 2, table_name: "Bàn 2", max_seats: 9, status: "active", floor_control_mode: "manual", floor_control_revision: 0 }];
    loaded.seats = [{ seat_id: "seat", player_id: "player", player_name: "TEST", entry_number: 1, table_id: seatTable, table_name: "Bàn 1", seat_number: 1, chip_count: 20000, is_active: true }];
    render(<SupabaseClientProvider client={supabase as never}><FloorTableMapPanel tournament={{ id: "tour", club_id: "club", status: "live" } as Tournament} refreshTrigger={0} /></SupabaseClientProvider>);
    expect(await screen.findByRole("button", { name: /Bàn 1, 1\/9 ghế/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Bàn 2, 0\/9 ghế/ })).toBeVisible();
    expect((loaded.seats[0] as { table_id: string }).table_id).toBe(seatTable);
  });
});
