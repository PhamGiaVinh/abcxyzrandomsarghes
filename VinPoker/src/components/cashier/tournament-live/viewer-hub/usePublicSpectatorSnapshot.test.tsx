import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePublicSpectatorSnapshot } from "./usePublicSpectatorSnapshot";
import type { PublicSpectatorSnapshot, PublicTableSnapshot } from "./publicSnapshotTypes";

const { rpc, removeChannel, channel } = vi.hoisted(() => {
  const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
  return { rpc: vi.fn(), removeChannel: vi.fn(), channel };
});

vi.mock("@/integrations/supabase/SupabaseClientContext", () => {
  const client = { rpc, channel: () => channel, removeChannel };
  return { useSupabaseClient: () => client };
});

afterEach(() => {
  cleanup();
  rpc.mockReset();
  removeChannel.mockClear();
});

describe("public spectator table scope", () => {
  it("keeps the catalog visible while loading details for the visible tables", async () => {
    const tournamentId = "5a51bec5-4da0-4dd9-861a-cc4e7678478c";
    const tableId = "1ceaeb99-fecd-4ff2-9451-964399f954d0";
    const catalog = [
      { tableId, name: "Bàn 1", playerCount: 1, searchPlayers: ["Test 1"] },
      { tableId: "d5ead9f1-1aa6-4cc9-8e3e-01b8ce2407a8", name: "Bàn 2", playerCount: 1, searchPlayers: ["Test 2"] },
    ];
    const freshness = {
      sourceRevision: "{}", projectedSourceRevision: "{}", sourceChangedAt: null,
      publishedAt: null, serverCheckedAt: "2026-09-25T00:00:00Z", oldestPendingAt: null,
      state: "current" as const,
    };
    const initial: PublicSpectatorSnapshot = {
      ok: true, access: "public", tournamentId,
      sections: { tables: { revision: "162", freshness, catalog, items: [], removed: [], unchanged: false } },
    };
    const table: PublicTableSnapshot = {
      tableId, tableSessionId: null, name: "Bàn 1", handId: null, handNumber: null,
      buttonSeat: null, street: null, board: null, pot: null, smallBlind: null,
      bigBlind: null, players: [], trackerState: "waiting",
    };
    const detail: PublicSpectatorSnapshot = {
      ...initial,
      sections: { tables: { ...initial.sections.tables!, items: [table] } },
    };
    let finishDetail!: (value: { data: PublicSpectatorSnapshot; error: null }) => void;
    const pendingDetail = new Promise<{ data: PublicSpectatorSnapshot; error: null }>((resolve) => { finishDetail = resolve; });
    rpc.mockResolvedValueOnce({ data: initial, error: null }).mockReturnValueOnce(pendingDetail);

    const { result, rerender } = renderHook(
      ({ ids }) => usePublicSpectatorSnapshot(tournamentId, true, ids),
      { initialProps: { ids: [] as string[] } },
    );
    await waitFor(() => expect(result.current.snapshot?.sections.tables?.catalog).toHaveLength(2));

    rerender({ ids: [tableId] });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(result.current.snapshot?.sections.tables?.catalog).toHaveLength(2);
    expect(result.current.snapshot?.sections.tables?.items).toEqual([]);

    await act(async () => { finishDetail({ data: detail, error: null }); });
    await waitFor(() => expect(result.current.snapshot?.sections.tables?.items).toHaveLength(1));
    expect(result.current.snapshot?.sections.tables?.catalog).toHaveLength(2);
  });
});
