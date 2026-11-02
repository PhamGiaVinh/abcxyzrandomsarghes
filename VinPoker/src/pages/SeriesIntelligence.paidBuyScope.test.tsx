import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { SupabaseClientProvider } from '@/integrations/supabase/SupabaseClientContext';
import SeriesIntelligence from './SeriesIntelligence';
import { createSeriesClubPulseDemoV1 } from '@/lib/series-intelligence/seriesClubPulseDemoV1';

function mockPulse(clubId: string) {
  return { ...createSeriesClubPulseDemoV1('2026-10-30T10:00:00Z'), clubId };
}

const fixture = vi.hoisted(() => ({ actor: 'owner-a' as string | null, session: { access_token: 'LOCAL_UNIT_A' }, rpc: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.actor ? { id: fixture.actor } : null, session: fixture.session,
  isAdmin: false, isClubAdmin: false, isClubOwner: true, loading: false }) }));
vi.mock('@/lib/featureFlags', () => ({ FEATURES: { seriesClubPulseV1: true, seriesVCopilotV1: true } }));
vi.mock('@/components/series-intelligence/VCopilotPanel', () => ({
  VCopilotPanel: ({ clubId }: { clubId: string | null }) => <div data-testid="copilot-club">{clubId ?? 'none'}</div>,
}));
vi.mock('@/components/series-intelligence/OwnerCommandCenter', () => ({ OwnerCommandCenter: () => null }));
vi.mock('@/components/series-intelligence/ClubPulsePanel', () => ({
  ClubPulsePanel: ({ onPulseChange, onDemoModeChange, demoMode }: {
    onPulseChange: (value: unknown) => void; onDemoModeChange: (value: boolean) => void; demoMode: boolean;
  }) => <div>
    <button onClick={() => onPulseChange(mockPulse('11111111-1111-4111-8111-111111111111'))}>Chọn CLB A</button>
    <button onClick={() => onPulseChange(mockPulse('22222222-2222-4222-8222-222222222222'))}>Chọn CLB B</button>
    <button onClick={() => {
      if (!demoMode) onPulseChange(mockPulse('00000000-0000-4000-8000-000000000001'));
      onDemoModeChange(!demoMode);
    }}>Đổi chế độ mẫu</button>
  </div>,
}));

function live(clubId: string, rake = 90000) {
  return { clubId, asOf: '2026-10-30T10:00:00Z', tours: [{ tournamentId: `tour-${clubId}`, name: `Giải ${clubId}`,
    eventDay: '2026-11-04', registrationClosedAt: null, provisional: true, buyState: 'open',
    paidBuys: 9, waitingSeatBuys: 1, uniquePlayers: 8, refundedBuys: 0, unavailableBuys: 0,
    rake, serviceFee: 45000, platformFee: 0, collected: 1035000 }] };
}
const channel = { on: () => channel, subscribe: () => channel };
const client = { rpc: (...args: unknown[]) => fixture.rpc(...args), channel: () => channel, removeChannel: vi.fn() };
const view = () => <MemoryRouter><SupabaseClientProvider client={client as never}><SeriesIntelligence /></SupabaseClientProvider></MemoryRouter>;
beforeEach(() => {
  localStorage.clear(); fixture.actor = 'owner-a'; fixture.session = { access_token: 'LOCAL_UNIT_A' }; fixture.rpc.mockReset();
  fixture.rpc.mockImplementation(async (name, args) => name === 'get_owner_tour_rake_live_v1'
    ? { data: live(args.p_club_id), error: null }
    : { data: { status: 'buy_open', canExport: false, snapshot: null, capturedAt: null }, error: null });
});

it('mounts canonical paid buy metrics only after live club selection and removes them in demo mode', async () => {
  render(view());
  expect(fixture.rpc).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Chọn CLB A' }));
  await screen.findByText('90.000 đ');
  expect(screen.getByText('Buy đã thu')).toBeInTheDocument();
  expect(screen.getByText('Người chơi duy nhất')).toBeInTheDocument();
  expect(screen.getByText('1 buy đã thu đang chờ xếp chỗ.')).toBeInTheDocument();
  const calls = fixture.rpc.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Đổi chế độ mẫu' }));
  expect(screen.queryByText('90.000 đ')).not.toBeInTheDocument();
  expect(screen.queryByText('Rake theo giải')).not.toBeInTheDocument();
  expect(fixture.rpc).toHaveBeenCalledTimes(calls);
  // The actual pulse component retains its demo sentinel until its live read finishes.
  fireEvent.click(screen.getByRole('button', { name: 'Đổi chế độ mẫu' }));
  expect(screen.queryByText('Rake theo giải')).not.toBeInTheDocument();
  expect(fixture.rpc).toHaveBeenCalledTimes(calls);
  fireEvent.click(screen.getByRole('button', { name: 'Chọn CLB A' }));
  await screen.findByText('90.000 đ');
  expect(fixture.rpc.mock.calls.some(([, args]) => args?.p_club_id === '00000000-0000-4000-8000-000000000001')).toBe(false);
});

it('does not display a late club A response after switching to club B', async () => {
  let release!: (value: unknown) => void;
  fixture.rpc.mockImplementation(async (name, args) => name !== 'get_owner_tour_rake_live_v1'
    ? { data: { status: 'buy_open', canExport: false, snapshot: null, capturedAt: null }, error: null }
    : args.p_club_id === '11111111-1111-4111-8111-111111111111' ? new Promise(r => { release = r; }) : { data: live('22222222-2222-4222-8222-222222222222', 200000), error: null });
  render(view()); fireEvent.click(screen.getByRole('button', { name: 'Chọn CLB A' }));
  fireEvent.click(screen.getByRole('button', { name: 'Chọn CLB B' }));
  await screen.findByText('200.000 đ');
  await act(async () => release({ data: live('11111111-1111-4111-8111-111111111111'), error: null }));
  expect(screen.queryByText('90.000 đ')).not.toBeInTheDocument();
});

it('clears cached money on actor and session changes even when the club id stays the same', async () => {
  const mounted = render(view()); fireEvent.click(screen.getByRole('button', { name: 'Chọn CLB A' }));
  await screen.findByText('90.000 đ');
  fixture.rpc.mockImplementation(() => new Promise(() => {}));
  fixture.actor = 'owner-b'; fixture.session = { access_token: 'LOCAL_UNIT_B' }; mounted.rerender(view());
  expect(screen.queryByText('90.000 đ')).not.toBeInTheDocument();
  fixture.session = { access_token: 'LOCAL_UNIT_REFRESH' }; mounted.rerender(view());
  expect(screen.queryByText('90.000 đ')).not.toBeInTheDocument();
});

it('removes money immediately on logout while old role flags are still present', async () => {
  const mounted = render(view()); fireEvent.click(screen.getByRole('button', { name: 'Chọn CLB A' }));
  await screen.findByText('90.000 đ'); fixture.actor = null; mounted.rerender(view());
  expect(screen.queryByText('90.000 đ')).not.toBeInTheDocument();
  expect(screen.queryByText('Rake theo giải')).not.toBeInTheDocument();
});

it('does not start an old club money read for a new actor before a new pulse is accepted', async () => {
  const mounted = render(view());
  fireEvent.click(screen.getByRole('button', { name: 'Chọn CLB A' }));
  await screen.findByText('90.000 đ');
  expect(screen.getByTestId('copilot-club')).toHaveTextContent('11111111-1111-4111-8111-111111111111');
  fixture.rpc.mockClear();
  fixture.actor = 'owner-b';
  fixture.session = { access_token: 'LOCAL_UNIT_B' };
  mounted.rerender(view());
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect(screen.queryByText('Rake theo giải')).not.toBeInTheDocument();
  expect(screen.getByTestId('copilot-club')).toHaveTextContent('none');
  fireEvent.click(screen.getByRole('button', { name: 'Chọn CLB B' }));
  await screen.findByText('90.000 đ');
  expect(fixture.rpc.mock.calls.filter(([name]) => name === 'get_owner_tour_rake_live_v1')
    .every(([, args]) => args.p_club_id === '22222222-2222-4222-8222-222222222222')).toBe(true);
  fixture.rpc.mockClear();
  fixture.session = { access_token: 'LOCAL_UNIT_B_REFRESH' };
  mounted.rerender(view());
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect(screen.getByTestId('copilot-club')).toHaveTextContent('none');
});

it('keeps paid buys and unique people scoped to the selected tournament across selection and refresh', async () => {
  const first = live('11111111-1111-4111-8111-111111111111');
  first.tours.push({ ...first.tours[0], tournamentId: 'second-tour', name: 'Giải thứ hai',
    paidBuys: 4, uniquePlayers: 2, waitingSeatBuys: 0, rake: 40000 });
  fixture.rpc.mockImplementation(async name => name === 'get_owner_tour_rake_live_v1'
    ? { data: structuredClone(first), error: null }
    : { data: { status: 'buy_open', canExport: false, snapshot: null, capturedAt: null }, error: null });
  render(view());
  fireEvent.click(screen.getByRole('button', { name: 'Chọn CLB A' }));
  await screen.findByText('90.000 đ');
  const metric = (label: string) => within(screen.getByText(label).parentElement!).getByRole('definition').textContent;
  expect(metric('Buy đã thu')).toBe('9');
  expect(metric('Người chơi duy nhất')).toBe('8');
  fireEvent.change(screen.getByRole('combobox', { name: 'Giải cần xem' }), { target: { value: 'second-tour' } });
  await screen.findByText('40.000 đ');
  expect(metric('Buy đã thu')).toBe('4');
  expect(metric('Người chơi duy nhất')).toBe('2');
  expect(screen.queryByText('1 buy đã thu đang chờ xếp chỗ.')).not.toBeInTheDocument();
  first.tours[1].paidBuys = 5; // Another buy by an existing person must not increment unique people.
  first.tours[1].rake = 50000;
  fireEvent.click(screen.getByRole('button', { name: 'Làm mới rake' }));
  await screen.findByText('50.000 đ');
  expect(metric('Buy đã thu')).toBe('5');
  expect(metric('Người chơi duy nhất')).toBe('2');
  fireEvent.change(screen.getByRole('combobox', { name: 'Giải cần xem' }), { target: { value: first.tours[0].tournamentId } });
  await screen.findByText('90.000 đ');
  expect(metric('Người chơi duy nhất')).toBe('8');
});

it('times out a hung rake read, resumes polling, and ignores the expired response', async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  try {
    const expired: Array<(value: unknown) => void> = [];
    fixture.rpc.mockImplementation(() => new Promise(resolve => { expired.push(resolve); }));
    render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Chọn CLB A' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được rake');
    fixture.rpc.mockImplementation(async name => name === 'get_owner_tour_rake_live_v1'
      ? { data: live('11111111-1111-4111-8111-111111111111'), error: null }
      : { data: { status: 'buy_open', canExport: false, snapshot: null, capturedAt: null }, error: null });
    // The poll at the deadline may already have started a second hung read.
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByText('90.000 đ')).toBeInTheDocument();
    await act(async () => { for (const release of expired) release({ data: live('11111111-1111-4111-8111-111111111111', 999000), error: null }); });
    expect(screen.queryByText('999.000 đ')).not.toBeInTheDocument();
    expect(screen.getByText('90.000 đ')).toBeInTheDocument();
  } finally { visibility.mockRestore(); vi.useRealTimers(); }
});
