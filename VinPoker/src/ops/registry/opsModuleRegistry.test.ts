import { describe, expect, it } from "vitest";
import {
  OPS_MODULE_REGISTRY,
  getAvailableOpsModules,
  getAvailableOpsModulesForSource,
  getModuleClubIds,
  getOpsModule,
  getOpsModuleByPath,
  isOpsModuleFeatureEnabled,
  type OpsScopeSnapshot,
} from "@/ops/registry/opsModuleRegistry";
import type { OpsClubCapabilityRow } from "@/ops/auth/opsCapabilityContract";

const emptyRow = (club_id: string): OpsClubCapabilityRow => ({
  club_id,
  can_owner: false,
  can_floor: false,
  can_cashier: false,
  can_tracker: false,
  can_dealer_control: false,
  can_accountant: false,
  can_chip_master: false,
  can_marketer: false,
  can_fnb_cashier: false,
  can_fnb_server: false,
  can_fnb_kitchen: false,
});

const scope = (clubs: OpsClubCapabilityRow[], isSuperAdmin = false): OpsScopeSnapshot => ({
  clubs,
  global: { is_super_admin: isSuperAdmin },
});

describe("Ops module runtime registry", () => {
  it("names the personnel finance workspace without relaxing its payroll guard", () => {
    const accountant = getOpsModule("accountant");
    expect(accountant.title).toBe("Tài chính & Đối soát · nhân sự");
    expect(accountant.route).toBe("/ops/accountant");
    expect(accountant.sideEffectClass).toBe("MONEY");
    expect(accountant.defaultState).toBe("BLOCKED");
    expect(accountant.disabledReasonCode).toBe("ACCOUNTANT_PAYROLL_GUARD_NOT_LIVE");
    const allowed = { ...emptyRow("10000000-0000-4000-8000-000000000001"), can_accountant: true };
    expect(accountant.clubCapabilityPredicate(allowed)).toBe(true);
    expect(accountant.clubCapabilityPredicate(emptyRow(allowed.club_id))).toBe(false);
  });

  it("has unique ids/routes and complete safety metadata", () => {
    expect(new Set(OPS_MODULE_REGISTRY.map((module) => module.id)).size).toBe(OPS_MODULE_REGISTRY.length);
    expect(new Set(OPS_MODULE_REGISTRY.map((module) => module.route)).size).toBe(OPS_MODULE_REGISTRY.length);
    for (const module of OPS_MODULE_REGISTRY) {
      expect(module.route.startsWith("/ops/")).toBe(true);
      expect(module.requiredContracts.length).toBeGreaterThan(0);
      expect(module.sideEffectClass).toBeTruthy();
      if (module.defaultState === "BLOCKED" || module.defaultState === "DISABLED") {
        expect(module.disabledReasonCode).toBeTruthy();
      }
    }
  });

  it("keeps cross-club capabilities scoped to their exact module", () => {
    const floor = { ...emptyRow("10000000-0000-4000-8000-000000000001"), can_floor: true };
    const cashier = { ...emptyRow("10000000-0000-4000-8000-000000000002"), can_cashier: true };
    const tracker = { ...emptyRow("10000000-0000-4000-8000-000000000003"), can_tracker: true };
    const kitchen = { ...emptyRow("10000000-0000-4000-8000-000000000004"), can_fnb_kitchen: true };
    const snapshot = scope([floor, cashier, tracker, kitchen]);
    expect(getAvailableOpsModules(snapshot).map((module) => module.id)).toEqual([
      "floor", "cashier", "tracker", "fnb",
    ]);
    expect(getModuleClubIds(getOpsModule("floor"), snapshot.clubs)).toEqual([floor.club_id]);
    expect(getModuleClubIds(getOpsModule("cashier"), snapshot.clubs)).toEqual([cashier.club_id]);
    expect(getModuleClubIds(getOpsModule("tracker"), snapshot.clubs)).toEqual([tracker.club_id]);
    expect(getModuleClubIds(getOpsModule("fnb"), snapshot.clubs)).toEqual([kitchen.club_id]);
  });

  it("preserves multiple F&B facets without creating unrelated access", () => {
    const a = {
      ...emptyRow("10000000-0000-4000-8000-000000000001"),
      can_fnb_cashier: true,
      can_fnb_kitchen: true,
    };
    const b = { ...emptyRow("10000000-0000-4000-8000-000000000002"), can_fnb_server: true };
    expect(getModuleClubIds(getOpsModule("fnb"), [a, b])).toEqual([a.club_id, b.club_id]);
    expect(getAvailableOpsModules(scope([a, b])).map((module) => module.id)).toEqual(["fnb"]);
  });

  it("gives super-admin module visibility without expanding the login club list", () => {
    const available = getAvailableOpsModules(scope([], true));
    expect(available).toHaveLength(OPS_MODULE_REGISTRY.length);
    expect(getModuleClubIds(getOpsModule("floor"), [])).toEqual([]);
  });

  it("keeps the 42883 compatibility path limited to legacy modules", () => {
    const owner = { ...emptyRow("10000000-0000-4000-8000-000000000001"), can_owner: true };
    expect(getAvailableOpsModulesForSource(scope([owner]), "legacy").map((module) => module.id)).toEqual([
      "club-admin", "floor", "cashier",
    ]);
    expect(getAvailableOpsModulesForSource(scope([owner]), "unified")).toHaveLength(OPS_MODULE_REGISTRY.length);
  });

  it("matches child paths to their single module definition", () => {
    expect(getOpsModuleByPath("/ops/floor/tournaments/id")?.id).toBe("floor");
    expect(getOpsModuleByPath("/ops/select-module")).toBeNull();
  });

  it("keeps Owner Daily Digest owner-only and production-enabled", () => {
    const digest = getOpsModule("daily-digest");
    const owner = { ...emptyRow("10000000-0000-4000-8000-000000000001"), can_owner: true };
    expect(digest.sideEffectClass).toBe("READ");
    expect(digest.defaultState).toBe("READ_ONLY");
    expect(digest.clubCapabilityPredicate(owner)).toBe(true);
    expect(digest.clubCapabilityPredicate(emptyRow(owner.club_id))).toBe(false);
    expect(isOpsModuleFeatureEnabled(digest, { development: false })).toBe(true);
    expect(isOpsModuleFeatureEnabled(digest, { development: true })).toBe(true);
    expect(isOpsModuleFeatureEnabled(digest, { development: false, superAdmin: true })).toBe(true);
  });
});
