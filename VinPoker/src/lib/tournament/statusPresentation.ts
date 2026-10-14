// Read-only aliases for existing catalog/live status strings. Never use these
// labels or categories as mutation payloads or as operational authority.
const LABEL_STATUS: Readonly<Record<string, string>> = {
  scheduled: 'upcoming', upcoming: 'upcoming',
  registration_open: 'registering', registering: 'registering', drawing: 'drawing',
  active: 'active', live: 'live', playing: 'playing', running: 'playing',
  break: 'break', paused: 'paused', final_table: 'final_table',
  finished: 'completed', completed: 'completed', cancelled: 'cancelled',
};

export type TournamentStatusCategory = 'running' | 'break' | 'upcoming' | 'closed' | 'unknown';

function labelStatus(status: unknown): string | undefined {
  return typeof status === 'string' && Object.prototype.hasOwnProperty.call(LABEL_STATUS, status)
    ? LABEL_STATUS[status] : undefined;
}

export function tournamentStatusCategory(status: unknown): TournamentStatusCategory {
  const labelled = labelStatus(status);
  if (labelled === 'active' || labelled === 'live' || labelled === 'playing' || labelled === 'final_table') return 'running';
  if (labelled === 'break' || labelled === 'paused') return 'break';
  if (labelled === 'upcoming' || labelled === 'registering' || labelled === 'drawing') return 'upcoming';
  if (labelled === 'completed' || labelled === 'cancelled') return 'closed';
  return 'unknown';
}

export function tournamentStatusLabel(status: unknown, translate: (key: string) => string): string {
  const labelled = labelStatus(status);
  if (labelled) return translate(`tournamentLive.statusLabels.${labelled}`);
  return typeof status === 'string' && status.trim()
    ? status.replace(/_/g, ' ') : translate('tournamentLive.statusLabels.unknown');
}
