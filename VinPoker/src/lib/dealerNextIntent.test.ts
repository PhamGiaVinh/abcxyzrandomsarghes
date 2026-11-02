import { describe, expect, it } from "vitest";
import { clearDealerNextIntent, dealerNextIntentArgs, dealerNextIntentKey,
  persistDealerNextIntent, readDealerNextIntent, type DealerNextIntent } from "./dealerNextIntent";
const intent: DealerNextIntent = { actorId: "actor", clubId: "club", sessionId: "session",
  assignmentId: "assignment", version: 3, attendanceId: "candidate",
  requestId: "e1800000-0000-4000-8000-000000000090" };
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
describe("dealer next unknown-outcome intent", () => {
  it("retains original version and request after refetch or modal reopen", () => {
    const s = storage(); persistDealerNextIntent(s, intent);
    const restored = readDealerNextIntent(s, intent)!;
    expect(dealerNextIntentArgs(restored)).toEqual({ p_table_session_id: "session", p_assignment_id: "assignment",
      p_expected_assignment_version: 3, p_next_attendance_id: "candidate", p_request_id: intent.requestId });
    expect(() => persistDealerNextIntent(s, { ...intent, version: 4 })).toThrow(/previous/);
    expect(readDealerNextIntent(s, intent)).toEqual(intent);
  });
  it.each(["actorId", "clubId", "sessionId", "assignmentId"] as const)("does not inherit another %s", field => {
    const s = storage(); persistDealerNextIntent(s, intent);
    expect(readDealerNextIntent(s, { ...intent, [field]: "other" })).toBeNull();
  });
  it("rejects corrupt storage and candidate replacement without deleting pending evidence", () => {
    const s = storage(); persistDealerNextIntent(s, intent);
    expect(() => clearDealerNextIntent(s, { ...intent, attendanceId: "other" })).toThrow(/changed/);
    s.setItem(dealerNextIntentKey(intent), "broken");
    expect(() => readDealerNextIntent(s, intent)).toThrow();
  });
  it("fails closed when persistent storage is unavailable", () => {
    expect(() => persistDealerNextIntent({ ...storage(), setItem: () => { throw Error("quota"); } }, intent)).toThrow("quota");
  });
});
