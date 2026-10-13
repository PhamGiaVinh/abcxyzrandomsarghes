import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

type TestSession = {
  user: { id: string };
  access_token: string;
};

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/integrations/supabase/opsClient", () => ({
  opsClient: { auth },
}));

vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({
  SupabaseClientProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { OpsAuthProvider, useOpsAuth } from "@/ops/auth/OpsAuthProvider";

const storedSession: TestSession = {
  user: { id: "10000000-0000-4000-8000-000000000001" },
  access_token: "cached-token",
};

function Probe() {
  const { loading, user } = useOpsAuth();
  return <p>{loading ? "loading" : (user?.id ?? "anonymous")}</p>;
}

function Draft() {
  const [value, setValue] = useState("");
  return <input aria-label="Unsaved TEST draft" value={value} onChange={(event) => setValue(event.target.value)} />;
}

function GatedDraft() {
  const { loading, user } = useOpsAuth();
  return loading ? <p>loading</p> : user ? <Draft /> : <p>anonymous</p>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("OpsAuthProvider session acceptance", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not accept the browser INITIAL_SESSION before the Auth server confirms it", async () => {
    const verification = deferred<{ data: { user: { id: string } | null }; error: null }>();
    auth.getSession.mockResolvedValue({ data: { session: storedSession }, error: null });
    auth.getUser.mockReturnValue(verification.promise);
    auth.onAuthStateChange.mockImplementation((listener) => {
      listener("INITIAL_SESSION", storedSession);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    render(<OpsAuthProvider><Probe /></OpsAuthProvider>);

    expect(screen.getByText("loading")).toBeInTheDocument();
    verification.resolve({ data: { user: storedSession.user }, error: null });

    await waitFor(() => {
      expect(screen.getByText(storedSession.user.id)).toBeInTheDocument();
    });
  });

  it("keeps a signed-out callback ahead of an in-flight validation", async () => {
    const verification = deferred<{ data: { user: { id: string } | null }; error: null }>();
    let listener: ((event: string, session: TestSession | null) => void) | null = null;
    auth.getSession.mockResolvedValue({ data: { session: storedSession }, error: null });
    auth.getUser.mockReturnValue(verification.promise);
    auth.onAuthStateChange.mockImplementation((nextListener) => {
      listener = nextListener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    render(<OpsAuthProvider><Probe /></OpsAuthProvider>);

    expect(listener).not.toBeNull();
    act(() => {
      listener?.("SIGNED_OUT", null);
    });
    verification.resolve({ data: { user: storedSession.user }, error: null });

    await waitFor(() => {
      expect(screen.getByText("anonymous")).toBeInTheDocument();
    });
  });

  it("retains a verified same-token draft during refocus without skipping server validation", async () => {
    const verification = deferred<{ data: { user: { id: string } | null }; error: null }>();
    let listener: ((event: string, session: TestSession | null) => void) | null = null;
    auth.getSession.mockResolvedValue({ data: { session: storedSession }, error: null });
    auth.getUser.mockResolvedValueOnce({ data: { user: storedSession.user }, error: null })
      .mockReturnValue(verification.promise);
    auth.onAuthStateChange.mockImplementation((nextListener) => {
      listener = nextListener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    let observedUser: unknown;
    function IdentityProbe() {
      observedUser = useOpsAuth().user;
      return null;
    }
    render(<OpsAuthProvider><GatedDraft /><IdentityProbe /></OpsAuthProvider>);
    fireEvent.change(await screen.findByRole("textbox", { name: "Unsaved TEST draft" }), {
      target: { value: "TEST pending selection" },
    });
    const confirmedUser = observedUser;
    auth.getSession.mockResolvedValue({ data: { session: { ...storedSession, user: { ...storedSession.user } } }, error: null });
    act(() => listener?.("SIGNED_IN", { ...storedSession, user: { ...storedSession.user } }));
    expect(screen.getByRole("textbox", { name: "Unsaved TEST draft" })).toHaveValue("TEST pending selection");
    await waitFor(() => expect(auth.getUser).toHaveBeenCalledTimes(2));
    await act(async () => verification.resolve({ data: { user: { ...storedSession.user } }, error: null }));
    expect(screen.getByRole("textbox", { name: "Unsaved TEST draft" })).toHaveValue("TEST pending selection");
    expect(observedUser).toBe(confirmedUser);
  });

  it("revokes the retained view when the same-token server recheck rejects the user", async () => {
    const verification = deferred<{ data: { user: null }; error: Error }>();
    let listener: ((event: string, session: TestSession | null) => void) | null = null;
    auth.getSession.mockResolvedValue({ data: { session: storedSession }, error: null });
    auth.getUser.mockResolvedValueOnce({ data: { user: storedSession.user }, error: null })
      .mockReturnValue(verification.promise);
    auth.onAuthStateChange.mockImplementation((nextListener) => {
      listener = nextListener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    render(<OpsAuthProvider><GatedDraft /></OpsAuthProvider>);
    await screen.findByRole("textbox", { name: "Unsaved TEST draft" });
    act(() => listener?.("SIGNED_IN", storedSession));
    await waitFor(() => expect(auth.getUser).toHaveBeenCalledTimes(2));
    await act(async () => verification.resolve({ data: { user: null }, error: new Error("session revoked") }));
    expect(screen.getByText("anonymous")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("gates a different actor and ignores an older same-token validation completion", async () => {
    const oldCheck = deferred<{ data: { user: { id: string } }; error: null }>();
    const newCheck = deferred<{ data: { user: { id: string } }; error: null }>();
    const otherSession = { user: { id: "10000000-0000-4000-8000-000000000002" }, access_token: "other-token" };
    let listener: ((event: string, session: TestSession | null) => void) | null = null;
    auth.getSession.mockResolvedValue({ data: { session: storedSession }, error: null });
    auth.getUser.mockResolvedValueOnce({ data: { user: storedSession.user }, error: null })
      .mockReturnValueOnce(oldCheck.promise).mockReturnValue(newCheck.promise);
    auth.onAuthStateChange.mockImplementation((nextListener) => {
      listener = nextListener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    render(<OpsAuthProvider><Probe /><GatedDraft /></OpsAuthProvider>);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Actor A draft" } });
    act(() => listener?.("SIGNED_IN", storedSession));
    await waitFor(() => expect(auth.getUser).toHaveBeenCalledTimes(2));
    auth.getSession.mockResolvedValue({ data: { session: otherSession }, error: null });
    act(() => listener?.("SIGNED_IN", otherSession));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await waitFor(() => expect(auth.getUser).toHaveBeenCalledTimes(3));
    await act(async () => newCheck.resolve({ data: { user: otherSession.user }, error: null }));
    await screen.findByText(otherSession.user.id);
    expect(screen.getByRole("textbox")).toHaveValue("");
    await act(async () => oldCheck.resolve({ data: { user: storedSession.user }, error: null }));
    expect(screen.getByText(otherSession.user.id)).toBeInTheDocument();
    expect(screen.queryByText(storedSession.user.id)).not.toBeInTheDocument();
  });

  it("does not retain the old view for a changed token even when the actor is the same", async () => {
    const verification = deferred<{ data: { user: { id: string } }; error: null }>();
    const refreshedSession = { ...storedSession, access_token: "refreshed-token" };
    let listener: ((event: string, session: TestSession | null) => void) | null = null;
    auth.getSession.mockResolvedValue({ data: { session: storedSession }, error: null });
    auth.getUser.mockResolvedValueOnce({ data: { user: storedSession.user }, error: null })
      .mockReturnValue(verification.promise);
    auth.onAuthStateChange.mockImplementation((nextListener) => {
      listener = nextListener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    render(<OpsAuthProvider><GatedDraft /></OpsAuthProvider>);
    await screen.findByRole("textbox");
    auth.getSession.mockResolvedValue({ data: { session: refreshedSession }, error: null });
    act(() => listener?.("SIGNED_IN", refreshedSession));
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await waitFor(() => expect(auth.getUser).toHaveBeenCalledTimes(2));
    await act(async () => verification.resolve({ data: { user: storedSession.user }, error: null }));
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("cannot restore a verified view after sign-out during a refocus check", async () => {
    const verification = deferred<{ data: { user: { id: string } }; error: null }>();
    let listener: ((event: string, session: TestSession | null) => void) | null = null;
    auth.getSession.mockResolvedValue({ data: { session: storedSession }, error: null });
    auth.getUser.mockResolvedValueOnce({ data: { user: storedSession.user }, error: null })
      .mockReturnValue(verification.promise);
    auth.onAuthStateChange.mockImplementation((nextListener) => {
      listener = nextListener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    render(<OpsAuthProvider><GatedDraft /></OpsAuthProvider>);
    await screen.findByRole("textbox");
    act(() => listener?.("SIGNED_IN", storedSession));
    await waitFor(() => expect(auth.getUser).toHaveBeenCalledTimes(2));
    act(() => listener?.("SIGNED_OUT", null));
    expect(screen.getByText("anonymous")).toBeInTheDocument();
    await act(async () => verification.resolve({ data: { user: storedSession.user }, error: null }));
    expect(screen.getByText("anonymous")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
