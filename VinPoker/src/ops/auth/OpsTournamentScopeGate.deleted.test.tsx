import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  club: 'club-a', deleted: false, is: vi.fn(), mounted: vi.fn(),
}));
vi.mock('react-router-dom', () => ({ useParams: () => ({ id: 'tour-a' }) }));
vi.mock('./OpsCapabilityProvider', () => ({ useOpsCapabilities: () => ({
  floorClubIds: ['club-a'], isSuperAdmin: false, loading: false, scopeError: null,
}) }));
vi.mock('@/ops/workspace/OpsWorkspaceProvider', () => ({ useOpsWorkspace: () => ({ selectedClubId: 'club-a' }) }));
vi.mock('@/ops/pages/OpsEntryResolver', () => ({ OpsAccessDenied: () => <p>Scope denied</p> }));
vi.mock('@/integrations/supabase/SupabaseClientContext', () => ({ useSupabaseClient: () => client }));
const client = { from: () => {
  let expectedClub = '';
  let excludesDeleted = false;
  const query = {
    select: () => query,
    eq: (key: string, value: string) => { if (key === 'club_id') expectedClub = value; return query; },
    is: (key: string, value: null) => { h.is(key, value); excludesDeleted = key === 'deleted_at' && value === null; return query; },
    maybeSingle: async () => ({ data: h.club !== expectedClub || (h.deleted && excludesDeleted) ? null
      : { id: 'tour-a', club_id: h.club, name: 'TEST', status: 'live' }, error: null }),
  };
  return query;
} };
import { OpsTournamentScopeGate } from './OpsTournamentScopeGate';

function Workspace() { h.mounted(); return <p>Operational workspace</p>; }
beforeEach(() => { h.club = 'club-a'; h.deleted = false; vi.clearAllMocks(); });
afterEach(cleanup);

it('mounts an active tournament only inside its verified club', async () => {
  render(<OpsTournamentScopeGate><Workspace /></OpsTournamentScopeGate>);
  await screen.findByText('Operational workspace');
  expect(h.is).toHaveBeenCalledWith('deleted_at', null);
});
it('never mounts operational readers or controls from a deleted tournament deep link', async () => {
  h.deleted = true;
  render(<OpsTournamentScopeGate><Workspace /></OpsTournamentScopeGate>);
  await screen.findByText('Scope denied');
  expect(h.mounted).not.toHaveBeenCalled();
});
it('retains the cross-club rejection', async () => {
  h.club = 'club-b';
  render(<OpsTournamentScopeGate><Workspace /></OpsTournamentScopeGate>);
  await screen.findByText('Scope denied');
  expect(h.mounted).not.toHaveBeenCalled();
});
