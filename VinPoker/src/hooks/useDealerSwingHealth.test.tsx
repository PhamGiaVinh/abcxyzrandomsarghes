import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const f=vi.hoisted(()=>({rpc:vi.fn(),user:{id:"a"} as {id:string}|null,session:{access_token:"TEST_A"}}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:(...args:unknown[])=>{
 const promise=Promise.resolve(f.rpc(...args));return Object.assign(promise,{abortSignal:()=>promise});
}}}));
vi.mock("@/hooks/useAuth",()=>({useAuth:()=>({user:f.user,session:f.session})}));
import {useDealerSwingHealth} from "./useDealerSwingHealth";
const row={club_id:"club",lock:{held:false},pre_announce:{pending:0,processing:0,failed_recent:0},overdue_now:0,last_swing_activity_at:null};
function setup(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 return ({children}:{children:ReactNode})=>createElement(QueryClientProvider,{client},children);}
beforeEach(()=>{f.user={id:"a"};f.session={access_token:"TEST_A"};f.rpc.mockReset();f.rpc.mockResolvedValue({data:[row],error:null});});
afterEach(()=>vi.useRealTimers());
describe("Swing health trust boundary",()=>{
 it('accepts the native held-lease contract, including a nullable heartbeat',async()=>{
  const valid={...row,lock:{held:true,is_expired:false,age_seconds:30,locked_at:'2026-10-19T00:00:00Z',expires_at:'2026-10-19T00:01:00Z',heartbeat_age_seconds:null}};
  f.rpc.mockResolvedValue({data:[valid],error:null});const h=renderHook(()=>useDealerSwingHealth(['club']),{wrapper:setup()});
  await waitFor(()=>expect(h.result.current.data).toEqual([valid]));expect(h.result.current.unavailable).toBe(false);h.unmount();
 });
 it.each([
  {...row,lock:{held:true,is_expired:'false',age_seconds:30,locked_at:'2026-10-19T00:00:00Z',expires_at:'2026-10-19T00:01:00Z'}},
  {...row,lock:{held:true,is_expired:false,age_seconds:NaN,locked_at:'2026-10-19T00:00:00Z',expires_at:'2026-10-19T00:01:00Z'}},
  {...row,lock:{held:true,is_expired:false,age_seconds:30,locked_at:'not-a-date',expires_at:'2026-10-19T00:01:00Z'}},
  {...row,last_swing_activity_at:'not-a-date'},
 ])('rejects malformed lease/activity evidence rather than presenting a verified engine',async(bad)=>{
  f.rpc.mockResolvedValue({data:[bad],error:null});const h=renderHook(()=>useDealerSwingHealth(['club']),{wrapper:setup()});
  await waitFor(()=>expect(h.result.current.unavailable).toBe(true));expect(h.result.current.data).toBeNull();h.unmount();
 });
 it("times out a hanging read and ignores its late completion",async()=>{
  vi.useFakeTimers();let complete!:(value:unknown)=>void;
  f.rpc.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
  const h=renderHook(()=>useDealerSwingHealth(["club"]),{wrapper:setup()});
  await act(async()=>{await vi.advanceTimersByTimeAsync(15_100);});
  expect(h.result.current.unavailable).toBe(true);expect(h.result.current.data).toBeNull();
  await act(async()=>{complete({data:[row],error:null});await vi.advanceTimersByTimeAsync(10);});
  expect(h.result.current.data).toBeNull();h.unmount();
 });
 for(const bad of [[row,row],[{...row,overdue_now:-1}],[{...row,overdue_now:NaN}],[{...row,pre_announce:{...row.pre_announce,pending:0.5}}]]) {
  it("rejects duplicate or invalid counters "+JSON.stringify(bad),async()=>{
   f.rpc.mockResolvedValue({data:bad,error:null});const h=renderHook(()=>useDealerSwingHealth(["club"]),{wrapper:setup()});
   await waitFor(()=>expect(h.result.current.unavailable).toBe(true));expect(h.result.current.data).toBeNull();
  });
 }
 it("does not show a previous actor's data while a new actor read is pending",async()=>{
  const h=renderHook(()=>useDealerSwingHealth(["club"]),{wrapper:setup()});
  await waitFor(()=>expect(h.result.current.data).toEqual([row]));
  f.rpc.mockImplementation(()=>new Promise(()=>{}));f.user={id:"b"};h.rerender();
  expect(h.result.current.data).toBeNull();
 });
 it("does not read or expose health after logout",async()=>{
  const h=renderHook(()=>useDealerSwingHealth(["club"]),{wrapper:setup()});await waitFor(()=>expect(h.result.current.data).toEqual([row]));
  f.user=null;h.rerender();expect(h.result.current.data).toBeNull();
  await act(async()=>{await h.result.current.refetch();});expect(f.rpc).toHaveBeenCalledTimes(1);
 });
 it("revalidates a new session for the same actor without exposing token in cache keys",async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const wrapper=({children}:{children:ReactNode})=>createElement(QueryClientProvider,{client},children);
  const h=renderHook(()=>useDealerSwingHealth(["club"]),{wrapper});await waitFor(()=>expect(h.result.current.data).toEqual([row]));
  f.rpc.mockImplementation(()=>new Promise(()=>{}));f.session={access_token:"TEST_B"};h.rerender();
  expect(h.result.current.data).toBeNull();
  expect(JSON.stringify(client.getQueryCache().getAll().map(q=>q.queryKey))).not.toMatch(/TEST_A|TEST_B/);
 });
});
