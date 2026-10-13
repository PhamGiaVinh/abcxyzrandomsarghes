import { describe, expect, it } from "vitest";
import { issuancePayload, readIssuanceIntent, readIssuanceState, settleIssuanceIntent, validateIssuanceReceipt, type IssuanceIntent } from "./chipIssuanceIntent";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const i: IssuanceIntent = { actorId: id, clubId: id, tournamentId: id, templateId: id, requestId: id, count: 8, revision: 0 };
const receipt = { status: "ok", actor_id: id, club_id: id, tournament_id: id, request_id: id, payload: issuancePayload(i), stack_template_id: id, issued_count: 8, revision: 1, coupled: true };
describe("issuance frozen intent boundary", () => {
  it("accepts only scoped journal and server state", () => {
    expect(readIssuanceIntent(JSON.stringify(i), i)).toEqual(i);
    expect(readIssuanceState({ ...receipt, revision: 2 }, i)).toEqual({ count: 8, revision: 2 });
    expect(() => readIssuanceIntent(JSON.stringify(i), { ...i, actorId: other })).toThrow();
  });
  it.each(["actorId", "clubId", "tournamentId", "templateId", "requestId"])("rejects invalid journal %s", key => {
    expect(() => readIssuanceIntent(JSON.stringify({ ...i, [key]: "bad" }), i)).toThrow();
  });
  it("rejects unsafe integers and mismatched receipts", () => {
    for (const delta of [{ count: 1.5 }, { count: -1 }, { revision: Infinity }]) expect(() => readIssuanceIntent(JSON.stringify({ ...i, ...delta }), i)).toThrow();
    for (const delta of [{ actor_id: other }, { request_id: other }, { issued_count: 9 }, { revision: 5 }, { coupled: "yes" }, { payload: { ...issuancePayload(i), extra: true } }])
      expect(validateIssuanceReceipt(i, { ...receipt, ...delta }).status).toBe("unknown");
  });
  it("accepts unchanged generation and original committed result after later operations", () => {
    expect(validateIssuanceReceipt(i, receipt).status).toBe("committed");
    expect(validateIssuanceReceipt(i, { ...receipt, revision: 0 }).status).toBe("committed");
    expect(validateIssuanceReceipt(i, { ...receipt, status: undefined, error: "STALE_STATE" })).toEqual({ status: "rejected", error: "STALE_STATE" });
    expect(validateIssuanceReceipt(i, { error: "Forbidden" }).status).toBe("unknown");
  });
  it("a newer journal fences a late settlement", () => {
    sessionStorage.clear(); sessionStorage.setItem("test", JSON.stringify({ ...i, requestId: other }));
    expect(() => settleIssuanceIntent(sessionStorage, "test", i)).toThrow();
    sessionStorage.setItem("test", JSON.stringify(i)); settleIssuanceIntent(sessionStorage, "test", i);
    expect(readIssuanceIntent(sessionStorage.getItem("test")!, i).resolved).toBe(true);
  });
});
