import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OpsCashier from './OpsCashier';

const h = vi.hoisted(() => ({ reads: [] as { table: string; signal?: AbortSignal; resolve: (value: unknown) => void }[] }));
vi.mock('@/integrations/supabase/SupabaseClientContext', () => {
  const client = { from: (table: string) => {
    let signal: AbortSignal | undefined;
    const q = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
      abortSignal: (next: AbortSignal) => { signal = next; return q; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        new Promise(done => h.reads.push({ table, signal, resolve: done })).then(resolve, reject) };
    return q;
  } };
  return { useSupabaseClient: () => client };
});
vi.mock('@/ops/auth/OpsAuthProvider', () => { const user = { id: 'actor' }; return { useOpsAuth: () => ({ user }) }; });
vi.mock('@/ops/auth/OpsCapabilityProvider', () => ({ useOpsCapabilities: () => ({ loading: false, scopeError: null, cashierClubIds: ['club'], clubs: [{ id: 'club', name: 'Club' }] }) }));
vi.mock('@/ops/workspace/OpsWorkspaceProvider', () => ({ useOpsWorkspace: () => ({ selectedClubId: 'club' }) }));
vi.mock('@/lib/featureFlags', () => ({ OPS_TOUR_CASHIER_ENABLED: false }));
const empty = { data: [], error: null };
const mount = async () => { const view = render(<MemoryRouter><OpsCashier /></MemoryRouter>); await act(async () => { await Promise.resolve(); }); return view; };
const expire = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(10_000); }); };

describe('Cashier overview owned read lifetime', () => {
  beforeEach(() => { h.reads = []; vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it.each(['registrations', 'statuses', 'profiles', 'tournament names'])('rejects null %s instead of reporting verified empty data', async (bad) => {
    await mount();
    const rows = bad === 'profiles' || bad === 'tournament names'
      ? [{ id: 'registration', status: 'confirmed', player_id: 'p', tournament_id: 't' }] : [];
    await act(async () => {
      h.reads[0].resolve({ data: bad === 'registrations' ? null : rows, error: null });
      h.reads[1].resolve(bad === 'statuses' ? { data: null, error: null } : empty);
    });
    if (rows.length) await act(async () => {
      h.reads[2].resolve(bad === 'profiles' ? { data: null, error: null } : empty);
      h.reads[3].resolve(bad === 'tournament names' ? { data: null, error: null } : empty);
    });
    expect(screen.getByText('Không tải được dữ liệu')).toBeInTheDocument();
    expect(screen.queryByText('Không có đăng ký đang chờ.')).not.toBeInTheDocument();
    expect(screen.queryByText('Người chơi')).not.toBeInTheDocument();
  });
  it('settles a hung root read, aborts both transports and ignores late rows', async () => {
    await mount(); expect(h.reads).toHaveLength(2); await expire();
    expect(screen.getByText('Không tải được dữ liệu')).toBeInTheDocument();
    expect(h.reads.every(read => read.signal?.aborted)).toBe(true);
    await act(async () => h.reads[0].resolve({ data: [{ player_id: 'p', tournament_id: 't' }], error: null }));
    expect(h.reads).toHaveLength(2);
    expect(screen.getByText('Không tải được dữ liệu')).toBeInTheDocument();
  });
  it('bounds dependent profile/tournament reads in the same overall deadline', async () => {
    await mount();
    await act(async () => { h.reads[0].resolve({ data: [{ player_id: 'p', tournament_id: 't' }], error: null }); h.reads[1].resolve(empty); });
    expect(h.reads).toHaveLength(4); await expire();
    expect(screen.getByText('Không tải được dữ liệu')).toBeInTheDocument();
    expect(h.reads.every(read => read.signal?.aborted)).toBe(true);
  });
  it('recovers on explicit refresh and aborts owned reads on unmount', async () => {
    const view = await mount(); await expire();
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới dữ liệu Cashier' }));
    await act(async () => { await Promise.resolve(); });
    expect(h.reads).toHaveLength(4);
    await act(async () => { h.reads[2].resolve(empty); h.reads[3].resolve(empty); });
    expect(screen.getByText('Không có đăng ký đang chờ.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới dữ liệu Cashier' }));
    await act(async () => { await Promise.resolve(); }); view.unmount();
    expect(h.reads.slice(-2).every(read => read.signal?.aborted)).toBe(true);
  });
});
