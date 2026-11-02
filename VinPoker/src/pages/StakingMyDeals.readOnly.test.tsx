import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ read: vi.fn(), remove: vi.fn(), user: { id: 'local-player' } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: h.user, loading: false }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }), Trans: () => null }));
vi.mock('@/components/PlayerCheckInQR', () => ({ PlayerCheckInQR: () => null }));
vi.mock('@/components/RatingDialog', () => ({ RatingDialog: () => null }));
vi.mock('@/components/ResultQRDialog', () => ({ ResultQRDialog: () => null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: (table: string) => {
    let removing = false;
    const q = {
      select: () => q, eq: () => q, in: () => q, is: () => q, order: () => q,
      delete: () => { removing = true; h.remove(table); return q; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve(removing ? { data: null, error: null } : h.read(table)).then(resolve, reject),
    };
    return q;
  },
  channel: () => { const c = { on: () => c, subscribe: () => c }; return c; },
  removeChannel: vi.fn(),
} }));

import MyDeals from './StakingMyDeals';

beforeEach(() => {
  h.user = { id: 'local-player' };
  h.remove.mockReset();
  h.read.mockReset().mockImplementation((table: string) => ({ data: table === 'staking_deals' ? [{
    id: 'expired-listing', player_id: h.user.id, status: 'listing', backer_id: null,
    filled_percent: 0, registration_deadline: '2000-01-01T00:00:00Z',
    tournament_id: null,
  }] : [], error: null }));
});

const privateDeal = {
  id: 'private-listing', player_id: 'local-player', status: 'listing', backer_id: null,
  filled_percent: 0, tournament_id: null, custom_event_name: 'PRIVATE OLD DEAL',
  buy_in_amount_vnd: 100000, percentage_sold: 10, markup: 1,
};

it('hides the previous account listing immediately while the next account loads', async () => {
  h.read.mockImplementation((table: string) => ({ data: table === 'staking_deals' ? [privateDeal] : [], error: null }));
  const view = () => <MemoryRouter><MyDeals /></MemoryRouter>;
  const mounted = render(view());
  await screen.findByText('PRIVATE OLD DEAL');
  h.read.mockImplementation(() => new Promise(() => {}));
  h.user = { id: 'new-player' };
  mounted.rerender(view());
  expect(screen.queryByText('PRIVATE OLD DEAL')).toBeNull();
});

it('ignores an old account response arriving after the new account empty result', async () => {
  let resolveOld!: (value: unknown) => void;
  const old = new Promise(resolve => { resolveOld = resolve; });
  h.read.mockReturnValueOnce(old).mockReturnValue({ data: [], error: null });
  const view = () => <MemoryRouter><MyDeals /></MemoryRouter>;
  const mounted = render(view());
  await waitFor(() => expect(h.read).toHaveBeenCalledWith('staking_deals'));
  h.user = { id: 'new-player' };
  mounted.rerender(view());
  await screen.findByText('myDeals.emptyA');
  await act(async () => resolveOld({ data: [privateDeal], error: null }));
  expect(screen.queryByText('PRIVATE OLD DEAL')).toBeNull();
});

it('opening the read page never deletes an expired listing or its history', async () => {
  render(<MemoryRouter><MyDeals /></MemoryRouter>);
  await screen.findByText('myDeals.emptyA');
  await waitFor(() => expect(h.read).toHaveBeenCalledWith('deal_ratings'));
  expect(h.remove).not.toHaveBeenCalled();
});

it.each(['primary', 'ratings', 'rejection'])('shows a recoverable error rather than empty for %s failure', async (failure) => {
  h.read.mockImplementation((table: string) => {
    if (failure === 'rejection') return Promise.reject(new Error('LOCAL NETWORK'));
    if ((failure === 'primary' && table === 'staking_deals') || (failure === 'ratings' && table === 'deal_ratings')) {
      return { data: null, error: { message: '503 LOCAL' } };
    }
    return { data: table === 'staking_deals' ? [privateDeal] : [], error: null };
  });
  render(<MemoryRouter><MyDeals /></MemoryRouter>);
  await screen.findByRole('alert');
  expect(screen.queryByText('myDeals.emptyA')).toBeNull();
  expect(screen.queryByText('PRIVATE OLD DEAL')).toBeNull();
  h.read.mockReturnValue({ data: [], error: null });
  fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại deal' }));
  await screen.findByText('myDeals.emptyA');
  expect(screen.queryByRole('alert')).toBeNull();
});
