import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "user-a" } as { id: string } | null,
  read: vi.fn(),
  write: vi.fn(),
  signals: [] as AbortSignal[],
  subscriptions: new Map<string, boolean>(),
  listeners: [] as Array<{ event: string; callback: (payload: { new: Record<string, unknown> }) => void }>,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/lib/notifySound", () => ({
  playSuccessSound: vi.fn(), playErrorSound: vi.fn(), playWarningSound: vi.fn(),
  playInfoSound: vi.fn(), playAlertSound: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => {
    let count = false;
    let mutation = false;
    let userId = "";
    const query = {
      select: (_columns: string, options?: { head?: boolean }) => { count = Boolean(options?.head); return query; },
      update: () => { mutation = true; return query; },
      eq: (column: string, value: string | boolean) => { if (column === "user_id") userId = String(value); return query; },
      order: () => query,
      limit: () => query,
      abortSignal: (signal: AbortSignal) => {state.signals.push(signal);return query;},
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(mutation ? state.write(userId) : state.read(userId, count)).then(resolve, reject),
    };
    return query;
  },
  channel: (name: string) => {
    const channel = {
      name,
      on: (_kind: string, filter: { event: string }, callback: (payload: { new: Record<string, unknown> }) => void) => {
        if (state.subscriptions.get(name)) throw new Error("Cannot add callbacks after subscribe");
        state.listeners.push({ event: filter.event, callback });
        return channel;
      },
      subscribe: () => { state.subscriptions.set(name, true); return channel; },
    };
    return channel;
  },
  removeChannel: vi.fn((channel: { name: string }) => { state.subscriptions.delete(channel.name); }),
} }));

import { routeForNotification, useNotifications } from "./useNotifications";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

describe('notification destinations match active routes',()=>{
  for(const type of ['schedule_updated','club_schedule_updated','registration_confirmed','tournament_created'] as const){
    it(`${type} opens the current tournament list route`,()=>{
      expect(routeForNotification({type,data:{}})).toBe('/');
    });
  }
  it('group message opens the canonical group route',()=>{
    expect(routeForNotification({type:'chat_message',data:{group_id:'ad82bc10-27a1-4aab-8efa-2c0d01a621cb'}})).toBe('/group/ad82bc10-27a1-4aab-8efa-2c0d01a621cb');
  });
  for(const group_id of [undefined,null,'','../admin','not-a-uuid',42]){
    it(`malformed group target ${String(group_id)} falls back to inbox`,()=>{
      expect(routeForNotification({type:'chat_message',data:{group_id}})).toBe('/inbox');
    });
  }
});

describe("notification read scope", () => {
  beforeEach(() => {
    state.user = { id: "user-a" };
    state.read.mockReset();
    state.write.mockReset();
    state.write.mockResolvedValue({ error: null });
    state.listeners = [];
    state.subscriptions.clear();
    state.signals=[];
    state.read.mockImplementation((userId: string, count: boolean) => count
      ? { count: 1, error: null }
      : { data: [{ id: `notification-${userId}`, user_id: userId, title: userId, is_read: false }], error: null });
  });

  it("rejects a late previous-account snapshot", async () => {
    const old = deferred<unknown>();
    state.read.mockImplementation((userId: string, count: boolean) => userId === "user-a"
      ? old.promise
      : Promise.resolve(count ? { count: 1, error: null } : { data: [{ id: "new", user_id: userId }], error: null }));
    const hook = renderHook(() => useNotifications());
    await waitFor(() => expect(state.read).toHaveBeenCalledTimes(2));
    const previousSignals=[...state.signals];
    expect(previousSignals).toHaveLength(2);expect(previousSignals.every(signal=>!signal.aborted)).toBe(true);
    state.user = { id: "user-b" };
    hook.rerender();
    await waitFor(() => expect(hook.result.current.items[0]?.id).toBe("new"));
    expect(previousSignals.every(signal=>signal.aborted)).toBe(true);
    await act(async () => { old.resolve({ data: [{ id: "old", user_id: "user-a" }], count: 9, error: null }); });
    expect(hook.result.current.items[0]?.id).toBe("new");
    expect(hook.result.current.unreadCount).toBe(1);
  });

  it('bounds a hung read, aborts both queries and permits explicit same-scope recovery without losing the last snapshot',async()=>{
    const hook=renderHook(()=>useNotifications());
    await waitFor(()=>expect(hook.result.current.items).toHaveLength(1));
    const held=deferred<unknown>();state.read.mockImplementation(()=>held.promise);
    vi.useFakeTimers();
    try{
      let pending!:Promise<void>;act(()=>{pending=hook.result.current.refresh();});
      await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
      expect(hook.result.current.loading).toBe(false);expect(hook.result.current.error).toBeTruthy();
      await pending;
      expect(hook.result.current.items[0]?.id).toBe('notification-user-a');
      expect(state.signals.slice(-2)).toHaveLength(2);expect(state.signals.slice(-2).every(signal=>signal.aborted)).toBe(true);
      const calls=state.read.mock.calls.length;await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});
      expect(state.read).toHaveBeenCalledTimes(calls);
      state.read.mockImplementation((_actor:string,count:boolean)=>count?{count:2,error:null}:{data:[{id:'recovered',user_id:'user-a'}],error:null});
      await act(async()=>{await hook.result.current.refresh();});
      expect(hook.result.current.error).toBeNull();expect(hook.result.current.items[0]?.id).toBe('recovered');
      await act(async()=>{held.resolve({data:[{id:'late'}],count:9,error:null});});
      expect(hook.result.current.items[0]?.id).toBe('recovered');expect(hook.result.current.unreadCount).toBe(2);
    }finally{hook.unmount();vi.useRealTimers();}
  });

  it("supports simultaneous bell and page hooks without reusing a subscribed channel", async () => {
    const bell = renderHook(() => useNotifications(15));
    await waitFor(() => expect(bell.result.current.items).toHaveLength(1));
    const page = renderHook(() => useNotifications(100));
    await waitFor(() => expect(page.result.current.items).toHaveLength(1));
    expect(state.subscriptions.size).toBe(2);
    page.unmount();
    expect(state.subscriptions.size).toBe(1);
    await act(async () => { await bell.result.current.refresh(); });
    expect(bell.result.current.items).toHaveLength(1);
  });

  it("does not replace a valid snapshot with an empty success on read error", async () => {
    const hook = renderHook(() => useNotifications());
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    state.read.mockResolvedValue({ data: null, count: null, error: { message: "503 TEST" } });
    await act(async () => { await hook.result.current.refresh(); });
    expect(hook.result.current.items).toHaveLength(1);
    expect(hook.result.current.unreadCount).toBe(1);
  });

  it("keeps the newest same-account refresh when an older read finishes later", async () => {
    const hook = renderHook(() => useNotifications());
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    const old = deferred<unknown>();
    state.read.mockImplementation(() => old.promise);
    let earlier!: Promise<void>;
    act(() => { earlier = hook.result.current.refresh(); });
    await waitFor(() => expect(state.read).toHaveBeenCalledTimes(4));
    state.read.mockImplementation((_userId: string, count: boolean) => count
      ? { count: 2, error: null }
      : { data: [{ id: "latest", user_id: "user-a" }], error: null });
    await act(async () => { await hook.result.current.refresh(); });
    await act(async () => { old.resolve({ data: [{ id: "obsolete" }], count: 9, error: null }); await earlier; });
    expect(hook.result.current.items[0]?.id).toBe("latest");
    expect(hook.result.current.unreadCount).toBe(2);
  });

  it("retains the same-scope snapshot and exposes a thrown network error", async () => {
    const hook = renderHook(() => useNotifications());
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    state.read.mockRejectedValue(new TypeError("Failed to fetch"));
    await act(async () => { await hook.result.current.refresh(); });
    expect(hook.result.current.items).toHaveLength(1);
    expect(hook.result.current.error).toBe("Failed to fetch");
    expect(hook.result.current.loading).toBe(false);
    state.user = null;
    hook.rerender();
    expect(hook.result.current.items).toEqual([]);
    expect(hook.result.current.unreadCount).toBe(0);
  });

  it("notifies only a new INSERT for the active subscription, never initial reads or UPDATE", async () => {
    const notify = vi.fn();
    const hook = renderHook(() => useNotifications(20, notify));
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    expect(notify).not.toHaveBeenCalled();
    const oldInsert = state.listeners.find((listener) => listener.event === "INSERT")!;
    const update = state.listeners.find((listener) => listener.event === "UPDATE")!;
    await act(async () => { update.callback({ new: { user_id: "user-a" } }); });
    expect(notify).not.toHaveBeenCalled();
    await act(async () => { oldInsert.callback({ new: { id: "fresh", user_id: "user-a", title: "Fresh", type: "registration_confirmed" } }); });
    expect(notify).toHaveBeenCalledOnce();
    await act(async () => { oldInsert.callback({ new: { id: "fresh", user_id: "user-a", title: "Fresh", type: "registration_confirmed" } }); });
    expect(notify).toHaveBeenCalledOnce();
    state.user = { id: "user-b" };
    hook.rerender();
    await waitFor(() => expect(hook.result.current.items[0]?.user_id).toBe("user-b"));
    await act(async () => { oldInsert.callback({ new: { id: "late-event", user_id: "user-a" } }); });
    expect(notify).toHaveBeenCalledOnce();
    const currentInsert = state.listeners.filter((listener) => listener.event === "INSERT").at(-1)!;
    await act(async () => { currentInsert.callback({ new: { id: "foreign", user_id: "user-a" } }); });
    expect(notify).toHaveBeenCalledOnce();
  });

  it.each(["one", "all"])("does not acknowledge a failed mark-read %s mutation", async (kind) => {
    const hook = renderHook(() => useNotifications());
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    state.write.mockResolvedValue({ error: { message: "WRITE_DENIED" } });
    await act(async () => {
      if (kind === "one") await hook.result.current.markRead("notification-user-a");
      else await hook.result.current.markAllRead();
    });
    expect(hook.result.current.items[0]?.is_read).toBe(false);
    expect(hook.result.current.unreadCount).toBe(1);
  });

  it.each(["one", "all"])("bounds a hung mark-read %s without retry or late acknowledgment", async (kind) => {
    const hook = renderHook(() => useNotifications());
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    const held = deferred<{ error: null }>();
    state.write.mockReturnValue(held.promise);
    let accepted: boolean | null = null;
    let pending!: Promise<boolean>;
    vi.useFakeTimers();
    try {
      act(() => {
        pending = (kind === "one" ? hook.result.current.markRead("notification-user-a") : hook.result.current.markAllRead())
          .then(value => { accepted = value; return value; });
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(10001); });
      expect(accepted).toBe(false);
      expect(hook.result.current.error).toMatch(/10 giây/);
      expect(hook.result.current.items[0]?.is_read).toBe(false);
      expect(hook.result.current.unreadCount).toBe(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(state.write).toHaveBeenCalledOnce();
      state.read.mockImplementation((_actor: string, count: boolean) => count
        ? { count: 0, error: null }
        : { data: [{ id: "notification-user-a", user_id: "user-a", is_read: true }], error: null });
      await act(async () => { await hook.result.current.refresh(); });
      expect(hook.result.current.error).toBeNull();
      expect(hook.result.current.unreadCount).toBe(0);
      const reads = state.read.mock.calls.length;
      await act(async () => { held.resolve({ error: null }); await pending; });
      expect(accepted).toBe(false);
      expect(state.read).toHaveBeenCalledTimes(reads);
    } finally {
      hook.unmount();
      held.resolve({ error: null });
      await pending;
      vi.useRealTimers();
    }
  });

  it("does not refresh or acknowledge another account after an old write returns", async () => {
    const hook = renderHook(() => useNotifications());
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    const oldWrite = deferred<{ error: null }>();
    state.write.mockReturnValue(oldWrite.promise);
    let pending!: Promise<boolean>;
    act(() => { pending = hook.result.current.markAllRead(); });
    await waitFor(() => expect(state.write).toHaveBeenCalledWith("user-a"));
    state.user = { id: "user-b" };
    hook.rerender();
    await waitFor(() => expect(hook.result.current.items[0]?.user_id).toBe("user-b"));
    const reads = state.read.mock.calls.length;
    let accepted: boolean | undefined;
    await act(async () => { oldWrite.resolve({ error: null }); accepted = await pending; });
    expect(accepted).toBe(false);
    expect(state.read).toHaveBeenCalledTimes(reads);
    expect(hook.result.current.items[0]?.is_read).toBe(false);
    expect(hook.result.current.unreadCount).toBe(1);
  });

  it("rejects a write from the previous A scope after an A-B-A switch", async () => {
    const hook = renderHook(() => useNotifications());
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    const oldWrite = deferred<{ error: null }>();
    state.write.mockReturnValue(oldWrite.promise);
    let pending!: Promise<boolean>;
    act(() => { pending = hook.result.current.markAllRead(); });
    await waitFor(() => expect(state.write).toHaveBeenCalledOnce());
    state.user = { id: "user-b" }; hook.rerender();
    await waitFor(() => expect(hook.result.current.items[0]?.user_id).toBe("user-b"));
    state.user = { id: "user-a" }; hook.rerender();
    await waitFor(() => expect(hook.result.current.items[0]?.user_id).toBe("user-a"));
    const reads = state.read.mock.calls.length;
    let accepted: boolean | undefined;
    await act(async () => { oldWrite.resolve({ error: null }); accepted = await pending; });
    expect(accepted).toBe(false);
    expect(state.read).toHaveBeenCalledTimes(reads);
  });

  it("rejects acknowledgment when account changes during post-write refresh", async () => {
    const hook = renderHook(() => useNotifications());
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    const refresh = deferred<unknown>();
    state.read.mockImplementation((userId: string, count: boolean) => userId === "user-a" ? refresh.promise
      : { data: [{ id: "new", user_id: userId }], count: count ? 1 : undefined, error: null });
    let pending!: Promise<boolean>;
    act(() => { pending = hook.result.current.markRead("notification-user-a"); });
    await waitFor(() => expect(state.read).toHaveBeenCalledTimes(4));
    state.user = { id: "user-b" }; hook.rerender();
    await waitFor(() => expect(hook.result.current.items[0]?.id).toBe("new"));
    let accepted: boolean | undefined;
    await act(async () => { refresh.resolve({ data: [], count: 0, error: null }); accepted = await pending; });
    expect(accepted).toBe(false);
  });

  it("rejects a pending write after unmount without starting a refresh", async () => {
    const hook = renderHook(() => useNotifications());
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    const write = deferred<{ error: null }>();
    state.write.mockReturnValue(write.promise);
    let pending!: Promise<boolean>;
    act(() => { pending = hook.result.current.markAllRead(); });
    await waitFor(() => expect(state.write).toHaveBeenCalledOnce());
    hook.unmount();
    let accepted: boolean | undefined;
    await act(async () => { write.resolve({ error: null }); accepted = await pending; });
    expect(accepted).toBe(false);
    expect(state.read).toHaveBeenCalledTimes(2);
  });

  it("rejects the first mount read after StrictMode cleanup and setup", async () => {
    const obsolete = deferred<unknown>();
    let calls = 0;
    state.read.mockImplementation((_userId: string, count: boolean) => {
      calls += 1;
      if (calls <= 2) return obsolete.promise;
      return count ? { count: 1, error: null } : { data: [{ id: "current", user_id: "user-a" }], error: null };
    });
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const hook = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(hook.result.current.items[0]?.id).toBe("current"));
    await act(async () => { obsolete.resolve({ data: [{ id: "obsolete" }], count: 9, error: null }); });
    expect(hook.result.current.items[0]?.id).toBe("current");
    expect(hook.result.current.unreadCount).toBe(1);
  });

 it.each([
  ['null list',null,0],['object list',{},0],['null count',[],null],['fractional count',[],0.5],['negative count',[],-1],
 ])('rejects a successful malformed %s instead of publishing an empty inbox',async(_case,data,count)=>{
  const hook=renderHook(()=>useNotifications());
  await waitFor(()=>expect(hook.result.current.items).toHaveLength(1));
  state.read.mockImplementation((_actor:string,isCount:boolean)=>isCount?{count,error:null}:{data,error:null});
  await act(async()=>{await hook.result.current.refresh();});
  expect(hook.result.current.error).toBeTruthy();
  expect(hook.result.current.items[0]?.id).toBe('notification-user-a');
  expect(hook.result.current.unreadCount).toBe(1);
  state.read.mockImplementation((_actor:string,isCount:boolean)=>isCount?{count:0,error:null}:{data:[],error:null});
  await act(async()=>{await hook.result.current.refresh();});
  expect(hook.result.current.error).toBeNull();
  expect(hook.result.current.items).toEqual([]);expect(hook.result.current.unreadCount).toBe(0);
  expect(state.write).not.toHaveBeenCalled();
 });
});
