import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SeriesClubLivePulseV1 } from "./seriesClubLivePulseV1";
import { useSeriesClubLivePulseV1 } from "./useSeriesClubLivePulseV1";

vi.mock("./seriesClubLivePulseRpc", () => ({ getSeriesClubLivePulseV1: vi.fn() }));

const CLUB_ID = "11111111-1111-4111-8111-111111111111";
const PULSE = { version: "series-club-live-pulse-v1", clubId: CLUB_ID } as SeriesClubLivePulseV1;

it("hides the previous club while the next club read is pending", async () => {
  const nextClub = "22222222-2222-4222-8222-222222222222";
  let release!: (value: { ok: true; value: SeriesClubLivePulseV1 }) => void;
  const load = vi.fn().mockResolvedValueOnce({ ok: true, value: PULSE })
    .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const view = renderHook(({ clubId }) => useSeriesClubLivePulseV1({ enabled: true, clubId, load }), {
    initialProps: { clubId: CLUB_ID },
  });
  await waitFor(() => expect(view.result.current.pulse).toBe(PULSE));
  view.rerender({ clubId: nextClub });
  expect(view.result.current.pulse).toBeNull();
  expect(view.result.current.state).toBe("loading");
  const next = { ...PULSE, clubId: nextClub };
  await act(async () => release({ ok: true, value: next }));
  expect(view.result.current.pulse).toBe(next);
  view.unmount();
});

it("ignores an old club result after switching to a new club", async () => {
  const nextClub = "22222222-2222-4222-8222-222222222222";
  let oldResult!: (value: { ok: true; value: SeriesClubLivePulseV1 }) => void;
  const next = { ...PULSE, clubId: nextClub };
  const load = vi.fn().mockImplementationOnce(() => new Promise(resolve => { oldResult = resolve; }))
    .mockResolvedValueOnce({ ok: true, value: next });
  const view = renderHook(({ clubId }) => useSeriesClubLivePulseV1({ enabled: true, clubId, load }), {
    initialProps: { clubId: CLUB_ID },
  });
  view.rerender({ clubId: nextClub });
  await waitFor(() => expect(view.result.current.pulse).toBe(next));
  await act(async () => oldResult({ ok: true, value: PULSE }));
  expect(view.result.current.pulse).toBe(next);
  view.unmount();
});

describe("useSeriesClubLivePulseV1", () => {
  afterEach(() => vi.useRealTimers());
  it("stays disabled without invoking the loader", () => {
    const load = vi.fn();
    const { result } = renderHook(() => useSeriesClubLivePulseV1({ enabled: false, clubId: CLUB_ID, load }));
    expect(result.current.state).toBe("disabled");
    expect(load).not.toHaveBeenCalled();
  });

  it("moves loading to ready and supports explicit refresh", async () => {
    let release: ((value: { ok: true; value: SeriesClubLivePulseV1 }) => void) | undefined;
    const load = vi.fn(() => new Promise<{ ok: true; value: SeriesClubLivePulseV1 }>((resolve) => { release = resolve; }));
    const { result } = renderHook(() => useSeriesClubLivePulseV1({ enabled: true, clubId: CLUB_ID, load }));
    expect(result.current.state).toBe("loading");

    await act(async () => release?.({ ok: true, value: PULSE }));
    expect(result.current.state).toBe("ready");
    expect(result.current.pulse).toBe(PULSE);
    expect(load).toHaveBeenCalledTimes(1);

    act(() => result.current.refresh());
    expect(result.current.state).toBe("refreshing");
    await act(async () => release?.({ ok: true, value: PULSE }));
    expect(result.current.state).toBe("ready");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("fails closed for a missing club and an RPC authorization error", async () => {
    const missing = renderHook(() => useSeriesClubLivePulseV1({ enabled: true, clubId: null }));
    expect(missing.result.current).toMatchObject({ state: "unavailable", pulse: null, error: "club_unavailable" });

    const load = vi.fn().mockResolvedValue({ ok: false, error: "forbidden", retryable: false });
    const denied = renderHook(() => useSeriesClubLivePulseV1({ enabled: true, clubId: CLUB_ID, load }));
    await waitFor(() => expect(denied.result.current.state).toBe("unavailable"));
    expect(denied.result.current).toMatchObject({ pulse: null, error: "forbidden", retryable: false });
  });
});

it("refreshes the live pulse without an Owner click and stops after unmount", async () => {
  vi.useFakeTimers();
  const load = vi.fn().mockResolvedValue({ ok: true, value: PULSE });
  const view = renderHook(() => useSeriesClubLivePulseV1({ enabled: true, clubId: CLUB_ID, load }));
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(load).toHaveBeenCalledTimes(2);
  view.unmount();
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(load).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
it("recovers a hung read and ignores its late result", async () => {
  vi.useFakeTimers();
  let release!: (value: { ok: true; value: SeriesClubLivePulseV1 }) => void;
  const recovered = { ...PULSE, clubId: CLUB_ID };
  const load = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
    .mockResolvedValue({ ok: true, value: recovered });
  const view = renderHook(() => useSeriesClubLivePulseV1({ enabled: true, clubId: CLUB_ID, load }));
  await act(async () => vi.advanceTimersByTimeAsync(10001));
  // One recovery read is enough; the periodic tick does not queue a duplicate.
  expect(load).toHaveBeenCalledTimes(2);
  expect(view.result.current.pulse).toBe(recovered);
  await act(async () => release({ ok: true, value: PULSE }));
  expect(view.result.current.pulse).toBe(recovered);
  view.unmount();vi.useRealTimers();
});
