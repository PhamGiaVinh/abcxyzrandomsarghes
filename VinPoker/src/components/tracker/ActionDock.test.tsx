import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ActionDock } from './ActionDock';
import type { ActionDockProps } from './types';

afterEach(cleanup);

function bigBlindOption(): ActionDockProps {
  return {
    actingSeat: { seatNumber: 3, name: 'Hà', stack: 2000, committed: 100 }, toCall: 0, bigBlind: 100,
    view: { toCall: 0, minRaiseTo: 200, legal: { check: true, call: false, raise: true, bet: false, allIn: true, fold: false } },
    onIntent: vi.fn(), onUndo: vi.fn(),
  };
}

it('uses the engine BB option, minimum raise and disabled actions for both touch and keyboard', () => {
  const props = bigBlindOption();
  render(<ActionDock {...props} />);
  expect(screen.getByRole('button', { name: /BỎ BÀI/ }).hasAttribute('disabled')).toBe(true);
  fireEvent.keyDown(document.body, { key: 'f' });
  fireEvent.click(screen.getByRole('button', { name: /nhập tổng/ }));
  for (const key of '150') fireEvent.keyDown(document.body, { key });
  fireEvent.keyDown(document.body, { key: 'Enter' });
  expect(props.onIntent).not.toHaveBeenCalled();
  for (const key of ['Backspace', 'Backspace', 'Backspace', '2', '0', '0', 'Enter']) fireEvent.keyDown(document.body, { key });
  expect(props.onIntent).toHaveBeenCalledExactlyOnceWith({ seatNumber: 3, action: 'raise', amount: 200 });
});

it('leaves input and Enter on other dealer controls to their owner, and blocks writes while busy', () => {
  const props = bigBlindOption();
  const controls = (busy: boolean) => <><input aria-label="Mic" /><button>Reset đồng hồ</button><ActionDock {...props} disabled={busy} /></>;
  const { rerender } = render(controls(false));
  const input = screen.getByRole('textbox');
  for (const key of ['c', 'f', 'a', 'Backspace']) fireEvent.keyDown(input, { key });
  fireEvent.keyDown(document.body, { key: 'r' });
  for (const key of '200') fireEvent.keyDown(document.body, { key });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Reset đồng hồ' }), { key: 'Enter' });
  rerender(controls(true));
  fireEvent.keyDown(document.body, { key: 'Enter' });
  fireEvent.keyDown(document.body, { key: 'c' });
  expect(props.onUndo).not.toHaveBeenCalled();
  expect(props.onIntent).not.toHaveBeenCalled();
});
