import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DealerShiftReviewList } from './DealerShiftReviewList';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc } }));
const range = { from: '2026-11-01', to: '2026-11-30' };
describe('đối chiếu công Swing', () => {
  it('shows an administratively closed shift with an unknown checkout and missing table', async () => {
    rpc.mockResolvedValueOnce({ data: [{
      attendance_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', dealer_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      dealer_name: 'Dealer TEST', shift_date: '2026-11-03', checked_in_at: '2026-11-03T02:00:00Z',
      checked_out_at: null, table_name: null, reason: 'Thiếu giờ ra',
    }], error: null });
    render(<DealerShiftReviewList club="club-a" {...range} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đối chiếu công từ Swing' }));
    expect(await screen.findByText('Dealer TEST')).toBeVisible();
    expect(screen.getByText(/Giờ ra: Chưa xác định/)).toBeVisible();
    expect(rpc).toHaveBeenCalledWith('list_dealer_shift_payroll_reviews_v1', { p_club: 'club-a', p_from: range.from, p_to: range.to });
  });
  it('distinguishes a failed read from a verified empty list', async () => {
    rpc.mockResolvedValueOnce({ error: {message: 'forbidden'} }).mockResolvedValueOnce({ data: [], error: null });
    render(<DealerShiftReviewList club="club-a" {...range} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đối chiếu công từ Swing' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }));
    expect(await screen.findByText('Không có ca đã đóng cần đối chiếu trong kỳ này.')).toBeVisible();
  });
});

it("requires evidence before approving and refreshes the selected club's queue", async () => {
  const row = {
    id: '11111111-1111-4111-8111-111111111111', dealer_name: 'Dealer correction TEST', shift_date: '2026-11-03',
    original_check_in: null, original_check_out: null,
    proposed_check_in: '2026-11-03T03:00:00Z', proposed_check_out: '2026-11-03T05:00:00Z',
    reason: 'Clock record', status: 'pending', decision_reason: null, can_decide: true,
  };
  rpc.mockReset()
    .mockResolvedValueOnce({ data: [], error: null })
    .mockResolvedValueOnce({ data: [row], error: null })
    .mockResolvedValueOnce({ data: 'approved', error: null })
    .mockResolvedValueOnce({ data: [{ ...row, status: 'approved', can_decide: false, decision_reason: 'Đã đối chiếu' }], error: null });
  render(<DealerShiftReviewList club="club-a" {...range} />);
  fireEvent.click(screen.getByRole('button', { name: 'Đối chiếu công từ Swing' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xem đề nghị sửa công' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Xem xét đề nghị' }));
  const approve = screen.getByRole('button', { name: 'Duyệt', exact: true });
  expect(approve).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Lý do quyết định'), { target: { value: 'Đã đối chiếu' } });
  fireEvent.click(approve);
  expect(await screen.findByText(/Lý do quyết định: Đã đối chiếu/)).toBeVisible();
  expect(rpc).toHaveBeenCalledWith('decide_dealer_shift_payroll_correction_v1', {
    p_club: 'club-a', p_correction: row.id, p_approve: true, p_reason: 'Đã đối chiếu',
  });
});

it("submits corrected club times against the attendance revision it loaded", async () => {
  const attendance = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const updated = '2026-11-03T03:00:00Z';
  rpc.mockReset()
    .mockResolvedValueOnce({ data: [{
      attendance_id: attendance, dealer_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      dealer_name: 'Dealer TEST', shift_date: '2026-11-03', checked_in_at: updated,
      checked_out_at: null, table_name: null, reason: 'Thiếu giờ ra',
    }], error: null })
    .mockResolvedValueOnce({ data: { updated_at: updated, check_in: updated, check_out: null }, error: null })
    .mockResolvedValueOnce({ data: '11111111-1111-4111-8111-111111111111', error: null });
  render(<DealerShiftReviewList club="club-a" {...range} />);
  fireEvent.click(screen.getByRole('button', { name: 'Đối chiếu công từ Swing' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Lập đề nghị sửa công' }));
  fireEvent.change(await screen.findByLabelText('Giờ vào đề nghị (giờ CLB)'), { target: { value: '2026-11-03T10:00' } });
  fireEvent.change(screen.getByLabelText('Giờ ra đề nghị (giờ CLB)'), { target: { value: '2026-11-03T12:00' } });
  const send = screen.getByRole('button', { name: 'Gửi chủ CLB duyệt' });
  expect(send).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Căn cứ sửa công'), { target: { value: 'Đối chiếu sổ ca' } });
  fireEvent.click(send);
  expect(await screen.findByText('Đã gửi đề nghị để chủ CLB duyệt.')).toBeVisible();
  expect(rpc).toHaveBeenCalledWith('propose_dealer_shift_payroll_correction_v1', {
    p_club: 'club-a', p_attendance: attendance, p_expected_updated_at: updated,
    p_check_in: '2026-11-03T10:00+07:00', p_check_out: '2026-11-03T12:00+07:00', p_reason: 'Đối chiếu sổ ca',
  });
});
