import type { PublicSnapshotSection } from "./publicSnapshotTypes";

// Keep source writes independent while coalescing spectator HTTP bursts.
// First/scope reads stay immediate; loaded delivery must still meet the3s gate.
// Spread steady hint dispatch over one second instead of concentrating 1,000
// readers into 200ms. The combined dispatch delay stays below2.5s. The1.5s
// minimum coalesces continuous source hints to reduce HTTP/DB contention;
// actual loaded source-to-display delivery must still pass the3s gate.
export const PUBLIC_SPECTATOR_READ_INTERVAL_MS = 1_500;
export const PUBLIC_SPECTATOR_HINT_JITTER_MS = 1_000;

export interface SnapshotRequest {
  tournamentId: string;
  tableIds: string[];
  sections: PublicSnapshotSection[];
  revisions: Partial<Record<PublicSnapshotSection, string>>;
}

export class PublicSnapshotCoordinator {
  private running = false;
  private queued = false;
  private stopped = false;
  private lastStartedAt: number | null = null;
  private hasDispatchedHint = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly hintDelayMs:number;

  constructor(private readonly refresh: () => Promise<void>, private readonly minIntervalMs = 0, hintJitterMs=0) {
    this.hintDelayMs=hintJitterMs>0?Math.floor(Math.random()*hintJitterMs):0;
  }

  request(): void {
    if (this.stopped) return;
    if (this.running) {
      this.queued = true;
      return;
    }
    // Keep one fixed hint deadline. A duplicate (even after the deadline but
    // before the timer callback runs) must not create another trailing read.
    if(this.timer)return;
    const elapsed = this.lastStartedAt === null ? Infinity : Date.now() - this.lastStartedAt;
    const intervalWait = Math.max(0, this.minIntervalMs - elapsed);
    // Spread the first hint and bursts after idle time. During a continuous
    // stream the existing phase already spreads clients; adding jitter again
    // would lengthen every minimum interval and accumulate delivery delay.
    const jitter = !this.hasDispatchedHint || elapsed >= this.minIntervalMs ? this.hintDelayMs : 0;
    const wait = this.lastStartedAt === null ? 0 : intervalWait + jitter;
    if (wait > 0) {
      this.queued = true;
      if (!this.timer) this.timer = setTimeout(() => {
        this.timer = null;
        this.queued = false;
        if(!this.stopped)void this.run();
      }, wait);
      return;
    }
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    this.queued = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async run(): Promise<void> {
    this.running = true;
    if (this.lastStartedAt !== null) this.hasDispatchedHint = true;
    this.lastStartedAt = Date.now();
    try {
      await this.refresh();
    } finally {
      this.running = false;
      if (this.queued && !this.stopped) {
        this.queued = false;
        this.request();
      }
    }
  }
}

type PublicReadRegistration = { request(): void; stop(): void };
type ReadSlot = { refresh: () => Promise<void>; pending: boolean; running: boolean; first: boolean; active: boolean };
type ReadGroup = { slots: Set<ReadSlot>; scheduler: PublicSnapshotCoordinator; launch(slot: ReadSlot): void; dispose(): void };
const tournamentReads = new WeakMap<object, Map<string, ReadGroup>>();

// One dispatch clock per client/tournament. Consumers retain their own request
// cancellation and epoch fences; a slow section never holds another section.
export function registerPublicTournamentRead(client: object, tournamentId: string, refresh: () => Promise<void>): PublicReadRegistration {
  let groups = tournamentReads.get(client);
  if (!groups) { groups = new Map(); tournamentReads.set(client, groups); }
  let group = groups.get(tournamentId);
  if (!group) {
    const slots = new Set<ReadSlot>();
    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const launch = (slot: ReadSlot) => {
      if (!slot.active || slot.running || !slot.pending || hidden()) return;
      slot.pending = false; slot.running = true; slot.first = false;
      // A consumer observes its own failure. Scheduling still releases its slot
      // after rejection, without retrying or blocking unrelated consumers.
      void Promise.resolve().then(() => {
        if (!slot.active) return;
        if (hidden()) { slot.pending = true; return; }
        return slot.refresh();
      }).finally(() => {
        slot.running = false;
        if (slot.active && slot.pending && !hidden()) scheduler.request();
      }).catch(() => { console.error('Public tournament read failed'); });
    };
    const scheduler = new PublicSnapshotCoordinator(async () => {
      for (const slot of slots) launch(slot);
    }, PUBLIC_SPECTATOR_READ_INTERVAL_MS, PUBLIC_SPECTATOR_HINT_JITTER_MS);
    const onVisible = () => { if (!hidden() && [...slots].some(slot => slot.pending)) scheduler.request(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    group = { slots, scheduler, launch, dispose() {
      scheduler.stop();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    } };
    groups.set(tournamentId, group);
    // Prime the shared interval without delaying a newly mounted scope.
    scheduler.request();
    // Initial reads are intentionally immediate, even when another section has
    // a steady-state dispatch already scheduled.
  }
  const current = group;
  const slot: ReadSlot = { refresh, pending: false, running: false, first: true, active: true };
  current.slots.add(slot);
  return {
    request() {
      if (!slot.active) return;
      slot.pending = true;
      if (slot.first) current.launch(slot);
      else if (!slot.running) current.scheduler.request();
    },
    stop() {
      slot.active = false; slot.pending = false; current.slots.delete(slot);
      queueMicrotask(() => {
        if (!current.slots.size && groups.get(tournamentId) === current) {
          current.dispose(); groups.delete(tournamentId);
        }
      });
    },
  };
}

export function normalizeVisibleTableIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(Boolean))].slice(0, 16);
}
