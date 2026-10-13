import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  FLOOR_CASHIER_ACTION_IDS,
  FLOOR_CASHIER_BUTTON_MANIFEST,
} from "@/ops/coverage/floorCashierButtonManifest";

const root = resolve(import.meta.dirname, "../..");
const coveredFiles = [
  "src/ops/floor/FloorTournamentWorkspace.tsx",
  "src/pages/ops/OpsTournaments.tsx",
  "src/pages/ops/OpsTables.tsx",
  "src/pages/ops/OpsTournamentCockpit.tsx",
  "src/pages/ops/OpsCashier.tsx",
  "src/components/ops/shared/PlayerActionSheets.tsx",
  "src/components/ops/shared/FloorSeatRoster.tsx",
  "src/components/ops/shared/FloorEntryPicker.tsx",
  "src/components/ops/shared/RoomGrid.tsx",
  "src/components/ops/shared/FloorTableRosterIndex.tsx",
  "src/components/ops/shared/FloorTableControlMode.tsx",
  "src/components/ops/shared/FloorTableNumberPicker.tsx",
  "src/components/ops/shared/FloorTableModePicker.tsx",
  "src/components/cashier/tournament-live/OpenTableDialog.tsx",
  "src/components/cashier/tournament-live/FloorTableMapPanelV3.tsx",
  "src/components/cashier/tournament-live/AddPlayerDialog.tsx",
] as const;
const interactiveTags = new Set(["button", "Button", "AlertDialogAction", "AlertDialogCancel"]);

describe("Floor and Cashier button coverage", () => {
  it("requires every authored interactive control to declare a known action id", () => {
    const missing: string[] = [];
    const unknown: string[] = [];
    for (const file of coveredFiles) {
      const source = readFileSync(resolve(root, file), "utf8");
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) && interactiveTags.has(node.tagName.getText(sourceFile))) {
          const action = node.attributes.properties.find(
            (property): property is ts.JsxAttribute =>
              ts.isJsxAttribute(property) && property.name.getText(sourceFile) === "data-ops-action",
          );
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          if (!action?.initializer || !ts.isStringLiteral(action.initializer)) {
            missing.push(`${file}:${line}`);
          } else if (!FLOOR_CASHIER_ACTION_IDS.has(action.initializer.text)) {
            unknown.push(`${file}:${line}:${action.initializer.text}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
    expect(missing).toEqual([]);
    expect(unknown).toEqual([]);
  });

  it("requires unique actions and ownership proof for every destructive action", () => {
    const ids = FLOOR_CASHIER_BUTTON_MANIFEST.map((item) => item.actionId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of FLOOR_CASHIER_BUTTON_MANIFEST) {
      expect(item.labelOrTestId).toBe(`[data-ops-action="${item.actionId}"]`);
      expect(item.route).toMatch(/^\/ops\//u);
      expect(item.expectedBackendCall.length).toBeGreaterThan(0);
      expect(item.expectedDbInvariant.length).toBeGreaterThan(0);
      if (item.destructive) {
        expect(item.fixtureScenario).toMatch(/^CODEX_FLOOR_UAT_/u);
        expect(item.sideEffectClass).toBe("DESTRUCTIVE");
      }
    }
  });

  it("keeps production Cashier read-only and free from mounted money adapters", () => {
    const cashier = readFileSync(resolve(root, "src/pages/ops/OpsCashier.tsx"), "utf8");
    expect(cashier).not.toContain("@/ops/opsMutations");
    expect(cashier).not.toMatch(/\.rpc\s*\(|functions\.invoke|manual_confirm_bank_transaction|admin-confirm-funded/u);
    expect(cashier).not.toMatch(/confirmOfflineBuyIn|confirmRegistration|confirmSepay|confirmStaking|reviewVerification|approve_verification/u);
    expect(cashier).toContain("OPS MONEY GATE B đang tắt");
  });

  it("does not ship mock-success controls in the mounted Floor action graph", () => {
    const playerActions = readFileSync(resolve(root, "src/components/ops/shared/PlayerActionSheets.tsx"), "utf8");
    expect(playerActions).not.toMatch(/bản mẫu|\(mẫu\)|Đã gửi lệnh in/u);
  });
});
