// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { TournamentPhotosManager } from './TournamentPhotosManager';

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'actor-one' }, session: { access_token: 'local-fixture-one' } },
  photoRead: vi.fn(), rpc: vi.fn(), success: vi.fn(), error: vi.fn(),
  tours: [
    { id: 'tour-a', club_id: 'club-a', name: 'Tour A', status: 'active' },
    { id: 'tour-b', club_id: 'club-b', name: 'Tour B', status: 'active' },
  ],
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mocks.auth }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: ReactNode }) => <select aria-label="Giải" value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
  SelectTrigger: () => <option value="">Chọn giải</option>, SelectValue: () => null,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: mocks.rpc,
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    const query = {
      select: () => query, order: () => query, abortSignal: () => query,
      in: (key: string, value: unknown) => { filters[key] = value; return query; },
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(table === 'tournaments' ? { data: mocks.tours, error: null } : mocks.photoRead(filters.tournament_id)).then(resolve, reject),
    };
    return query;
  },
} }));
type Result = { data: unknown[] | null; error: { message: string } | null };
function deferred() { let resolve!: (value: Result) => void; const promise = new Promise<Result>(done => { resolve = done; }); return { promise, resolve }; }
const photo = (id: string, tour: string) => ({ id, tournament_id: tour, photo_url: `https://photos.example.test/${id}.jpg`, storage_path: `${tour}/${id}.jpg`, created_at: '2026-11-27T00:00:00Z' });
const choose = async (tour: string) => { await screen.findByRole('combobox'); fireEvent.change(screen.getByRole('combobox'), { target: { value: tour } }); };
afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth = { user: { id: 'actor-one' }, session: { access_token: 'local-fixture-one' } };
  mocks.rpc.mockResolvedValue({ data: ['club-a', 'club-b'], error: null });
  mocks.photoRead.mockImplementation((tour: string) => ({ data: [photo(tour + '-photo', tour)], error: null }));
});

describe('tournament photo read context', () => {
  it('ignores a late A photo response after choosing B', async () => {
    const a = deferred(); mocks.photoRead.mockImplementation((tour: string) => tour === 'tour-a' ? a.promise : { data: [photo('b-photo', 'tour-b')], error: null });
    render(<TournamentPhotosManager />); await choose('tour-a');
    await waitFor(() => expect(mocks.photoRead).toHaveBeenCalledWith('tour-a'));
    await choose('tour-b'); await waitFor(() => expect(document.querySelector('img')?.getAttribute('src')).toContain('b-photo'));
    await act(async () => a.resolve({ data: [photo('a-late', 'tour-a')], error: null }));
    expect(document.querySelector('img')?.getAttribute('src')).toContain('b-photo');
  });
  it('shows a B read error as unknown, preserving no stale A gallery', async () => {
    mocks.photoRead.mockImplementation((tour: string) => tour === 'tour-a' ? { data: [photo('a-photo', tour)], error: null } : { data: null, error: { message: 'fixture read failure' } });
    render(<TournamentPhotosManager />); await choose('tour-a'); await waitFor(() => expect(document.querySelector('img')).toBeTruthy());
    await choose('tour-b');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh'));
    expect(document.querySelector('img')).toBeNull(); expect(screen.queryByText(/Chưa có ảnh/)).toBeNull();
  });
  it('clears selected photos immediately when the actor changes', async () => {
    const view = render(<TournamentPhotosManager />); await choose('tour-a'); await waitFor(() => expect(document.querySelector('img')).toBeTruthy());
    mocks.auth = { user: { id: 'actor-two' }, session: { access_token: 'local-fixture-two' } }; view.rerender(<TournamentPhotosManager />);
    expect(document.querySelector('img')).toBeNull(); expect(screen.queryByText(/Tour A ·/)).toBeNull();
  });
  it('contains rejected photo reads as an explicit retryable error', async () => {
    mocks.photoRead.mockRejectedValue(new TypeError('fixture unavailable'));
    render(<TournamentPhotosManager />); await choose('tour-b');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác minh'));
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeVisible();
  });
  it('removes old photos and disables upload while the next tour is unverified', async () => {
    const pending = deferred(); mocks.photoRead.mockImplementation((tour: string) => tour === 'tour-b' ? pending.promise : { data: [photo('a-photo', tour)], error: null });
    render(<TournamentPhotosManager />); await choose('tour-a'); await waitFor(() => expect(document.querySelector('img')).toBeTruthy());
    await choose('tour-b');
    expect(document.querySelector('img')).toBeNull(); expect(document.querySelector('input[type=file]')).toBeDisabled();
    await act(async () => pending.resolve({ data: [], error: null }));
    await waitFor(() => expect(document.querySelector('input[type=file]')).not.toBeDisabled());
    expect(screen.getByText(/Chưa có ảnh/)).toBeVisible();
  });
  it('rejects a response containing photos for another tournament', async () => {
    mocks.photoRead.mockResolvedValue({ data: [photo('a-foreign', 'tour-a')], error: null });
    render(<TournamentPhotosManager />); await choose('tour-b');
    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible()); expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('input[type=file]')).toBeDisabled();
  });
  it('allows retry to publish only the current tour after an error', async () => {
    mocks.photoRead.mockResolvedValueOnce({ data: null, error: { message: 'fixture failure' } }).mockResolvedValue({ data: [photo('b-retry', 'tour-b')], error: null });
    render(<TournamentPhotosManager />); await choose('tour-b');
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(document.querySelector('img')?.getAttribute('src')).toContain('b-retry'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('clears a previous session even for the same actor', async () => {
    const view = render(<TournamentPhotosManager />); await choose('tour-a'); await waitFor(() => expect(document.querySelector('img')).toBeTruthy());
    mocks.auth = { ...mocks.auth, session: { access_token: 'local-fixture-refresh' } }; view.rerender(<TournamentPhotosManager />);
    expect(document.querySelector('img')).toBeNull();
  });
  it('bounds a hung photo read and aborts delivery of its late result', async () => {
    const pending = deferred(); mocks.photoRead.mockReturnValue(pending.promise);
    render(<TournamentPhotosManager />); await choose('tour-b'); await waitFor(() => expect(mocks.photoRead).toHaveBeenCalled());
    vi.useFakeTimers();
    // The observer timer was created with real timers; restart this read under the controlled clock.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tour-a' } });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10001); });
    expect(screen.getByRole('alert')).toBeVisible();
    await act(async () => pending.resolve({ data: [photo('a-late', 'tour-a')], error: null }));
    expect(document.querySelector('img')).toBeNull();
  });
});
