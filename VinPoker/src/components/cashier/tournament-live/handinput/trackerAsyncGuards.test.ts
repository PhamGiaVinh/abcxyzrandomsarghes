import { describe, expect, it } from "vitest";
import {
  buildNextHandNumberRequest,
  classifyActionWriteFailure,
  createActionWriteGuard,
  createTableLoadGuard,
  isConfirmedActionWrite,
  isConfirmedCompletedHandReadback,
  resolveTableHandIdentity,
  isConfirmedRosterWrite,
} from "./trackerAsyncGuards";
import { createSingleFlightGuard } from "@/lib/singleFlight";
import { friendlyValidationError } from "./validationMessages";

describe("tracker async guards", () => {
  it.each([
    ['tracker_action_stack_exceeded','Số chip vượt quá stack còn lại trên server. Hãy tải lại hand trước khi nhập lại.'],
    ['tracker_action_negative_amount','Số chip không được âm. Hãy kiểm tra lại hành động.'],
    ['tracker_action_stack_evidence_missing','Chưa xác minh được stack của hand. Gọi Floor kiểm tra dữ liệu trước khi tiếp tục.'],
  ])('recognizes authoritative %s denial instead of treating it as an unknown commit', (code,message)=>{
    expect(classifyActionWriteFailure({code,message:code})).toBe('validation');
    expect(friendlyValidationError(code,code)).toBe(message);
  });
  it("validates exact roster receipt before applying chip state", () => {
    const context = { tableId: "logical-b", sessionId: "session-b", epoch: 2, seatNumber: 3, chipCount: 20000 };
    const valid = { ok: true, tournament_table_id: "logical-b", table_session_id: "session-b", control_epoch: 2,
      seat: { id: "seat", entry_id: "entry", player_id: "player", entry_number: 1, seat_number: 3, chip_count: 20000 } };
    expect(isConfirmedRosterWrite(valid, context)).toBe(true);
    for (const invalid of [null, { ...valid, ok: false }, { ...valid, table_session_id: "session-a" },
      { ...valid, control_epoch: 1 }, { ...valid, tournament_table_id: "logical-a" },
      { ...valid, seat: { ...valid.seat, chip_count: -1 } },
      { ...valid, seat: { ...valid.seat, seat_number: 4 } },
      { ...valid, seat: { ...valid.seat, entry_id: null } }]) {
      expect(isConfirmedRosterWrite(invalid, context)).toBe(false);
    }
  });
  it("keeps only the latest table load eligible to commit and invalidates on unmount", () => {
    const guard = createTableLoadGuard();
    const tableA = guard.begin("table-a");
    const tableB = guard.begin("table-b");
    const committed: string[] = [];

    if (guard.isCurrent(tableB)) committed.push("players", "maxSeats", "buttonSeat", "handNumber", "orphanHand", "autoResumeArmed");
    if (guard.isCurrent(tableA)) committed.push("late-a");

    expect(committed).toEqual(["players", "maxSeats", "buttonSeat", "handNumber", "orphanHand", "autoResumeArmed"]);

    guard.dispose();
    expect(guard.isCurrent(tableB)).toBe(false);
  });

  it("rejects a late table-list response after the routed tournament changes", () => {
    const guard = createTableLoadGuard();
    const tournamentA = guard.begin("tournament-a");
    const tournamentB = guard.begin("tournament-b");

    expect(guard.isCurrent(tournamentA)).toBe(false);
    expect(guard.isCurrent(tournamentB)).toBe(true);
  });

  it("builds a next-hand request from the explicit selected table, never a stale closure", () => {
    expect(buildNextHandNumberRequest("tournament-1", "table-b")).toEqual({
      p_tournament_id: "tournament-1",
      p_table_id: "table-b",
    });
  });

  it("resumes Hand #4 without ever requesting the next Hand #5 identity", async () => {
    let nextCalls = 0;
    const result = await resolveTableHandIdentity({
      loadOrphan: async () => ({ id: "hand-4-id", hand_number: 4 }),
      loadNextHandNumber: async () => {
        nextCalls += 1;
        return 5;
      },
      isCurrent: () => true,
    });

    expect(result).toEqual({ kind: "resume", hand: { id: "hand-4-id", hand_number: 4 } });
    expect(nextCalls).toBe(0);
  });

  it("drops a late next-hand response after the table load becomes stale", async () => {
    let current = true;
    let releaseNext!: (value: number) => void;
    const next = new Promise<number>((resolve) => { releaseNext = resolve; });
    const pending = resolveTableHandIdentity({
      loadOrphan: async () => null,
      loadNextHandNumber: () => next,
      isCurrent: () => current,
    });

    await Promise.resolve();
    current = false;
    releaseNext(5);
    await expect(pending).resolves.toEqual({ kind: "stale" });
  });

  it("allows only one completion or re-entry submit until the first finishes", () => {
    const guard = createSingleFlightGuard();
    expect(guard.begin()).toBe(true);
    expect(guard.begin()).toBe(false);
    expect(guard.isBusy()).toBe(true);
    guard.finish();
    expect(guard.begin()).toBe(true);
  });

  it("permits only one action write and stale completion cannot unlock a newer scope", () => {
    const guard = createActionWriteGuard();
    let edgeInvocations = 0;
    const submit = (scope: string) => {
      const token = guard.begin(scope);
      if (!token) return null;
      edgeInvocations += 1;
      return token;
    };
    const first = submit("table-a:hand-1");

    expect(first).not.toBeNull();
    expect(submit("table-a:hand-1")).toBeNull();
    expect(submit("table-b:hand-2")).toBeNull();
    expect(edgeInvocations).toBe(1);

    guard.invalidate("table-a:hand-1");
    const second = submit("table-b:hand-2");
    expect(second).not.toBeNull();
    expect(guard.finish(first!)).toBe(false);
    expect(guard.isBusy()).toBe(true);
    expect(guard.finish(second!)).toBe(true);
    expect(guard.isBusy()).toBe(false);
  });

  it("commits one action, one order increment, and one stack delta after a single-flight success", () => {
    const guard = createActionWriteGuard();
    let actionCount = 0;
    let nextOrder = 1;
    let stack = 100;
    const submit = () => guard.begin("table-a:hand-1");
    const first = submit();
    const duplicate = submit();

    if (first && guard.finish(first)) {
      actionCount += 1;
      nextOrder += 1;
      stack -= 25;
    }

    expect(duplicate).toBeNull();
    expect({ actionCount, nextOrder, stack }).toEqual({ actionCount: 1, nextOrder: 2, stack: 75 });
  });

  it("releases a validation rejection without committing an optimistic action", () => {
    const guard = createActionWriteGuard();
    const attempt = guard.begin("table-a:hand-1");

    expect(classifyActionWriteFailure({ code: "OUT_OF_TURN", message: "out of turn" })).toBe("validation");
    expect(guard.finish(attempt!)).toBe(true);
    expect(guard.begin("table-a:hand-1")).not.toBeNull();
  });

  it.each([
    { message: "Edge Function returned a non-2xx status code" },
    { data: { error: "write failed" } },
    { data: { error: { unexpected: true } } },
  ])("fails closed for an ambiguous Edge rejection: %#", (failure) => {
    expect(classifyActionWriteFailure(failure)).toBe("uncertain");
  });

  it("accepts only the existing Edge success envelope and rejects malformed responses", () => {
    expect(isConfirmedActionWrite({ status: "success", data: null })).toBe(true);
    expect(isConfirmedActionWrite({ status: "success" })).toBe(false);
    expect(isConfirmedActionWrite({ ok: true })).toBe(false);
    expect(isConfirmedActionWrite("success")).toBe(false);
  });

  it("accepts an authoritative completed-hand readback only when the pot matches", () => {
    const completed = { id: "hand-2", status: "completed", pot_size: 5_400_000 };

    expect(isConfirmedCompletedHandReadback(completed, 5_400_000)).toBe(true);
    expect(isConfirmedCompletedHandReadback(completed, 5_300_000)).toBe(false);
    expect(isConfirmedCompletedHandReadback({ ...completed, status: "in_progress" }, 5_400_000)).toBe(false);
    expect(isConfirmedCompletedHandReadback(null, 5_400_000)).toBe(false);
  });

  it("blocks further actions after an ambiguous outcome until an authoritative reload", () => {
    const guard = createActionWriteGuard();
    const attempt = guard.begin("table-a:hand-1");

    expect(attempt).not.toBeNull();
    expect(guard.markUncertain(attempt!)).toBe(true);
    expect(guard.isBlocked("table-a:hand-1")).toBe(true);
    expect(guard.begin("table-a:hand-1")).toBeNull();
  });
});
