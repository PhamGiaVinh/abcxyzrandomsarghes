import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const query = { select: () => query, in: (...args: unknown[]) => {
    const promise = h.metadata(...args);
    return Object.assign(promise, { abortSignal: () => promise });
  } };
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
  return c.hasCashierAccess ? <><Draft />{c.hasFloorAccess && <button>Floor TEST action</button>}</> : <p>denied</p>;
}
function View() {
  return <OpsCapabilityProvider><Gate /><MetadataProbe /></OpsCapabilityProvider>;
}
function MetadataProbe() {
  const c = useOpsCapabilities();
  return <output aria-label="Owned club metadata">{c.clubs.map((club) => club.name).join(",")}</output>;
}
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Ops capability same-actor revalidation", () => {
  beforeEach(() => {
    h.auth = { user: { id: "actor-a" }, loading: false, verificationRevision: 1 };
    h.load.mockReset().mockResolvedValue(allowed);
    h.metadata.mockReset().mockResolvedValue({ data: [{ id: "club-a", name: "Club A" }], error: null });
  });

  it('removes revoked access without waiting for a refocus', async () => {
    vi.useFakeTimers();
    await act(async () => { render(<View />); });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep valid Cashier A draft' } });
    h.load.mockResolvedValue({ ...allowed, scope: [] });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('denied')).toBeInTheDocument();
  });

  it('keeps an unchanged workspace mounted across background verification', async () => {
    vi.useFakeTimers();
    await act(async () => { render(<View />); });
    const draft = screen.getByRole('textbox');
    fireEvent.change(draft, { target: { value: 'Unchanged draft' } });
    h.load.mockResolvedValue(structuredClone(allowed));
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(h.load).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('textbox')).toBe(draft);
    expect(draft).toHaveValue('Unchanged draft');
    expect(h.metadata).toHaveBeenCalledTimes(1);
  });

  it('does not overlap active observations or reset a hung read deadline with polling', async () => {
    vi.useFakeTimers();
    await act(async () => { render(<View />); });
    const late = deferred<typeof allowed>(); h.load.mockReturnValue(late.promise);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(h.load).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByText('scope-error')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await act(async () => { late.resolve(allowed); });
    expect(screen.getByText('scope-error')).toBeInTheDocument();
  });

  it('stops background checks after the provider unmounts', async () => {
    vi.useFakeTimers();
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<View />); });
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(h.load).toHaveBeenCalledTimes(1);
  });

  it('removes Floor B while preserving the valid Cashier A draft', async () => {
    vi.useFakeTimers();
    const floorB = { ...allowed.scope[0], club_id: 'club-b', can_cashier: false, can_floor: true };
    h.load.mockResolvedValue({ ...allowed, scope: [...allowed.scope, floorB] });
    h.metadata.mockResolvedValue({ data: [{ id: 'club-a', name: 'Club A' }, { id: 'club-b', name: 'Club B' }], error: null });
    await act(async () => { render(<View />); });
    const draft = screen.getByRole('textbox');fireEvent.change(draft, { target: { value: 'Valid Cashier A' } });
    expect(screen.getByRole('button', { name: 'Floor TEST action' })).toBeInTheDocument();
    h.load.mockResolvedValue(allowed);h.metadata.mockResolvedValue({ data: [{ id: 'club-a', name: 'Club A' }], error: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByRole('button', { name: 'Floor TEST action' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBe(draft);expect(draft).toHaveValue('Valid Cashier A');
    expect(screen.getByLabelText('Owned club metadata').textContent).toBe('Club A');
  });

  it('clears unknown scope on a failed background read and can recover from the next read', async () => {
    vi.useFakeTimers();await act(async () => { render(<View />); });
    h.load.mockRejectedValue(new Error('offline'));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByText('scope-error')).toBeInTheDocument();expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    h.load.mockResolvedValue(allowed);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByRole('textbox')).toBeInTheDocument();expect(screen.queryByText('scope-error')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Owned club metadata').textContent).toBe('Club A');
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
