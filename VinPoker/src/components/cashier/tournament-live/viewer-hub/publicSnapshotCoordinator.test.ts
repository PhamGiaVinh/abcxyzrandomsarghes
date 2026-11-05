import { describe, expect, it, vi } from "vitest";
import { registerPublicTournamentRead, PublicSnapshotCoordinator, PUBLIC_SPECTATOR_READ_INTERVAL_MS, PUBLIC_SPECTATOR_HINT_JITTER_MS, normalizeVisibleTableIds } from "./publicSnapshotCoordinator";

describe("PublicSnapshotCoordinator", () => {
  it('spreads the production hint policy across 100ms windows within a two-second dispatch budget',async()=>{
    vi.useFakeTimers();const random=vi.spyOn(Math,'random');
    try{
      const starts:number[]=[],base=Date.now();
      const coordinators=Array.from({length:1000},(_,i)=>{
        random.mockReturnValue(i/1000);
        return new PublicSnapshotCoordinator(async()=>{starts.push(Date.now()-base);},PUBLIC_SPECTATOR_READ_INTERVAL_MS,PUBLIC_SPECTATOR_HINT_JITTER_MS);
      });
      coordinators.forEach(c=>c.request());await Promise.resolve();
      coordinators.forEach(c=>c.request());
      await vi.advanceTimersByTimeAsync(2200);
      const hinted=starts.slice(1000),windows=new Map<number,number>();
      hinted.forEach(t=>{const window=Math.floor(t/100);windows.set(window,(windows.get(window)??0)+1);});
      expect(hinted).toHaveLength(1000);
      expect(Math.max(...windows.values())).toBeLessThanOrEqual(100);
      expect(Math.max(...hinted)).toBeLessThan(2000);
      coordinators.forEach(c=>c.stop());
    }finally{random.mockRestore();vi.useRealTimers();}
  });
  it('serializes a held read and cancels its jittered trailing hint on stop',async()=>{
    vi.useFakeTimers();const random=vi.spyOn(Math,'random').mockReturnValue(.5);
    try{
      let release!:()=>void;
      const refresh=vi.fn().mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;})).mockResolvedValue(undefined);
      const coordinator=new PublicSnapshotCoordinator(refresh,2000,200);
      coordinator.request();coordinator.request();coordinator.request();
      await vi.advanceTimersByTimeAsync(500);expect(refresh).toHaveBeenCalledTimes(1);
      release();await Promise.resolve();await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1599);expect(refresh).toHaveBeenCalledTimes(1);
      coordinator.stop();await vi.advanceTimersByTimeAsync(5000);
      expect(refresh).toHaveBeenCalledTimes(1);
    }finally{random.mockRestore();vi.useRealTimers();}
  });
  it("does not turn an overdue scheduled hint into an extra trailing read",async()=>{
    vi.useFakeTimers();
    try{
      const refresh=vi.fn().mockResolvedValue(undefined);
      const coordinator=new PublicSnapshotCoordinator(refresh,1000);
      coordinator.request();await Promise.resolve();coordinator.request();
      vi.setSystemTime(Date.now()+1100);coordinator.request();await Promise.resolve();
      await vi.advanceTimersByTimeAsync(3000);
      expect(refresh).toHaveBeenCalledTimes(2);coordinator.stop();
    }finally{vi.useRealTimers();}
  });

  it("spreads a thousand shared hints without delaying initial reads or sliding deadlines",async()=>{
    vi.useFakeTimers();const random=vi.spyOn(Math,'random');
    try{
      const starts:number[]=[],base=Date.now();
      const coordinators=Array.from({length:1000},(_,i)=>{
        random.mockReturnValue(i/1000);
        return new PublicSnapshotCoordinator(async()=>{starts.push(Date.now()-base);},2000,200);
      });
      coordinators.forEach(c=>c.request());await Promise.resolve();
      expect(starts).toHaveLength(1000);expect(starts.every(t=>t===0)).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      coordinators.forEach(c=>c.request());
      await vi.advanceTimersByTimeAsync(500);coordinators.forEach(c=>c.request());
      await vi.advanceTimersByTimeAsync(700);
      const hinted=starts.slice(1000),buckets=new Map<number,number>();
      hinted.forEach(t=>buckets.set(t,(buckets.get(t)??0)+1));
      expect(hinted).toHaveLength(1000);
      expect(Math.max(...buckets.values())).toBeLessThanOrEqual(10);
      expect(Math.min(...hinted)).toBeGreaterThanOrEqual(2000);
      expect(Math.max(...hinted)).toBeLessThanOrEqual(2200);
      await vi.advanceTimersByTimeAsync(5000);expect(starts).toHaveLength(2000);
      coordinators.forEach(c=>c.stop());
    }finally{random.mockRestore();vi.useRealTimers();}
  });
  it("coalesces an event storm into one trailing refresh", async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const refresh = vi.fn().mockImplementationOnce(() => first).mockResolvedValue(undefined);
    const coordinator = new PublicSnapshotCoordinator(refresh);
    coordinator.request();
    coordinator.request();
    coordinator.request();
    expect(refresh).toHaveBeenCalledTimes(1);
    release();
    await first;
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });

  it("does not replay queued refreshes after stop", async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const refresh = vi.fn(() => first);
    const coordinator = new PublicSnapshotCoordinator(refresh);
    coordinator.request();
    coordinator.request();
    coordinator.stop();
    release();
    await first;
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("rate-limits repeated invalidation hints independently of hint payloads", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const coordinator = new PublicSnapshotCoordinator(refresh, 1_000);
    coordinator.request();
    await Promise.resolve();
    coordinator.request();
    coordinator.request();
    await vi.advanceTimersByTimeAsync(999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    coordinator.stop();
    vi.useRealTimers();
  });
});

describe("normalizeVisibleTableIds", () => {
  it("deduplicates and caps the public request at sixteen tables", () => {
    const ids = Array.from({ length: 20 }, (_, index) => `table-${index}`);
    expect(normalizeVisibleTableIds([ids[0], ...ids, ""])).toEqual(ids.slice(0, 16));
  });
});


describe('shared tournament read scheduling', () => {
  it('shares one hint deadline while first scope reads remain immediate', async () => {
    vi.useFakeTimers(); const random=vi.spyOn(Math,'random').mockReturnValue(.5);
    const client={}, a=vi.fn().mockResolvedValue(undefined), b=vi.fn().mockResolvedValue(undefined);
    const first=registerPublicTournamentRead(client,'tour',a), second=registerPublicTournamentRead(client,'tour',b);
    try {
      first.request(); second.request(); await vi.advanceTimersByTimeAsync(0);
      expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1);
      first.request(); second.request(); first.request();
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1499); expect(a).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1); expect(a).toHaveBeenCalledTimes(2); expect(b).toHaveBeenCalledTimes(2);
    } finally {first.stop();second.stop();await Promise.resolve();random.mockRestore();vi.useRealTimers();}
  });
  it('does not hold a table behind a slow snapshot or cancel another consumer', async () => {
    vi.useFakeTimers();const random=vi.spyOn(Math,'random').mockReturnValue(0);
    let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
    const client={}, slow=vi.fn(()=>held), fast=vi.fn().mockResolvedValue(undefined);
    const first=registerPublicTournamentRead(client,'tour',slow),second=registerPublicTournamentRead(client,'tour',fast);
    try {
      first.request();second.request();await vi.advanceTimersByTimeAsync(0);
      first.request();second.request();await vi.advanceTimersByTimeAsync(1000);
      expect(slow).toHaveBeenCalledTimes(1);expect(fast).toHaveBeenCalledTimes(2);
      first.stop();release();await vi.advanceTimersByTimeAsync(0);
      second.request();await vi.advanceTimersByTimeAsync(1000);
      expect(slow).toHaveBeenCalledTimes(1);expect(fast).toHaveBeenCalledTimes(3);
    }finally{first.stop();second.stop();release();await Promise.resolve();random.mockRestore();vi.useRealTimers();}
  });
  it('keeps client and tournament dispatch schedules separate', async () => {
    vi.useFakeTimers();const random=vi.spyOn(Math,'random').mockReturnValue(0);const client={};
    const registrations=[registerPublicTournamentRead(client,'a',async()=>{}),registerPublicTournamentRead(client,'b',async()=>{}),registerPublicTournamentRead({},'a',async()=>{})];
    try{registrations.forEach(r=>r.request());await vi.advanceTimersByTimeAsync(0);registrations.forEach(r=>r.request());expect(vi.getTimerCount()).toBe(3);}
    finally{registrations.forEach(r=>r.stop());await Promise.resolve();random.mockRestore();vi.useRealTimers();}
  });
  it('releases a failed section without hiding failure or blocking other sections', async () => {
    vi.useFakeTimers();const log=vi.spyOn(console,'error').mockImplementation(()=>{});const client={};
    const bad=vi.fn().mockRejectedValue(new Error('read failed')),good=vi.fn().mockResolvedValue(undefined);
    const a=registerPublicTournamentRead(client,'tour',bad),b=registerPublicTournamentRead(client,'tour',good);
    try{a.request();b.request();await vi.advanceTimersByTimeAsync(0);expect(log).toHaveBeenCalledTimes(1);expect(good).toHaveBeenCalledTimes(1);}
    finally{a.stop();b.stop();await Promise.resolve();log.mockRestore();vi.useRealTimers();}
  });
  it('defers queued background dispatch until visible', async () => {
    vi.useFakeTimers();const random=vi.spyOn(Math,'random').mockReturnValue(0);const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
    const read=vi.fn().mockResolvedValue(undefined),registration=registerPublicTournamentRead({},'tour',read);
    try{registration.request();await vi.advanceTimersByTimeAsync(0);registration.request();visibility.mockReturnValue('hidden');await vi.advanceTimersByTimeAsync(2500);expect(read).toHaveBeenCalledTimes(1);visibility.mockReturnValue('visible');document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(1000);expect(read).toHaveBeenCalledTimes(2);}
    finally{registration.stop();await Promise.resolve();visibility.mockRestore();random.mockRestore();vi.useRealTimers();}
  });
});

describe('registration cleanup before dispatch',()=>{
  it('does not run a removed callback after immediate scope remount',async()=>{
    const client={},oldRead=vi.fn().mockResolvedValue(undefined),newRead=vi.fn().mockResolvedValue(undefined);
    const old=registerPublicTournamentRead(client,'tour',oldRead);old.request();old.stop();
    const current=registerPublicTournamentRead(client,'tour',newRead);current.request();
    await Promise.resolve();await Promise.resolve();
    expect(oldRead).not.toHaveBeenCalled();expect(newRead).toHaveBeenCalledTimes(1);current.stop();await Promise.resolve();
  });
  it('keeps a first read pending if the tab hides before its microtask',async()=>{
    vi.useFakeTimers();const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
    const read=vi.fn().mockResolvedValue(undefined),registration=registerPublicTournamentRead({},'tour',read);
    try{registration.request();visibility.mockReturnValue('hidden');await vi.advanceTimersByTimeAsync(3000);expect(read).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);visibility.mockReturnValue('visible');document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(2000);expect(read).toHaveBeenCalledTimes(1);}
    finally{registration.stop();await Promise.resolve();visibility.mockRestore();vi.useRealTimers();}
  });
});
