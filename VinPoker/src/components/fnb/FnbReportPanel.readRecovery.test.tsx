import { act, cleanup, render, screen } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), auth: {
  user: { id: 'owner-a' }, session: { access_token: 'LOCAL_FNB_READ_TEST' }, loading: false,
} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => fixture.auth }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: fixture.rpc } }));
import { FnbReportPanel } from './FnbReportPanel';

const clients: QueryClient[] = [];
const report = (revenue = 7654321) => ({ revenue, cogs: 2000, grossProfit: revenue - 2000,
  orderCount: 1, statusCounts: { paid: 1 }, topItems: [], lowStock: [], dailyTrend: [],
  compCount: 0, compCogs: 0, byTable: [], byPlayer: [] });
function mount() {
  // App.tsx query policy, including the real retry/backoff rather than retry:false.
  const client = new QueryClient({ defaultOptions: { queries: {
    staleTime: 5 * 60 * 1000, gcTime: 30 * 60 * 1000, retry: 2,
    retryDelay: attempt => Math.min(1000 * 2 ** attempt, 8000), refetchOnWindowFocus: true,
  } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><FnbReportPanel clubId="club-a" /></QueryClientProvider>);
}
afterEach(() => { cleanup(); for (const client of clients.splice(0)) client.clear(); onlineManager.setOnline(true); vi.useRealTimers(); fixture.rpc.mockReset(); });

it('hides cached totals while offline polling is paused and recovers on reconnect', async () => {
  vi.useFakeTimers();
  fixture.rpc.mockResolvedValue({ data: report(), error: null });
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByText(/7\.654\.321/)).toBeInTheDocument();
  act(() => onlineManager.setOnline(false));
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(screen.queryByText(/7\.654\.321/)).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Mất kết nối');
  fixture.rpc.mockResolvedValue({ data: report(6543210), error: null });
  act(() => onlineManager.setOnline(true));
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByText(/6\.543\.210/)).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('explains a paused initial report instead of showing a blank screen', async () => {
  vi.useFakeTimers();
  onlineManager.setOnline(false);
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('Mất kết nối');
});

it('recovers a hung report with actual app retries and ignores expired replies', async () => {
  vi.useFakeTimers();
  const expired: Array<(value: unknown) => void> = [];
  fixture.rpc.mockImplementation(() => new Promise(resolve => expired.push(resolve)));
  mount();
  // Three 10s observations plus the app's 1s and 2s retry backoffs.
  await act(async () => { await vi.advanceTimersByTimeAsync(34_000); });
  expect(screen.getByText('Không tải được báo cáo — thử lại sau.')).toBeInTheDocument();
  expect(screen.queryByText(/7\.654\.321/)).not.toBeInTheDocument();
  fixture.rpc.mockResolvedValue({ data: report(), error: null });
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(screen.getByText(/7\.654\.321/)).toBeInTheDocument();
  await act(async () => { for (const resolve of expired) resolve({ data: report(8888888), error: null }); });
  expect(screen.queryByText(/8\.888\.888/)).not.toBeInTheDocument();
  expect(screen.getByText(/7\.654\.321/)).toBeInTheDocument();
});

it('hides cached totals on malformed refresh and automatically recovers without zero fallback', async () => {
  vi.useFakeTimers();
  fixture.rpc.mockResolvedValue({ data: report(), error: null });
  mount();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByText(/7\.654\.321/)).toBeInTheDocument();
  fixture.rpc.mockResolvedValue({ data: { ...report(), byTable: [null] }, error: null });
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(screen.getByText('Không tải được báo cáo — thử lại sau.')).toBeInTheDocument();
  expect(screen.queryByText(/7\.654\.321/)).not.toBeInTheDocument();
  expect(screen.queryByText('Doanh thu (sau hoàn)')).not.toBeInTheDocument();
  fixture.rpc.mockResolvedValue({ data: report(6543210), error: null });
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(screen.getByText(/6\.543\.210/)).toBeInTheDocument();
  expect(screen.queryByText(/7\.654\.321/)).not.toBeInTheDocument();
});
