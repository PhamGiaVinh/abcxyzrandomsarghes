import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFinanceSummary, currentMonthFinanceRange } from "@/ops/finance/financeReadAdapter";
import { FINANCE_SERIES_BUTTON_MANIFEST } from "@/ops/coverage/financeSeriesButtonManifest";
import { getOpsModule } from "@/ops/registry/opsModuleRegistry";

const root = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Ops Finance and Series read boundaries", () => {
  it.each([
    ['2026-10-01T00:30:00.123+07:00','2026-10-01T00:00:00+07:00'],
    ['2027-01-01T00:30:00.123+07:00','2027-01-01T00:00:00+07:00'],
    ['2024-02-29T23:59:59.999+07:00','2024-02-01T00:00:00+07:00'],
    ['2026-10-24T10:15:22.123Z','2026-10-01T00:00:00+07:00'],
  ])('keeps the UTC+7 month start and exact as-of cutoff at %s',(now,start)=>{
    const instant=new Date(now),range=currentMonthFinanceRange(instant);
    expect(range.from).toBe(new Date(start).toISOString());
    expect(range.to).toBe(instant.toISOString());
  });
  it("mounts Ops-native read workspaces", () => {
    const app = source("src/OpsApp.tsx");
    expect(app).toContain('<OpsModuleGate capability="finance"><OpsFinanceWorkspace /></OpsModuleGate>');
    expect(app).toContain('<OpsModuleGate capability="series"><OpsSeriesWorkspace /></OpsModuleGate>');
    expect(app).toContain('path="/ops/accounting" element={<Navigate to="/ops/finance" replace />}');
    expect(getOpsModule("finance").title).toBe("Tài chính & Đối soát");
    expect(getOpsModule("finance").defaultState).toBe("READ_ONLY");
    expect(getOpsModule("series").defaultState).toBe("READ_ONLY");
  });

  it("uses only fixed server read RPCs and no player/local fallback", () => {
    const finance = [
      source("src/ops/finance/financeReadAdapter.ts"),
      source("src/ops/finance/OpsFinanceWorkspace.tsx"),
      source("src/ops/finance/FinanceWorkspaceView.tsx"),
    ].join("\n");
    const series = [
      source("src/ops/series/seriesReadAdapter.ts"),
      source("src/ops/series/OpsSeriesWorkspace.tsx"),
      source("src/ops/series/SeriesWorkspaceView.tsx"),
    ].join("\n");
    const graph = finance + series;

    expect(finance).toContain('client.rpc("get_club_finance_summary"');
    expect(finance).not.toMatch(/\.from\s*\(|useClubFinanceSummary/iu);
    expect(series).toContain('client.rpc("get_club_series_events"');
    expect(series).not.toMatch(/localStorage|sessionStorage|useSeriesLibrary|useNativeSeriesEvents|navigate\(-1\)/u);
    expect(graph).not.toContain("@/integrations/supabase/client");
    expect(graph).not.toContain("@/hooks/useAuth");
    expect(graph).not.toMatch(/\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|functions\.invoke|\.channel\s*\(/u);
  });

  it("fails Finance closed instead of rendering fake zeros", () => {
    const valid = {
      revenue: { total: 1_000, rake: 500, serviceFee: 100, stakingFees: 100, payoutFees: 100, fnb: 200 },
      cost: { payrollNet: 200, ptWagePaid: 50, fnbCogs: 40, compCogs: 10, clubExpenses: 100 },
      net: 600,
    };
    expect(parseFinanceSummary(valid).net).toBe(600);
    expect(() => parseFinanceSummary({ ...valid, revenue: { total: 1_000 } })).toThrow("FINANCE_SUMMARY_MALFORMED");
    expect(() => parseFinanceSummary({ ...valid, cost: { ...valid.cost, payrollNet: "0" } })).toThrow("FINANCE_SUMMARY_MALFORMED");
    expect(() => parseFinanceSummary({ error: "Forbidden" })).toThrow("FINANCE_SUMMARY_RPC_UNAVAILABLE");
  });

  it("covers exactly the two read refresh actions", () => {
    expect(FINANCE_SERIES_BUTTON_MANIFEST).toHaveLength(2);
    for (const entry of FINANCE_SERIES_BUTTON_MANIFEST) {
      expect(entry.sideEffectClass).toBe("READ");
      expect(entry.disposition).toBe("CLICKED_PASS");
    }
  });
});
