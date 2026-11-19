import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import OpsClubAccounts from "./OpsClubAccounts";

const mock = vi.hoisted(() => ({ club: "a", user: "owner-a", read: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = { from: () => ({ select: () => ({ eq: (_field: string, club: string) => ({ order: () => mock.read(club) }) }) }),
    functions: { invoke: mock.invoke } };
  return { useSupabaseClient: () => client };
});
vi.mock("@/ops/auth/OpsAuthProvider", () => ({ useOpsAuth: () => ({ user: { id: mock.user }, session: null }) }));
vi.mock("@/ops/auth/OpsCapabilityProvider", () => ({ useOpsCapabilities: () => ({
  scope: [{ club_id: mock.club, can_owner: true }], clubs: [{ id: mock.club, name: mock.club }],
  loading: false, scopeError: null, hasOwnerAccess: true,
}) }));

it("clears old invite actions when club authority changes and discards its late read", async () => {
  let finish!: (reply: unknown) => void;
  mock.read.mockImplementation((club: string) => club === "a"
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ data: null, error: "failed" }));
  const view = render(<MemoryRouter><OpsClubAccounts /></MemoryRouter>);
  expect(mock.read).toHaveBeenCalledWith("a");
  mock.club = "b";
  mock.user = "owner-b";
  view.rerender(<MemoryRouter><OpsClubAccounts /></MemoryRouter>);
  expect(await screen.findByRole("alert")).toHaveTextContent("Chưa tải được danh sách lời mời");
  await act(async () => finish({ data: [{ id: "invite-a", club_id: "a", email_normalized: "a@example.test", operator_role: "floor", status: "active" }], error: null }));
  expect(screen.queryByText("a@example.test")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Thu hồi" })).not.toBeInTheDocument();
  expect(mock.invoke).not.toHaveBeenCalled();
});
