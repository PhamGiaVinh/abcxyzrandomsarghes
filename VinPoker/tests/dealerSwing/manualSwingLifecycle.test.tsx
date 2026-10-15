import { useEffect, useRef } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { classifyManualSwingOutcome } from "@/lib/dealerSwingOutcome";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
// Executes the actual production callback/ref/effect seam with React hooks;
// synthetic RPC only, not a full Dealer panel or DB/worker test.
const source = readFileSync("src/components/cashier/DealerSwingTab.tsx", "utf8");
const start = source.indexOf("  const swingingRef = useRef(false);");
const end = source.indexOf("  // Mass assign:", start);
if (start < 0 || end <= start) throw new Error("manual swing seam missing");
const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const production = new Function("useRef", "useEffect", "context", `
const {assignments,user,activeClubId,supabase,toast,refetchAssignments,refetchDealers,setSwingingTableId,
 classifyManualSwingOutcome,waitForManualPlayerResponse,dealerMassOpenRpc}=context;
${code}
return {performSwingForTable};`);
function context() {
  const ctx = { assignments: [{ id: "assignment-a", table_id: "table-a", table_session_id: "session-a", version: 1 }],
    user: { id: "actor-a" }, activeClubId: "club-a", supabase: { rpc: vi.fn() },
    toast: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() },
    refetchAssignments: vi.fn(), refetchDealers: vi.fn(), setSwingingTableId: vi.fn(),
    classifyManualSwingOutcome, waitForManualPlayerResponse };
  return { ...ctx, dealerMassOpenRpc: (name: string, args: Record<string, unknown>) => ctx.supabase.rpc(name, args) };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("ignores an acknowledgement after unmount and prevents synchronous double-clicks", async () => {
  const ctx = context(); let finish!: (value: unknown) => void;
  ctx.supabase.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const hook = renderHook(() => production(useRef, useEffect, ctx));
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.performSwingForTable("assignment-a");
    void hook.result.current.performSwingForTable("assignment-a");
  });
  expect(ctx.supabase.rpc).toHaveBeenCalledTimes(1);
  hook.unmount(); ctx.setSwingingTableId.mockClear();
  await act(async () => { finish({ data: { outcome: "swung" }, error: null }); await pending; });
  expect(ctx.toast.success).not.toHaveBeenCalled();
  expect(ctx.refetchAssignments).not.toHaveBeenCalled();
  expect(ctx.refetchDealers).not.toHaveBeenCalled();
  expect(ctx.setSwingingTableId).not.toHaveBeenCalled();
});
it("retains the exact request and version after an unknown outcome", async () => {
  const ctx = context(); ctx.supabase.rpc.mockResolvedValue({ data: { outcome: "unexpected" }, error: null });
  const hook = renderHook(() => production(useRef, useEffect, ctx));
  await act(async () => hook.result.current.performSwingForTable("assignment-a"));
  ctx.assignments[0].version = 2;
  await act(async () => hook.result.current.performSwingForTable("assignment-a"));
  expect(ctx.supabase.rpc.mock.calls[1][1]).toEqual(ctx.supabase.rpc.mock.calls[0][1]);
});
it("bounds a hung request without accepting late success or generating a retry", async () => {
  vi.useFakeTimers(); const ctx = context(); let finish!: (value: unknown) => void;
  ctx.supabase.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const hook = renderHook(() => production(useRef, useEffect, ctx));
  let pending!: Promise<void>;
  act(() => { pending = hook.result.current.performSwingForTable("assignment-a"); });
  await act(async () => { await vi.advanceTimersByTimeAsync(20_001); await pending; });
  expect(ctx.setSwingingTableId).toHaveBeenLastCalledWith(null);
  await act(async () => finish({ data: { outcome: "swung" }, error: null }));
  expect(ctx.toast.success).not.toHaveBeenCalled(); expect(ctx.supabase.rpc).toHaveBeenCalledTimes(1);
  const original = ctx.supabase.rpc.mock.calls[0][1]; ctx.assignments[0].version = 2;
  ctx.supabase.rpc.mockResolvedValue({ data: { outcome: "swung" }, error: null });
  await act(async () => hook.result.current.performSwingForTable("assignment-a"));
  expect(ctx.supabase.rpc.mock.calls[1][1]).toEqual(original);
});
it("does not let an old club response clear the current club write flight", async () => {
  const old = context(), next = context(); next.activeClubId = "club-b";
  let finishOld!: (value: unknown) => void, finishNew!: (value: unknown) => void;
  old.supabase.rpc.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  next.supabase.rpc.mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
  const hook = renderHook(({ctx}) => production(useRef, useEffect, ctx), { initialProps: {ctx:old} });
  let a!: Promise<void>, b!: Promise<void>;
  act(() => { a = hook.result.current.performSwingForTable("assignment-a"); });
  hook.rerender({ctx:next});
  act(() => { b = hook.result.current.performSwingForTable("assignment-a"); });
  next.setSwingingTableId.mockClear();
  await act(async () => { finishOld({ data: { outcome: "swung" }, error: null }); await a; });
  expect(old.toast.success).not.toHaveBeenCalled(); expect(next.setSwingingTableId).not.toHaveBeenCalled();
  await act(async () => { finishNew({ data: { outcome: "swung" }, error: null }); await b; });
  expect(next.toast.success).toHaveBeenCalledOnce();
});
