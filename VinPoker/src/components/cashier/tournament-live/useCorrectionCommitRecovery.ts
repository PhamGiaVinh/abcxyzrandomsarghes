import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { correctionCommitKey, correctionResolutionState, correctionCommitConfirmed, persistCorrectionIntent,
  readCorrectionIntent, settleCorrectionIntent, type CorrectionCommitIntent } from "@/lib/tracker-poker/correctionCommitIntent";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";

export function useCorrectionCommitRecovery(tournamentId: string, handId: string | null, onResolved: (status: "found" | "obsolete") => void) {
  const { user } = useAuth(), supabase = useSupabaseClient();
  const identity = useMemo(() => user?.id && handId ? { expected_actor_id: user.id, tournament_id: tournamentId, hand_id: handId } : null,
    [user?.id, tournamentId, handId]);
  const scope = JSON.stringify(identity), generation = useRef(0), scopeRef = useRef(scope), mounted = useRef(true);
  if (scopeRef.current !== scope) { scopeRef.current = scope; generation.current++; }
  const flight = useRef(false);
  const [notice, setNotice] = useState<{ scope: string; text: string | null } | null>(null);
  const setMessage = useCallback((text: string | null) => setNotice({ scope, text }), [scope]);
  const message = notice?.scope === scope ? notice.text : null;
  const [busy, setBusy] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => {
    setBusy(false);
    const refresh = () => {
      setMessage(null);
      if (identity) try {
        if (readCorrectionIntent(localStorage, identity)) setMessage("Có yêu cầu sửa hand chưa rõ kết quả. Kiểm tra receipt trước khi sửa tiếp.");
      } catch { setMessage("Không đọc được mã phục hồi sửa hand. Giữ dữ liệu trình duyệt; chưa gửi yêu cầu mới."); }
    };
    refresh(); window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [identity, setMessage]);
  const assertNoPending = () => {
    if (!identity) throw new Error("Chưa xác minh tài khoản hoặc hand.");
    if (readCorrectionIntent(localStorage, identity)) throw new Error("Còn yêu cầu sửa hand chưa rõ kết quả. Kiểm tra receipt trước.");
  };
  const recover = async () => {
    if (!identity || flight.current) return;
    flight.current = true; const token = generation.current;
    const current = () => mounted.current && generation.current === token;
    setBusy(true);
    try {
      const intent = readCorrectionIntent(localStorage, identity);
      if (!intent) { if (current()) setMessage(null); return; }
      const { data, error } = await observeTrackerContextRead(supabase.functions.invoke("tournament-live-resettle-commit", { body: { mode: "resolve", ...intent } }));
      if (!current()) return;
      const status = correctionResolutionState(data, intent);
      if (error || (status !== "found" && status !== "obsolete")) {
        setMessage("Chưa xác nhận được receipt. Giữ nguyên mã yêu cầu; không tự gửi lại hoặc tạo mã mới."); return;
      }
      settleCorrectionIntent(localStorage, intent); setMessage(null); onResolved(status);
    } catch { if (current()) setMessage("Không kiểm tra được receipt. Mã yêu cầu vẫn được giữ để phục hồi."); }
    finally { flight.current = false; if (current()) setBusy(false); }
  };
  const commit = async (intent: CorrectionCommitIntent, mutation: () => Promise<{ data: unknown; error: unknown }>) => {
    if (!identity || intent.expected_actor_id !== identity.expected_actor_id || intent.tournament_id !== tournamentId || intent.hand_id !== handId)
      throw new Error("Tài khoản hoặc hand đã thay đổi. Chưa gửi yêu cầu.");
    if (flight.current) return false;
    if (!navigator.locks) throw new Error("Trình duyệt chưa hỗ trợ khóa thao tác an toàn; chưa gửi yêu cầu.");
    flight.current = true; const token = generation.current;
    const current = () => mounted.current && generation.current === token;
    setBusy(true);
    try {
      return await navigator.locks.request(correctionCommitKey(intent), { mode: "exclusive" }, async () => {
        if (!current()) return false;
        assertNoPending(); persistCorrectionIntent(localStorage, intent);
        setMessage("Đang xác minh kết quả sửa hand. Mã phục hồi đã được lưu.");
        try {
          const { data, error } = await waitForManualPlayerResponse(mutation());
          if (!current()) return false;
          if (error || !correctionCommitConfirmed(data, intent)) return false;
          settleCorrectionIntent(localStorage, intent); setMessage(null); return true;
        } catch { return false; }
      });
    } finally {
      flight.current = false;
      if (current()) { setBusy(false); if (readCorrectionIntent(localStorage, intent)) setMessage("Chưa xác nhận kết quả sửa hand. Dùng Kiểm tra receipt; không gửi lại thao tác."); }
    }
  };
  return { actorId: user?.id, message, busy, assertNoPending, recover, commit };
}
