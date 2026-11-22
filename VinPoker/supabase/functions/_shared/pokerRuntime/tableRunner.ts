// supabase/functions/_shared/pokerRuntime/tableRunner.ts
// GE-2K — the table runner core loop (no Deno-only imports, so it is unit-testable). The
// Edge function online-poker-table-runner is a thin Deno.serve wrapper around runTableRunner.
//
// FAIL-CLOSED: if op_is_enabled() is not true (the runtime is DARK), it does NOTHING and
// returns {outcome:'disabled'}. In dryRun it lists/classifies tables but NEVER deals.
// Per-table isolation: one table failing must not abort the others.

import { dealNextHand, type AdminClient, type DealResult } from './dealNextHand.ts';

const MAX_TABLES_PER_RUN = 200; // safety cap per tick

export interface RunnerResult {
  outcome: 'ok' | 'disabled';
  dryRun: boolean;
  scanned: number;            // eligible tables considered this tick
  dealt: number;
  skippedAlreadyActive: number;
  skippedNotEnough: number;
  skippedWaitingForRound: number;
  errors: number;
  /** dry-run only: why open tables are/aren't eligible (no cards, ever) */
  diag?: {
    eligible: number; active_hand: number; no_quorum: number; cooldown: number;
    tables: Array<{ table_id: string; bucket: string }>;
  };
}

/**
 * Find tables due for a new hand and deal each (via dealNextHand). Returns count-only
 * telemetry — never cards/deck/holes (G1). dryRun reports eligibility without dealing.
 */
export async function runTableRunner(
  admin: AdminClient, opts: { limit?: number; dryRun?: boolean } = {},
): Promise<RunnerResult> {
  const limit = opts.limit ?? 50;
  const dryRun = !!opts.dryRun;
  const r: RunnerResult = {
    outcome: 'ok', dryRun, scanned: 0, dealt: 0,
    skippedAlreadyActive: 0, skippedNotEnough: 0, skippedWaitingForRound: 0, errors: 0,
  };

  const { data: enabled } = await admin.rpc('op_is_enabled');
  if (enabled !== true) return { ...r, outcome: 'disabled' };

  if (dryRun) {
    const { data: diag } = await admin.rpc('op_table_runner_diag', { p_limit: MAX_TABLES_PER_RUN });
    const tables: Array<{ table_id: string; bucket: string }> = diag?.tables ?? [];
    const count = (b: string) => tables.filter((t) => t.bucket === b).length;
    r.scanned = count('eligible');
    r.diag = {
      eligible: count('eligible'), active_hand: count('active_hand'),
      no_quorum: count('no_quorum'), cooldown: count('cooldown'), tables,
    };
    return r; // dry-run NEVER deals
  }

  const { data: due, error } = await admin.rpc('op_run_due_table_ticks', { p_limit: limit });
  if (error || !due || due.outcome !== 'ok') return r;
  const tables: Array<{ table_id: string }> = (due.tables ?? []).slice(0, MAX_TABLES_PER_RUN);
  r.scanned = tables.length;

  for (const t of tables) {
    try {
      const res: DealResult = await dealNextHand(admin, t.table_id, null);
      if (res.ok) r.dealt++;
      else if (res.reason === 'already_active') r.skippedAlreadyActive++;
      else if (res.reason === 'not_enough_players') r.skippedNotEnough++;
      else if (res.reason === 'waiting_for_round') r.skippedWaitingForRound++;
      else r.errors++;
    } catch {
      r.errors++; // table isolation: one failure must not abort the rest
    }
  }
  return r;
}
