import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FnbHub from "./FnbHub";
import Marketing from "./Marketing";
const h = vi.hoisted(() => ({ auth: { loading: false, rolesLoading: true,
  authError: null as string | null, rolesError: null as string | null,
  isClubOwner: false, isAdmin: false, isFnbCashier: false, isFnbServer: false, isFnbKitchen: false, isMarketing: false,
} }));
vi.mock("@/hooks/useOperationalCapabilities", () => ({ useOperationalCapabilities: () => ({ loading: h.auth.rolesLoading, error: Boolean(h.auth.rolesError), allows: () => h.auth.isClubOwner, hasFacet: () => h.auth.isClubOwner }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/components/RouteLoader", () => ({ RouteLoader: () => <p>verifying access</p> }));
vi.mock("@/components/marketing/MarketingManager", () => ({ MarketingManager: () => <p>marketing workspace</p> }));
beforeEach(() => Object.assign(h.auth, { loading: false, rolesLoading: true, authError: null, rolesError: null,
  isClubOwner: false, isAdmin: false, isFnbCashier: false, isFnbServer: false, isFnbKitchen: false, isMarketing: false }));
afterEach(cleanup);
function view(Page: typeof FnbHub) { return render(<MemoryRouter initialEntries={["/module"]}><Routes>
  <Route path="/module" element={<Page />} /><Route path="/" element={<p>home redirect</p>} />
</Routes></MemoryRouter>); }
describe.each([["F&B", FnbHub], ["Marketing", Marketing]] as const)("%s operational entry", (_name, Page) => {
  it("waits for roles before deciding whether to redirect", () => {
    const result = view(Page); expect(screen.getByText("verifying access")).toBeInTheDocument();
    expect(screen.queryByText("home redirect")).not.toBeInTheDocument();
    h.auth.rolesLoading = false; h.auth.isClubOwner = true;
    result.rerender(<MemoryRouter initialEntries={["/module"]}><Routes><Route path="/module" element={<Page />} /></Routes></MemoryRouter>);
    expect(screen.queryByText("verifying access")).not.toBeInTheDocument();
    expect(screen.queryByText("home redirect")).not.toBeInTheDocument();
    expect(screen.getByText(_name === "F&B" ? "Quầy" : "marketing workspace")).toBeInTheDocument();
  });
  it("does not mount operations when role verification fails", () => {
    h.auth.rolesLoading = false; h.auth.rolesError = "unavailable"; h.auth.isClubOwner = true;
    view(Page); expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Quầy")).not.toBeInTheDocument();
    expect(screen.queryByText("marketing workspace")).not.toBeInTheDocument();
  });
  it("denies a verified caller without the module role", () => {
    h.auth.rolesLoading = false; view(Page);
    expect(screen.getByText("home redirect")).toBeInTheDocument();
  });
});
