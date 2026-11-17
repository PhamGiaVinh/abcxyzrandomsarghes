import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import i18n from '@/i18n';
import OwnerAssistantPanel from './OwnerAssistantPanel';
import { askOwnerAssistant } from './ownerAssistantRead';
import type { AssistantRead } from './ownerAssistantRead';
vi.mock('./OwnerBankFeed', () => ({ default: () => null }));
vi.mock('./ownerAssistantRead', () => ({ askOwnerAssistant: vi.fn() }));
const ask = vi.mocked(askOwnerAssistant);
const base = { client: {} as never, clubId: 'club-a', clubName: 'Center Point', actorId: 'owner', sessionToken: 'session-test' };
const answer: AssistantRead = { question: 'thu chi', plan: { intent: 'cashflow', from: '2026-11-01', to: '2026-11-17', search: null }, evidence: { source: 'sepay-api-v2', accountLast4: '5678', from: '2026-11-01', to: '2026-11-17', fetchedAt: '2026-11-17T01:00:00Z', complete: true, transactions: [], totals: { incoming: 500000, outgoing: 100000, net: 400000, countIn: 1, countOut: 1, withoutCode: 1 } } };
beforeEach(async () => { vi.clearAllMocks(); await i18n.changeLanguage('vi'); });
describe('owner financial assistant UI', () => {
  it('waits for an explicit question and requires one selected club', () => {
    render(<OwnerAssistantPanel {...base} clubId={null} />);
    expect(ask).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Gửi câu hỏi' })).toBeDisabled();
  });
  it('suppresses double submit and shows source-backed figures', async () => {
    let resolve!: (value: AssistantRead) => void;
    ask.mockImplementation(() => new Promise(r => { resolve = r; }));
    render(<OwnerAssistantPanel {...base} />);
    fireEvent.change(screen.getByLabelText('Bạn muốn kiểm tra điều gì?'), { target: { value: 'thu chi' } });
    const button = screen.getByRole('button', { name: 'Gửi câu hỏi' });
    fireEvent.click(button); fireEvent.click(button);
    expect(ask).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(answer); });
    expect(screen.getByText('500.000 ₫')).toBeInTheDocument(); expect(screen.getByText(/5678/)).toBeInTheDocument();
    expect(screen.getByText(/không đồng nghĩa doanh thu/)).toBeInTheDocument();
  });
  it('aborts old club request and ignores its late reply', async () => {
    let resolve!: (value: AssistantRead) => void;
    ask.mockImplementation(() => new Promise(r => { resolve = r; }));
    const view = render(<OwnerAssistantPanel {...base} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thu chi tháng này thế nào?' }));
    const signal = ask.mock.calls[0][3];
    view.rerender(<OwnerAssistantPanel {...base} clubId="club-b" clubName="Other club" />);
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve(answer); });
    expect(screen.queryByText('500.000 ₫')).not.toBeInTheDocument();
  });
  it('explains free quota and never schedules polling or automatic retries', async () => {
    ask.mockRejectedValue(new Error('FREE_QUOTA_EXHAUSTED'));
    render(<OwnerAssistantPanel {...base} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thu chi tháng này thế nào?' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('không chuyển sang trả phí'));
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
