import type { PublicSnapshotSection } from './publicSnapshotTypes';

const generation = (value: unknown): bigint | null => {
  if (typeof value !== 'string' || !/^\d{1,19}$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= 9_223_372_036_854_775_807n ? parsed : null;
};

/** Hints can require fresher data; only an authoritative current reply proves it. */
export class PublicSnapshotRequestFence {
  private invalid = false;
  private readonly sections = new Map<PublicSnapshotSection, {
    initial: number; observed: number; complete: boolean; required: bigint | null;
  }>();

  constructor(epochs: Partial<Record<PublicSnapshotSection, number>>) {
    for (const section of ['tables', 'ranking', 'payout'] as const) {
      const epoch = epochs[section];
      if (epoch !== undefined) this.sections.set(section, { initial: epoch, observed: epoch, complete: true, required: null });
    }
  }

  invalidate(): void { this.invalid = true; }

  record(section: PublicSnapshotSection, epoch: number, revision: unknown): void {
    const state = this.sections.get(section);
    if (!state) return;
    const next = generation(revision);
    if (epoch !== state.observed + 1 || next === null) state.complete = false;
    state.observed = epoch;
    if (next !== null && (state.required === null || next > state.required)) state.required = next;
  }

  accepts(section: PublicSnapshotSection, epoch: number, reply: unknown): boolean {
    const state = this.sections.get(section);
    if (this.invalid || !state) return false;
    if (epoch === state.initial) return true;
    if (!state.complete || state.observed !== epoch || state.required === null) return false;
    if (!reply || typeof reply !== 'object') return false;
    const value = reply as { unchanged?: unknown; freshness?: { state?: unknown; projectedSourceRevision?: unknown } };
    if (value.unchanged === true || value.freshness?.state !== 'current' || typeof value.freshness.projectedSourceRevision !== 'string') return false;
    try {
      const projected = JSON.parse(value.freshness.projectedSourceRevision);
      const actual = generation(projected?.generation);
      return actual !== null && actual >= state.required;
    } catch { return false; }
  }
}
