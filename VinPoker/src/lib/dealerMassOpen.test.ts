import { describe, expect, it } from "vitest";
import {
  dealerEdgeErrorMessage,
  isCurrentMassOpenRequest,
  readOpenOperationProgress,
  resolveMassOpenGate,
  shouldContinueOpenOperation,
} from "./dealerMassOpen";

describe("dealer Edge error text boundary", () => {
  it.each([null, undefined, [], 42, "raw", {error:{code:"nested"}}, {error:false}, {error:"  ",message:[] }])("uses SDK fallback for malformed body %j", body => {
    expect(dealerEdgeErrorMessage(body,"SDK failure")).toBe("SDK failure");
  });
  it("preserves the exact conflict code used by assignment reconciliation", () => {
    expect(dealerEdgeErrorMessage({error:"IDEMPOTENCY_CONFLICT",message:"other"},"SDK failure")).toBe("IDEMPOTENCY_CONFLICT");
  });
  it("accepts a text message when the error field is malformed", () => {
    expect(dealerEdgeErrorMessage({error:{code:"nested"},message:"Try the same request"},"SDK failure")).toBe("Try the same request");
  });
});

describe("dealer mass-open client contract", () => {
  it("fails closed, including a missing server RPC", () => {
    expect(resolveMassOpenGate({ allowed: true }, null)).toBe("enabled");
    expect(resolveMassOpenGate({ allowed: false }, null)).toBe("disabled");
    expect(resolveMassOpenGate(null, { code: "42501", message: "denied" })).toBe("disabled");
    expect(resolveMassOpenGate(null, {
      code: "PGRST202",
      message: "get_dealer_mass_open_rollout missing from schema cache",
    })).toBe("disabled");
  });

  it("ignores a stale club response by request generation", () => {
    expect(isCurrentMassOpenRequest(4, 4)).toBe(true);
    expect(isCurrentMassOpenRequest(3, 4)).toBe(false);
  });

  it("continues only while assignment makes measurable progress", () => {
    const current = {
      operationId: "operation",
      requested: 30,
      assigned: 19,
      remaining: 11,
      status: "waiting_for_dealer",
    };
    const next = readOpenOperationProgress(
      { requested: 30, assigned: 25, remaining: 5, operation_status: "waiting_for_dealer" },
      "operation",
      current,
    );
    expect(shouldContinueOpenOperation(current, next, 6)).toBe(true);
    expect(shouldContinueOpenOperation(next, next, 0)).toBe(false);
  });
});
