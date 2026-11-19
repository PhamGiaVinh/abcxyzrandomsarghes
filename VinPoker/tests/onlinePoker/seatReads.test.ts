import { expect, it, vi } from 'vitest';
import { loadSeatsLive } from '@/lib/onlinePoker/client';

const mock = vi.hoisted(() => ({ seats: vi.fn(), profiles: vi.fn() }));
vi.mock('@/lib/onlinePoker/types', async original => ({ ...await original<typeof import('@/lib/onlinePoker/types')>(), RUNTIME_LIVE: true }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (table: string) => ({ select: () => table === 'profiles'
    ? { in: () => ({ abortSignal: mock.profiles }) } : { eq: () => ({ in: mock.seats }) } }) },
}));

it('distinguishes a real empty table from a failed seat read', async () => {
  mock.seats.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: { code: 'TEST' } });
  await expect(loadSeatsLive('table')).resolves.toEqual([]);
  await expect(loadSeatsLive('table')).rejects.toThrow('ONLINE_POKER_SEATS_UNAVAILABLE');
});

it('keeps occupied seats if optional player names cannot be read', async () => {
  mock.seats.mockResolvedValueOnce({ data: [{ seat_no: 1, user_id: 'seated', stack: '2000', status: 'sitting' }], error: null });
  mock.profiles.mockRejectedValueOnce(new Error('TEST name lookup'));
  await expect(loadSeatsLive('table')).resolves.toEqual([{ seatNo: 1, userId: 'seated', stack: '2000', status: 'sitting' }]);
});

it('returns verified seat positions when the profile lookup exceeds its deadline', async () => {
  vi.useFakeTimers();
  try {
    mock.seats.mockResolvedValueOnce({ data: [{ seat_no: 2, user_id: 'seated', stack: '1000', status: 'sitting' }], error: null });
    mock.profiles.mockImplementationOnce((signal: AbortSignal) => new Promise(resolve => {
      signal.addEventListener('abort', () => resolve({ data: null, error: 'cancelled' }), { once: true });
    }));
    const pending = loadSeatsLive('table');
    await vi.advanceTimersByTimeAsync(750);
    await expect(pending).resolves.toMatchObject([{ seatNo: 2, userId: 'seated' }]);
  } finally {
    vi.useRealTimers();
  }
});
