import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { stakingReleaseJournalKey } from '@/lib/stakingReleaseIntent';
const h = vi.hoisted(() => ({ actor: 'local-actor', rpc: vi.fn(), invoke: vi.fn(), done: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: h.actor }, loading: false }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('sonner', () => ({ toast: { success: h.success, error: h.error } }));
vi.mock('@/components/admin/CashierCounter', () => ({ default: () => null }));
vi.mock('@/components/admin/FeeConfigManager', () => ({ default: () => null }));
vi.mock('@/components/admin/FeeRevenueDashboard', () => ({ default: () => null }));
vi.mock('@/components/admin/TournamentRegistrationsTab', () => ({ TournamentRegistrationsTab: () => null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: (...args: unknown[]) => h.rpc(...args),
  functions: { invoke: (...args: unknown[]) => h.invoke(...args) },
  from: (table: string) => {
    const q = { select: () => q, eq: () => q, in: () => q,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'staking_purchases'
        ? [{ id: 'purchase-a', backer_id: 'backer-a', percent: 10 }]
        : [{ user_id: 'backer-a', display_name: 'LOCAL BACKER' }], error: null }).then(resolve),
    };return q;
  },
} }));
import { ExecuteReleaseModal, RequestReleaseModal } from './AdminStaking';
const request = '11111111-1111-4111-8111-111111111111';
const deal = '33333333-3333-4333-8333-333333333333';
const data = { req: { id: request }, deal: { id: deal, status: 'cosigned', result_prize_vnd: 1000000, platform_archive_fee: 199000, platform_fee_vnd: 199000 } } as ComponentProps<typeof ExecuteReleaseModal>['data'];
beforeEach(() => {
  localStorage.clear();
  h.actor = 'local-actor';
  h.rpc.mockReset().mockResolvedValue({ data: { deal_id: deal, preview_hash: 'a'.repeat(32), prize: 1000000, fee: 199000,
    distributable: 801000, backer_amount: 80100, player_amount: 720900, rows: [{
      purchase_id: '22222222-2222-4222-8222-222222222222', backer_id: '44444444-4444-4444-8444-444444444444',
      backer_name: 'LOCAL BACKER', percent: 10, vnd_value: 80100, bank_name: null, bank_account_number: null, bank_account_holder: null,
    }] }, error: null });
  h.invoke.mockReset().mockResolvedValue({ data: { success: true, status: 'completed', release_request_id: request, deal_id: deal,
    amounts: { backer: 80100, player: 720900, fee: 199000 } }, error: null });
  h.done.mockReset();h.success.mockReset();h.error.mockReset();
});
afterEach(() => vi.restoreAllMocks());
it('recovered execute receipt skips request/cosign even when one-step parent has no request ID', async () => {
  const receipt = await h.invoke();h.invoke.mockClear();h.invoke.mockResolvedValue({ data: null, error: { message: 'LOCAL EXECUTE LOST' } });
  const mounted = render(<ExecuteReleaseModal data={data} onClose={() => {}} onDone={h.done} />);
  await screen.findByText('LOCAL BACKER');for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã giải ngân' }));await waitFor(() => expect(h.error).toHaveBeenCalled());mounted.unmount();
  h.invoke.mockClear().mockResolvedValue(receipt);
  render(<ExecuteReleaseModal data={{ ...data!, req: { ...data!.req, id: '' }, deal: { ...data!.deal, status: 'completed' } }} onClose={() => {}} onDone={h.done} />);
  await screen.findByText('Khôi phục yêu cầu giải ngân chưa xác minh');fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã giải ngân' }));
  await waitFor(() => expect(h.done).toHaveBeenCalled());expect(h.invoke).toHaveBeenCalledTimes(1);expect(h.invoke.mock.calls[0][0]).toBe('staking-execute-release');
});
it('recovers frozen preparation after request response loss before its UUID is known', async () => {
  const receipt = await h.invoke();h.invoke.mockClear();
  h.invoke.mockResolvedValueOnce({ data: null, error: { message: 'LOCAL REQUEST RESPONSE LOST' } });
  const initial = { ...data!, req: { ...data!.req, id: '' }, deal: { ...data!.deal, status: 'result_verified' } };
  const mounted = render(<ExecuteReleaseModal data={initial} onClose={() => {}} onDone={h.done} />);
  await screen.findByText('LOCAL BACKER');for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã giải ngân' }));await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(screen.getByRole('combobox')).toBeDisabled();const sent = h.invoke.mock.calls[0][1];mounted.unmount();
  h.rpc.mockRejectedValue(new Error('fresh preview deliberately unavailable'));
  h.invoke.mockImplementation(async (name: string) => name === 'staking-request-release'
    ? { data: { success: true, release_request_id: request, status: 'release_requested' }, error: null }
    : name === 'staking-cosign-release' ? { data: { success: true, release_request_id: request, status: 'cosigned' }, error: null } : receipt);
  render(<ExecuteReleaseModal data={initial} onClose={() => {}} onDone={h.done} />);
  await screen.findByText('Khôi phục bước chuẩn bị giải ngân chưa xác minh');
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã giải ngân' }));await waitFor(() => expect(h.done).toHaveBeenCalledTimes(1));
  expect(h.rpc).toHaveBeenCalledTimes(1);expect(h.invoke.mock.calls[1][1]).toEqual(sent);
  expect(h.invoke.mock.calls.filter(([name]) => name === 'staking-execute-release')).toHaveLength(1);
  expect(localStorage.length).toBe(0);
});
it('request modal submits canonical net funded amounts, not gross advertised percentage', async () => {
  h.invoke.mockResolvedValue({ data: { success: true, release_request_id: request, status: 'release_requested' }, error: null });
  render(<RequestReleaseModal deal={{ ...data!.deal, percentage_sold: 50 } as ComponentProps<typeof RequestReleaseModal>['deal']} onClose={() => {}} onDone={h.done} />);
  await waitFor(() => expect(screen.getByLabelText('Backer nhận (VND)')).toHaveValue('80100'));
  expect(screen.getByLabelText('Player nhận (VND)')).toHaveValue('720900');
  const button = screen.getByRole('button', { name: 'Tạo yêu cầu' });
  act(() => { fireEvent.click(button);fireEvent.click(button); });
  await waitFor(() => expect(h.done).toHaveBeenCalledTimes(1));
  expect(h.invoke).toHaveBeenCalledTimes(1);
  expect(h.invoke.mock.calls[0]).toEqual(['staking-request-release', { body: { deal_id: deal, backer_amount: 80100, player_amount: 720900, note: null } }]);
});
it('request preview failure blocks submission and retries only the read', async () => {
  h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'LOCAL 503' } });
  render(<RequestReleaseModal deal={data!.deal} onClose={() => {}} onDone={h.done} />);
  await screen.findByRole('alert');expect(screen.getByRole('button', { name: 'Tạo yêu cầu' })).toBeDisabled();
  expect(h.invoke).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Tạo yêu cầu' })).toBeEnabled());
});
it('request modal rejects empty success and never finishes the next actor from an old response', async () => {
  let resolve!: (value: unknown) => void;
  h.invoke.mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = () => <RequestReleaseModal deal={data!.deal} onClose={() => {}} onDone={h.done} />;
  const mounted = render(view());await waitFor(() => expect(screen.getByRole('button', { name: 'Tạo yêu cầu' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Tạo yêu cầu' }));h.actor = 'next-actor';mounted.rerender(view());
  await act(async () => resolve({ data: { success: true, release_request_id: request, status: 'release_requested' }, error: null }));
  expect(h.done).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Tạo yêu cầu' })).toBeEnabled());
  h.invoke.mockResolvedValue({ data: {}, error: null });fireEvent.click(screen.getByRole('button', { name: 'Tạo yêu cầu' }));
  await waitFor(() => expect(h.error).toHaveBeenCalled());expect(h.done).not.toHaveBeenCalled();
});
it('recovers exact sent request after remount even when completed deal preview is unavailable', async () => {
  h.invoke.mockResolvedValue({ data: null, error: { message: 'LOCAL RESPONSE LOST' } });
  const mounted = render(<ExecuteReleaseModal data={data} onClose={() => {}} onDone={h.done} />);
  await screen.findByText('LOCAL BACKER');for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã giải ngân' }));await waitFor(() => expect(h.error).toHaveBeenCalled());
  const first = h.invoke.mock.calls[0][1];mounted.unmount();
  h.rpc.mockRejectedValue(new Error('completed preview unavailable'));
  render(<ExecuteReleaseModal data={data} onClose={() => {}} onDone={h.done} />);
  await screen.findByText('Khôi phục yêu cầu giải ngân chưa xác minh');
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã giải ngân' }));
  await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(2));
  expect(h.invoke.mock.calls[1][1]).toEqual(first);expect(h.rpc).toHaveBeenCalledTimes(1);
});
it('blocks execute before network I/O if intent cannot be saved', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('LOCAL QUOTA'); });
  fireEvent.click(await ready());
  await waitFor(() => expect(h.error).toHaveBeenCalled());expect(h.invoke).not.toHaveBeenCalled();
});
it('clears only the current actor journal after a matching completed receipt', async () => {
  const otherKey = stakingReleaseJournalKey('other-actor', deal);localStorage.setItem(otherKey, 'KEEP_OTHER_SCOPE');
  fireEvent.click(await ready());await waitFor(() => expect(h.done).toHaveBeenCalled());
  expect(localStorage.getItem(stakingReleaseJournalKey(h.actor, deal))).toBeNull();
  expect(localStorage.getItem(otherKey)).toBe('KEEP_OTHER_SCOPE');
});
it('blocks corrupt recovery without deleting its evidence or calling preview/execute', async () => {
  const key = stakingReleaseJournalKey(h.actor, deal);localStorage.setItem(key, 'CORRUPT_LOCAL_INTENT');
  render(<ExecuteReleaseModal data={data} onClose={() => {}} onDone={h.done} />);
  await screen.findByRole('alert');expect(screen.getByRole('button', { name: 'Xác nhận đã giải ngân' })).toBeDisabled();
  expect(h.rpc).not.toHaveBeenCalled();expect(h.invoke).not.toHaveBeenCalled();expect(localStorage.getItem(key)).toBe('CORRUPT_LOCAL_INTENT');
});
it('hides old account banking preview immediately after an actor change', async () => {
  const view = () => <ExecuteReleaseModal data={data} onClose={() => {}} onDone={h.done} />;
  const mounted = render(view());await screen.findByText('LOCAL BACKER');
  h.rpc.mockImplementation(() => new Promise(() => {}));h.actor = 'other-actor';mounted.rerender(view());
  expect(screen.queryByText('LOCAL BACKER')).toBeNull();
});
it('does not complete a new account modal from an old account execute response', async () => {
  let resolve!: (value: unknown) => void;
  const successful = await h.invoke();h.invoke.mockClear().mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = () => <ExecuteReleaseModal data={data} onClose={() => {}} onDone={h.done} />;
  const mounted = render(view());await screen.findByText('LOCAL BACKER');
  for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã giải ngân' }));
  h.actor = 'other-actor';mounted.rerender(view());await act(async () => resolve(successful));
  expect(h.done).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
});
it('freezes the exact sent payload after an unknown execute outcome', async () => {
  h.invoke.mockResolvedValue({ data: null, error: { message: 'LOCAL RESPONSE LOST' } });
  fireEvent.click(await ready());await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(screen.getByRole('combobox')).toBeDisabled();
  expect(screen.getAllByRole('checkbox').every(node => (node as HTMLInputElement).disabled)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã giải ngân' }));
  await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(2));
  expect(h.invoke.mock.calls[1][1]).toEqual(h.invoke.mock.calls[0][1]);
});
it('keeps the pending preview and intent across a same-deal parent refresh', async () => {
  h.invoke.mockResolvedValue({ data: null, error: { message: 'LOCAL RESPONSE LOST' } });
  const mounted = render(<ExecuteReleaseModal data={data} onClose={() => {}} onDone={h.done} />);
  await screen.findByText('LOCAL BACKER');for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã giải ngân' }));await waitFor(() => expect(h.error).toHaveBeenCalled());
  h.rpc.mockRejectedValue(new Error('completed deal no longer previewable'));
  mounted.rerender(<ExecuteReleaseModal data={{ ...data!, deal: { ...data!.deal } }} onClose={() => {}} onDone={h.done} />);
  expect(h.rpc).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Xác nhận đã giải ngân' })).not.toBeDisabled();
});
it('reuses a created one-step request after a cosign response failure', async () => {
  let cosigns = 0;
  h.invoke.mockImplementation(async (name: string) => {
    if (name === 'staking-request-release') return { data: { release_request_id: request }, error: null };
    if (name === 'staking-cosign-release') return ++cosigns === 1 ? { data: null, error: { message: 'COSIGN UNKNOWN' } } : { data: { success: true }, error: null };
    return { data: { success: true, status: 'completed', release_request_id: request, deal_id: deal,
      amounts: { backer: 80100, player: 720900, fee: 199000 } }, error: null };
  });
  render(<ExecuteReleaseModal data={{ ...data!, req: { ...data!.req, id: '' }, deal: { ...data!.deal, status: 'result_verified' } }} onClose={() => {}} onDone={h.done} />);
  await screen.findByText('LOCAL BACKER');for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
  const button = screen.getByRole('button', { name: 'Xác nhận đã giải ngân' });
  fireEvent.click(button);await waitFor(() => expect(h.error).toHaveBeenCalled());
  fireEvent.click(button);await waitFor(() => expect(h.done).toHaveBeenCalled());
  expect(h.invoke.mock.calls.filter(([name]) => name === 'staking-request-release')).toHaveLength(1);
  expect(h.invoke.mock.calls.filter(([name]) => name === 'staking-cosign-release')).toHaveLength(2);
});
async function ready() {
  render(<ExecuteReleaseModal data={data} onClose={() => {}} onDone={h.done} />);
  await screen.findByText('LOCAL BACKER');
  for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
  const button = screen.getByRole('button', { name: 'Xác nhận đã giải ngân' });
  await waitFor(() => expect(button).not.toBeDisabled());return button;
}
it('does not mark a malformed execute response as completed', async () => {
  h.invoke.mockResolvedValue({ data: {}, error: null });
  fireEvent.click(await ready());await waitFor(() => expect(h.invoke).toHaveBeenCalled());
  expect(h.done).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
});
it('sends one execute request for two same-tick confirmation events', async () => {
  h.invoke.mockImplementation(() => new Promise(() => {}));
  const button = await ready();
  act(() => { button.dispatchEvent(new MouseEvent('click', { bubbles: true }));button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(h.invoke).toHaveBeenCalledTimes(1);
});
it('uses the server override preview and carries its exact hash into execute', async () => {
  const response = await h.rpc();
  response.data.backer_amount = 333333;response.data.player_amount = 123456;response.data.rows[0].vnd_value = 333333;
  h.rpc.mockResolvedValue(response);
  fireEvent.click(await ready());
  await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('staking-execute-release', expect.objectContaining({
    body: expect.objectContaining({ preview_hash: 'a'.repeat(32) }),
  })));
  expect(h.rpc).toHaveBeenCalledWith('get_staking_release_preview_v1', { p_deal: deal });
});
it('blocks confirmation on server preview errors and allows explicit read retry', async () => {
  const success = await h.rpc();h.rpc.mockResolvedValueOnce({ data: null, error: { message: '503 LOCAL' } });
  render(<ExecuteReleaseModal data={data} onClose={() => {}} onDone={h.done} />);
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Xác nhận đã giải ngân' })).toBeDisabled();
  expect(h.invoke).not.toHaveBeenCalled();
  h.rpc.mockResolvedValue(success);fireEvent.click(screen.getByRole('button', { name: 'Thử tải lại bảng thanh toán' }));
  await screen.findByText('LOCAL BACKER');
});
