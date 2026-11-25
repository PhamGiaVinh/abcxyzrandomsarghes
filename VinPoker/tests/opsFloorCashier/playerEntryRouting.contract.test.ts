import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(repo, path), "utf8");

describe("legacy player-shell operator entry routing", () => {
  it("renders the existing Floor and Cashier dashboards inside the player app", () => {
    const app = source("src/App.tsx");

    expect(app).toContain('const FloorDashboard = lazy(() => import("./pages/FloorDashboard"));');
    expect(app).toContain('const CashierDashboard = lazy(() => import("./pages/CashierDashboard"));');
    expect(app).toContain('<Route path="/floor" element={<FloorDashboard />} />');
    expect(app).toContain('<Route path="/cashier" element={<FinanceLegacyRedirect />} />');
    expect(app).toContain('<Route path="/finance/transactions" element={<CashierDashboard />} />');
    const legacy = source("src/pages/FinanceLegacyRedirect.tsx");
    expect(legacy).toContain('pathname === "/cashier" ? "/finance/transactions"');
    expect(legacy).toContain('destination + search + hash');
    expect(app).not.toContain('<DocumentRedirect to="/ops/floor" />');
    expect(app).not.toContain('<DocumentRedirect to="/ops/cashier" />');
  });

  it("keeps the player operations menu on player routes", () => {
    const layout = source("src/components/Layout.tsx");

    expect(layout).toContain('onClick={() => nav("/floor")}');
    expect(layout).toContain('onClick={() => nav("/cashier")}');
    expect(layout).not.toContain('href="/ops/floor"');
    expect(layout).not.toContain('href="/ops/cashier"');
  });

  it("preserves the separate Ops application for direct access", () => {
    const opsApp = source("src/OpsApp.tsx");

    expect(opsApp).toContain('path="/ops/floor"');
    expect(opsApp).toContain('path="/ops/cashier"');
  });
});
