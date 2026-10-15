import type { Tournament } from '@/types/tournament';

export interface TournamentConfigSaveRequest {
  p_expected_actor_id: string;
  p_tournament_id: string | null;
  p_club_id: string;
  p_config: {
    name: string;
    description: string | null;
    swing_duration_minutes: number;
    warn_at_minutes: number;
    crit_at_minutes: number;
  };
  p_table_ids: string[];
  p_expected_updated_at: string | null;
  p_expected_active_table_ids: string[];
  p_request_id: string;
}

export type TournamentConfigRpc = (name: string, args: Record<string, unknown>) => PromiseLike<{data: unknown; error: unknown}>;

export function tournamentConfigJournalKey(actorId: string, clubId: string, tournamentId: string | null) {
  return `vinpoker:config-save:v1:${actorId}:${clubId}:${tournamentId ?? 'create'}`;
}

export function readTournamentConfigJournal(raw: string, clubId: string, tournamentId: string | null, actorId: string): TournamentConfigSaveRequest {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('invalid_config_journal');
  const r = value as TournamentConfigSaveRequest;
  const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  if (r.p_expected_actor_id !== actorId || r.p_club_id !== clubId || r.p_tournament_id !== tournamentId || !uuid(r.p_request_id)
    || !r.p_config || typeof r.p_config.name !== 'string'
    || (r.p_config.description !== null && typeof r.p_config.description !== 'string')
    || ![r.p_config.swing_duration_minutes,r.p_config.warn_at_minutes,r.p_config.crit_at_minutes].every(Number.isSafeInteger)
    || !Array.isArray(r.p_table_ids) || !r.p_table_ids.every(uuid)
    || !Array.isArray(r.p_expected_active_table_ids) || !r.p_expected_active_table_ids.every(uuid)
    || (r.p_expected_updated_at !== null && typeof r.p_expected_updated_at !== 'string')) {
    throw new Error('invalid_config_journal');
  }
  return r;
}

export class TournamentConfigSaveError extends Error {
  constructor(public readonly code: string, public readonly outcomeUnknown = false) {
    super(code);
    this.name = 'TournamentConfigSaveError';
  }
}

function readResult(data: unknown, clubId: string, tournamentId: string | null): Tournament {
  if (!data || typeof data !== 'object') throw new TournamentConfigSaveError('unknown_save_result', true);
  const result = data as {ok?: unknown; error?: unknown; tournament?: Partial<Tournament>};
  if (result.ok === false && typeof result.error === 'string') throw new TournamentConfigSaveError(result.error);
  const tournament = result.tournament;
  if (result.ok !== true || !tournament || typeof tournament.id !== 'string'
    || tournament.club_id !== clubId || (tournamentId !== null && tournament.id !== tournamentId)
    || typeof tournament.updated_at !== 'string') {
    throw new TournamentConfigSaveError('unknown_save_result', true);
  }
  return tournament as Tournament;
}

async function boundedResponse<T>(response: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(response), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TournamentConfigSaveError('save_outcome_unknown', true)), 20000);
    })]);
  } finally { clearTimeout(timer); }
}

/** One mutation only. A transport failure is reconciled by reading its actor-bound receipt.
 * Caller must retain the exact request until the outcome is known; never mint a retry key. */
export async function saveTournamentConfig(rpc: TournamentConfigRpc, request: TournamentConfigSaveRequest): Promise<Tournament> {
  let response: {data: unknown; error: unknown};
  try {
    response = await boundedResponse(rpc('save_tournament_config_v1', {...request}));
  } catch {
    return recoverTournamentConfigSave(rpc, request);
  }
  if (response.error) {
    const error = response.error as {code?: unknown; message?: unknown};
    // These are explicit PostgreSQL statement failures: the RPC transaction rolled back.
    // A transport/gateway failure has no equivalent no-commit guarantee.
    if (['P0001', '22P02', '22003', '23505', '23503', '23514'].includes(String(error.code))) {
      throw new TournamentConfigSaveError(typeof error.message === 'string' ? error.message : String(error.code));
    }
    return recoverTournamentConfigSave(rpc, request);
  }
  return readResult(response.data, request.p_club_id, request.p_tournament_id);
}

export async function recoverTournamentConfigSave(rpc: TournamentConfigRpc, request: TournamentConfigSaveRequest): Promise<Tournament> {
  try {
    const receipt = await boundedResponse(rpc('get_tournament_config_save_receipt_v1', {p_request_id: request.p_request_id, p_expected_actor_id: request.p_expected_actor_id}));
    if (receipt.error) throw new TournamentConfigSaveError('save_outcome_unknown', true);
    // A missing receipt may race an original request still committing; it is not proof of rollback.
    if (receipt.data && typeof receipt.data === 'object'
      && (receipt.data as {ok?: unknown}).ok === false) {
      // Authorization could have changed after the original commit. A denied GET
      // says nothing about that transaction and must not destroy its request identity.
      throw new TournamentConfigSaveError('save_outcome_unknown', true);
    }
    return readResult(receipt.data, request.p_club_id, request.p_tournament_id);
  } catch (error) {
    if (error instanceof TournamentConfigSaveError) throw error;
    throw new TournamentConfigSaveError('save_outcome_unknown', true);
  }
}
