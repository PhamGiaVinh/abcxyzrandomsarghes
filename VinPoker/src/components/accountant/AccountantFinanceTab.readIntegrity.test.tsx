import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const fixture = vi.hoisted(() => ({ error: {} as unknown, read:vi.fn() }));
vi.mock('@/hooks/accountant/useFinanceSummaryRpcOnly', () => ({
  useFinanceSummaryRpcOnly: (...args:unknown[]) => {fixture.read(...args);return { isLoading: false, isError: true, error: fixture.error, data: undefined };},
}));
import { AccountantFinanceTab } from './AccountantFinanceTab';
afterEach(()=>{cleanup();vi.useRealTimers();vi.clearAllMocks();});

describe('accountant financial error presentation', () => {
  beforeEach(() => { fixture.error = {}; });
  it('does not claim a network failure proves missing club permission', () => {
    fixture.error = new TypeError('Failed to fetch');
    render(<AccountantFinanceTab clubId="club-test" />);
    expect(screen.getByRole('alert')).toHaveTextContent('kiểm tra kết nối');
    expect(screen.getByRole('alert')).not.toHaveTextContent('chưa có quyền');
    expect(screen.getByRole('alert')).not.toHaveTextContent('20261236000000');
  });
  it('shows permission denial only for an explicit server denial', () => {
    fixture.error = { code: '42501', message: 'denied' };
    render(<AccountantFinanceTab clubId="club-test" />);
    expect(screen.getByRole('alert')).toHaveTextContent('chưa có quyền');
  });
  it('keeps malformed successful data distinct from both zero balances and access denial', () => {
    fixture.error = new Error('FINANCE_SUMMARY_INVALID: net');
    render(<AccountantFinanceTab clubId="club-test" />);
    expect(screen.getByRole('alert')).toHaveTextContent('không hợp lệ');
    expect(screen.queryByText('Tổng thu')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).not.toHaveTextContent('chưa có quyền');
  });
});
it.each([
 ['2027-01-01T00:00:00+07:00','2027-01-01','2027-01-31'],
 ['2024-02-29T00:01:00+07:00','2024-02-01','2024-02-29'],
 ['2026-10-24T12:00:00+07:00','2026-10-01','2026-10-31'],
])('queries the complete UTC+7 calendar month at %s',(now,from,to)=>{
 vi.useFakeTimers();vi.setSystemTime(new Date(now));render(<AccountantFinanceTab clubId="club-test"/>);
 expect(fixture.read).toHaveBeenLastCalledWith('club-test',from,to);
});
it('moves across year and leap-month boundaries using inclusive calendar dates',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2024-03-01T00:01:00+07:00'));
 render(<AccountantFinanceTab clubId="club-test"/>);
 fireEvent.click(screen.getByRole('button',{name:'Tháng trước'}));
 expect(fixture.read).toHaveBeenLastCalledWith('club-test','2024-02-01','2024-02-29');
});
