import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const hookSource = readFileSync(resolve(root, "src/hooks/useDealerSwing.ts"), "utf8");
const panelSource = readFileSync(resolve(root, "src/components/cashier/DealerSwingTab.tsx"), "utf8");
const stopSource = readFileSync(resolve(root, "src/components/cashier/dealer-swing/DealerSwingStopControl.tsx"), "utf8");
const stopSql = readFileSync(resolve(root, "supabase/migrations/20270128000064_dealer_swing_scoped_stop_v1.sql"), "utf8");

describe("Dealer Swing Floor V3 inventory convergence", () => {
  it("reads the authoritative club table inventory while Floor V3 is enabled", () => {
    expect(hookSource).toContain("getClubTableInventory");
    expect(hookSource).toContain("projectDealerOperationalTable");
    expect(hookSource).toContain('"table_sessions", "tournament_tables", "dealer_assignments"');
  });

  it("opens and closes cash or VIP sessions through the fixed Floor V3 adapter", () => {
    expect(panelSource).toContain("floorV3.openClubTables");
    expect(panelSource).toContain("floorV3.closeClubTable");
    expect(panelSource).toContain("Bàn giải phải được mở trong Floor");
  });

  it("blocks the legacy bulk path and requires server close readiness for tours", () => {
    expect(panelSource).toContain("không thể dùng đường đóng bàn legacy");
    expect(panelSource).toContain("Đóng hàng loạt đang khóa để tránh bỏ qua phiên bàn V3");
    expect(panelSource).toContain("getDealerTourCloseReadiness");
    expect(panelSource).toContain("archive_and_close_dealer_tour");
  });

  it("stops Auto-Swing with an explicit OFF write and never invokes the toggle path", () => {
    expect(panelSource).toContain("<DealerSwingStopControl");
    const handler = stopSource.match(/const\s+stop\s*=\s*async\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\};/)?.[1];
    expect(handler).toBeDefined();
    expect(handler).toContain('stopApi.rpc("operator_stop_dealer_swing_v1"');
    expect(handler).toContain("p_club_id: intent.clubId");
    expect(handler).toContain("p_request_id: intent.requestId");
    expect(handler).toContain("p_expected_actor_id: intent.actorId");
    expect(handler).not.toContain('from("club_settings")');
    expect(handler).not.toContain(".upsert(");
    expect(stopSql).toContain("UPDATE public.club_settings SET auto_swing_enabled=false WHERE club_id=p_club_id");
    expect(stopSql).not.toMatch(/SET\s+auto_swing_enabled\s*=\s*true/i);
    expect(handler).toContain("onStopped()");
    expect(handler).not.toContain("onToggleAutoSwing()");
    expect(handler).not.toContain("massAssign");
    expect(handler).not.toContain("autoSwingAll");
  });
});
