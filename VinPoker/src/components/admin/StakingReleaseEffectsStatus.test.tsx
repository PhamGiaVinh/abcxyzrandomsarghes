import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ actor: 'actor-a', rpc: vi.fn(), invoke: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: h.actor }, loading: false }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...args: unknown[]) => h.rpc(...args), functions: { invoke: (...args: unknown[]) => h.invoke(...args) } } }));
import { StakingReleaseEffectsStatus } from './StakingReleaseEffectsStatus';
const request = '11111111-1111-4111-8111-111111111111', deal = '33333333-3333-4333-8333-333333333333';
const status = { release_request_id: request, deal_id: deal, state: 'needs_attention', total: 3, delivered: 2,
  pending: 0, processing: 0, needs_attention: 1, evidence_missing: false };
beforeEach(() => { h.actor = 'actor-a';h.rpc.mockReset().mockResolvedValue({ data: status, error: null });h.invoke.mockReset(); });
it('shows durable held state rather than green completion and performs only a scoped read', async () => {
  render(<StakingReleaseEffectsStatus requestId={request} dealId={deal} />);
  await screen.findByText('Đã ghi sổ cái. Có thông báo/kết quả cần kiểm tra; không tự gửi lại.');
  expect(h.rpc).toHaveBeenCalledWith('get_staking_release_effect_status_v1', { p_request: request });
  expect(h.rpc).toHaveBeenCalledTimes(1);
});
it.each([{ ...status, release_request_id: 'wrong-request' }, { ...status, state: 'all_delivered' }, { ...status, delivered: 0 }])('rejects wrong identity/contradictory/incomplete counts', async data => {
  h.rpc.mockResolvedValue({ data, error: null });render(<StakingReleaseEffectsStatus requestId={request} dealId={deal} />);
  await screen.findByRole('alert');expect(screen.queryByText('Đã ghi sổ cái và xử lý xong thông báo/kết quả.')).toBeNull();
});
it('makes a rejected read retryable without executing any payment or delivery mutation', async () => {
  h.rpc.mockRejectedValueOnce(new Error('LOCAL NETWORK'));
  render(<StakingReleaseEffectsStatus requestId={request} dealId={deal} />);await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại trạng thái hậu xử lý' }));
  await screen.findByText('Đã ghi sổ cái. Có thông báo/kết quả cần kiểm tra; không tự gửi lại.');
  expect(h.rpc.mock.calls.every(([name]) => name === 'get_staking_release_effect_status_v1')).toBe(true);
});
it('ignores old account status while the new account read remains pending', async () => {
  let resolveOld!: (value: unknown) => void;
  h.rpc.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })).mockImplementation(() => new Promise(() => {}));
  const view = () => <StakingReleaseEffectsStatus requestId={request} dealId={deal} />;
  const mounted = render(view());h.actor = 'actor-b';mounted.rerender(view());
  await act(async () => resolveOld({ data: status, error: null }));
  expect(screen.queryByText('Đã ghi sổ cái. Có thông báo/kết quả cần kiểm tra; không tự gửi lại.')).toBeNull();
});
it('explicitly continues only pending work and displays the new validated summary', async () => {
  h.rpc.mockResolvedValue({ data: { ...status, state: 'pending', pending: 1, needs_attention: 0 }, error: null });
  h.invoke.mockResolvedValue({ data: { ok: true, release_request_id: request,
    delivery: { ...status, state: 'all_delivered', delivered: 3, needs_attention: 0 } }, error: null });
  render(<StakingReleaseEffectsStatus requestId={request} dealId={deal} />);
  await screen.findByText('Đã ghi sổ cái. Thông báo/kết quả còn chờ xử lý.');
  fireEvent.click(screen.getByRole('button', { name: 'Xử lý phần còn chờ' }));
  await screen.findByText('Đã ghi sổ cái và xử lý xong thông báo/kết quả.');
  expect(h.invoke).toHaveBeenCalledWith('staking-process-release-effects', { body: { release_request_id: request } });
});
it('does not double-submit continuation in the same event turn', async () => {
  h.rpc.mockResolvedValue({ data: { ...status, state: 'pending', pending: 1, needs_attention: 0 }, error: null });
  h.invoke.mockImplementation(() => new Promise(() => {}));
  render(<StakingReleaseEffectsStatus requestId={request} dealId={deal} />);
  const button = await screen.findByRole('button', { name: 'Xử lý phần còn chờ' });
  act(() => { button.dispatchEvent(new MouseEvent('click', { bubbles: true }));button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(h.invoke).toHaveBeenCalledTimes(1);
});
