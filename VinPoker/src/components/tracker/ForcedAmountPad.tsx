// PR-A — Tracker Racetrack Hand-Input UI: forced numpad for the TOTAL ("raise to").
// Forces manual entry so the seat's end-of-hand stack can't drift. Rendered only
// while open (ActionDock mounts it conditionally), so its key listener is live only
// then. Decides nothing about legality — the server is the source of truth.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatChips } from './constants';
import type { ForcedAmountPadProps } from './types';
import { acceptsTrackerShortcut } from './trackerShortcut';

const NUM = 'font-display tabular-nums';
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'del'] as const;

export function ForcedAmountPad({
  stack,
  committedThisStreet,
  minTotal,
  enforceMinimum = false,
  onConfirm,
  onCancel,
}: ForcedAmountPadProps) {
  const [entered, setEntered] = useState(0);
  const pad = useRef<HTMLDivElement>(null);

  // total = the street total AFTER the action ("raise to"). Chips leaving the
  // stack = total - already-committed. Remaining = stack - that delta.
  const delta = entered - committedThisStreet;
  const remaining = stack - delta;
  const overStack = delta > stack; // typed more than this seat physically has left
  const valid = entered > committedThisStreet && !overStack; // must raise over what's in, within stack
  // BUGFIX: strict < — entering EXACTLY the minimum raise-to (e.g. 400k over a 200k BB)
  // is a LEGAL min-raise and must not trigger the "dưới mức tố tối thiểu" warning.
  const belowMin = valid && minTotal != null && entered < minTotal; // soft typo warning
  const canConfirm = valid && !(enforceMinimum && belowMin);

  const press = (k: string) => {
    setEntered((prev) => {
      if (k === 'del') return Math.floor(prev / 10);
      if (k === '000') return Math.min(prev * 1000, 999_999_999);
      return Math.min(prev * 10 + parseInt(k, 10), 999_999_999);
    });
  };

  const confirm = () => {
    if (canConfirm) onConfirm(entered);
  };

  // Own keyboard while mounted: digits feed the pad, Enter confirms, Esc/Backspace edit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!acceptsTrackerShortcut(e, pad.current?.parentElement ?? null)) return;
      if (/^[0-9]$/.test(e.key)) {
        press(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        press('del');
      } else if (e.key === 'Enter') {
        if (e.target instanceof Element && e.target.closest('button, a[href]')) return;
        e.preventDefault();
        if (canConfirm) onConfirm(entered);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entered, canConfirm, onConfirm, onCancel]);

  return (
    <div ref={pad} className="mt-2.5 rounded-xl border-2 border-[hsl(var(--destructive))] bg-[hsl(var(--card))] p-3">
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div className="max-w-[55%] text-xs text-[hsl(var(--muted-foreground))]">
          Nhập <b className="text-[hsl(var(--destructive))]">TỔNG chip tố tới</b> (raise to — không
          phải phần thêm). Bắt buộc gõ tay để stack cuối hand không sai.
        </div>
        <div className="text-right">
          <div
            className={`text-[30px] font-bold leading-none ${NUM} ${
              entered === 0 ? 'text-[hsl(var(--muted-foreground))]' : 'text-[hsl(var(--primary))]'
            }`}
          >
            {formatChips(entered)}
          </div>
          <div
            className={`mt-1 text-[11px] ${
              overStack ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--muted-foreground))]'
            }`}
          >
            stack còn lại:{' '}
            <b className={NUM}>{overStack ? 'VƯỢT STACK' : formatChips(remaining)}</b>
          </div>
          {belowMin && (
            <div className="mt-0.5 text-[11px] text-[hsl(var(--warning))]">
              ⚠ dưới mức tố tối thiểu (kiểm tra lại)
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            className={`min-h-[54px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-2xl font-bold transition-transform hover:bg-[hsl(var(--secondary))] active:scale-95 ${NUM}`}
          >
            {k === 'del' ? '⌫' : k}
          </button>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-[1fr_1.6fr] gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="min-h-[50px] text-[hsl(var(--muted-foreground))]"
        >
          Huỷ
        </Button>
        <button
          type="button"
          disabled={!canConfirm}
          onClick={confirm}
          className="min-h-[50px] rounded-lg bg-[hsl(var(--primary))] text-base font-bold text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary-glow))] disabled:cursor-not-allowed disabled:bg-[hsl(var(--secondary))] disabled:text-[hsl(var(--muted-foreground))]"
        >
          {entered <= committedThisStreet
            ? 'Nhập tổng để xác nhận'
            : overStack
              ? 'Số vượt stack'
              : `Xác nhận TỐ lên ${formatChips(entered)} →`}
        </button>
      </div>
    </div>
  );
}
