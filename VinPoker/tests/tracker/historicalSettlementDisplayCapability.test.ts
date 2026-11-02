import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURES } from "@/lib/featureFlags";

const panel = readFileSync(resolve(process.cwd(), "src/components/cashier/tournament-live/HandHistoryWorkspace.tsx"), "utf8");
const control = readFileSync(resolve(process.cwd(), "src/components/cashier/tournament-live/HistoricalSettlementDisplayControl.tsx"), "utf8");
const batchControl = readFileSync(resolve(process.cwd(), "src/components/cashier/tournament-live/HistoricalSettlementBatchControl.tsx"), "utf8");
const commitIntent = readFileSync(resolve(process.cwd(), "src/lib/tracker-poker/historicalCommitIntent.ts"), "utf8");

describe("historical settlement display capability", () => {
  it("enables the historical Edge caller only outside the legacy edit path", () => {
    expect(FEATURES.trackerHistoricalSettlementDisplay).toBe(true);
    expect(FEATURES.trackerHistoricalSettlementBulk).toBe(false);
    expect(panel).toContain("FEATURES.trackerHistoricalSettlementDisplay && !editMode");
  });

  it("submits only an intent plus preview CAS values, never a browser winner or stack", () => {
    expect(control).toContain('mode: "preview"');
    expect(control).toContain('mode: "commit"');
    expect(commitIntent).toContain("expected_source_revision: preview.sourceRevision");
    expect(control).toContain("parseHistoricalSettlementDisplayPreview(data, crypto.randomUUID())");
    expect(commitIntent).toContain("idempotency_key: preview.idempotencyKey");
    expect(control).toContain('body: { mode: "commit", ...intent }');
    expect(control).not.toMatch(/\bwinner_id\s*:/);
    expect(control).not.toMatch(/\bending_stack\s*:/);
    expect(batchControl).not.toMatch(/\bwinner_id\s*:/);
    expect(batchControl).not.toMatch(/\bending_stack\s*:/);
  });

  it("uses the safe diagnostic boundary instead of exposing the raw function error", () => {
    expect(control).toContain("diagnoseHistoricalSettlementInvocation");
    expect(batchControl).toContain("diagnoseHistoricalSettlementInvocation");
    expect(batchControl).toContain("data-historical-diagnostic");
    expect(batchControl).not.toContain("responseCode(");
  });

  it("fails closed with a safe preview diagnostic when the Edge invocation throws", () => {
    expect(control).toContain("catch (error)");
    expect(control).toContain('diagnoseHistoricalSettlementInvocation({ data: null, error, mode: "preview", handId })');
  });
});
