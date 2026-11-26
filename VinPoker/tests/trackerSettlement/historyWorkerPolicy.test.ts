import { describe, expect, it } from "vitest";
import {
  historicalWorkerFailureStatus,
  isDeterministicHistoricalWorkerFailure,
  TRACKER_HISTORY_WORKER_MAX_BATCH,
  parseHistoryWorkerHandIds,
} from "../../supabase/functions/_shared/trackerSettlement/historyWorkerPolicy.ts";

describe("historical display worker policy", () => {
  it("never broadens an invalid canary scope to the whole queue", () => {
    const id="ABCDEF00-0000-4000-8000-000000000001";
    expect(parseHistoryWorkerHandIds(undefined)).toBeUndefined();
    expect(parseHistoryWorkerHandIds([id])).toEqual([id.toLowerCase()]);
    for(const value of [null,[],["bad"],[id,id.toLowerCase()],Array(21).fill(id)]) {
      expect(()=>parseHistoryWorkerHandIds(value)).toThrow("invalid_hand_scope");
    }
  });
  it("keeps each invocation bounded", () => {
    expect(TRACKER_HISTORY_WORKER_MAX_BATCH).toBe(20);
  });

  it("sends deterministic source errors to operator attention and retries transport errors", () => {
    expect(isDeterministicHistoricalWorkerFailure("historical_blind_snapshot_missing")).toBe(true);
    expect(historicalWorkerFailureStatus("invalid_big_blind_ante_snapshot", false)).toBe("needs_attention");
    expect(historicalWorkerFailureStatus("stored_ending_stack_mismatch", false)).toBe("needs_attention");
    expect(historicalWorkerFailureStatus("refund_source_action_missing", false)).toBe("needs_attention");
    expect(historicalWorkerFailureStatus("incomplete_showdown_cards", true)).toBe("needs_attention");
    expect(historicalWorkerFailureStatus("fetch_failed", false)).toBe("pending");
    expect(historicalWorkerFailureStatus("queue_lease_lost", false)).toBe("pending");
  });
});
