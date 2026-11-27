import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import OpsClubAccounts from "./OpsClubAccounts";

afterEach(cleanup);
vi.mock("@/ops/auth/OpsAuthProvider", () => ({
  useOpsAuth: () => ({ user: { id: "owner-fixture" }, session: null, loading: false }),
}));

const state = vi.hoisted(() => ({
  clubs: [{ id: "A", name: "CLB A" }],
  scope: [{ club_id: "A", can_owner: true }],
  read: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/ops/auth/OpsCapabilityProvider", () => ({
  useOpsCapabilities: () => ({
    scope: state.scope, clubs: state.clubs, hasOwnerAccess: true, loading: false,
  }),
}));

vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = {
    functions: { invoke: state.invoke },
    from: () => ({
      select: () => ({
        eq: (_column: string, clubId: string) => ({ order: () => state.read(clubId) }),
      }),
    }),
  };
  return { useSupabaseClient: () => client };
});

const invite = (club: string) => ({
  id: `invite-${club}`, club_id: club, operator_role: "dealer_control",
  status: "active", email_normalized: `staff-${club.toLowerCase()}@example.invalid`,
});

it("ignores a previous club read after ownership changes and only revokes within the current club", async () => {
  let finishOld!: (value: unknown) => void;
  state.read.mockImplementation((clubId: string) => clubId === "A"
    ? new Promise(resolve => { finishOld = resolve; })
    : Promise.resolve({ data: [invite("B")], error: null }));
  state.invoke.mockResolvedValue({ error: null });
  const renderPage = () => <MemoryRouter><OpsClubAccounts /></MemoryRouter>;
  const view = render(renderPage());
  expect(state.read).toHaveBeenCalledWith("A");

  state.scope = [{ club_id: "B", can_owner: true }];
  state.clubs = [{ id: "B", name: "CLB B" }];
  view.rerender(renderPage());
  expect(await screen.findByText("staff-b@example.invalid")).toBeVisible();

  await act(async () => { finishOld({ data: [invite("A")], error: null }); });
  expect(screen.queryByText("staff-a@example.invalid")).toBeNull();
  expect(screen.getByText("staff-b@example.invalid")).toBeVisible();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Thu hồi" })); });
  expect(state.invoke).toHaveBeenCalledExactlyOnceWith("ops-club-accounts", {
    body: { action: "revoke", invite_id: "invite-B" },
  });
});
