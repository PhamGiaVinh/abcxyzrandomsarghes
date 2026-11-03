import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNTANT_WORKSPACE_SECTIONS } from "../../src/ops/accountant/accountantWorkspaceManifest";
import { getOpsModule } from "../../src/ops/registry/opsModuleRegistry";

const repo = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(repo, "supabase/migration-archive/historical-never-replay/20270110000001_ops_accountant_payroll_approval_guard.sql"),
  "utf8",
);
const opsApp = readFileSync(resolve(repo, "src/OpsApp.tsx"), "utf8");

describe("Ops V3 Accountant reconciliation contract", () => {
  it("uses a caller-bound approval helper that excludes Cashier and Accountant membership", () => {
    const helper = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public._assert_payroll_approval_actor"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.transition_payroll_status_secure"),
    );

    expect(helper).toContain("v_actor uuid := auth.uid()");
    expect(helper).toContain("'super_admin'::public.app_role");
    expect(helper).toContain("'club_admin'::public.app_role");
    expect(helper).toContain("public.is_club_admin(v_actor, p_club_id)");
    expect(helper).not.toContain("club_cashiers");
    expect(helper).not.toContain("club_accountants");
  });

  it("routes approve, reject and lock through the strict helper", () => {
    expect(migration).toContain("v_sensitive_review :=");
    expect(migration).toContain("v_actor := public._assert_payroll_approval_actor(v_club_id)");
    expect(migration).toContain("p_new_status IN ('approved', 'rejected')");
    expect(migration).toContain("p_new_status = 'locked'");
  });

  it("keeps the caller-supplied legacy transition unavailable to clients", () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.transition_payroll_status\(uuid, text, text, uuid, text\)[\s\S]*FROM PUBLIC, anon, authenticated;/u,
    );
  });

  it("keeps every Accountant section blocked with an explicit authority contract", () => {
    expect(ACCOUNTANT_WORKSPACE_SECTIONS).toHaveLength(5);
    for (const section of ACCOUNTANT_WORKSPACE_SECTIONS) {
      expect(section.state).toBe("BLOCKED");
      expect(section.reasonCode).toBeTruthy();
      expect(section.requiredContracts.length).toBeGreaterThan(0);
      expect(["MONEY", "DESTRUCTIVE"]).toContain(section.sideEffectClass);
    }
  });

  it("opens the operational Accountant document without importing it or Accounting Control mocks", () => {
    const accountant = getOpsModule("accountant");
    expect(accountant.defaultState).toBe("LIVE");
    expect(accountant.operationalRoute).toBe("/accountant");
    expect(opsApp).toContain('<OpsModuleGate capability="accountant" />');
    expect(opsApp).toContain('path="/ops/accounting" element={<Navigate to="/ops/finance" replace />}');
    expect(opsApp).not.toContain("MOCK_OVERVIEW");
  });
});
