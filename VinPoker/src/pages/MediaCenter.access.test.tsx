// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import MediaCenter from './MediaCenter';
const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'actor' }, session: { access_token: 'local-media-test' }, loading: false, isMediaOrAdmin: false, isFloor: false },
  scope: [{ club_id: 'club-b', can_floor: true }], roles: [] as { role: string }[],
  load: vi.fn(), poll: null as null | (() => void), mounts: 0,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mocks.auth }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }) }));
vi.mock('@/ops/auth/opsCapabilityLoader', () => ({ loadOpsCapabilities: mocks.load }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => {
  const query = { select: () => query, eq: () => query, abortSignal: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: mocks.roles, error: null }).then(resolve) }; return query;
} } }));
vi.mock('./SuperAdmin', () => ({ BannersEditor: () => <div>Banners CMS</div>, SeriesEditor: () => <div>Series CMS</div> }));
vi.mock('./News', () => ({ default: () => <div data-testid="news-cms">News CMS</div> }));
vi.mock('./InternationalEvents', () => ({ default: () => <div>International CMS</div> }));
vi.mock('@/components/admin/AdminSupportTab', () => ({ AdminSupportTab: () => <div>Support CMS</div> }));
vi.mock('@/components/admin/MediaClubSchedules', () => ({ MediaClubSchedules: () => <div>Schedules CMS</div> }));
vi.mock('@/components/admin/TournamentPhotosManager', async () => {
  const React = await import('react');
  return { TournamentPhotosManager: () => { React.useEffect(() => { ++mocks.mounts; }, []); return <div data-testid="photo-workspace">Photo workspace</div>; } };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth = { user: { id: 'actor' }, session: { access_token: 'local-media-test' }, loading: false, isMediaOrAdmin: false, isFloor: false };
  mocks.scope = [{ club_id: 'club-b', can_floor: true }]; mocks.roles = []; mocks.mounts = 0; mocks.poll = null;
  mocks.load.mockImplementation(async () => ({ scope: mocks.scope, global: { is_super_admin: false }, source: 'unified' }));
  const originalInterval = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation((callback, delay, ...args) => {
    if (delay === 5000) { mocks.poll = callback as () => void; return 0 as unknown as ReturnType<typeof setInterval>; }
    return originalInterval(callback, delay, ...args);
  });
});
const open = () => render(<MemoryRouter><MediaCenter /></MemoryRouter>);
const poll = async () => { expect(mocks.poll).not.toBeNull(); await act(async () => { mocks.poll?.(); await Promise.resolve(); }); };
describe('Media entry uses current server authority', () => {
  it('allows a canonical club Floor to open only photos without a global floor role', async () => {
    open(); expect(await screen.findByTestId('photo-workspace')).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'mediaCenterPage.tabNews' })).toBeNull(); expect(mocks.load).toHaveBeenCalled();
  });
  it('does not retain a cached global-floor affordance after scope withdrawal', async () => {
    mocks.auth.isFloor = true; mocks.scope = []; open();
    await waitFor(() => expect(screen.queryByTestId('photo-workspace')).toBeNull());
    expect(await screen.findByText('mediaCenterPage.noPermissionTitle')).toBeVisible();
  });
  it('does not grant CMS from a cached Media flag without current global Media authority', async () => {
    mocks.auth.isMediaOrAdmin = true; mocks.scope = []; open();
    expect(await screen.findByText('mediaCenterPage.noPermissionTitle')).toBeVisible(); expect(screen.queryByTestId('news-cms')).toBeNull();
  });
  it('preserves a verified global Media CMS grant independently of cached flags', async () => {
    mocks.roles = [{ role: 'media' }]; mocks.scope = []; open();
    expect(await screen.findByTestId('news-cms')).toBeVisible();
  });
  it('withdraws global CMS while retaining a valid club Floor workspace', async () => {
    mocks.roles = [{ role: 'media' }]; mocks.auth.isMediaOrAdmin = true; open(); await screen.findByTestId('news-cms');
    mocks.roles = []; await poll();
    expect(await screen.findByTestId('photo-workspace')).toBeVisible(); expect(screen.queryByRole('tab', { name: 'mediaCenterPage.tabNews' })).toBeNull();
  });
  it('disposes a mixed-club photo workspace when A is revoked while B remains', async () => {
    mocks.scope = [{ club_id: 'club-a', can_floor: true }, { club_id: 'club-b', can_floor: true }]; open(); await screen.findByTestId('photo-workspace'); expect(mocks.mounts).toBe(1);
    mocks.scope = [{ club_id: 'club-b', can_floor: true }]; await poll();
    await waitFor(() => expect(mocks.mounts).toBe(2)); expect(screen.getByTestId('photo-workspace')).toBeVisible();
  });
  it('closes old controls on a failed authority refresh and reports unknown', async () => {
    open(); await screen.findByTestId('photo-workspace'); mocks.load.mockRejectedValue(new Error('fixture scope unavailable')); await poll();
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa xác minh'); expect(screen.queryByTestId('photo-workspace')).toBeNull();
  });
  it('keeps verified super-admin CMS access with no global Media role', async () => {
    mocks.load.mockResolvedValue({ scope: [], global: { is_super_admin: true }, source: 'unified' }); open();
    expect(await screen.findByTestId('news-cms')).toBeVisible();
  });
  it('does not turn a club Marketing capability into global CMS access', async () => {
    mocks.scope = [Object.assign({ club_id: 'club-b', can_floor: false }, { can_marketer: true })]; open();
    expect(await screen.findByText('mediaCenterPage.noPermissionTitle')).toBeVisible(); expect(screen.queryByTestId('news-cms')).toBeNull();
  });
  it('rejects malformed Media role responses rather than treating them as CMS authority', async () => {
    mocks.roles = [{ role: 'marketing' }]; open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa xác minh'); expect(screen.queryByTestId('news-cms')).toBeNull();
  });
  it('hides the old workspace immediately after same-actor session rotation', async () => {
    const view = open(); await screen.findByTestId('photo-workspace');
    mocks.load.mockReturnValue(new Promise(() => {})); mocks.auth = { ...mocks.auth, session: { access_token: 'new-local-media-session' } };
    view.rerender(<MemoryRouter><MediaCenter /></MemoryRouter>); expect(screen.queryByTestId('photo-workspace')).toBeNull();
  });
  it('does not overlap a stalled check, removes old controls at its deadline and ignores its late grant', async () => {
    open(); await screen.findByTestId('photo-workspace');
    let resolve!: (value: unknown) => void; mocks.load.mockReturnValue(new Promise(done => { resolve = done; }));
    vi.useFakeTimers();
    await poll(); await poll(); expect(mocks.load).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(10001); });
    expect(screen.getByRole('alert')).toBeVisible(); expect(screen.queryByTestId('photo-workspace')).toBeNull();
    await act(async () => resolve({ scope: [], global: { is_super_admin: true }, source: 'unified' }));
    expect(screen.queryByTestId('news-cms')).toBeNull(); vi.useRealTimers();
  });
});
