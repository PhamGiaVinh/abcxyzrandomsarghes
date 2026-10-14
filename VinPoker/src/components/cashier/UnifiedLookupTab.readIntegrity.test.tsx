import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ invoke: vi.fn(), failProfiles: false, actor: 'cashier-test' }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: fixture.invoke },
  from: (table: string) => {
    const result = table === 'profiles'
      ? fixture.failProfiles ? { data: null, error: { message: '503' } } : { data: [{ user_id: 'player-test', display_name: 'TEST Player' }], error: null }
      : { data: [], error: null };
    const query: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    for (const method of ['select', 'in', 'or', 'limit', 'eq', 'order']) query[method] = () => query;
    return query;
  },
} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: fixture.actor }, session: { access_token: `TEST_SESSION_${fixture.actor}` }, loading: false }) }));
import UnifiedLookupTab from './UnifiedLookupTab';
const props = { clubIds: ['club-a'], clubs: [{ id: 'club-a', name: 'Club TEST' }] };
const view = (clubIds = props.clubIds) => <MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><UnifiedLookupTab {...props} clubIds={clubIds} /></MemoryRouter>;
function search() {
  const input = screen.getByPlaceholderText('Tên / SĐT / Mã thẻ / CCCD');
  fireEvent.change(input, { target: { value: 'TEST' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}
describe('unified cashier lookup read integrity', () => {
  beforeEach(() => { fixture.failProfiles = false; fixture.actor = 'cashier-test'; fixture.invoke.mockReset(); });
  it('shows an Edge lookup failure as unavailable rather than a verified no-deal result', async () => {
    fixture.invoke.mockResolvedValue({ data: null, error: { message: '503' } });
    render(view()); search();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Không tải đủ'));
    expect(screen.queryByRole('button', { name: 'Check-in', exact: true })).not.toBeInTheDocument();
  });
  it('does not show a failed primary profile read as no members found', async () => {
    fixture.failProfiles = true;
    render(view()); search();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Không tải được'));
    expect(screen.queryByText('Không tìm thấy thành viên')).not.toBeInTheDocument();
  });
  it('masks old results immediately on club change and fences a late detail response', async () => {
    let resolve!:(value: unknown) => void;
    fixture.invoke.mockReturnValue(new Promise(done => { resolve = done; }));
    const { rerender } = render(view()); search();
    await waitFor(() => expect(fixture.invoke).toHaveBeenCalledTimes(1));
    rerender(view(['club-b']));
    expect(screen.queryByText('TEST Player')).not.toBeInTheDocument();
    await act(async () => resolve({ data: { deals: [{ deal_id: 'stale', title: 'OLD DEAL', status: 'funded' }] }, error: null }));
    expect(screen.queryByText('OLD DEAL')).not.toBeInTheDocument();
  });
  it('masks a previously completed result immediately when its club scope changes', async () => {
    fixture.invoke.mockResolvedValue({ data: { deals: [] }, error: null });
    const { rerender } = render(view()); search();
    await waitFor(() => expect(screen.getByText('TEST Player')).toBeInTheDocument());
    rerender(view(['club-b']));
    expect(screen.queryByText('TEST Player')).not.toBeInTheDocument();
  });
  it('turns a rejected detail request into an explicit retryable error', async () => {
    fixture.invoke.mockRejectedValue(new TypeError('Failed to fetch'));
    render(view()); search();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Không tải đủ'));
    expect(screen.getByRole('button', { name: 'Tìm kiếm' })).toBeEnabled();
  });
  it('does not retain a previous actor result when club IDs remain the same', async () => {
    fixture.invoke.mockResolvedValue({ data: { deals: [] }, error: null });
    const { rerender } = render(view()); search();
    await waitFor(() => expect(screen.getByText('TEST Player')).toBeInTheDocument());
    fixture.actor = 'cashier-other'; rerender(view());
    expect(screen.queryByText('TEST Player')).not.toBeInTheDocument();
  });
});
