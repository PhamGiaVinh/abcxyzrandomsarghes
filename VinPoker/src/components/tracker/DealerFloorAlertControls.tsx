import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, PhoneCall } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";

type AlertKind = "call_floor" | "display_issue" | "wrong_action";
type PendingAlert = {
  actorId: string;
  requestId: string;
  tournamentId: string;
  tournamentTableId: string;
  handId: string | null;
  sourceRevision: number | null;
  kind: AlertKind;
  message: string;
};

const legacyStorageKey = (tournamentId: string, tournamentTableId: string) =>
  `dealer-floor-alert:${tournamentId}:${tournamentTableId}`;
const storageKey = (actorId: string | null, tournamentId: string, tournamentTableId: string) =>
  `dealer-floor-alert:${actorId}:${tournamentId}:${tournamentTableId}`;

function loadPending(key: string, actorId: string | null, tournamentId: string, tournamentTableId: string): PendingAlert | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingAlert>;
    const sourceRevision = value.sourceRevision ?? null;
    return value.actorId === actorId && typeof value.requestId === "string" && value.tournamentId === tournamentId
      && value.tournamentTableId === tournamentTableId
      && (value.kind === "call_floor" || value.kind === "display_issue" || value.kind === "wrong_action")
      && typeof value.message === "string" && (value.handId === null || typeof value.handId === "string")
      && (sourceRevision === null || Number.isSafeInteger(sourceRevision))
      ? { ...value, sourceRevision } as PendingAlert : null;
  } catch { return null; }
}

function persistPending(key: string, value: PendingAlert | null): boolean {
  try {
    if (value) window.sessionStorage.setItem(key, JSON.stringify(value));
    else window.sessionStorage.removeItem(key);
    return true;
  } catch { return false; }
}

type Props = {
  tournamentId: string;
  tournamentTableId: string;
  handId: string | null;
  enabled: boolean;
};

export function DealerFloorAlertControls(props: Props) {
  const { user, session } = useAuth();
  const actorId = user?.id ?? null;
  return <ScopedDealerFloorAlertControls key={JSON.stringify([actorId, sessionReadEpoch(session), props.tournamentId, props.tournamentTableId])} {...props} actorId={actorId} />;
}

function ScopedDealerFloorAlertControls({ tournamentId, tournamentTableId, handId, enabled: capabilityEnabled, actorId }: Props & {actorId:string|null}) {
  const key = storageKey(actorId, tournamentId, tournamentTableId);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [pending, setPending] = useState<PendingAlert | null>(() => actorId ? loadPending(key, actorId, tournamentId, tournamentTableId) : null);
  const [unverifiedRecovery] = useState(() => {
    if (!actorId) return false;
    try {
      // Actor-less legacy intents cannot safely be replayed as today's actor.
      // Preserve them and fail closed rather than discard or silently adopt.
      return window.sessionStorage.getItem(legacyStorageKey(tournamentId, tournamentTableId)) !== null
        || (window.sessionStorage.getItem(key) !== null && !loadPending(key, actorId, tournamentId, tournamentTableId));
    } catch { return true; }
  });
  const enabled = capabilityEnabled && Boolean(actorId) && !unverifiedRecovery;
  const [status, setStatus] = useState<"idle" | "sending" | "unknown" | "sent" | "rejected">(
    pending ? "unknown" : "idle",
  );
  const [detail, setDetail] = useState("");
  const [sourceRevision, setSourceRevision] = useState<number | null>(null);
  const [revisionUnavailable, setRevisionUnavailable] = useState(false);

  const readSourceRevision = useCallback(async (): Promise<number | null> => {
    if (!enabled || !handId) return null;
    try {
      const handResult = await observeTrackerContextRead(supabase.from("tournament_hands")
        .select("id,source_revision")
        .eq("id", handId).eq("tournament_id", tournamentId)
        .eq("tournament_table_id", tournamentTableId).maybeSingle());
      return handResult.error || !handResult.data
        || !Number.isSafeInteger(handResult.data.source_revision)
        ? null : handResult.data.source_revision;
    } catch { return null; }
  }, [enabled, handId, tournamentId, tournamentTableId]);

  useEffect(() => {
    let active = true;
    setSourceRevision(null);
    setRevisionUnavailable(false);
    if (!enabled || !handId) return () => { active = false; };
    const load = async () => {
      const revision = await readSourceRevision();
      if (active) { setSourceRevision(revision); setRevisionUnavailable(revision === null); }
    };
    void load();
    return () => { active = false; };
  }, [enabled, handId, readSourceRevision]);

  async function submit(kind: AlertKind) {
    if (!enabled || !actorId || status === "sending") return;
    const request = pending ?? {
      actorId, requestId: crypto.randomUUID(), tournamentId, tournamentTableId,
      handId, sourceRevision: kind === "wrong_action" ? sourceRevision : null,
      kind, message: "",
    };
    if (!pending && kind === "wrong_action" && (!handId || sourceRevision === null)) {
      setStatus("rejected");
      setDetail("Chưa xác minh được hand và phiên bản máy chủ; chưa gửi Floor.");
      return;
    }
    if (!pending) {
      if (!persistPending(key, request)) {
        setStatus("rejected");
        setDetail("Chưa gửi yêu cầu: không lưu được mã trong trình duyệt. Hãy gọi Floor trực tiếp.");
        return;
      }
      setPending(request);
    }
    setStatus("sending");
    setDetail("");
    try {
      const response = request.kind === "wrong_action"
        ? supabase.rpc("report_tracker_wrong_hand_v1" as never, {
          p_tournament_id: request.tournamentId,
          p_tournament_table_id: request.tournamentTableId,
          p_hand_id: request.handId,
          p_expected_source_revision: request.sourceRevision,
          p_request_id: request.requestId,
        } as never)
        : supabase.rpc("report_tracker_floor_operational_alert_v2" as never, {
          p_tournament_id: request.tournamentId,
          p_tournament_table_id: request.tournamentTableId,
          p_hand_id: request.handId,
          p_action_id: null,
          p_kind: request.kind,
          p_message: request.message,
          p_request_id: request.requestId,
          p_expected_action: null,
          p_source_revision: null,
        } as never);
      const { data, error } = await waitForManualPlayerResponse(Promise.resolve(response));
      const receipt = data as { ok?: boolean; alert_id?: string; request_id?: string; error?: string } | null;
      // An old table's completion must not replace the current table's UI or
      // erase its unresolved request key. Recover that request in its own scope.
      if (!alive.current) return;
      if (error) throw error;
      if (receipt?.ok === true && typeof receipt.alert_id === "string" && receipt.alert_id.trim().length > 0 && receipt.request_id === request.requestId) {
        setPending(null);
        persistPending(key, null);
        setStatus("sent");
        setDetail(`Mã cảnh báo: ${receipt.alert_id}`);
      } else {
        // A missing/mismatched receipt is not evidence that no alert committed.
        // Conflict may refer to an earlier committed payload; preserve its key.
        if (receipt?.ok !== false || typeof receipt.error !== "string" || !receipt.error
          || receipt.error === "request_key_conflict") throw new Error("floor_alert_receipt_unconfirmed");
        if (request.kind === "wrong_action" && receipt?.error === "stale_source_revision") {
          setPending(null);
          persistPending(key, null);
          const freshRevision = await readSourceRevision();
          if (!alive.current) return;
          setSourceRevision(freshRevision);
          setStatus("rejected");
          setDetail(freshRevision === null
            ? "Hand đã thay đổi trên máy chủ nhưng chưa tải được phiên bản mới. Hãy tải lại màn hình rồi kiểm tra hand trước khi báo lại."
            : "Hand đã thay đổi trên máy chủ. Đã tải phiên bản mới; kiểm tra lại hand rồi bấm Báo sai hand.");
          return;
        }
        if (pending && ["stale_tracker_context", "tracker_lock_not_owned", "actor_not_allowed"].includes(receipt?.error ?? "")) {
          setStatus("unknown");
          setDetail("Không còn quyền xác minh yêu cầu cũ. Liên hệ Floor bằng kênh khác và cung cấp mã yêu cầu; không gửi lại bằng mã mới.");
          return;
        }
        setPending(null);
        persistPending(key, null);
        setStatus("rejected");
        setDetail(receipt?.error ?? "Máy chủ từ chối yêu cầu.");
      }
    } catch {
      if (!alive.current) return;
      setStatus("unknown");
      setDetail("Chưa biết máy chủ đã nhận chưa. Kiểm tra lại bằng cùng mã yêu cầu; không gửi yêu cầu mới.");
    }
  }

  return <section className="dealer-floor-controls" aria-label="Liên hệ Floor">
    <div className="dealer-floor-heading">
      <strong>Floor hỗ trợ</strong>
      <span>Độc lập Voice · không đổi action</span>
    </div>
    <div className="dealer-floor-actions">
      <button type="button" disabled={!enabled || Boolean(pending) || status === "sending"} onClick={() => void submit("call_floor")}>
        <PhoneCall size={16} /> Gọi Floor
      </button>
      <button type="button" disabled={!enabled || Boolean(pending) || status === "sending"} onClick={() => void submit("display_issue")}>
        <AlertTriangle size={16} /> Vấn đề hiển thị
      </button>
      <button type="button" disabled={!enabled || !handId || sourceRevision === null || Boolean(pending) || status === "sending"}
        onClick={() => void submit("wrong_action")}>
        <AlertTriangle size={16} /> Báo sai hand
      </button>
    </div>
    {pending && status !== "sending" && <button type="button" className="dealer-floor-retry" disabled={!enabled}
      onClick={() => void submit(pending.kind)}>Kiểm tra lại yêu cầu đang chờ</button>}
    <p role="status" className={`dealer-floor-status dealer-floor-status-${status}`}>
      {!capabilityEnabled ? "Cảnh báo Floor mới chưa được bật; dùng quy trình Floor hiện tại." :
        !actorId ? "Chưa xác minh tài khoản. Đăng nhập lại trước khi gửi cảnh báo Floor." :
        unverifiedRecovery ? "Có yêu cầu cũ chưa xác minh được tài khoản hoặc phạm vi. Giữ nguyên mã đã lưu và liên hệ Floor; không gửi bằng mã mới." :
        status === "sending" ? "Đang gửi cảnh báo…" :
        status === "unknown" ? detail || "Chưa xác nhận được kết quả; kiểm tra lại bằng cùng mã yêu cầu." :
        status === "sent" ? `Đã gửi Floor. ${detail}` :
        status === "rejected" ? `Chưa gửi được: ${detail}` :
        revisionUnavailable ? "Chưa xác minh được phiên bản hand. Tải lại màn hình để kiểm tra trước khi báo sai hand; vẫn có thể Gọi Floor trực tiếp." :
        "Gọi Floor không dừng hand. Báo sai hand sẽ tạm dừng tiến hand sau khi máy chủ trả receipt."}
    </p>
    {pending && <small className="dealer-floor-request-id">Mã yêu cầu: {pending.requestId}</small>}
  </section>;
}
