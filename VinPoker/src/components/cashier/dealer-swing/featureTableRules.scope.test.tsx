import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: io.rpc } }));
import { getProfile, hydrateFromRules, loadFeatureTableProfile, useFeatureTableRules } from "./featureTableMock";
const clubA = "11111111-1111-4111-8111-111111111111", clubB = "22222222-2222-4222-8222-222222222222";
const tableA = "33333333-3333-4333-8333-333333333333", tableB = "44444444-4444-4444-8444-444444444444";
function rules(club: string, table: string, mode = "feature") {
  return { club_id: club, as_of: "2026-10-29T12:00:00Z", tables: [{ table_id: table, table_mode: mode,
    is_final: false, allow_override: false, display_label: null, pool: [] }] };
}
function deferred() {
  let resolve: (value: { data: unknown; error: unknown }) => void = () => {};
  const promise = new Promise<{ data: unknown; error: unknown }>(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(() => { io.rpc.mockReset(); hydrateFromRules(null); });
afterEach(() => { cleanup(); hydrateFromRules(null); });

it("does not let an old club response erase the current club's verified profiles", async () => {
  const a = deferred(), b = deferred();
  io.rpc.mockImplementation((_name, args) => args.p_club_id === clubA ? a.promise : b.promise);
  const view = renderHook(({ club }) => useFeatureTableRules(club), { initialProps: { club: clubA } });
  view.rerender({ club: clubB });
  await act(async () => { b.resolve({ data: rules(clubB, tableB), error: null }); });
  expect(getProfile(tableB).tableMode).toBe("feature");
  await act(async () => { a.resolve({ data: rules(clubA, tableA), error: null }); });
  expect(getProfile(tableB).tableMode).toBe("feature");
  expect(view.result.current.error).toBeNull();
});

it("rejects a wrong-club response before hydrating the shared cache", async () => {
  hydrateFromRules(rules(clubA, tableA));
  io.rpc.mockResolvedValue({ data: rules(clubB, tableB), error: null });
  const view = renderHook(() => useFeatureTableRules(clubA));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(view.result.current.error).not.toBeNull();
  expect(getProfile(tableA).tableMode).toBe("feature");
  expect(getProfile(tableB).tableMode).toBe("normal");
});

it("ignores a response from an unmounted panel", async () => {
  hydrateFromRules(rules(clubB, tableB)); const a = deferred();
  io.rpc.mockReturnValue(a.promise);
  const view = renderHook(() => useFeatureTableRules(clubA)); view.unmount();
  await act(async () => { a.resolve({ data: rules(clubA, tableA), error: null }); });
  expect(getProfile(tableB).tableMode).toBe("feature");
});

it("does not overwrite a newer dialog read with an older summary read", async () => {
  const summary = deferred(), dialog = deferred();
  io.rpc.mockReturnValueOnce(summary.promise).mockReturnValueOnce(dialog.promise);
  renderHook(() => useFeatureTableRules(clubA));
  const current = loadFeatureTableProfile(clubA, tableA, () => true);
  await act(async () => { dialog.resolve({ data: rules(clubA, tableA), error: null }); });
  expect((await current).tableMode).toBe("feature");
  await act(async () => { summary.resolve({ data: rules(clubA, tableA, "normal"), error: null }); });
  expect(getProfile(tableA).tableMode).toBe("feature");
});
