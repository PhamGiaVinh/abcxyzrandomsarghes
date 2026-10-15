import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlayerProfile from './PlayerProfile';

const fixture = vi.hoisted(() => ({
  actor: null as null | { id: string },
  projections: [] as string[],
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fixture.actor, isAdmin: false }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/BackButton', () => ({ BackButton: () => null }));
vi.mock('@/components/InterestDialog', () => ({ InterestDialog: () => null }));
vi.mock('@/components/PerformanceCard', () => ({ PerformanceCard: () => null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: (table: string) => {
    let projection = '';
    const query = {
      select: (columns: string) => { projection = columns; return query; },
      eq: () => query, gte: () => query, order: () => query, limit: () => query,
      maybeSingle: () => {
        if (table !== 'profiles') return Promise.resolve({ data: null, error: null });
        fixture.projections.push(projection);
        if (!fixture.actor && projection.split(',').includes('phone')) {
          return Promise.resolve({ data: null, error: { code: '42501' } });
        }
        return Promise.resolve({ data: {
          user_id: 'player', display_name: 'Public fixture player', region: 'TEST',
          ...(projection.includes('phone') ? { phone: 'FIXTURE PHONE' } : {}),
        }, error: null });
      },
      then: (resolve: (value: { data: never[]; error: null }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return query;
  },
} }));

const page = () => <MemoryRouter initialEntries={['/player/player']}
  future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
  <Routes><Route path="/player/:userId" element={<PlayerProfile />} /></Routes>
</MemoryRouter>;

describe('PlayerProfile public column boundary', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    fixture.actor = null;
    fixture.projections = [];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ profile: null }) }));
  });
  it('renders anonymous identity without requesting phone', async () => {
    render(page());
    expect(await screen.findByRole('heading', { name: 'Public fixture player' })).toBeInTheDocument();
    expect(fixture.projections).toEqual(['user_id,display_name,region,avatar_url']);
    expect(screen.queryByText('FIXTURE PHONE')).not.toBeInTheDocument();
  });
  it('preserves the existing authenticated projection, then drops phone after logout', async () => {
    fixture.actor = { id: 'viewer' };
    const view = render(page());
    await screen.findByRole('heading', { name: 'Public fixture player' });
    expect(fixture.projections.at(-1)).toContain('phone');
    await act(async () => { fixture.actor = null; view.rerender(page()); });
    await waitFor(() => expect(fixture.projections.at(-1)).toBe('user_id,display_name,region,avatar_url'));
    expect(await screen.findByRole('heading', { name: 'Public fixture player' })).toBeInTheDocument();
  });
});
