import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import PlayerProfile from './PlayerProfile';

const state = vi.hoisted(() => ({route: 'player-a', actor: 'viewer-a', session: null as unknown,
  failure: '', pending: new Map<string, (value: unknown) => void>()}));
vi.mock('react-router-dom', () => ({useParams: () => ({userId: state.route})}));
vi.mock('@/hooks/useAuth', () => ({useAuth: () => ({user: {id: state.actor}, session: state.session, isAdmin: false})}));
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
vi.mock('@/components/PerformanceCard', () => ({PerformanceCard: () => null}));
vi.mock('@/components/InterestDialog', () => ({InterestDialog: () => null}));
vi.mock('@/components/BackButton', () => ({BackButton: () => null}));
vi.mock('@/integrations/supabase/client', () => ({supabase: {from: (table: string) => {
  let id = '';
  const query = {
    select: () => query, eq: (_key: string, value: string) => {id = value; return query;},
    order: () => query, gte: () => query, limit: () => query, in: () => query,
    maybeSingle: () => query, abortSignal: () => query,
    then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => table === 'profiles'
      ? new Promise(done => state.pending.set(id, done)).then(resolve, reject)
      : (state.failure === 'network' ? Promise.reject(new TypeError('offline')) : Promise.resolve({data: table === 'player_stats' || state.failure === `null:${table}` ? null : [], error: state.failure === table ? {message: 'unavailable'} : null})).then(resolve, reject),
  };
  return query;
}}}));

async function profile(id: string, name: string) {
  await waitFor(() => expect(state.pending.has(id)).toBe(true));
  await act(async () => {state.pending.get(id)?.({data: {user_id: id, display_name: name}, error: null});});
}

describe('PlayerProfile scope lifetime', () => {
  beforeEach(() => {
    state.route = 'player-a'; state.actor = 'viewer-a'; state.session = null; state.failure = ''; state.pending.clear();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  });
  afterEach(() => {cleanup(); vi.useRealTimers(); vi.unstubAllGlobals();});

  it('hides the previous profile immediately while another route loads', async () => {
    const view = render(<PlayerProfile />);
    await profile('player-a', 'Player A');
    expect(screen.getByText('Player A')).toBeInTheDocument();
    state.route = 'player-b'; view.rerender(<PlayerProfile />);
    expect(screen.queryByText('Player A')).not.toBeInTheDocument();
    await profile('player-b', 'Player B');
    expect(screen.getByText('Player B')).toBeInTheDocument();
  });

  it('ignores a previous route response arriving after the new profile', async () => {
    const view = render(<PlayerProfile />);
    state.route = 'player-b'; view.rerender(<PlayerProfile />);
    await profile('player-b', 'Player B');
    await profile('player-a', 'Player A');
    expect(screen.getByText('Player B')).toBeInTheDocument();
    expect(screen.queryByText('Player A')).not.toBeInTheDocument();
  });

  it('clears profile state when the viewing account changes', async () => {
    const view = render(<PlayerProfile />);
    await profile('player-a', 'Player A');
    state.actor = 'viewer-b'; view.rerender(<PlayerProfile />);
    expect(screen.queryByText('Player A')).not.toBeInTheDocument();
  });

  it('clears profile state for a new session of the same account', async () => {
    state.session = {access_token: 'test-incarnation-a'};
    const view = render(<PlayerProfile />);
    await profile('player-a', 'Player A');
    state.session = {access_token: 'test-incarnation-b'};
    view.rerender(<PlayerProfile />);
    expect(screen.queryByText('Player A')).not.toBeInTheDocument();
  });

  it('aborts the old public request and ignores its late successful body', async () => {
    let resolveOld!: (value: unknown) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise(resolve => {resolveOld = resolve;}))
      .mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<PlayerProfile />);
    state.route = 'player-b'; view.rerender(<PlayerProfile />);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    await profile('player-b', 'Player B');
    await act(async () => {resolveOld({ok: true, json: async () => ({profile: {}, player: {}, backer: {}})});});
    expect(screen.queryByText('playerProfile.stakingActivity')).not.toBeInTheDocument();
  });

  it('does not present a failed profile read as a missing player and can retry', async () => {
    render(<PlayerProfile />);
    await waitFor(() => expect(state.pending.has('player-a')).toBe(true));
    await act(async () => {state.pending.get('player-a')?.({data: null, error: {message: 'backend unavailable'}});});
    expect(screen.getByText('playerProfile.loadError')).toBeInTheDocument();
    expect(screen.queryByText('playerProfile.notFound')).not.toBeInTheDocument();
    state.pending.clear();
    fireEvent.click(screen.getByRole('button', {name: 'playerProfile.retry'}));
    await profile('player-a', 'Player A');
    expect(screen.getByText('Player A')).toBeInTheDocument();
  });

  it('does not turn an errored stats read into a no-statistics profile', async () => {
    state.failure = 'player_stats';
    render(<PlayerProfile />);
    await profile('player-a', 'Player A');
    expect(screen.getByText('playerProfile.loadError')).toBeInTheDocument();
    expect(screen.queryByText('playerProfile.noStats')).not.toBeInTheDocument();
  });

  it('reports a public summary HTTP error instead of silently hiding it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: false})));
    render(<PlayerProfile />);
    await profile('player-a', 'Player A');
    expect(screen.getByText('playerProfile.summaryError')).toBeInTheDocument();
  });

  it('allows manual summary retry and displays genuine zero values', async () => {
    const packet = {profile: {user_id: 'player-a'},
      player: {dealsCreated: 0, dealsCompleted: 0, itmCount: 0, avgRoi: 0},
      backer: {totalStaked: 0, totalReturned: 0, netPnl: 0, activeCount: 0}, ratings: []};
    const fetchMock = vi.fn().mockResolvedValueOnce({ok: false})
      .mockResolvedValue({ok: true, json: async () => packet});
    vi.stubGlobal('fetch', fetchMock);
    render(<PlayerProfile />);
    await profile('player-a', 'Player A');
    fireEvent.click(screen.getByRole('button', {name: 'playerProfile.retry'}));
    expect(await screen.findByText('playerProfile.stakingActivity')).toBeInTheDocument();
    expect(screen.queryByText('playerProfile.summaryError')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([{}, {profile: {user_id: 'other'}}, {profile: {user_id: 'player-a'}, player: {}, backer: {}, ratings: []}])('does not publish malformed or wrong-identity summaries (%j)', async packet => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ok: true, json: async () => packet})));
    render(<PlayerProfile />);
    await profile('player-a', 'Player A');
    expect(screen.getByText('playerProfile.summaryError')).toBeInTheDocument();
    expect(screen.queryByText('playerProfile.stakingActivity')).not.toBeInTheDocument();
  });

  it('ends a hung read and prevents the timed-out response from resurfacing', async () => {
    vi.useFakeTimers();
    render(<PlayerProfile />);
    await act(async () => {await Promise.resolve();});
    expect(state.pending.has('player-a')).toBe(true);
    await act(async () => {await vi.advanceTimersByTimeAsync(15_000);});
    expect(screen.getByText('playerProfile.loadError')).toBeInTheDocument();
    await act(async () => {state.pending.get('player-a')?.({data: {user_id: 'player-a', display_name: 'Late profile'}, error: null});});
    expect(screen.getByText('playerProfile.loadError')).toBeInTheDocument();
    expect(screen.queryByText('Late profile')).not.toBeInTheDocument();
  });

  it('does not accept a missing list as verified empty data', async () => {
    state.failure = 'null:backer_reviews';
    render(<PlayerProfile />);
    await profile('player-a', 'Player A');
    expect(screen.getByText('playerProfile.loadError')).toBeInTheDocument();
  });

  it('settles a rejected read instead of leaving the page loading', async () => {
    state.failure = 'network';
    render(<PlayerProfile />);
    expect(await screen.findByText('playerProfile.loadError')).toBeInTheDocument();
    expect(screen.queryByText('playerProfile.loading')).not.toBeInTheDocument();
  });

  it('retains not-found only for a successful absent-profile response', async () => {
    render(<PlayerProfile />);
    await waitFor(() => expect(state.pending.has('player-a')).toBe(true));
    await act(async () => {state.pending.get('player-a')?.({data: null, error: null});});
    expect(screen.getByText('playerProfile.notFound')).toBeInTheDocument();
    expect(screen.queryByText('playerProfile.loadError')).not.toBeInTheDocument();
  });
});
