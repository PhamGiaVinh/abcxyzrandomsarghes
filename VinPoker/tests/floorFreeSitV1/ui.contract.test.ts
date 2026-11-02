import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const panel = readFileSync(
  resolve(process.cwd(), "src/components/cashier/tournament-live/FloorTableMapPanelV3.tsx"),
  "utf8",
);
const flags = readFileSync(resolve(process.cwd(), "src/lib/featureFlags.ts"), "utf8");

describe("Floor Free Sit V1 UI contract", () => {
  it("shows concise player actions before destination controls", () => {
    expect(panel).toContain('data-ops-action="floor.player.open_move"');
    expect(panel).toContain("<MovePlayerDialog actorId={actorId}");
    expect(panel).toContain("entryId={moveTarget.entryId}");
    expect(panel).toContain('data-ops-action="floor.player.open_free_sit"');
    expect(panel).toContain('data-ops-action="floor.player.open_bust"');
    expect(panel).toContain("open={moveOpen}");
    expect(panel).toContain("Rời ghế");
  });

  it("explains the preserved stack and Waiting transition before confirmation", () => {
    expect(panel).toContain("giữ nguyên chip và trở về danh sách chờ");
    expect(panel).toContain("Chip giữ lại");
    expect(panel).toContain("Xác nhận rời ghế");
    expect(panel).toContain("break-all font-semibold");
    expect(panel).toContain("Kiểm tra vị trí mới của từng người trước khi xác nhận.");
    expect(panel).toContain("breakPlan?.planHash");
    expect(panel).toContain("!breakPlan?.complete");
    expect(panel).toContain("Chưa có phương án đầy đủ. Bàn sẽ không bị đóng.");
    expect(panel).not.toContain("Server sẽ kiểm tra sức chứa");
  });

  it("keeps the write path behind the explicit Free Sit flag", () => {
    expect(flags).toContain("floorFreeSitV1: true");
    expect(panel).toContain("FEATURES.floorFreeSitV1");
  });
});
