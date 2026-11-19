import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createClient } from "@supabase/supabase-js";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import OpsAlerts from "./OpsAlerts";

const fixture = vi.hoisted(() => ({
  club: "club-a",
  user: { id: "actor-a" },
  session: { access_token: "fixture-a" },
  allowed: ["club-a", "club-b"],
  transport: vi.fn<typeof fetch>(),
}));
vi.mock("@/ops/auth/OpsAuthProvider", () => ({ useOpsAuth: () => fixture }));
vi.mock("@/ops/workspace/OpsWorkspaceProvider", () => ({ useOpsWorkspace: () => ({ selectedClubId: fixture.club }) }));
vi.mock("@/ops/auth/OpsCapabilityProvider", () => ({
  useOpsCapabilities: () => ({ floorClubIds: fixture.allowed, isSuperAdmin: false, loading: false, scopeError: null }),
}));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => client }));
vi.mock("@/lib/tracker-floor-alerts/useTrackerFloorAlertLocations", () => ({
  useTrackerFloorAlertLocations: () => () => undefined,
}));

const client = createClient("http://127.0.0.1:54321", "fixture", {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: fixture.transport },
});

function alertResponse(label: string) {
  return new Response(JSON.stringify([{
    id: "bd310000-0000-4000-8000-000000000001",
    tournament_id: "tour", physical_table_id: "table", hand_id: null,
    status: "open", priority: "high", title: label, created_at: "2026-01-01T12:00:00+00:00",
    tournaments: { name: label + " tour" },
  }]), { headers: { "content-type": "application/json" } });
}

it.each(["switch club", "switch actor", "revoke role"])("discards a pending old alert read on %s", async change => {
  fixture.club = "club-a";
  fixture.user = { id: "actor-a" };
  fixture.session = { access_token: "fixture-a" };
  fixture.allowed = ["club-a", "club-b"];
  fixture.transport.mockReset();
  let resolveOld!: (response: Response) => void;
  const oldRead = new Promise<Response>(resolve => { resolveOld = resolve; });
  fixture.transport.mockReturnValueOnce(oldRead).mockImplementation(async () => alertResponse("Current alert"));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = () => <QueryClientProvider client={queryClient}><MemoryRouter><OpsAlerts /></MemoryRouter></QueryClientProvider>;
  const view = render(ui());
  await waitFor(() => expect(fixture.transport).toHaveBeenCalledTimes(1));
  const oldSignal = fixture.transport.mock.calls[0][1]?.signal;

  if (change === "switch club") fixture.club = "club-b";
  if (change === "switch actor") {
    fixture.user = { id: "actor-b" };
    fixture.session = { access_token: "fixture-b" };
  }
  if (change === "revoke role") fixture.allowed = [];
  view.rerender(ui());
  expect(oldSignal?.aborted).toBe(true);
  if (change !== "revoke role") await screen.findByText("Current alert");
  else expect(screen.getByText(/Chọn CLB bạn được phân quyền/)).toBeInTheDocument();

  await act(async () => resolveOld(alertResponse("Old alert")));
  expect(screen.queryByText("Old alert")).not.toBeInTheDocument();
  expect(fixture.transport).toHaveBeenCalledTimes(change === "revoke role" ? 1 : 2);
});
