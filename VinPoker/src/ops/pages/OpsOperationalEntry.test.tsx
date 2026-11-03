import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpsModuleGate } from "./OpsEntryResolver";
import { getOpsModule, type OpsModuleId } from "@/ops/registry/opsModuleRegistry";

const h = vi.hoisted(() => ({ loading: false, scopeError: null as string | null,
  allowed: true, superAdmin: false, tourEnabled: false, clubs: ["club-a"], verify: vi.fn(),
  workspace: { verifiedSuperAdminClubs: new Map(), rememberVerifiedSuperAdminClub: vi.fn() },
}));
vi.mock("@/lib/featureFlags", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/featureFlags")>(), get OPS_TOUR_CASHIER_ENABLED() { return h.tourEnabled; } }));
vi.mock("@/ops/auth/OpsCapabilityProvider", () => ({ useOpsCapabilities: () => ({
  loading: h.loading, scopeError: h.scopeError, availableModules: h.allowed
    ? ["cashier", "tracker", "dealer-control", "fnb", "marketing", "chip-ops", "accountant", "series"].map(id => getOpsModule(id as OpsModuleId)) : [],
  moduleClubIds: () => h.clubs, isSuperAdmin: h.superAdmin, verifySuperAdminClub: h.verify,
}) }));
vi.mock("@/ops/workspace/OpsWorkspaceProvider", () => ({ useOpsWorkspace: () => h.workspace }));
vi.mock("@/ops/auth/OpsAuthProvider", () => ({ useOpsAuth: () => ({ user: { id: "operator" }, loading: false }) }));
const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
const replace = vi.fn();
beforeEach(() => {
  h.loading = false; h.scopeError = null; h.allowed = true; h.superAdmin = false; h.tourEnabled = false;
  h.clubs = ["club-a"]; h.verify.mockReset(); replace.mockReset();
  h.workspace.verifiedSuperAdminClubs.clear();
  Object.defineProperty(window, "location", { configurable: true, value: {
    origin: "https://vinpoker.vercel.app", search: "?club=club-b&t=stale&tab=offline_buyin", hash: "#stale", replace,
  } });
});
afterEach(() => { cleanup(); if (originalLocation) Object.defineProperty(window, "location", originalLocation); });
function mount(id: OpsModuleId, path = getOpsModule(id).route) {
  return render(<MemoryRouter initialEntries={[path + "?club=club-a"]}>
    <OpsModuleGate capability={id}><div>child workspace</div></OpsModuleGate>
  </MemoryRouter>);
}
describe("operational module document entry", () => {
  it.each([
    ["cashier", "/cashier"], ["tracker", "/tracker"], ["dealer-control", "/dealer-swing"],
    ["fnb", "/fnb/hub"], ["marketing", "/marketing"], ["chip-ops", "/chip-ops"],
    ["accountant", "/accountant"], ["series", "/club/admin/series-intelligence"],
  ] as const)("opens %s through its existing operational document", (id, target) => {
    mount(id); expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith("https://vinpoker.vercel.app" + target);
    expect(screen.queryByText("child workspace")).not.toBeInTheDocument();
  });
  it.each([
    ["counter", "/fnb"], ["serve", "/fnb/serve"], ["kitchen", "/fnb/kitchen"], ["admin", "/fnb/admin"],
  ])("retains the F&B %s destination without granting its facet", (facet, target) => {
    mount("fnb", "/ops/fnb/" + facet);
    expect(replace).toHaveBeenCalledWith("https://vinpoker.vercel.app" + target);
  });
  it("uses the enabled tour counter directly instead of looping multi-club cashiers through the hub", () => {
    h.tourEnabled = true; mount("cashier");
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("child workspace")).toBeInTheDocument();
  });
  it("does not redirect the existing tour cashier writer back into the legacy counter", () => {
    mount("cashier", "/ops/cashier/tour"); expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("child workspace")).toBeInTheDocument();
  });
  it.each(["loading", "error", "no-module", "wrong-club"])("never opens an unverified scope: %s", kind => {
    if (kind === "loading") h.loading = true;
    if (kind === "error") h.scopeError = "scope unavailable";
    if (kind === "no-module") h.allowed = false;
    if (kind === "wrong-club") h.clubs = ["club-b"];
    mount("accountant"); expect(replace).not.toHaveBeenCalled();
  });
  it("waits for fresh super-admin club verification before opening an operational document", async () => {
    h.superAdmin = true; h.clubs = [];
    let finish!: (value: unknown) => void;
    h.verify.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    mount("accountant"); expect(replace).not.toHaveBeenCalled();
    await act(async () => finish({ club_id: "club-a", club_name: "A" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("https://vinpoker.vercel.app/accountant"));
  });
  it("does not open a club rejected by super-admin verification", async () => {
    h.superAdmin = true; h.clubs = []; h.verify.mockResolvedValue(null);
    mount("fnb"); await screen.findByText(/Không xác minh được CLB/);
    expect(replace).not.toHaveBeenCalled();
  });
});
