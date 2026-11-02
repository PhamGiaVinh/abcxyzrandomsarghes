import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canUseTrackerAtomicResettle, FEATURES } from "@/lib/featureFlags";

const handHistoryPath = resolve(process.cwd(), "src/components/cashier/tournament-live/HandHistoryWorkspace.tsx");
const handHistorySource = readFileSync(handHistoryPath, "utf8");

describe("tracker atomic resettle capability gate", () => {
  it("requires both the source flag and deployment acknowledgement", () => {
    expect(canUseTrackerAtomicResettle(false, false)).toBe(false);
    expect(canUseTrackerAtomicResettle(false, true)).toBe(false);
    expect(canUseTrackerAtomicResettle(true, false)).toBe(false);
    expect(canUseTrackerAtomicResettle(true, true)).toBe(true);
  });

  it("enables the source flag only with the deployment acknowledgement", () => {
    expect(FEATURES.trackerAtomicResettle).toBe(true);
  });

  it("checks capability before the atomic Edge invocation", () => {
    // The earlier preview is read-only and intentionally available while the
    // write capability is dark. Check the confirm/write callback, not preview.
    const confirm = handHistorySource.indexOf("const handleResettleConfirm =");
    expect(confirm).toBeGreaterThan(-1);
    const guard = handHistorySource.indexOf("if (!isTrackerAtomicResettleAvailable())", confirm);
    const invoke = handHistorySource.indexOf('supabase.functions.invoke("tournament-live-resettle-commit"', confirm);
    expect(guard).toBeGreaterThan(-1);
    expect(invoke).toBeGreaterThan(guard);
    expect(handHistorySource.slice(invoke, invoke + 160)).toContain('mode: "commit"');
  });

  it("does not send client-selected winners or mucks to the atomic writer", () => {
    const manualWinnerGuard = handHistorySource.indexOf("rv.editedTarget.manualWinnerIds");
    const serverEdit = handHistorySource.indexOf("const serverEdit = buildServerSettlementEdit(rv.patch)");
    const invoke = handHistorySource.indexOf('supabase.functions.invoke("tournament-live-resettle-commit"', serverEdit);
    expect(manualWinnerGuard).toBeGreaterThan(-1);
    expect(serverEdit).toBeGreaterThan(manualWinnerGuard);
    expect(invoke).toBeGreaterThan(serverEdit);
  });
});
