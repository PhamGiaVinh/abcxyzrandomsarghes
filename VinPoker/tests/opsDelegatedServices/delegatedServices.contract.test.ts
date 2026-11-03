import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseIssuedChipInventory } from "@/ops/chip-ops/chipOpsReadAdapter";
import { DELEGATED_SERVICES_BUTTON_MANIFEST } from "@/ops/coverage/delegatedServicesButtonManifest";
import { getOpsModule } from "@/ops/registry/opsModuleRegistry";

const root = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Ops delegated service boundaries", () => {
  it("opens F&B and Marketing documents without importing their legacy modules", () => {
    const app = source("src/OpsApp.tsx");
    for (const route of ["/ops/fnb", "/ops/fnb/counter", "/ops/fnb/serve", "/ops/fnb/kitchen", "/ops/fnb/admin"]) {
      expect(app).toContain(`path="${route}" element={<OpsModuleGate capability="fnb" />}`);
    }
    expect(app).toContain('path="/ops/marketing" element={<OpsModuleGate capability="marketing" />}');
    expect(app).not.toContain("FnbCounter");
    expect(app).not.toContain("FnbServe");
    expect(app).not.toContain("MarketingManager");
    expect(app).not.toContain("PostComposer");
    expect(getOpsModule("fnb").defaultState).toBe("LIVE");
    expect(getOpsModule("marketing").defaultState).toBe("LIVE");
  });

  it("mounts a fixed read-only Chip Ops adapter", () => {
    const app = source("src/OpsApp.tsx");
    const adapter = source("src/ops/chip-ops/chipOpsReadAdapter.ts");
    const graph = [
      adapter,
      source("src/ops/chip-ops/OpsChipOpsWorkspace.tsx"),
      source("src/ops/chip-ops/ChipOpsWorkspaceView.tsx"),
    ].join("\n");

    expect(app).toContain('<OpsModuleGate capability="chip-ops"><OpsChipOpsWorkspace /></OpsModuleGate>');
    expect(adapter).toContain('client.rpc("get_issued_chip_inventory"');
    expect(graph).not.toContain("callRpc(");
    expect(graph).not.toContain("@/integrations/supabase/client");
    expect(graph).not.toContain("@/hooks/useAuth");
    expect(adapter).not.toMatch(/\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/u);
    expect(graph).not.toMatch(/functions\.invoke|\.channel\s*\(/u);
    expect(graph).not.toMatch(/chip_ops_(create|update|delete|bind)|get_current_chip_inventory|color_up|bag_tag|stocktake/iu);
    expect(getOpsModule("chip-ops").defaultState).toBe("LIVE");
  });

  it("fails closed on malformed or cross-tournament inventory", () => {
    const tournamentId = "20000000-0000-4000-8000-000000000010";
    const valid = {
      tournament_id: tournamentId,
      denominations: [{
        denomination_id: "30000000-0000-4000-8000-000000000010",
        value: 1_000,
        color: "blue",
        issued_count_total: 90,
      }],
      total_value: 90_000,
      reconciliation_value: 90_000,
      reconciled: true,
    };
    expect(parseIssuedChipInventory(valid, tournamentId).totalValue).toBe(90_000);
    expect(() => parseIssuedChipInventory(valid, "20000000-0000-4000-8000-000000000011"))
      .toThrow("CHIP_OPS_INVENTORY_SCOPE_MISMATCH");
    expect(() => parseIssuedChipInventory({ ...valid, total_value: -1 }, tournamentId))
      .toThrow("CHIP_OPS_INVENTORY_MALFORMED");
    expect(() => parseIssuedChipInventory({ error: "Forbidden" }, tournamentId))
      .toThrow("CHIP_OPS_INVENTORY_READ_FAILED");
  });

  it("has one enabled read action while disabled modules expose none", () => {
    expect(DELEGATED_SERVICES_BUTTON_MANIFEST).toEqual([expect.objectContaining({
      actionId: "chip-ops.refresh",
      sideEffectClass: "READ",
      disposition: "CLICKED_PASS",
    })]);
  });
});
