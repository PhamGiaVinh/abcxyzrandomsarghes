import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import Leaderboard from './Leaderboard';
import {ErrorBoundary} from 'react-error-boundary';

const h = vi.hoisted(() => ({actor: 'actor-a', session: null as unknown, failure: '',
  reads: [] as {table: string; resolve: (value: unknown) => void; signal?: AbortSignal}[],
  callbacks: [] as (() => void)[], removed: vi.fn()}));
vi.mock('@/hooks/useAuth', () => ({useAuth: () => ({user: {id: h.actor}, session: h.session, isAdmin: false})}));
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
vi.mock('@/components/PlayerHistoryDialog', () => ({default: () => null}));
vi.mock('@/lib/exportExcel', () => ({exportToExcel: vi.fn()}));
vi.mock('@/integrations/supabase/client', () => ({supabase: {
  from: (table: string) => {
    let signal: AbortSignal | undefined;
    const q = {select: () => q, eq: () => q, order: () => q, gte: () => q, in: () => q,
      abortSignal: (value: AbortSignal) => {signal = value; return q;},
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        new Promise(done => {h.reads.push({table, resolve: done, signal});}).then(resolve, reject)};
    return q;
  },
  channel: () => {const ch = {on: (_event: string, _filter: unknown, cb: () => void) => {h.callbacks.push(cb); return ch;}, subscribe: () => ch}; return ch;},
  removeChannel: h.removed,
}}));

async function finish(reads: typeof h.reads, name = '') {
  await act(async () => {
    for (const r of reads) r.resolve({data: r.table === 'all_time_money_list' && name
      ? [{id: name, display_name: name, player_id: null, total_winnings: 0}] : [],
      error: r.table === h.failure ? {message: 'unavailable'} : null});
  });
}

describe('Leaderboard actual read lifecycle', () => {
  beforeEach(() => {h.actor = 'actor-a'; h.session = null; h.failure = ''; h.reads = []; h.callbacks = []; h.removed.mockClear();});
  afterEach(() => {cleanup(); vi.useRealTimers(); vi.restoreAllMocks();});

  it.each([
    ['clubs', [null]],
    ['all_time_money_list', [{id:'bad-name', display_name:{invalid:true}, player_id:null, total_winnings:0}]],
  ])('rejects malformed display rows from %s without crashing the page', async (table, data) => {
    render(<ErrorBoundary fallback={<div data-testid="ranking-crash"/>}><Leaderboard /></ErrorBoundary>);
    await waitFor(() => expect(h.reads).toHaveLength(5));
    await act(async () => {for (const r of h.reads.slice()) r.resolve({data:r.table===table?data:[],error:null});});
    expect(screen.queryByTestId('ranking-crash')).not.toBeInTheDocument();
    expect(screen.getByText('leaderboardPage.loadError')).toBeInTheDocument();
    expect(screen.queryByText('leaderboardPage.emptyOverall')).not.toBeInTheDocument();
  });

  it('rejects a malformed profile display name before publishing ranking state', async () => {
    render(<ErrorBoundary fallback={<div data-testid="ranking-crash"/>}><Leaderboard /></ErrorBoundary>);
    await waitFor(() => expect(h.reads).toHaveLength(5));
    await act(async () => {for (const r of h.reads.slice()) r.resolve({data:r.table==='all_time_money_list'
      ? [{id:'row',player_id:'player',display_name:'Public name',total_winnings:100}] : [],error:null});});
    await waitFor(() => expect(h.reads).toHaveLength(6));
    await act(async () => {h.reads[5].resolve({data:[{user_id:'player',display_name:{invalid:true},avatar_url:null}],error:null});});
    expect(screen.queryByTestId('ranking-crash')).not.toBeInTheDocument();
    expect(screen.getByText('leaderboardPage.loadError')).toBeInTheDocument();
    expect(screen.queryByText('Public name')).not.toBeInTheDocument();
  });

  it('does not label backend failure as an empty leaderboard and supports manual retry', async () => {
    h.failure = 'all_time_money_list';
    render(<Leaderboard />);
    await waitFor(() => expect(h.reads).toHaveLength(5));
    await finish(h.reads.slice());
    expect(screen.getByText('leaderboardPage.loadError')).toBeInTheDocument();
    expect(screen.queryByText('leaderboardPage.emptyOverall')).not.toBeInTheDocument();
    h.failure = '';
    fireEvent.click(screen.getByRole('button', {name: 'leaderboardPage.retry'}));
    await waitFor(() => expect(h.reads).toHaveLength(10));
    await finish(h.reads.slice(5), 'Recovered player');
    expect(screen.getByText('Recovered player')).toBeInTheDocument();
  });

  it('coalesces a realtime burst instead of overlapping the initial five reads', async () => {
    render(<Leaderboard />);
    await waitFor(() => expect(h.reads).toHaveLength(5));
    await act(async () => {for (let i = 0; i < 10; i++) h.callbacks[0]();});
    expect(h.reads).toHaveLength(5);
    await finish(h.reads.slice(), 'Current player');
    await waitFor(() => expect(h.reads).toHaveLength(10));
    await finish(h.reads.slice(5), 'Refreshed player');
    expect(screen.getByText('Refreshed player')).toBeInTheDocument();
    expect(h.reads).toHaveLength(10);
  });

  it('hides the prior account data immediately and ignores its delayed response', async () => {
    const view = render(<Leaderboard />);
    await waitFor(() => expect(h.reads).toHaveLength(5));
    const old = h.reads.slice();
    h.actor = 'actor-b'; view.rerender(<Leaderboard />);
    await waitFor(() => expect(h.reads).toHaveLength(10));
    await finish(h.reads.slice(5), 'Account B');
    await finish(old, 'Account A');
    expect(screen.getByText('Account B')).toBeInTheDocument();
    expect(screen.queryByText('Account A')).not.toBeInTheDocument();
  });

  it('clears loaded rows for a new session of the same account', async () => {
    h.session = {access_token: 'local-test-a'};
    const view = render(<Leaderboard />);
    await waitFor(() => expect(h.reads).toHaveLength(5));
    await finish(h.reads.slice(), 'Previous session');
    h.session = {access_token: 'local-test-b'}; view.rerender(<Leaderboard />);
    expect(screen.queryByText('Previous session')).not.toBeInTheDocument();
  });

  it('settles a hung read and ignores a late transport completion', async () => {
    vi.useFakeTimers();
    render(<Leaderboard />);
    await act(async () => {await Promise.resolve();});
    const pending = h.reads.slice();
    await act(async () => {await vi.advanceTimersByTimeAsync(15_000);});
    expect(screen.getByText('leaderboardPage.loadError')).toBeInTheDocument();
    await finish(pending, 'Late player');
    expect(screen.queryByText('Late player')).not.toBeInTheDocument();
  });

  it('does not turn a malformed successful list into verified empty results', async () => {
    render(<Leaderboard />);
    await waitFor(() => expect(h.reads).toHaveLength(5));
    await act(async () => {for (const r of h.reads) r.resolve({data: null, error: null});});
    expect(screen.getByText('leaderboardPage.loadError')).toBeInTheDocument();
    expect(screen.queryByText('leaderboardPage.emptyOverall')).not.toBeInTheDocument();
  });

  it('does not display rankings when the required profile lookup fails', async () => {
    render(<Leaderboard />);
    await waitFor(() => expect(h.reads).toHaveLength(5));
    await act(async () => {
      for (const r of h.reads.slice()) r.resolve({data: r.table === 'all_time_money_list'
        ? [{id: 'row', player_id: 'player', display_name: 'Unverified player', total_winnings: 100}] : [], error: null});
    });
    await waitFor(() => expect(h.reads).toHaveLength(6));
    await act(async () => {h.reads[5].resolve({data: null, error: {message: 'profile unavailable'}});});
    expect(screen.getByText('leaderboardPage.loadError')).toBeInTheDocument();
    expect(screen.queryByText('Unverified player')).not.toBeInTheDocument();
  });

  it('aborts owned requests, removes the channel and ignores late events after unmount', async () => {
    const view = render(<Leaderboard />);
    await waitFor(() => expect(h.reads).toHaveLength(5));
    const pending = h.reads.slice();
    view.unmount();
    expect(pending.every(r => r.signal?.aborted)).toBe(true);
    expect(h.removed).toHaveBeenCalledTimes(1);
    await act(async () => {h.callbacks[0]();});
    await finish(pending, 'Unmounted player');
    expect(h.reads).toHaveLength(5);
  });

  it('does not read while offline and coalesces reconnect events into one batch', async () => {
    vi.useFakeTimers();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<Leaderboard />);
    await act(async () => {await Promise.resolve();});
    expect(h.reads).toHaveLength(0);
    expect(screen.getByText('leaderboardPage.loadError')).toBeInTheDocument();
    online.mockReturnValue(true);
    await act(async () => {for (let i = 0; i < 3; i++) window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(200);});
    expect(h.reads).toHaveLength(5);
    await finish(h.reads.slice(), 'Reconnected player');
    expect(screen.getByText('Reconnected player')).toBeInTheDocument();
  });

  it('defers hidden-tab reads until visible again', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    render(<Leaderboard />);
    await act(async () => {await Promise.resolve(); h.callbacks[0](); await vi.advanceTimersByTimeAsync(1000);});
    expect(h.reads).toHaveLength(0);
    visibility.mockReturnValue('visible');
    await act(async () => {document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(200);});
    expect(h.reads).toHaveLength(5);
    await finish(h.reads.slice(), 'Visible player');
    expect(screen.getByText('Visible player')).toBeInTheDocument();
  });

  it('cancels sibling transport reads when one read rejects', async () => {
    render(<Leaderboard />);
    await waitFor(() => expect(h.reads).toHaveLength(5));
    await act(async () => {h.reads[0].resolve(Promise.reject(new TypeError('offline')));});
    expect(screen.getByText('leaderboardPage.loadError')).toBeInTheDocument();
    expect(h.reads.every(r => r.signal?.aborted)).toBe(true);
  });
});

describe('Leaderboard monetary snapshot boundary',()=>{
 beforeEach(()=>{h.actor='actor-a';h.session=null;h.failure='';h.reads=[];h.callbacks=[];h.removed.mockClear();});
 afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
it.each([
 ['leaderboard_entries',{player_id:null,winnings:null,cashout:0}],
 ['leaderboard_entries',{player_id:null,winnings:0,cashout:false}],
 ['all_time_money_list',{player_id:null,display_name:'Unknown winnings TEST',total_winnings:null}],
 ['club_money_list',{player_id:null,total_winnings:'not-money'}],
 ['player_results',{player_id:null,prize:'Infinity'}],
])('rejects malformed monetary snapshot instead of displaying zero: %s',async(table,row)=>{
 render(<Leaderboard/>);await waitFor(()=>expect(h.reads).toHaveLength(5));
 await act(async()=>{for(const r of h.reads.slice())r.resolve({data:r.table===table?[row]:[],error:null});});
 if(h.reads.length>5)await act(async()=>{for(const r of h.reads.slice(5))r.resolve({data:[],error:null});});
 expect(screen.getByText('leaderboardPage.loadError')).toBeInTheDocument();
 expect(screen.queryByText('leaderboardPage.emptyOverall')).not.toBeInTheDocument();
});
it.each([0,'0','100.25'])('preserves valid numeric leaderboard values: %s',async(total_winnings)=>{
 render(<Leaderboard/>);await waitFor(()=>expect(h.reads).toHaveLength(5));
 await act(async()=>{for(const r of h.reads.slice())r.resolve({data:r.table==='all_time_money_list'?[{player_id:null,display_name:'Valid monetary TEST',total_winnings}]:[],error:null});});
 expect(screen.getByText('Valid monetary TEST')).toBeInTheDocument();expect(screen.queryByText('leaderboardPage.loadError')).not.toBeInTheDocument();
});

});
