import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
beforeAll(() => { globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });
const m = vi.hoisted(() => ({ rpc: vi.fn(), actor: "owner-a", success: vi.fn(), error: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: m.actor } }) }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = { rpc: m.rpc }; return { useSupabaseClient: () => client };
});
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { tvLayoutEditorV1: true } }));
vi.mock("@/components/ProofUploader", () => ({ ProofUploader: () => <div /> }));
vi.mock("@/components/tournament-clock/VinPokerTournamentClock", () => ({ VinPokerTournamentClock: () => <div /> }));
vi.mock("sonner", () => ({ toast: { success: m.success, error: m.error } }));
import { TvBrandingEditor } from "./TvBrandingEditor";
const branding = { logo_url: null, background_url: null, brand_name: "TEST", layout: {}, revision: 7 };
beforeEach(() => { vi.resetAllMocks(); m.actor = "owner-a"; m.rpc.mockResolvedValue({ data: branding, error: null }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
for (const changed of ["tournament", "actor"]) it(`ignores late publish after ${changed} changes`, async () => {
  const view = render(<TvBrandingEditor tournamentId="tour-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Edit TV layout" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish TV layout" })).toBeEnabled());
  let finish!: (value: unknown) => void;
  m.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Publish TV layout" }));
  if (changed === "actor") m.actor = "owner-b";
  view.rerender(<TvBrandingEditor tournamentId={changed === "tournament" ? "tour-b" : "tour-a"} />);
  await act(async () => finish({ data: { revision: 8 }, error: null }));
  expect(m.success).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("ends a stalled settings read and ignores the late draft", async () => {
  vi.useFakeTimers(); let finish!: (value: unknown) => void;
  m.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<TvBrandingEditor tournamentId="tour-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Edit TV layout" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  expect(screen.queryByText("Loading TV settings…")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Publish TV layout" })).toBeDisabled();
  await act(async () => finish({ data: branding, error: null }));
  expect(screen.queryByLabelText("Brand name")).not.toBeInTheDocument();
});
it("does not acknowledge unchanged content at the old revision after response loss", async () => {
  let submitted: Record<string, unknown> | null = null;
  m.rpc.mockImplementation(async (name, args) => {
    if (name === "save_tv_tournament_layout_v1") { submitted = args; throw new Error("offline"); }
    return { data: submitted ? { brand_name: submitted.p_brand_name, logo_url: submitted.p_logo_url || null,
      background_url: submitted.p_bg_url || null, layout: submitted.p_layout, revision: 7 } : branding, error: null };
  });
  render(<TvBrandingEditor tournamentId="tour-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Edit TV layout" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish TV layout" })).toBeEnabled());
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Publish TV layout" })));
  expect(m.success).not.toHaveBeenCalled(); expect(m.error).toHaveBeenCalled();
});
it("bounds a stalled publish and its readback without retrying the writer", async () => {
  render(<TvBrandingEditor tournamentId="tour-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Edit TV layout" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish TV layout" })).toBeEnabled());
  vi.useFakeTimers(); m.rpc.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "Publish TV layout" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_001); });
  expect(screen.getByRole("button", { name: "Publish TV layout" })).toBeEnabled();
  expect(m.rpc.mock.calls.filter(([name]) => name === "save_tv_tournament_layout_v1")).toHaveLength(1);
  expect(m.success).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it("does not accept an empty success object as proof of publication", async () => {
  m.rpc.mockImplementation(async name => ({ data: name === "save_tv_tournament_layout_v1" ? {} : branding, error: null }));
  render(<TvBrandingEditor tournamentId="tour-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Edit TV layout" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish TV layout" })).toBeEnabled());
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Publish TV layout" })));
  expect(m.success).not.toHaveBeenCalled(); expect(m.error).toHaveBeenCalled();
});
it("reconciles identical JSONB content even when object key order differs", async () => {
  let submitted: Record<string, unknown> | null = null;
  m.rpc.mockImplementation(async (name, args) => {
    if (name === "save_tv_tournament_layout_v1") { submitted = args; throw new Error("offline"); }
    return { data: submitted ? { brand_name: submitted.p_brand_name, logo_url: submitted.p_logo_url || null,
      background_url: submitted.p_bg_url || null, revision: 8,
      layout: Object.fromEntries(Object.entries(submitted.p_layout as Record<string, unknown>).reverse()) } : branding, error: null };
  });
  render(<TvBrandingEditor tournamentId="tour-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Edit TV layout" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Publish TV layout" })).toBeEnabled());
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Publish TV layout" })));
  expect(m.success).toHaveBeenCalledOnce(); expect(m.error).not.toHaveBeenCalled();
});
