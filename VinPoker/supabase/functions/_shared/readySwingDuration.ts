import type {DealerOperationalTable} from './dealerOperationalTables.ts';
import {SWING_POLICY} from './swingPolicy.ts';

interface DurationQuery {
  eq(column: string, value: unknown): DurationQuery;
  maybeSingle(): PromiseLike<{data: {swing_duration_minutes?: number | null} | null; error: unknown}>;
}
interface DurationClient {
  from(table: string): {select(columns: string): DurationQuery};
}

interface RestPolicyQuery {
  eq(column: string, value: unknown): RestPolicyQuery;
  maybeSingle(): PromiseLike<{data: unknown; error: unknown}>;
}
interface RestPolicyClient {
  from(table: string): {select(columns: string): RestPolicyQuery};
}

/** Bind rest credit to the verified destination session's table type, matching
 * the Floor close marker's configured break/minimum and the server hard floor. */
export async function getReadyRestThreshold(admin: RestPolicyClient, clubId: string, table: DealerOperationalTable): Promise<number> {
  if (!clubId || !table.id || !table.table_session_id || !['cash','tournament','vip'].includes(table.table_type)
    || table.table_type === 'tournament' && !table.tournament_id) throw new Error('ready_rest_context_invalid');
  const {data,error}=await admin.from('swing_config').select('break_duration_minutes,min_inter_swing_rest_minutes')
    .eq('club_id',clubId).eq('table_type',table.table_type).maybeSingle();
  if (error) throw new Error('ready_rest_policy_unverified');
  const floor=SWING_POLICY.rest.executeMinRestFloorMinutes;
  if (data === null) return floor;
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || !('break_duration_minutes' in data)
    || !('min_inter_swing_rest_minutes' in data)) throw new Error('ready_rest_policy_invalid');
  let threshold:number=floor;
  for (const value of [data.break_duration_minutes,data.min_inter_swing_rest_minutes]) {
    if (value === null) continue;
    if (typeof value!=='number'||!Number.isSafeInteger(value)||value<0) throw new Error('ready_rest_policy_invalid');
    threshold=Math.max(threshold,value);
  }
  return threshold;
}

/** Same configured precedence as empty-table fill; never infer a tournament
 * from a reusable physical table or substitute a default after a failed read. */
export async function getReadySwingDuration(admin: DurationClient, clubId: string, table: DealerOperationalTable): Promise<number> {
  const [override, config, tournament] = await Promise.all([
    admin.from('swing_configs').select('swing_duration_minutes').eq('club_id', clubId)
      .eq('scope_type', 'table').eq('scope_id', table.id).maybeSingle(),
    admin.from('swing_config').select('swing_duration_minutes').eq('club_id', clubId)
      .eq('table_type', table.table_type).maybeSingle(),
    table.table_type === 'tournament'
      ? admin.from('tournaments').select('swing_duration_minutes').eq('club_id', clubId)
        .eq('id', table.tournament_id).maybeSingle()
      : Promise.resolve({data: null, error: null}),
  ]);
  if (override.error || config.error || tournament.error
    || table.table_type === 'tournament' && !tournament.data) {
    throw new Error('swing_duration_unverified');
  }
  const duration = override.data?.swing_duration_minutes ?? tournament.data?.swing_duration_minutes
    ?? config.data?.swing_duration_minutes ?? SWING_POLICY.defaults.swingDurationMinutes;
  if (!Number.isInteger(duration) || duration <= 0) throw new Error('swing_duration_invalid');
  return duration;
}
