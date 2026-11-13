import { describe, expect, it, vi } from "vitest";
import { createFloorTableControlV3Client } from "./floorTableControlV3";

const intent = { tournamentId: "tour", tournamentTableId: "table", tableSessionId: "session", seatId: "seat",
  playerId: "player", seatNumber: 3, seatEntryId: "entry", expectedControlEpoch: 2,
  requestId: "request", reason: "floor_confirmed_player_out" };
const receipt = { ok: true, outcome: "busted", seat_id: "seat", entry_id: "entry", table_session_id: "session",
  request_id: "request", revision: 12, payout_applied: false };

describe("exact Floor bust intent", () => {
  it("stays dark without the explicit rollout", async () => {
    const rpc = vi.fn(); const client = createFloorTableControlV3Client(rpc, { enabled: true, fastBustEnabled: false });
    expect(await client.bustSeatExact(intent)).toEqual({ ok: false, error: "FLOOR_FAST_BUST_DISABLED" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sends exact seat/session identity without a table-wide revision", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: receipt, error: null });
    const client = createFloorTableControlV3Client(rpc, { enabled: true, fastBustEnabled: true });
    expect(await client.bustSeatExact(intent)).toMatchObject({ ok: true, data: receipt });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("floor_operator_bust_seat_v1", {
      p_tournament_id: "tour", p_tournament_table_id: "table", p_table_session_id: "session", p_seat_id: "seat",
      p_expected_player_id: "player", p_expected_seat_number: 3, p_expected_seat_entry_id: "entry",
      p_expected_control_epoch: 2, p_request_id: "request", p_reason: "floor_confirmed_player_out",
    });
  });
  it.each([{ seat_id: "other" }, { table_session_id: "other" }, { request_id: "other" },
    { entry_id: "other" }, { payout_applied: true }, { outcome: "unknown" }, { revision: -1 },
    { outcome: "orphan_seat_released", entry_id: "entry" }])("rejects an unverified receipt %j", async patch => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...receipt, ...patch }, error: null });
    expect(await createFloorTableControlV3Client(rpc, { enabled: true, fastBustEnabled: true }).bustSeatExact(intent))
      .toEqual({ ok: false, error: "V3_BUST_RECEIPT_UNVERIFIED" });
  });
  it("distinguishes orphan cleanup from a real elimination", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...receipt, outcome: "orphan_seat_released", entry_id: null }, error: null });
    expect(await createFloorTableControlV3Client(rpc, { enabled: true, fastBustEnabled: true })
      .bustSeatExact({ ...intent, seatEntryId: null })).toMatchObject({ ok: true, data: { outcome: "orphan_seat_released" } });
  });
  it("preserves a server identity rejection", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: false, error: "seat_identity_changed" }, error: null });
    expect(await createFloorTableControlV3Client(rpc, { enabled: true, fastBustEnabled: true }).bustSeatExact(intent))
      .toEqual({ ok: false, error: "seat_identity_changed" });
  });
});
