import { describe, expect, it, vi } from "vitest";
import { PublicSnapshotCoordinator, normalizeVisibleTableIds } from "./publicSnapshotCoordinator";

describe("PublicSnapshotCoordinator", () => {
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
