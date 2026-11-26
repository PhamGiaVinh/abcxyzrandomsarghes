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
