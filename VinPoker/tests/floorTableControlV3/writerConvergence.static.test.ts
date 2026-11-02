import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Floor Table Control V3 writer convergence source guards", () => {
  it("keeps the V3 source gate fail-closed and routes browser calls through one fixed adapter", () => {
    const flags = read("src/lib/featureFlags.ts");
    const adapter = read("src/lib/floorTableControlV3.ts");

    expect(flags).toContain("isFloorTableControlV3PreviewEnabled() || isFloorTableControlV3ProductionEnabled()");
    expect(flags).toContain('return flagValue === "preview" && environmentValue === "preview"');
    expect(flags).toContain('return flagValue === "production" && environmentValue === "production"');
    expect(adapter).toContain("FLOOR_TABLE_CONTROL_V3_DISABLED");
    expect(adapter).toContain('"floor_open_tournament_table_v3"');
    expect(adapter).toContain('"validate_tracker_table_writer_context_v3"');
    expect(adapter).not.toContain("rpc(name: string");
  });

  it("does not retain a browser game_tables update fallback in Dealer Swing", () => {
    const dealerSwing = read("src/components/cashier/DealerSwingTab.tsx");
    expect(dealerSwing).not.toMatch(/from\(["']game_tables["']\)\.update\(/);
    expect(dealerSwing).not.toContain('massOpenGate === "legacy"');
  });

  it("uses physical inventory and game_table_id when the future V3 opener is enabled", () => {
    const opener = read("src/components/cashier/tournament-live/OpenTableDialog.tsx");

    expect(opener).toContain("getClubTableInventory");
    expect(opener).toContain("v3GameTableIdByNumber");
    expect(opener).toContain("openTournamentTable");
    expect(opener).toContain("missingState={tableControlV3.enabled ? \"unavailable\" : \"available\"}");
    expect(opener).toContain("disabled={busy || tableControlV3.enabled}");
  });

  it("allows the V3 UI only in the guarded non-production Preview build", () => {
    const previewAudit = read("../.github/workflows/floor-v3-preview-audit.yml");

    expect(previewAudit).toContain("VITE_FLOOR_TABLE_CONTROL_V3: preview");
    expect(previewAudit).toContain("VITE_FLOOR_UAT_ENV: preview");
    expect(previewAudit).toContain("check-floor-audit-context.mjs");
    expect(previewAudit).toContain("github.ref != 'refs/heads/main'");
  });

  it("mounts the canonical V3 map rather than a legacy mixed-id reader when Preview is enabled", () => {
    const tableMap = read("src/components/cashier/tournament-live/FloorTableMapPanel.tsx");
    const v3Map = read("src/components/cashier/tournament-live/FloorTableMapPanelV3.tsx");

    expect(tableMap).toContain("<FloorTableMapPanelV3");
    expect(v3Map).toContain("getTournamentTableRoster");
    expect(v3Map).toContain("getSeatableEntries");
    expect(v3Map).toContain("<MovePlayerDialog actorId={actorId}");
    const moveDialog = read("src/components/cashier/tournament-live/MovePlayerDialog.tsx");
    expect(moveDialog).toContain("canonical.movePlayerSeatExact(frozen.intent)");
    expect(moveDialog).toContain("canonical.movePlayerSeatOrQueueExact(frozen.intent)");
    expect(v3Map).not.toContain("v3.movePlayerSeat(");
    expect(v3Map).toContain("breakTournamentTable");
    expect(v3Map).toContain('role="status"');
    expect(v3Map).toContain('role="alert"');
    expect(v3Map).toContain("min-h-12");
    expect(v3Map).not.toMatch(/functions\.invoke|from\(["']tournament_seats["']\)/);
  });
});
