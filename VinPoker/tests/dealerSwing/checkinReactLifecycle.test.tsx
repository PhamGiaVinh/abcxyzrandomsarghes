import React, { StrictMode, useEffect, useRef, useState } from "react";
import { act, cleanup, renderHook, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Button } from "../../src/components/ui/button";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

// Runs production check-in code with real React hooks. Not full-panel/web UAT.
const source = readFileSync(resolve(process.cwd(), "src/components/cashier/DealerSwingTab.tsx"), "utf8");
const start = source.indexOf("  const checkinScope = useRef(");
const end = source.indexOf("  // ── Special Dates", start);
if (start < 0 || end <= start) throw new Error("Production check-in seam missing");
const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const production = new Function("useRef", "useEffect", "useState", "context", `
  const {user,activeClubId,tours,checkinDealerIds,processing,setProcessing,
    dealerMassOpenRpc,checkinDealers,setCheckinDealers,setCheckinDealerIds,setCheckinOpen,
    refetchDealers,refetchCheckedOut,toast,supabase,checkinCandidatesLoading,checkinCandidatesError,
    setCheckinCandidatesLoading,setCheckinCandidatesError}=context;
  const checkinReadSequence = useRef(0);
  ${code}
  return {doCheckin,setCheckinShiftId,checkinShiftId,doReCheckin,reconcileCheckin,pendingCheckinIntents};
`);
const viewStart = source.indexOf("          {pendingCheckinIntents.length > 0 && (");
const viewEnd = source.indexOf("          {!activeClubId", viewStart);
if (viewStart < 0 || viewEnd <= viewStart) throw new Error("Production reconciliation view missing");
const viewCode = ts.transpileModule(`function View(context) {
  const {pendingCheckinIntents,processing,reconcileCheckin,checkinDealers,tours}=context;
  return <>{${source.slice(viewStart, viewEnd).trim().slice(1, -1)}}</>;
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const View = new Function("React", "Button", `${viewCode}; return View;`)(React, Button);
const receipt = { ok: true, outcome: "checked_in", attendance_id: "00000000-0000-4000-8000-000000000111", shift_date: "2026-10-10" };
beforeEach(() => sessionStorage.clear());
afterEach(cleanup);
function setup(rpc: (...args: any[]) => Promise<any>, readState = { loading: false, error: null as string | null, status: "new" }) {
  const success = vi.fn();
  const refetch = vi.fn();
  const hook = renderHook(({ actor, club }) => {
    const [processing, setProcessing] = useState<string | null>(null);
    const api = production(useRef, useEffect, useState, {
      user: { id: actor }, activeClubId: club, tours: [{ id: "shift", club_id: club }],
      checkinDealerIds: ["dealer"], processing, setProcessing, dealerMassOpenRpc: rpc,
      checkinDealers: [{ id: "dealer", full_name: "TEST", checkinStatus: readState.status }], setCheckinDealers: vi.fn(),
      checkinCandidatesLoading: readState.loading, checkinCandidatesError: readState.error,
      setCheckinCandidatesLoading: vi.fn(), setCheckinCandidatesError: vi.fn(),
      setCheckinDealerIds: vi.fn(), setCheckinOpen: vi.fn(), refetchDealers: refetch,
      refetchCheckedOut: vi.fn(), toast: { success, warning: vi.fn(), error: vi.fn() }, supabase: {},
    });
    return { ...api, processing };
  }, { initialProps: { actor: "actor", club: "club" }, wrapper: StrictMode });
  act(() => hook.result.current.setCheckinShiftId("shift"));
  return { ...hook, success, refetch };
}
describe("check-in production React lifecycle", () => {
  it.each([
    { loading: true, error: null, status: "new" },
    { loading: false, error: "READ_FAILED", status: "new" },
    { loading: false, error: null, status: "already_checked_in" },
    { loading: false, error: null, status: "ambiguous" },
  ])("does not submit a new intent from an unverified candidate: %j", async readState => {
    const rpc = vi.fn(async () => ({ data: receipt, error: null }));
    const h = setup(rpc, readState);
    await act(async () => { await h.result.current.doCheckin(); });
    expect(rpc).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });
  it("explicit retry can complete an uncommitted intent with the same key and payload", async () => {
    const storageKey = "vp:dealer-checkin-intent:v1:" + encodeURIComponent("actor:club:dealer:shift");
    const requestId = "00000000-0000-4000-8000-000000000222";
    sessionStorage.setItem(storageKey, requestId);
    const rpc = vi.fn(async (name: string) => name === "get_dealer_checkin_receipt_v1"
      ? { data: { ok: true, status: "unknown" }, error: null }
      : { data: receipt, error: null });
    const h = setup(rpc);
    await act(async () => { await h.result.current.reconcileCheckin(h.result.current.pendingCheckinIntents[0]); });
    expect(sessionStorage.getItem(storageKey)).toBe(requestId);
    render(<View pendingCheckinIntents={h.result.current.pendingCheckinIntents} processing={null}
      reconcileCheckin={h.result.current.reconcileCheckin} checkinDealers={[]} tours={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Gửi lại cùng yêu cầu" }));
    await waitFor(() => expect(h.success).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenLastCalledWith("operator_check_in_dealer_v1", {
      p_dealer_id: "dealer", p_club_id: "club", p_shift_id: "shift", p_request_id: requestId,
    });
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(h.success).toHaveBeenCalledTimes(1);
  });
  it("missing candidate dealer retains a reachable read-only reconciliation button", async () => {
    const storageKey = "vp:dealer-checkin-intent:v1:" + encodeURIComponent("actor:club:dealer:shift");
    const requestId = "00000000-0000-4000-8000-000000000222";
    sessionStorage.setItem(storageKey, requestId);
    const rpc = vi.fn(async () => ({ data: { ok: true, status: "committed", result: receipt }, error: null }));
    const h = setup(rpc);
    render(<View pendingCheckinIntents={h.result.current.pendingCheckinIntents} processing={null}
      reconcileCheckin={h.result.current.reconcileCheckin} checkinDealers={[]} tours={[]} />);
    expect(screen.getByText(/Dealer dealer/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Đối chiếu" }));
    await waitFor(() => expect(h.success).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith("get_dealer_checkin_receipt_v1", {
      p_dealer_id: "dealer", p_club_id: "club", p_shift_id: "shift", p_request_id: requestId,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });
  it.each(["unknown", "actor_not_allowed", "IDEMPOTENCY_CONFLICT"])("reconciliation %s keeps the original journal", async status => {
    const storageKey = "vp:dealer-checkin-intent:v1:" + encodeURIComponent("actor:club:dealer:shift");
    sessionStorage.setItem(storageKey, "00000000-0000-4000-8000-000000000222");
    const rpc = vi.fn(async () => ({ data: status === "unknown" ? { ok: true, status } : { ok: false, error: status }, error: null }));
    const h = setup(rpc);
    await act(async () => { await h.result.current.reconcileCheckin(h.result.current.pendingCheckinIntents[0]); });
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
    expect(h.success).not.toHaveBeenCalled();
    expect(rpc.mock.calls[0][0]).toBe("get_dealer_checkin_receipt_v1");
  });
  it("scope replacement resets check-in processing and chosen shift without accepting old completion", async () => {
    let finish!: (value: any) => void;
    const h = setup(() => new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = h.result.current.doCheckin(); });
    expect(h.result.current.processing).toBe("checkin");
    h.rerender({ actor: "other-actor", club: "other-club" });
    const state = { processing: h.result.current.processing, shift: h.result.current.checkinShiftId };
    await act(async () => { finish({ data: receipt, error: null }); await pending; });
    expect(state).toEqual({ processing: null, shift: "" });
    expect(h.success).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(1);
  });
  it("StrictMode permits confirmed current-scope check-in", async () => {
    const rpc = vi.fn(async () => ({ data: receipt, error: null }));
    const h = setup(rpc);
    await act(async () => { await h.result.current.doCheckin(); });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(h.success).toHaveBeenCalledTimes(1);
    expect(h.result.current.processing).toBeNull();
  });
  it("unmount suppresses late completion and keeps the journal", async () => {
    let finish!: (value: any) => void;
    const h = setup(() => new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = h.result.current.doCheckin(); });
    h.unmount();
    await act(async () => { finish({ data: receipt, error: null }); await pending; });
    expect(h.success).not.toHaveBeenCalled();
    expect(h.refetch).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(1);
  });
  it("unknown response survives a genuine React remount with the same request ID", async () => {
    const rpc = vi.fn(async (..._args: any[]) => ({ data: null, error: new Error("lost response") }));
    const first = setup(rpc);
    await act(async () => { await first.result.current.doCheckin(); });
    first.unmount();
    const second = setup(rpc);
    await act(async () => { await second.result.current.doCheckin(); });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1].p_request_id).toBe(rpc.mock.calls[1][1].p_request_id);
  });
});
