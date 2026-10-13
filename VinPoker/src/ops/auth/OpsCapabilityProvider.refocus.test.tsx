import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: { user: { id: "actor-a" } as { id: string } | null, loading: false, verificationRevision: 1 },
  load: vi.fn(),
  metadata: vi.fn(),
}));
vi.mock("./OpsAuthProvider", () => ({ useOpsAuth: () => h.auth }));
vi.mock("./opsCapabilityLoader", () => ({
  loadOpsCapabilities: h.load,
  loadSuperAdminClubPage: vi.fn(),
  verifySuperAdminClub: vi.fn(),
}));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const query = { select: () => query, in: h.metadata };
  const client = { from: () => query };
  return { useSupabaseClient: () => client };
});

import { OpsCapabilityProvider, useOpsCapabilities } from "./OpsCapabilityProvider";

const allowed = {
  source: "unified", global: { is_super_admin: false },
  scope: [{ club_id: "club-a", can_owner: false, can_floor: false, can_cashier: true,
    can_tracker: false, can_dealer_control: false, can_accountant: false, can_chip_master: false,
    can_marketer: false, can_fnb_cashier: false, can_fnb_server: false, can_fnb_kitchen: false }],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function Draft() {
  const [value, setValue] = useState("");
  return <input aria-label="Scoped TEST draft" value={value} onChange={(e) => setValue(e.target.value)} />;
}
function Gate() {
  const c = useOpsCapabilities();
  if (c.loading) return <p>loading</p>;
  if (c.scopeError) return <p>scope-error</p>;
  return c.hasCashierAccess ? <Draft /> : <p>denied</p>;
}
function View() {
  return <OpsCapabilityProvider><Gate /><MetadataProbe /></OpsCapabilityProvider>;
}
function MetadataProbe() {
  const c = useOpsCapabilities();
  return <output aria-label="Owned club metadata">{c.clubs.map((club) => club.name).join(",")}</output>;
}

describe("Ops capability same-actor revalidation", () => {
  beforeEach(() => {
    h.auth = { user: { id: "actor-a" }, loading: false, verificationRevision: 1 };
    h.load.mockReset().mockResolvedValue(allowed);
    h.metadata.mockReset().mockResolvedValue({ data: [{ id: "club-a", name: "Club A" }], error: null });
  });

  it("reloads canonical capabilities on verified refocus without unmounting the draft", async () => {
    const next = deferred<typeof allowed>();
    const view = render(<View />);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "TEST selection" } });
    h.load.mockReturnValue(next.promise);
    h.auth = { ...h.auth, verificationRevision: 2 };
    view.rerender(<View />);
    await waitFor(() => expect(h.load).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("textbox")).toHaveValue("TEST selection");
    await act(async () => next.resolve(allowed));
    expect(screen.getByRole("textbox")).toHaveValue("TEST selection");
    expect(h.load).toHaveBeenCalledTimes(2);
  });

  it("removes the retained controls when canonical roles have been revoked", async () => {
    const next = deferred<typeof allowed>();
    const view = render(<View />);
    await screen.findByRole("textbox");
    h.load.mockReturnValue(next.promise);
    h.auth = { ...h.auth, verificationRevision: 2 };
    view.rerender(<View />);
    await waitFor(() => expect(h.load).toHaveBeenCalledTimes(2));
    await act(async () => next.resolve({ ...allowed, scope: [] }));
    expect(screen.getByText("denied")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Owned club metadata").textContent).toBe("");
  });

  it("fails closed rather than showing ready privileges after a failed refresh", async () => {
    const next = deferred<typeof allowed>();
    const view = render(<View />);
    await screen.findByRole("textbox");
    h.load.mockReturnValue(next.promise);
    h.auth = { ...h.auth, verificationRevision: 2 };
    view.rerender(<View />);
    await waitFor(() => expect(h.load).toHaveBeenCalledTimes(2));
    await act(async () => next.reject(new Error("read unavailable")));
    expect(screen.getByText("scope-error")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("never transfers an old actor's ready scope while the new actor read is pending", async () => {
    const old = deferred<typeof allowed>();
    const fresh = deferred<typeof allowed>();
    const view = render(<View />);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Actor A secret draft" } });
    h.load.mockReturnValueOnce(old.promise).mockReturnValue(fresh.promise);
    h.auth = { ...h.auth, verificationRevision: 2 };
    view.rerender(<View />);
    await waitFor(() => expect(h.load).toHaveBeenCalledTimes(2));
    h.auth = { user: { id: "actor-b" }, loading: false, verificationRevision: 3 };
    view.rerender(<View />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await waitFor(() => expect(h.load).toHaveBeenCalledTimes(3));
    await act(async () => fresh.resolve({ ...allowed, scope: [] }));
    expect(screen.getByText("denied")).toBeInTheDocument();
    await act(async () => old.resolve(allowed));
    expect(screen.getByText("denied")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("drops metadata outside a newly returned subset before its metadata query finishes", async () => {
    const nextMetadata = deferred<{ data: { id: string; name: string }[]; error: null }>();
    const scopeB = { ...allowed.scope[0], club_id: "club-b" };
    h.load.mockResolvedValue({ ...allowed, scope: [...allowed.scope, scopeB] });
    h.metadata.mockResolvedValue({ data: [{ id: "club-a", name: "Club A" }, { id: "club-b", name: "Club B" }], error: null });
    const view = render(<View />);
    await waitFor(() => expect(screen.getByLabelText("Owned club metadata")).toHaveTextContent("Club A,Club B"));
    h.load.mockResolvedValue({ ...allowed, scope: [scopeB] });
    h.metadata.mockReturnValue(nextMetadata.promise);
    h.auth = { ...h.auth, verificationRevision: 2 };
    view.rerender(<View />);
    await waitFor(() => expect(h.metadata).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Owned club metadata").textContent).toBe("Club B");
    await act(async () => nextMetadata.resolve({ data: [{ id: "club-b", name: "Club B" }], error: null }));
    expect(screen.getByLabelText("Owned club metadata").textContent).toBe("Club B");
  });
});
