import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TRACKER_DEALER_BUTTON_MANIFEST } from "@/ops/coverage/trackerDealerButtonManifest";
import { getOpsModule } from "@/ops/registry/opsModuleRegistry";

const root = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Ops Tracker and Dealer Control read-only boundaries", () => {
  it("mounts Ops-native read workspaces behind the registry gates", () => {
    const app = source("src/OpsApp.tsx");
    expect(app).toContain('<OpsModuleGate capability="tracker"><OpsTrackerWorkspace /></OpsModuleGate>');
    expect(app).toContain('<OpsModuleGate capability="dealer-control"><OpsDealerControlWorkspace /></OpsModuleGate>');
    expect(app).not.toContain("TrackerDashboard");
    expect(app).not.toContain("OpsDealerSwing");
    expect(app).not.toContain("DealerSwingDashboard");
  });

  it("keeps both adapters read-only and exact-club scoped", () => {
    const adapters = [
      source("src/ops/tracker/trackerReadAdapter.ts"),
      source("src/ops/dealer-control/dealerControlReadAdapter.ts"),
    ];
    for (const adapter of adapters) {
      expect(adapter).toContain('.eq("club_id", clubId)');
      expect(adapter).not.toMatch(/\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(|functions\.invoke|\.channel\s*\(/u);
      expect(adapter.match(/\.rpc\b/g)).toHaveLength(1);
    }
    expect(adapters[0]).toContain("client.rpc.bind(client)");
    expect([...adapters[0].matchAll(/participationRpc\(\s*"([^"]+)"/g)].map(match => match[1]))
      .toEqual(["get_tournament_participation_counts_v1"]);
    expect(adapters[0]).toContain("p_tournament_id: row.id");
    expect([...adapters[1].matchAll(/\.rpc\(\s*"([^"]+)"/g)].map(match => match[1]))
      .toEqual(["get_club_table_inventory"]);
    expect(adapters[1]).toContain("p_club_id: clubId");
  });

  it("does not import player session, global client, payroll or writer components", () => {
    const graph = [
      "src/ops/tracker/OpsTrackerWorkspace.tsx",
      "src/ops/tracker/TrackerWorkspaceView.tsx",
      "src/ops/tracker/trackerReadAdapter.ts",
      "src/ops/dealer-control/OpsDealerControlWorkspace.tsx",
      "src/ops/dealer-control/DealerControlWorkspaceView.tsx",
      "src/ops/dealer-control/dealerControlReadAdapter.ts",
    ].map(source).join("\n");
    expect(graph).not.toContain("@/integrations/supabase/client");
    expect(graph).not.toContain("@/hooks/useAuth");
    expect(graph).not.toContain("useOperatorClubs");
    expect(graph).not.toMatch(/Payroll|opsSwingActions|assign-dealer|manage-break|checkout-dealer|telegram-swing-notifier/u);
    expect(graph).not.toContain("navigate(-1)");
  });

  it("keeps both modules read-only and rejects guessed club fallbacks", () => {
    expect(getOpsModule("tracker").defaultState).toBe("READ_ONLY");
    expect(getOpsModule("dealer-control").defaultState).toBe("READ_ONLY");

    const containers = [
      source("src/ops/tracker/OpsTrackerWorkspace.tsx"),
      source("src/ops/dealer-control/OpsDealerControlWorkspace.tsx"),
    ].join("\n");
    expect(containers).toContain("capabilities.moduleClubIds");
    expect(containers).toContain("selectedClubId");
    expect(containers).not.toMatch(/moduleClubIds\([^)]*\)\s*\[0\]/u);
    expect(containers).not.toMatch(/preview|bypass/iu);
  });

  it("covers every enabled module action as a read", () => {
    expect(TRACKER_DEALER_BUTTON_MANIFEST).toHaveLength(2);
    for (const entry of TRACKER_DEALER_BUTTON_MANIFEST) {
      expect(entry.labelOrTestId).toContain(entry.actionId);
      expect(entry.sideEffectClass).toBe("READ");
      expect(entry.disposition).toBe("CLICKED_PASS");
    }
  });
});
