// Viewer sync status (engine mode) — PURE UI state. Tells the operator whether
// the last persist reached the live viewer: idle → nothing affirmative; sending →
// "Đang gửi…"; sent → "Đã gửi lên viewer" + what was sent; error → the supplied
// failure reason (or a generic fallback). It reads ONLY phase/label derived from the same
// success/error they handle — it NEVER changes any persist payload, the order of
// the optimistic update vs. the network call vs. rollback, or action_amount.

import { Radio, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { useEffect, useRef } from 'react';

export type SyncPhase = "idle" | "sending" | "sent" | "error" | "uncertain";

interface ViewerSyncStatusProps {
  phase: SyncPhase;
  lastLabel: string | null;
  onReload?: () => void;
}

export function ViewerSyncStatus({ phase, lastLabel, onReload }: ViewerSyncStatusProps) {
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase === 'error' || phase === 'uncertain') errorRef.current?.focus();
  }, [phase, lastLabel]);
  if (phase === "sending") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-300" role="status" aria-live="polite">
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
        <span className="font-medium">Đang gửi lên viewer…</span>
      </div>
    );
  }

  if (phase === "sent") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-emerald-600/40 bg-emerald-950/30 text-[11px] text-emerald-300" role="status" aria-live="polite">
        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="font-medium">Đã gửi lên viewer</span>
        {lastLabel && <span className="text-emerald-300/70">· {lastLabel}</span>}
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div ref={errorRef} tabIndex={-1} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-600/50 bg-red-950/30 text-[11px] text-red-300" role="alert">
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="font-medium">{lastLabel || "Lỗi gửi — vui lòng thử lại"}</span>
      </div>
    );
  }

  if (phase === "uncertain") {
    return (
      <div ref={errorRef} tabIndex={-1} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-600/50 bg-red-950/30 text-[11px] text-red-300" role="alert">
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="font-medium">Chua xac minh duoc server - khong thao tac tiep</span>
        {onReload && (
          <button type="button" onClick={onReload} className="rounded border border-red-400/60 px-2 py-0.5 font-semibold hover:bg-red-500/15">
            Tai lai
          </button>
        )}
      </div>
    );
  }

  // idle — neutral, no affirmative "sent" claim
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/30 bg-card text-[11px] text-muted-foreground">
      <Radio className="w-3.5 h-3.5" aria-hidden="true" />
      <span>Sẵn sàng đồng bộ viewer</span>
    </div>
  );
}
