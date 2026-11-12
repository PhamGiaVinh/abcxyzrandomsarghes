import type { PublicSnapshotSection } from "./publicSnapshotTypes";

// Keep source writes independent while coalescing spectator HTTP bursts.
// First/scope reads stay immediate; loaded delivery must still meet the3s gate.
// Spread hint dispatch over500ms instead of launching1,000 readers together.
// The combined dispatch delay stays below2s. The1.5s
// minimum coalesces continuous source hints to reduce HTTP/DB contention;
// actual loaded source-to-display delivery must still pass the3s gate.
export const PUBLIC_SPECTATOR_READ_INTERVAL_MS = 1_500;
export const PUBLIC_SPECTATOR_OVERVIEW_READ_INTERVAL_MS = 1_000;
export const PUBLIC_SPECTATOR_HINT_JITTER_MS = 500;

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
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline: number | null = null;
  readonly hintDelayMs:number;
  get scheduledAt(): number | null { return this.deadline; }

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
    // Retain the viewer's spread during sustained traffic too. A shared fixed
    // interval re-forms request waves and competes with HUD withdrawal checks.
    // Ready readers keep a1.5–2s interval; a slow in-flight reader still owns
    // its slot. Duplicate hints never move an already scheduled deadline and
    // initial scope reads stay immediate.
    const wait = this.lastStartedAt === null ? 0 : intervalWait + this.hintDelayMs;
    if (wait > 0) {
      this.queued = true;
      this.deadline = Date.now() + wait;
      if (!this.timer) this.timer = setTimeout(() => {
        this.timer = null;
        this.deadline = null;
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
    this.deadline = null;
  }

  private async run(): Promise<void> {
    this.running = true;
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
type ReadSlot = { refresh: () => Promise<void>; pending: boolean; running: boolean; first: boolean; active: boolean; interval: number; lastStart: number | null; due: number | null };
type ReadGroup = { slots: Set<ReadSlot>; scheduler: PublicSnapshotCoordinator; launch(slot: ReadSlot): void; schedule(mixedOnly?: boolean): void; enableOverview(): void; dispose(): void };
const tournamentReads = new WeakMap<object, Map<string, ReadGroup>>();

// One dispatch clock per client/tournament. Consumers retain their own request
// cancellation and epoch fences; a slow section never holds another section.
export function registerPublicTournamentRead(client: object, tournamentId: string, refresh: () => Promise<void>, overview = false): PublicReadRegistration {
  let groups = tournamentReads.get(client);
  if (!groups) { groups = new Map(); tournamentReads.set(client, groups); }
  let group = groups.get(tournamentId);
  if (!group) {
    const slots = new Set<ReadSlot>();
    let mixed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let jitter: number | null = null;
    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
    // Default-only groups retain the existing shared dispatch clock. An
    // overview opts this group into per-section eligibility with one timer;
    // it must not accelerate clock/metadata reads in the same tournament.
    // Keep issued per-section deadlines until the group is disposed, including
    // when navigating away from overview with a surviving clock consumer.
    const schedule = (mixedOnly = false) => {
      if (!mixed) { if (!mixedOnly) scheduler.request(); return; }
      if (timer) clearTimeout(timer);
      timer = null;
      if (hidden()) return;
      let next = Infinity;
      for (const slot of slots) {
        if (!slot.active || !slot.pending) continue;
        slot.due ??= slot.first ? Date.now() : Math.max(Date.now(), (slot.lastStart ?? Date.now()) + slot.interval) + (jitter ?? 0);
        if (!slot.running) next = Math.min(next, slot.due);
      }
      if (Number.isFinite(next)) timer = setTimeout(() => {
        timer = null;
        if (hidden()) return;
        for (const slot of slots) if (slot.due !== null && slot.due <= Date.now()) launch(slot);
        schedule();
      }, Math.max(0, next - Date.now()));
    };
    const launch = (slot: ReadSlot) => {
      if (!slot.active || slot.running || !slot.pending || hidden()) return;
      slot.pending = false; slot.running = true; slot.first = false; slot.due = null; slot.lastStart = Date.now();
      // A consumer observes its own failure. Scheduling still releases its slot
      // after rejection, without retrying or blocking unrelated consumers.
      void Promise.resolve().then(() => {
        if (!slot.active) return;
        if (hidden()) { slot.pending = true; return; }
        return slot.refresh();
      }).finally(() => {
        slot.running = false;
        if (slot.active && slot.pending && !hidden()) schedule();
      }).catch(() => { console.error('Public tournament read failed'); });
    };
    const scheduler = new PublicSnapshotCoordinator(async () => {
      for (const slot of slots) launch(slot);
    }, PUBLIC_SPECTATOR_READ_INTERVAL_MS, PUBLIC_SPECTATOR_HINT_JITTER_MS);
    const onVisible = () => { if (!hidden() && [...slots].some(slot => slot.pending)) schedule(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    group = { slots, scheduler, launch, schedule, enableOverview() {
      if (mixed) return;
      mixed = true;
      jitter = scheduler.hintDelayMs;
      const previousDeadline = scheduler.scheduledAt;
      if (previousDeadline !== null) for (const slot of slots) {
        if (slot.pending && !slot.first) slot.due = Math.max(previousDeadline, (slot.lastStart ?? 0) + slot.interval + jitter);
      }
      scheduler.stop();
      schedule();
    }, dispose() {
      scheduler.stop();
      if (timer) clearTimeout(timer);
      timer = null;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    } };
    groups.set(tournamentId, group);
    // Prime the shared interval without delaying a newly mounted scope.
    scheduler.request();
    // Initial reads are intentionally immediate, even when another section has
    // a steady-state dispatch already scheduled.
  }
  const current = group;
  if (overview) current.enableOverview();
  const slot: ReadSlot = { refresh, pending: false, running: false, first: true, active: true, interval: overview ? PUBLIC_SPECTATOR_OVERVIEW_READ_INTERVAL_MS : PUBLIC_SPECTATOR_READ_INTERVAL_MS, lastStart: null, due: null };
  current.slots.add(slot);
  return {
    request() {
      if (!slot.active) return;
      slot.pending = true;
      if (slot.first) current.launch(slot);
      else current.schedule(slot.running);
    },
    stop() {
      slot.active = false; slot.pending = false; current.slots.delete(slot);
      current.schedule(true);
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
