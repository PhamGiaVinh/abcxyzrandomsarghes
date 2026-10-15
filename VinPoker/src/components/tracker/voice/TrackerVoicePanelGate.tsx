import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

import type { StandaloneHandInput } from "@/components/cashier/tournament-live/handinput/useStandaloneHandInput";
import { Button } from "@/components/ui/button";
import { loadTrackerVoiceRuntimeContext, type TrackerVoiceRuntimeContext } from "@/lib/trackerVoice";
import { isTrackerVoiceUiEnabled } from "@/lib/trackerVoice/uiGate";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";

import { TrackerVoicePanel } from "./TrackerVoicePanel";

/**
 * The build flag only enables this read-only server gate. The server remains
 * authoritative for the exact table, active dealer assignment, and Voice mode.
 */
export function TrackerVoicePanelGate({ hook, compact = false }: { hook: StandaloneHandInput; compact?: boolean }) {
  const [runtime, setRuntime] = useState<TrackerVoiceRuntimeContext | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setRuntime(null);
    setErrorCode(null);

    if (!hook.tournamentTableId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const nextRuntime = await waitForManualPlayerResponse(loadTrackerVoiceRuntimeContext(
        hook.tournamentId,
        hook.tournamentTableId,
      ));
      if (requestId !== requestSequence.current) return;
      setRuntime(nextRuntime);
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      setErrorCode(error instanceof Error ? error.message : "unknown");
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [hook.tournamentId, hook.tournamentTableId]);

  useEffect(() => {
    void refresh();
    const refreshOnFocus = () => void refresh();
    window.addEventListener("focus", refreshOnFocus);

    return () => {
      requestSequence.current += 1;
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [refresh]);

  if (isTrackerVoiceUiEnabled(runtime)) {
    return <TrackerVoicePanel hook={hook} compact={compact} />;
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-300/20 p-4 text-xs text-amber-100/80">
      <p>{loading ? "Đang kiểm tra quyền Voice…" : trackerVoiceUnavailableMessage(errorCode)}</p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 shrink-0 border-amber-200/30 bg-transparent text-amber-50 hover:bg-amber-200/10 hover:text-amber-50"
        disabled={loading}
        onClick={() => void refresh()}
      >
        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        Thử lại
      </Button>
    </div>
  );
}

export function trackerVoiceUnavailableMessage(errorCode: string | null): string {
  switch (errorCode) {
    case "dealer_assignment_missing":
      return "Tài khoản này không phải Dealer đang được phân công cho bàn.";
    case "dealer_assignment_ambiguous":
      return "Bàn đang có nhiều phân công Dealer. Floor cần giữ lại đúng một người.";
    case "dealer_assignment_invalid":
      return "Phân công Dealer của bàn chưa hợp lệ hoặc tài khoản Dealer chưa hoạt động.";
    case "voice_config_disabled":
    case "voice_config_stale":
      return "Voice chưa được duyệt cho đúng phiên Tracker hiện tại.";
    case "voice_global_disabled":
      return "Voice đang tắt ở cấp hệ thống.";
    case "voice_table_session_not_tracker":
      return "Bàn chưa có phiên Tracker đang hoạt động.";
    case "unauthorized":
      return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi thử lại.";
    default:
      return "Chưa kiểm tra được quyền Voice. Hãy thử lại.";
  }
}
