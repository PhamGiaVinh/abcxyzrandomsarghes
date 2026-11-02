import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }));
import { ensureRecordedHandDisplayOutcome } from "@/lib/tracker-poker/recordedHandDisplayOutcome";
import { historicalCommitKey, persistHistoricalCommitJournal } from "@/lib/tracker-poker/historicalCommitIntent";
const intent = {
  expected_actor_id: "81000000-0000-0000-0000-000000000001",
  tournament_id: "85000000-0000-0000-0000-000000000001",
  hand_id: "86000000-0000-0000-0000-000000000001",
  idempotency_key: "unknown-commit-original-key", expected_source_revision: 4,
  expected_source_chain_hash: "a".repeat(64), expected_outcome_hash: "b".repeat(64),
};
describe("automatic display verification with unresolved commit", () => {
  afterEach(() => { sessionStorage.clear(); vi.resetAllMocks(); });
  it("only reads the original receipt; never previews or writes another request", async () => {
    persistHistoricalCommitJournal(sessionStorage, intent);
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    mocks.invoke.mockResolvedValue({ data: null, error: { message: "offline" } });
    const input = { tournamentId: intent.tournament_id, handId: intent.hand_id,
      actorId: intent.expected_actor_id, isCurrent: () => true };
    await ensureRecordedHandDisplayOutcome(input);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("tournament-historical-settlement", {
      body: { mode: "receipt", ...intent },
    });
    expect(JSON.parse(sessionStorage.getItem(historicalCommitKey(intent))!)).toEqual(intent);
  });
  it("does not mistake an unrelated public proof for this request's receipt", async () => {
    persistHistoricalCommitJournal(sessionStorage, intent);
    mocks.rpc.mockResolvedValue({ data: { status: "verified" }, error: null });
    mocks.invoke.mockResolvedValue({ data: { ok: true, status: "receipt_found", actor_id: "another-actor" }, error: null });
    expect(await ensureRecordedHandDisplayOutcome({ tournamentId: intent.tournament_id, handId: intent.hand_id,
      actorId: intent.expected_actor_id, isCurrent: () => true })).toEqual({ ok: false, code: "verification_missing" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(historicalCommitKey(intent))!)).toEqual(intent);
  });
  it("blocks a corrupt journal without any request", async () => {
    sessionStorage.setItem(historicalCommitKey(intent), "broken-json");
    await ensureRecordedHandDisplayOutcome({ tournamentId: intent.tournament_id, handId: intent.hand_id,
      actorId: intent.expected_actor_id, isCurrent: () => true });
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(historicalCommitKey(intent))).toBe("broken-json");
  });
  it("preserves the pending journal after scope changes during receipt lookup", async () => {
    persistHistoricalCommitJournal(sessionStorage, intent);
    let current = true;
    mocks.invoke.mockImplementationOnce(async () => {
      current = false;
      return { data: { ok: true, status: "receipt_found", actor_id: intent.expected_actor_id,
        tournament_id: intent.tournament_id, hand_id: intent.hand_id, idempotency_key: intent.idempotency_key,
        source_revision: intent.expected_source_revision, source_chain_hash: intent.expected_source_chain_hash,
        outcome_hash: intent.expected_outcome_hash, receipt: { ok: true, idempotent: true, settlement_revision: 1,
          source_revision: intent.expected_source_revision, outcome_hash: intent.expected_outcome_hash } }, error: null };
    });
    await ensureRecordedHandDisplayOutcome({ tournamentId: intent.tournament_id, handId: intent.hand_id,
      actorId: intent.expected_actor_id, isCurrent: () => current });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(historicalCommitKey(intent))!)).toEqual(intent);
  });
});
