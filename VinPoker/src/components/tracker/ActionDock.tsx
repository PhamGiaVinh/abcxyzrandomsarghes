// PR-A — Tracker Racetrack Hand-Input UI: fixed bottom action dock.
// Emits ActionIntent upward per the AMOUNT CONTRACT in types.ts. Owns the
// ForcedAmountPad (open state) and the keyboard shortcuts. No legality logic.
import { useEffect, useRef, useState } from 'react';
import { formatChips, toBB, GTO_COLORS } from './constants';
import type { ActionDockProps, TrackerAction } from './types';
import { ForcedAmountPad } from './ForcedAmountPad';
import { acceptsTrackerShortcut } from './trackerShortcut';

const NUM = 'font-display tabular-nums';

function ActionButton({
  label,
  sub,
  color,
  hotkey,
  filled,
  disabled,
  onClick,
}: {
  label: string;
  sub?: string;
  color: string;
  hotkey: string;
  filled?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-action-key={hotkey}
      className="relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-xl border-2 text-base font-bold text-[hsl(var(--foreground))] transition-transform active:scale-95 disabled:opacity-40 disabled:active:scale-100 max-lg:landscape:min-h-[46px]"
      style={{ borderColor: color, background: filled ? `linear-gradient(180deg, ${color}60, ${color}22)` : `linear-gradient(180deg, ${color}26, #212728)` }}
    >
      <span className={`action-hotkey absolute right-2 top-1.5 text-[9px] opacity-50 ${NUM}`}>{hotkey}</span>
      {label}
      {sub && <span className={`text-[11px] font-medium opacity-85 ${NUM}`}>{sub}</span>}
    </button>
  );
}

export function ActionDock({ actingSeat, toCall, bigBlind, onIntent, onUndo, view, disabled = false }: ActionDockProps) {
  const [padOpen, setPadOpen] = useState(false);
  const dock = useRef<HTMLDivElement>(null);

  const committed = actingSeat?.committed ?? 0;
  const stack = actingSeat?.stack ?? 0;
  const isCheck = toCall <= 0;
  const wager = view ? (view.legal.bet ? 'bet' : 'raise') : (isCheck ? 'bet' : 'raise');
  const canWager = !disabled && (!view || view.legal[wager]);
  const canMatch = !disabled && (!view || view.legal[isCheck ? 'check' : 'call']);

  // Close the pad whenever the acting seat changes (auto-forward to the next seat).
  useEffect(() => {
    setPadOpen(false);
  }, [actingSeat?.playerId, actingSeat?.seatNumber, disabled, wager]);

  const emit = (action: TrackerAction, amount: number) => {
    if (!actingSeat || disabled || (view && !view.legal[action === 'all_in' ? 'allIn' : action])) return;
    onIntent({ seatNumber: actingSeat.seatNumber, action, amount });
  };

  const onFold = () => {
    setPadOpen(false);
    emit('fold', 0);
  };
  const onCallCheck = () => {
    setPadOpen(false);
    if (isCheck) emit('check', 0);
    else emit('call', committed + toCall); // TOTAL after call (contract)
  };
  const onAllIn = () => {
    setPadOpen(false);
    emit('all_in', committed + stack); // TOTAL after shoving everything (contract)
  };
  const onPadConfirm = (total: number) => {
    setPadOpen(false);
    emit(wager, total); // pad returns the TOTAL ("raise to")
  };

  // Keyboard shortcuts while the pad is CLOSED (the pad owns keys while open).
  useEffect(() => {
    if (padOpen || !actingSeat || disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!acceptsTrackerShortcut(e, dock.current)) return;
      const k = e.key.toLowerCase();
      if (k === 'f') onFold();
      else if (k === 'c') onCallCheck();
      else if (k === 'r' && canWager) setPadOpen(true);
      else if (k === 'a') onAllIn();
      else if (e.key === 'Backspace') {
        e.preventDefault();
        onUndo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!actingSeat) {
    return (
      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-center text-sm text-[hsl(var(--muted-foreground))]">
        Chưa có ghế tới lượt.
      </div>
    );
  }

  return (
    <div ref={dock} className="tracker-action-dock rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
      {/* Actor block */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[hsl(var(--primary))]">
            <span className={`text-xs font-bold text-[hsl(var(--primary))] ${NUM}`}>
              {actingSeat.name.slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-[hsl(var(--foreground))]">
              {actingSeat.name}
            </div>
            <div className={`text-[11px] text-[hsl(var(--muted-foreground))] ${NUM}`}>
              Ghế {actingSeat.seatNumber}
              {actingSeat.position ? ` · ${actingSeat.position}` : ''} · stack {formatChips(stack)} (
              {toBB(stack, bigBlind)} BB)
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
            Cần theo
          </div>
          <div className={`text-xl font-bold text-[hsl(var(--warning))] ${NUM}`}>
            {formatChips(toCall)}
          </div>
        </div>
      </div>

      {/* Action buttons — 2 cols under 380px (avoids squeeze on small phones), 4 in a
          row from 380px up. Pure responsive reflow: same buttons/handlers either way. */}
      <div className="grid grid-cols-2 min-[380px]:grid-cols-4 gap-2 min-[380px]:gap-2.5">
        <ActionButton label="BỎ BÀI" hotkey="F" color={GTO_COLORS.fold} disabled={disabled || view?.legal.fold === false} onClick={onFold} />
        <ActionButton
          label={isCheck ? 'CHECK' : 'THEO'}
          sub={isCheck ? undefined : formatChips(toCall)}
          hotkey="C"
          color={GTO_COLORS.call}
          disabled={!canMatch}
          onClick={onCallCheck}
        />
        <ActionButton
          label="TỐ"
          sub="nhập tổng →"
          hotkey="R"
          color={GTO_COLORS.raise}
          filled={padOpen}
          disabled={!canWager}
          onClick={() => setPadOpen(true)}
        />
        <ActionButton
          label="ALL-IN"
          sub={formatChips(committed + stack)}
          hotkey="A"
          color={GTO_COLORS.all_in}
          disabled={disabled || view?.legal.allIn === false}
          filled
          onClick={onAllIn}
        />
      </div>

      {/* Forced amount pad (inline) */}
      {padOpen && canWager && (
        <ForcedAmountPad
          stack={stack}
          committedThisStreet={committed}
          minTotal={view?.minRaiseTo ?? committed + toCall + bigBlind}
          enforceMinimum={Boolean(view)}
          onConfirm={onPadConfirm}
          onCancel={() => setPadOpen(false)}
        />
      )}

      {/* Undo — hotkey hints are desktop-only clutter on a touch screen; Undo itself
          always stays reachable at a real touch-target size on every width. */}
      <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
        <div className="tracker-keyboard-hints hidden flex-wrap sm:flex">
          <kbd className="rounded bg-[hsl(var(--secondary))] px-1.5 py-px">F</kbd>&nbsp;Bỏ{' '}
          <kbd className="rounded bg-[hsl(var(--secondary))] px-1.5 py-px">C</kbd>&nbsp;Theo{' '}
          <kbd className="rounded bg-[hsl(var(--secondary))] px-1.5 py-px">R</kbd>&nbsp;Tố{' '}
          <kbd className="rounded bg-[hsl(var(--secondary))] px-1.5 py-px">A</kbd>&nbsp;All-in{' '}
          <kbd className="rounded bg-[hsl(var(--secondary))] px-1.5 py-px">↵</kbd>&nbsp;Xác nhận{' '}
          <kbd className="rounded bg-[hsl(var(--secondary))] px-1.5 py-px">⌫</kbd>&nbsp;Undo
        </div>
        <button
          type="button"
          onClick={onUndo}
          disabled={disabled}
          className="min-h-[44px] flex-1 rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 font-semibold hover:border-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive))] sm:min-h-0 sm:flex-none max-lg:landscape:min-h-[38px]"
        >
          ↶ Hoàn tác
        </button>
      </div>
    </div>
  );
}
