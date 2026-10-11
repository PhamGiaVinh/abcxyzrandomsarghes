export const TRACKER_HISTORY_WORKER_MAX_BATCH = 20;
export const HISTORY_CANARY_SCOPE_ENV = "TRACKER_HISTORY_CANARY_ALLOWED_HAND_IDS";

/** The temporary credential never authorizes hands outside the server-owned canary scope. */
export function requireHistoryCanaryScope(handIds: string[], configured: string | undefined): void {
  let allowed: string[] | undefined;
  try { allowed = parseHistoryWorkerHandIds(JSON.parse(configured ?? "null")); }
  catch { throw new Error("canary_scope_unavailable"); }
  if (!allowed || allowed.length > 3) throw new Error("canary_scope_unavailable");
  if (handIds.some(id => !allowed.includes(id))) throw new Error("hand_out_of_scope");
}

/** Explicit canary scope. An invalid scope must never fall back to claiming the whole queue. */
export function parseHistoryWorkerHandIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > TRACKER_HISTORY_WORKER_MAX_BATCH
    || value.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error("invalid_hand_scope");
  }
  const ids = value.map(id => id.toLowerCase());
  if (new Set(ids).size !== ids.length) throw new Error("invalid_hand_scope");
  return ids;
}

const DETERMINISTIC_CODES = new Set([
  "invalid_historical_hand",
  "invalid_historical_source",
  "historical_blind_snapshot_missing",
  "incomplete_showdown_cards",
  "duplicate_card",
  "invalid_community_card",
  "invalid_hole_card",
  "refund_source_action_missing",
  "stored_ending_stack_mismatch",
  "stored_elimination_mismatch",
  "historical_player_projection_mismatch",
]);

export function isDeterministicHistoricalWorkerFailure(code: string): boolean {
  return code.startsWith("historical_") || DETERMINISTIC_CODES.has(code);
}

export function historicalWorkerFailureStatus(code: string, verifierRejected: boolean): "pending" | "needs_attention" {
  return verifierRejected || isDeterministicHistoricalWorkerFailure(code) ? "needs_attention" : "pending";
}
