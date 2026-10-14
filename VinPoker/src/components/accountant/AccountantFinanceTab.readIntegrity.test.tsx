import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ error: {} as unknown }));
vi.mock('@/hooks/accountant/useFinanceSummaryRpcOnly', () => ({
  useFinanceSummaryRpcOnly: () => ({ isLoading: false, isError: true, error: fixture.error, data: undefined }),
}));
import { AccountantFinanceTab } from './AccountantFinanceTab';

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
