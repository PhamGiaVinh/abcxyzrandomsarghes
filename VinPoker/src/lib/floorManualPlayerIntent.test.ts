import { describe, expect, it, vi } from "vitest";
import { settleManualPlayerIntent, manualPlayerPayload, readManualPlayerIntent, validateManualPlayerReceipt, waitForManualPlayerResponse, type ManualPlayerIntent } from "./floorManualPlayerIntent";
const id = "11111111-1111-4111-8111-111111111111";
const intent: ManualPlayerIntent = { actorId: id, tournamentId: id, tableId: id, sessionId: id,
  name: "TEST One", seat: 1, revision: 4, epoch: 2, requestId: id };
const proof = () => ({ ok: true, actor_id: id, request_id: id, payload: manualPlayerPayload(intent),
  tournament_table_id: id, table_session_id: id, seat_number: 1, control_epoch: 2, revision: 5,
  entry_id: id, seat_id: id, receipt_id: id, display_name: "TEST One", receipt_code: "TEST-ticket", starting_stack: 20000, table_number: 21 });
describe("manual player intent boundary", () => {
  it("recovers the original fences, not a newer revision or epoch", () => {
    expect(readManualPlayerIntent(JSON.stringify(intent), intent)).toEqual(intent);
  });
  it.each(["actorId", "tournamentId", "tableId", "sessionId"] as const)("refuses a journal from another %s", (key) => {
    expect(() => readManualPlayerIntent(JSON.stringify(intent), { ...intent, [key]: "22222222-2222-4222-8222-222222222222" })).toThrow();
  });
  it("refuses malformed journals", () => {
    for (const field of [{ seat: 10 }, { revision: -1 }, { requestId: "invalid" }, { name: " TEST One" }])
      expect(() => readManualPlayerIntent(JSON.stringify({ ...intent, ...field }), intent)).toThrow();
  });
  it("accepts only a complete exact committed receipt", () => {
    expect(validateManualPlayerReceipt(intent, proof()).status).toBe("committed");
    for (const change of [{ actor_id: "other" }, { revision: 6 }, { control_epoch: 3 }, { receipt_code: "" },
      { starting_stack: 0 }, { entry_id: "bad" }, { table_session_id: "other" }, { display_name: "Other" },
      { payload: { ...manualPlayerPayload(intent), seat_number: 2 } }])
      expect(validateManualPlayerReceipt(intent, { ...proof(), ...change }).status).toBe("unknown");
  });
  it("accepts a terminal rejection only when actor, key and payload are proven", () => {
    expect(validateManualPlayerReceipt(intent, { ...proof(), ok: false, error: "seat_locked" })).toEqual({ status: "rejected", error: "seat_locked" });
    expect(validateManualPlayerReceipt(intent, { ok: false, error: "seat_locked" }).status).toBe("unknown");
  });
  it("never clears a newer sibling request", () => {
    let stored: string | null = JSON.stringify({ ...intent, requestId: "other" });
    const storage = { getItem: () => stored, setItem: (_: string, v: string) => { stored = v; } };
    expect(() => settleManualPlayerIntent(storage, "key", intent)).toThrow();
    expect(stored).not.toBeNull();
    stored = JSON.stringify(intent); settleManualPlayerIntent(storage, "key", intent); expect(JSON.parse(stored!).resolved).toBe(true);
    stored = JSON.stringify({ ...intent, requestId: "other", resolved: true });
    expect(() => settleManualPlayerIntent(storage, "key", intent)).toThrow();
  });
  it("accepts an already cleared sibling journal after an exact proof", () => {
    let raw: string | null = null;
    settleManualPlayerIntent({ getItem: () => raw, setItem: (_, value) => { raw = value; } }, "key", intent);
    expect(JSON.parse(raw!).resolved).toBe(true);
  });
  it("bounds a hung response without changing intent or retrying", async () => {
    vi.useFakeTimers();
    try {
      const result = waitForManualPlayerResponse(new Promise(() => {}));
      const rejection = expect(result).rejects.toThrow("MANUAL_PLAYER_OUTCOME_UNKNOWN");
      await vi.advanceTimersByTimeAsync(20000); await rejection;
    } finally { vi.useRealTimers(); }
  });
});
