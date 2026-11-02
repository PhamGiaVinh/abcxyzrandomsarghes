/** Explicit proof returned by ops_delete_tournament_safe. No deletion policy here. */
export function assertTournamentDeleted(value: unknown, tournamentId: string): Record<string, unknown> {
  const result = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
  if (result?.ok === false) {
    throw new Error(typeof result.error === 'string' && result.error ? result.error : 'tournament_delete_failed');
  }
  if (result?.ok !== true || result.deleted !== true || result.tournament_id !== tournamentId || result.error) {
    throw new Error('tournament_delete_unverified');
  }
  return result;
}
