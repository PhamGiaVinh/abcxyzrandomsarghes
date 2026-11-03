import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOperationalCapabilities } from "./useOperationalCapabilities";
import type { LoadedOpsCapabilities } from "@/ops/auth/opsCapabilityLoader";
import type { OpsClubCapabilityRow } from "@/ops/auth/opsCapabilityContract";
const h = vi.hoisted(() => ({ auth: { user: { id: "member-a" } as {id:string} | null,
  session: { access_token: "TEST_SESSION_A" }, loading: false, authError: null as string|null }, load: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/ops/auth/opsCapabilityLoader", () => ({ loadOpsCapabilities: h.load }));
const row = (club_id: string, facet: Partial<OpsClubCapabilityRow> = {}): OpsClubCapabilityRow => ({
  club_id, can_owner:false,can_floor:false,can_cashier:false,can_tracker:false,can_dealer_control:false,
  can_accountant:false,can_chip_master:false,can_marketer:false,can_fnb_cashier:false,can_fnb_server:false,can_fnb_kitchen:false,...facet,
});
const value = (...scope: OpsClubCapabilityRow[]): LoadedOpsCapabilities => ({scope,global:{is_super_admin:false},source:"unified"});
function deferred() { let resolve!: (v:LoadedOpsCapabilities)=>void; const promise=new Promise<LoadedOpsCapabilities>(r=>{resolve=r;}); return {promise,resolve}; }
beforeEach(()=>{h.load.mockReset();h.auth.user={id:"member-a"};h.auth.session={access_token:"TEST_SESSION_A"};h.auth.loading=false;h.auth.authError=null;});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe("operational caller-bound capability readiness",()=>{
  it("waits for actual membership instead of denying a roleless operator",async()=>{
    const pending=deferred();h.load.mockReturnValue(pending.promise);const {result}=renderHook(useOperationalCapabilities);
    expect(result.current.loading).toBe(true);expect(result.current.allows("marketing")).toBe(false);
    await act(async()=>pending.resolve(value(row("club-a",{can_marketer:true,can_accountant:true}))));
    expect(result.current.loading).toBe(false);expect(result.current.allows("marketing")).toBe(true);expect(result.current.allows("accountant")).toBe(true);
  });
  it("keeps F&B facets and owner inheritance within the requested club",async()=>{
    h.load.mockResolvedValue(value(row("A",{can_fnb_cashier:true}),row("B",{can_fnb_kitchen:true}),row("C",{can_owner:true})));
    const {result}=renderHook(useOperationalCapabilities);await waitFor(()=>expect(result.current.loading).toBe(false));
    expect(result.current.hasFacet("can_fnb_cashier","A")).toBe(true);expect(result.current.hasFacet("can_fnb_cashier","B")).toBe(false);
    expect(result.current.hasFacet("can_fnb_kitchen","B")).toBe(true);expect(result.current.hasFacet("can_fnb_server","C")).toBe(true);
    expect(result.current.hasFacet("can_fnb_cashier","unrelated")).toBe(false);
  });
  it("does not infer authorization from a successful empty scope",async()=>{
    h.load.mockResolvedValue(value());const {result}=renderHook(useOperationalCapabilities);await waitFor(()=>expect(result.current.loading).toBe(false));
    expect(result.current.allows("accountant")).toBe(false);expect(result.current.hasFacet("can_fnb_cashier")).toBe(false);
  });
  it("hides prior account capabilities synchronously and ignores late old responses",async()=>{
    const old=deferred(),next=deferred();h.load.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const {result,rerender}=renderHook(useOperationalCapabilities);h.auth.user={id:"member-b"};rerender();
    await act(async()=>old.resolve(value(row("A",{can_owner:true}))));expect(result.current.allows("accountant")).toBe(false);
    await act(async()=>next.resolve(value(row("B",{can_fnb_kitchen:true}))));expect(result.current.hasFacet("can_fnb_kitchen","B")).toBe(true);
    expect(result.current.hasFacet("can_fnb_cashier","A")).toBe(false);
  });
  it("retires the old capability snapshot on token rotation",async()=>{
    h.load.mockResolvedValueOnce(value(row("A",{can_owner:true})));const next=deferred();h.load.mockReturnValueOnce(next.promise);
    const {result,rerender}=renderHook(useOperationalCapabilities);await waitFor(()=>expect(result.current.allows("accountant")).toBe(true));
    h.auth.session={access_token:"TEST_SESSION_B"};rerender();expect(result.current.loading).toBe(true);expect(result.current.allows("accountant")).toBe(false);
    await act(async()=>next.resolve(value()));expect(result.current.allows("accountant")).toBe(false);
  });
  it("fails closed on an unavailable server contract",async()=>{
    h.load.mockRejectedValue(new Error("unavailable"));const {result}=renderHook(useOperationalCapabilities);await waitFor(()=>expect(result.current.error).toBe(true));
    expect(result.current.loading).toBe(false);expect(result.current.allows("marketing")).toBe(false);
  });
  it("bounds a hung scope read and does not publish late permission",async()=>{
    vi.useFakeTimers();const pending=deferred();h.load.mockReturnValue(pending.promise);const {result}=renderHook(useOperationalCapabilities);
    await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});expect(result.current.error).toBe(true);
    await act(async()=>pending.resolve(value(row("A",{can_owner:true}))));expect(result.current.allows("accountant")).toBe(false);
  });
  it("does not query memberships without a verified available session",()=>{
    h.auth.user=null;const {result}=renderHook(useOperationalCapabilities);expect(h.load).not.toHaveBeenCalled();expect(result.current.allows("fnb")).toBe(false);
  });
});
