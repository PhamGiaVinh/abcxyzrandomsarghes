import type { PublicSnapshotSection } from "./publicSnapshotTypes";

// Keep source writes independent while coalescing spectator HTTP bursts.
// First/scope reads stay immediate; loaded delivery must still meet the3s gate.
// Spread steady hint dispatch over one second instead of concentrating 1,000
// readers into 200ms. The combined dispatch delay stays below two seconds;
// actual loaded delivery and increased request volume require the scale gate.
export const PUBLIC_SPECTATOR_READ_INTERVAL_MS = 1_000;
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
    const wait = this.lastStartedAt === null ? 0 : Math.max(0, this.minIntervalMs - (Date.now() - this.lastStartedAt))+this.hintDelayMs;
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

export function normalizeVisibleTableIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(Boolean))].slice(0, 16);
}
