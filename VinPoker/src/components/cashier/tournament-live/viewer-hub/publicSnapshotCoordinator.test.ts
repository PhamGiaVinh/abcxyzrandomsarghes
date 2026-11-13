import { describe, expect, it, vi } from "vitest";
import { registerPublicTournamentRead, PublicSnapshotCoordinator, PUBLIC_SPECTATOR_READ_INTERVAL_MS, PUBLIC_SPECTATOR_HINT_JITTER_MS, normalizeVisibleTableIds } from "./publicSnapshotCoordinator";

describe("PublicSnapshotCoordinator", () => {
  it('retains the viewer spread during continuous hints without sliding an existing deadline',async()=>{
    vi.useFakeTimers();const random=vi.spyOn(Math,'random').mockReturnValue(.5);
    try{
      const base=Date.now(),starts:number[]=[];
      const coordinator=new PublicSnapshotCoordinator(async()=>{starts.push(Date.now()-base);},1000,1000);
      coordinator.request();await Promise.resolve();coordinator.request();await vi.advanceTimersByTimeAsync(1500);
      for(let i=0;i<4;i++){coordinator.request();await vi.advanceTimersByTimeAsync(750);coordinator.request();await vi.advanceTimersByTimeAsync(750);}
      expect(starts).toEqual([0,1500,3000,4500,6000,7500]);
      expect(starts.slice(1).every((t,i)=>t-starts[i]>=1000)).toBe(true);coordinator.stop();
    }finally{random.mockRestore();vi.useRealTimers();}
  });
  it('bounds sustained thousand-viewer dispatches and eventually reads the latest source hint',async()=>{
    vi.useFakeTimers();const random=vi.spyOn(Math,'random');
    const base=Date.now(),starts:{at:number;viewer:number}[]=[],seen=Array(1000).fill(0);let revision=0;
    const coordinators=Array.from({length:1000},(_,viewer)=>{
      random.mockReturnValue(viewer/1000);
      return new PublicSnapshotCoordinator(async()=>{starts.push({at:Date.now()-base,viewer});seen[viewer]=revision;},PUBLIC_SPECTATOR_READ_INTERVAL_MS,PUBLIC_SPECTATOR_HINT_JITTER_MS);
    });
    try{
      coordinators.forEach(c=>c.request());await vi.advanceTimersByTimeAsync(0);
      for(let tick=0;tick<32;tick++){await vi.advanceTimersByTimeAsync(250);revision++;coordinators.forEach(c=>c.request());}
      const sustained=starts.filter(row=>row.at<=8000);
      expect(sustained.length).toBeLessThan(5600);
      expect(sustained.filter(row=>row.at===0)).toHaveLength(1000);
      // Deterministic scheduling coverage, not a production traffic bound:
      // retained client offsets spread successive waves into more windows.
      const windows=new Map<number,number>();
      sustained.filter(row=>row.at>0).forEach(row=>{const window=Math.floor(row.at/100);windows.set(window,(windows.get(window)??0)+1);});
      expect(windows.size).toBeGreaterThan(40);
      expect(Math.max(...windows.values())).toBeLessThanOrEqual(250);
      for(let viewer=0;viewer<1000;viewer++){
        const times=sustained.filter(row=>row.viewer===viewer).map(row=>row.at);
        expect(times.length).toBeGreaterThanOrEqual(5);
        expect(times.slice(1).every((time,index)=>time-times[index]>=1500&&time-times[index]<2000)).toBe(true);
      }
      await vi.advanceTimersByTimeAsync(2000);expect(seen.every(value=>value===revision)).toBe(true);
    }finally{coordinators.forEach(c=>c.stop());random.mockRestore();vi.useRealTimers();}
  });
  it('still spreads repeated shared bursts after idle time across a thousand clients',async()=>{
    vi.useFakeTimers();const random=vi.spyOn(Math,'random');
    try{
      const base=Date.now(),starts:number[]=[];
      const coordinators=Array.from({length:1000},(_,i)=>{random.mockReturnValue(i/1000);return new PublicSnapshotCoordinator(async()=>{starts.push(Date.now()-base);},1000,1000);});
      coordinators.forEach(c=>c.request());await vi.advanceTimersByTimeAsync(3000);
      coordinators.forEach(c=>c.request());await vi.advanceTimersByTimeAsync(4000);
      coordinators.forEach(c=>c.request());await vi.advanceTimersByTimeAsync(1000);
      for(const offset of [1000,2000]){
        const burst=starts.slice(offset,offset+1000),windows=new Map<number,number>();
        burst.forEach(t=>windows.set(Math.floor(t/100),(windows.get(Math.floor(t/100))??0)+1));
        expect(burst).toHaveLength(1000);expect(Math.max(...windows.values())).toBeLessThanOrEqual(100);
      }
      coordinators.forEach(c=>c.stop());
    }finally{random.mockRestore();vi.useRealTimers();}
  });
  it('spreads the production hint policy across 100ms windows within its2s dispatch budget',async()=>{
    vi.useFakeTimers();const random=vi.spyOn(Math,'random');
    try{
      const starts:number[]=[],base=Date.now();
      const coordinators=Array.from({length:1000},(_,i)=>{
        random.mockReturnValue(i/1000);
        return new PublicSnapshotCoordinator(async()=>{starts.push(Date.now()-base);},PUBLIC_SPECTATOR_READ_INTERVAL_MS,PUBLIC_SPECTATOR_HINT_JITTER_MS);
      });
      coordinators.forEach(c=>c.request());await Promise.resolve();
      coordinators.forEach(c=>c.request());
      await vi.advanceTimersByTimeAsync(2000);
      const hinted=starts.slice(1000),windows=new Map<number,number>();
      hinted.forEach(t=>{const window=Math.floor(t/100);windows.set(window,(windows.get(window)??0)+1);});
      expect(hinted).toHaveLength(1000);
      expect(Math.max(...windows.values())).toBeLessThanOrEqual(200);
      expect(Math.max(...hinted)).toBeLessThan(2000);
      coordinators.forEach(c=>c.stop());
    }finally{random.mockRestore();vi.useRealTimers();}
  });
  it('coalesces one-second source hints while retaining the latest queued read',async()=>{
    vi.useFakeTimers();const random=vi.spyOn(Math,'random').mockReturnValue(0);
    try{
      const base=Date.now(),starts:number[]=[];
      const coordinator=new PublicSnapshotCoordinator(async()=>{starts.push(Date.now()-base);},PUBLIC_SPECTATOR_READ_INTERVAL_MS,PUBLIC_SPECTATOR_HINT_JITTER_MS);
      coordinator.request();await vi.advanceTimersByTimeAsync(0);
      for(let second=1;second<=10;second++){await vi.advanceTimersByTimeAsync(1000);coordinator.request();}
      await vi.advanceTimersByTimeAsync(500);
      expect(starts).toEqual([0,1500,3000,4500,6000,7500,9000,10500]);
      coordinator.stop();await vi.advanceTimersByTimeAsync(5000);expect(starts).toHaveLength(8);
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
  it.each(['hidden','removed','rejected'] as const)('preserves %s boundaries after a default in-flight section changes scheduling',async(boundary)=>{
    vi.useFakeTimers();const random=vi.spyOn(Math,'random').mockReturnValue(.5),visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('visible'),log=vi.spyOn(console,'error').mockImplementation(()=>{});
    let release!:()=>void,reject!:(cause:Error)=>void;const held=new Promise<void>((resolve,no)=>{release=resolve;reject=no;});
    let calls=0;const read=vi.fn(async()=>{calls++;if(calls===1)await held;});
    const client={},detail=registerPublicTournamentRead(client,'transition-'+boundary,read),metadata=registerPublicTournamentRead(client,'transition-'+boundary,async()=>{});
    try{
      detail.request();metadata.request();await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);detail.request();metadata.request();await vi.advanceTimersByTimeAsync(1200);
      if(boundary==='hidden')visibility.mockReturnValue('hidden');if(boundary==='removed')detail.stop();
      if(boundary==='rejected')reject(new Error('held read failed'));else release();await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledTimes(boundary==='rejected'?2:1);
      if(boundary==='hidden'){visibility.mockReturnValue('visible');document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(0);expect(read).toHaveBeenCalledTimes(2);}
      if(boundary==='rejected')expect(log).toHaveBeenCalledTimes(1);
      if(boundary==='removed'){await vi.advanceTimersByTimeAsync(3000);expect(read).toHaveBeenCalledTimes(1);}
    }finally{detail.stop();metadata.stop();release();await Promise.resolve();log.mockRestore();visibility.mockRestore();random.mockRestore();vi.useRealTimers();}
  });
  it('keeps the original interval and jitter when a queued table completes before its own deadline',async()=>{
    vi.useFakeTimers();const random=vi.spyOn(Math,'random').mockReturnValue(.5);
    const base=Date.now(),starts:number[]=[];let release!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;});
    const client={},detail=registerPublicTournamentRead(client,'early-table',async()=>{starts.push(Date.now()-base);if(starts.length===1)await held;}),metadata=registerPublicTournamentRead(client,'early-table',async()=>{});
    try{
      detail.request();metadata.request();await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);detail.request();metadata.request();
      await vi.advanceTimersByTimeAsync(200);release();await vi.advanceTimersByTimeAsync(549);
      expect(starts).toEqual([0]);await vi.advanceTimersByTimeAsync(1);expect(starts).toEqual([0,1750]);
    }finally{detail.stop();metadata.stop();release();await Promise.resolve();random.mockRestore();vi.useRealTimers();}
  });
  it('does not charge an already eligible table a new interval after an unrelated metadata wave',async()=>{
    vi.useFakeTimers();const random=vi.spyOn(Math,'random').mockReturnValue(.5);
    const base=Date.now(),starts:number[]=[];let release!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;});
    const client={},detail=registerPublicTournamentRead(client,'owed-table',async()=>{starts.push(Date.now()-base);if(starts.length===1)await held;}),metadata=registerPublicTournamentRead(client,'owed-table',async()=>{});
    try{
      detail.request();metadata.request();await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);detail.request();metadata.request();
      await vi.advanceTimersByTimeAsync(750);expect(starts).toEqual([0]);
      await vi.advanceTimersByTimeAsync(450);release();await vi.advanceTimersByTimeAsync(0);
      expect(starts).toEqual([0,2200]);
    }finally{detail.stop();metadata.stop();release();await Promise.resolve();random.mockRestore();vi.useRealTimers();}
  });
  it('shares one hint deadline while first scope reads remain immediate', async () => {
    vi.useFakeTimers(); const random=vi.spyOn(Math,'random').mockReturnValue(.5);
    const client={}, a=vi.fn().mockResolvedValue(undefined), b=vi.fn().mockResolvedValue(undefined);
    const first=registerPublicTournamentRead(client,'tour',a), second=registerPublicTournamentRead(client,'tour',b);
    try {
      first.request(); second.request(); await vi.advanceTimersByTimeAsync(0);
      expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1);
      first.request(); second.request(); first.request();
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1749); expect(a).toHaveBeenCalledTimes(1);
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
      first.request();second.request();await vi.advanceTimersByTimeAsync(PUBLIC_SPECTATOR_READ_INTERVAL_MS);
      expect(slow).toHaveBeenCalledTimes(1);expect(fast).toHaveBeenCalledTimes(2);
      first.stop();release();await vi.advanceTimersByTimeAsync(0);
      second.request();await vi.advanceTimersByTimeAsync(PUBLIC_SPECTATOR_READ_INTERVAL_MS);
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

describe('overview section eligibility', () => {
  it('keeps one fixed timer with independent overview and clock deadlines', async () => {
    vi.useFakeTimers(); const random = vi.spyOn(Math, 'random').mockReturnValue(.5);
    const client = {}, overview = vi.fn().mockResolvedValue(undefined), clock = vi.fn().mockResolvedValue(undefined);
    const a = registerPublicTournamentRead(client, 'mixed', overview, true), b = registerPublicTournamentRead(client, 'mixed', clock);
    try {
      a.request(); b.request(); await vi.advanceTimersByTimeAsync(0);
      a.request(); b.request();
      await vi.advanceTimersByTimeAsync(500); a.request(); b.request();
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(749); expect(overview).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1); expect(overview).toHaveBeenCalledTimes(2); expect(clock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(500); expect(clock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5000); expect(overview).toHaveBeenCalledTimes(2);
    } finally { a.stop(); b.stop(); await Promise.resolve(); random.mockRestore(); vi.useRealTimers(); }
  });
  it('serves only one owed read on completion without blocking a clock', async () => {
    vi.useFakeTimers(); const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    const read = vi.fn().mockImplementationOnce(() => held).mockResolvedValue(undefined), clock = vi.fn().mockResolvedValue(undefined);
    const client = {}, a = registerPublicTournamentRead(client, 'owed', read, true), b = registerPublicTournamentRead(client, 'owed', clock);
    try {
      a.request(); b.request(); await vi.advanceTimersByTimeAsync(0);
      for (let i = 0; i < 100; i++) a.request(); b.request();
      await vi.advanceTimersByTimeAsync(2500); expect(read).toHaveBeenCalledTimes(1); expect(clock).toHaveBeenCalledTimes(2);
      release(); await vi.advanceTimersByTimeAsync(0); expect(read).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5000); expect(read).toHaveBeenCalledTimes(2);
    } finally { release(); a.stop(); b.stop(); await Promise.resolve(); random.mockRestore(); vi.useRealTimers(); }
  });
  it('preserves a pending deadline when an overview joins a default group', async () => {
    vi.useFakeTimers(); const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const client = {}, clock = vi.fn().mockResolvedValue(undefined), overview = vi.fn().mockResolvedValue(undefined);
    const b = registerPublicTournamentRead(client, 'transition', clock);
    let a: ReturnType<typeof registerPublicTournamentRead> | undefined;
    try {
      b.request(); await vi.advanceTimersByTimeAsync(0); b.request(); await vi.advanceTimersByTimeAsync(500);
      a = registerPublicTournamentRead(client, 'transition', overview, true); a.request(); await vi.advanceTimersByTimeAsync(0);
      expect(overview).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(999); expect(clock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1); expect(clock).toHaveBeenCalledTimes(2);
      a.stop(); b.request(); await vi.advanceTimersByTimeAsync(1499); expect(clock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1); expect(clock).toHaveBeenCalledTimes(3);
    } finally { a?.stop(); b.stop(); await Promise.resolve(); random.mockRestore(); vi.useRealTimers(); }
  });
  it('pauses hidden dispatch and cancels removed sections', async () => {
    vi.useFakeTimers(); const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const read = vi.fn().mockResolvedValue(undefined), a = registerPublicTournamentRead({}, 'hidden', read, true);
    try {
      a.request(); await vi.advanceTimersByTimeAsync(0); a.request(); visibility.mockReturnValue('hidden');
      await vi.advanceTimersByTimeAsync(2000); expect(read).toHaveBeenCalledTimes(1);
      visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0); expect(read).toHaveBeenCalledTimes(2);
      a.request(); a.stop(); await vi.advanceTimersByTimeAsync(5000); expect(read).toHaveBeenCalledTimes(2);
    } finally { a.stop(); await Promise.resolve(); visibility.mockRestore(); random.mockRestore(); vi.useRealTimers(); }
  });
  it('does not repay jitter when overview joins near an existing deadline', async () => {
    vi.useFakeTimers(); const random = vi.spyOn(Math, 'random').mockReturnValue(.5);
    const client = {}, clock = vi.fn().mockResolvedValue(undefined);
    const b = registerPublicTournamentRead(client, 'near-deadline', clock);
    let a: ReturnType<typeof registerPublicTournamentRead> | undefined;
    try {
      b.request(); await vi.advanceTimersByTimeAsync(1000); b.request();
      await vi.advanceTimersByTimeAsync(700);
      a = registerPublicTournamentRead(client, 'near-deadline', async () => {}, true); a.request();
      await vi.advanceTimersByTimeAsync(49); expect(clock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1); expect(clock).toHaveBeenCalledTimes(2);
    } finally { a?.stop(); b.stop(); await Promise.resolve(); random.mockRestore(); vi.useRealTimers(); }
  });
  it('releases a rejected overview and serves one pending read without blocking metadata', async () => {
    vi.useFakeTimers(); const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    let reject!: (error: Error) => void;
    const held = new Promise<void>((_, fail) => { reject = fail; });
    const read = vi.fn().mockImplementationOnce(() => held).mockResolvedValue(undefined), metadata = vi.fn().mockResolvedValue(undefined);
    const client = {}, a = registerPublicTournamentRead(client, 'rejection', read, true), b = registerPublicTournamentRead(client, 'rejection', metadata);
    try {
      a.request(); b.request(); await vi.advanceTimersByTimeAsync(0); a.request(); b.request();
      await vi.advanceTimersByTimeAsync(2000); expect(metadata).toHaveBeenCalledTimes(2);
      reject(new Error('failed read')); await vi.advanceTimersByTimeAsync(0);
      expect(log).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(5000); expect(read).toHaveBeenCalledTimes(2);
    } finally { a.stop(); b.stop(); await Promise.resolve(); log.mockRestore(); random.mockRestore(); vi.useRealTimers(); }
  });
  it('does not start a mixed read if hidden between launch and its microtask', async () => {
    vi.useFakeTimers(); const random = vi.spyOn(Math, 'random').mockReturnValue(.5);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const read = vi.fn().mockResolvedValue(undefined), a = registerPublicTournamentRead({}, 'microtask', read, true);
    try {
      a.request(); visibility.mockReturnValue('hidden'); await vi.advanceTimersByTimeAsync(3000);
      expect(read).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
      visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(1250); expect(read).toHaveBeenCalledTimes(1);
    } finally { a.stop(); await Promise.resolve(); visibility.mockRestore(); random.mockRestore(); vi.useRealTimers(); }
  });
  it('coalesces 1000 mixed-viewer hint storms without accelerating clocks', async () => {
    vi.useFakeTimers(); let sample = 0; const random = vi.spyOn(Math, 'random').mockImplementation(() => ((sample++ % 500) / 500));
    const starts: number[] = [], clocks: number[] = [], registrations: ReturnType<typeof registerPublicTournamentRead>[] = [];
    try {
      for (let i = 0; i < 1000; i++) {
        const client = {};
        registrations.push(registerPublicTournamentRead(client, 'storm', async () => { starts.push(Date.now()); }, true));
        registrations.push(registerPublicTournamentRead(client, 'storm', async () => { clocks.push(Date.now()); }));
      }
      registrations.forEach(r => r.request()); await vi.advanceTimersByTimeAsync(0);
      const initial = Date.now();
      for (let i = 0; i < 10; i++) { registrations.forEach(r => r.request()); await vi.advanceTimersByTimeAsync(50); }
      expect(vi.getTimerCount()).toBe(1000);
      await vi.advanceTimersByTimeAsync(1500);
      expect(starts).toHaveLength(2000); expect(clocks).toHaveLength(2000);
      expect(Math.min(...starts.slice(1000)) - initial).toBeGreaterThanOrEqual(1000);
      expect(Math.max(...starts.slice(1000)) - initial).toBeLessThan(1500);
      expect(Math.min(...clocks.slice(1000)) - initial).toBeGreaterThanOrEqual(1500);
      const buckets = new Map<number, number>();
      starts.slice(1000).forEach(t => buckets.set(t, (buckets.get(t) ?? 0) + 1));
      expect(Math.max(...buckets.values())).toBeLessThanOrEqual(4);
      await vi.advanceTimersByTimeAsync(5000); expect(starts).toHaveLength(2000); expect(clocks).toHaveLength(2000);
    } finally { registrations.forEach(r => r.stop()); await Promise.resolve(); random.mockRestore(); vi.useRealTimers(); }
  });
});
