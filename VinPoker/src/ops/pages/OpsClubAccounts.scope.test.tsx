import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import OpsClubAccounts from "./OpsClubAccounts";

const mock = vi.hoisted(() => ({ club: "a", otherClub: "", user: "owner-a", read: vi.fn(), invoke: vi.fn() }));
beforeEach(() => {
  mock.club = "a";
  mock.otherClub = "";
  mock.user = "owner-a";
  mock.read.mockReset();
  mock.invoke.mockReset();
});
vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = { from: () => ({ select: () => ({ eq: (_field: string, club: string) => ({ order: () => mock.read(club) }) }) }),
    functions: { invoke: mock.invoke } };
  return { useSupabaseClient: () => client };
});

it("does not report a revoke as confirmed when the response is for another invitation", async () => {
  mock.club = "b";
  mock.user = "owner-b";
  mock.read.mockResolvedValue({ data: [{ id: "invite-b", club_id: "b", email_normalized: "b@example.test", operator_role: "cashier", status: "active" }], error: null });
  mock.invoke.mockResolvedValue({ data: { status: "REVOKED", invite_status: "revoked", invite_id: "invite-a" }, error: null });
  render(<MemoryRouter><OpsClubAccounts /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Thu hồi" }));
  expect(await screen.findByText(/Chưa xác minh được kết quả/)).toBeVisible();
  expect(mock.invoke).toHaveBeenCalledExactlyOnceWith("ops-club-accounts", { body: { action: "revoke", invite_id: "invite-b" } });
});
vi.mock("@/ops/auth/OpsAuthProvider", () => ({ useOpsAuth: () => ({ user: { id: mock.user }, session: null }) }));
vi.mock("@/ops/auth/OpsCapabilityProvider", () => ({ useOpsCapabilities: () => {
  const clubs = [mock.club, mock.otherClub].filter(Boolean);
  return {
    scope: clubs.map(club_id => ({ club_id, can_owner: true })),
    clubs: clubs.map(id => ({ id, name: id })),
    loading: false, scopeError: null, hasOwnerAccess: true,
  };
} }));

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

it("keeps only the new actor's invite actions when the club does not change", async () => {
  let finish!: (reply: unknown) => void;
  mock.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ data: [
      { id: "new-invite", club_id: "a", email_normalized: "new@example.test", operator_role: "cashier", status: "active" },
    ], error: null });
  const view = render(<MemoryRouter><OpsClubAccounts /></MemoryRouter>);
  expect(mock.read).toHaveBeenCalledWith("a");
  mock.user = "new-owner";
  view.rerender(<MemoryRouter><OpsClubAccounts /></MemoryRouter>);
  expect(await screen.findByText("new@example.test")).toBeVisible();
  await act(async () => finish({ data: [
    { id: "old-invite", club_id: "a", email_normalized: "old@example.test", operator_role: "floor", status: "active" },
  ], error: null }));
  expect(screen.queryByText("old@example.test")).not.toBeInTheDocument();
  mock.invoke.mockResolvedValue({ data: { status: "REVOKED", invite_status: "revoked", invite_id: "new-invite" }, error: null });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Thu hồi" })); });
  expect(mock.invoke).toHaveBeenCalledExactlyOnceWith("ops-club-accounts", {
    body: { action: "revoke", invite_id: "new-invite" },
  });
});

it("shows the selected club's invites when the same owner can operate both clubs", async () => {
  const scrollIntoView = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mock.otherClub = "b";
  mock.read.mockImplementation((club: string) => Promise.resolve({ data: [
    { id: `invite-${club}`, club_id: club, email_normalized: `${club}@example.test`, operator_role: "floor", status: "active" },
  ], error: null }));
  render(<MemoryRouter><OpsClubAccounts /></MemoryRouter>);
  expect(mock.read).not.toHaveBeenCalled();
  const selectClub = async (name: string) => {
    fireEvent.keyDown(screen.getByLabelText("CLB"), { key: "Enter" });
    fireEvent.keyDown(await screen.findByRole("option", { name }), { key: "Enter" });
    expect(await screen.findByText(`${name}@example.test`)).toBeVisible();
  };
  try {
    await selectClub("a");
    await selectClub("b");
    expect(screen.queryByText("a@example.test")).not.toBeInTheDocument();
    expect(mock.read.mock.calls).toEqual([["a"], ["b"]]);
  } finally {
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
  }
});
