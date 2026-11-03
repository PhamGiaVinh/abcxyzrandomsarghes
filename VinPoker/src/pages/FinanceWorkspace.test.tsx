import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import viLocale from "@/i18n/locales/vi.json";

const auth = vi.hoisted(() => ({ isAccountant: false, isClubOwner: false, isAdmin: false, isClubAdmin: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/lib/featureFlags", () => ({ FEATURES: { accountingControl: true } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => viLocale.financeWorkspace[key.split(".")[1] as keyof typeof viLocale.financeWorkspace] }) }));
import FinanceWorkspace from "./FinanceWorkspace";
import { FEATURES } from "@/lib/featureFlags";

beforeEach(() => {
  Object.assign(auth, { isAccountant: false, isClubOwner: false, isAdmin: false, isClubAdmin: false });
  (FEATURES as { accountingControl: boolean }).accountingControl = true;
});
afterEach(cleanup);

function mount(path = "/finance") {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route element={<FinanceWorkspace />}>
    <Route path="/finance" element={null} />
    <Route path="/club/admin/finance" element={<p>Finance page</p>} />
    <Route path="/accountant" element={<p>Payroll page</p>} />
    <Route path="/club/admin/accounting-control" element={<p>Reconciliation page</p>} />
  </Route></Routes></MemoryRouter>);
}

it("keeps all three existing destinations reachable from one entry and between sections", () => {
  auth.isClubOwner = true;
  mount();
  expect(screen.getByRole("heading", { name: "Tài chính & Đối soát" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: /Tổng quan thu–chi/ }));
  expect(screen.getByText("Finance page")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Tổng quan thu–chi" })).toHaveAttribute("aria-current", "page");
  fireEvent.click(screen.getByRole("link", { name: "Lương & nhân sự" }));
  expect(screen.getByText("Payroll page")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Đối soát & báo cáo" }));
  expect(screen.getByText("Reconciliation page")).toBeInTheDocument();
});

it("preserves accountant-only navigation without exposing owner sections", () => {
  auth.isAccountant = true;
  mount();
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("link", { name: /Lương & nhân sự/ })).toHaveAttribute("href", "/accountant");
});

it("preserves the accounting-control flag and club-admin payroll visibility", () => {
  auth.isClubAdmin = true;
  (FEATURES as { accountingControl: boolean }).accountingControl = false;
  mount();
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("link", { name: /Tổng quan thu–chi/ })).toHaveAttribute("href", "/club/admin/finance");
});

it("keeps legacy direct payroll links working with shared navigation", () => {
  auth.isAccountant = true;
  mount("/accountant");
  expect(screen.getByText("Payroll page")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Tài chính & Đối soát" })).toHaveAttribute("href", "/finance");
});
