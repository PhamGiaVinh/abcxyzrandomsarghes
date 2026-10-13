// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseClientProvider } from "@/integrations/supabase/SupabaseClientContext";
import type { Tournament } from "@/types/tournament";

const pendingResponse = new Promise<never>(() => {});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "test-floor-actor" } }) }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(() => pendingResponse),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => pendingResponse),
      })),
    })),
    functions: {
      invoke: vi.fn(() => pendingResponse),
    },
  },
}));

import { FloorTableMapPanel } from "../FloorTableMapPanel";
import { supabase } from "@/integrations/supabase/client";

afterEach(cleanup);

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
