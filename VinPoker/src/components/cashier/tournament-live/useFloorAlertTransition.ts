import { useEffect, useRef, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";

type Action = "acknowledge" | "start" | "resolve" | "dismiss";
type Intent = { actor: string; tournament: string; alert: string; version: number;
  action: Action; note: string | null; request: string };
type Journal = { key: string; intent: Intent | null; error: string | null; rejected?: boolean };
const status: Record<Action, string> = { acknowledge: "acknowledged", start: "in_progress", resolve: "resolved", dismiss: "dismissed" };
const unknown = "Chưa xác nhận được kết quả. Giữ nguyên yêu cầu cũ; không tạo thao tác mới.";

function read(key: string, actor: string | undefined, tournament: string): Intent | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const value = JSON.parse(raw) as Intent;
  if (!value || typeof value !== "object" || Object.keys(value).length !== 7
    || value.actor !== actor || value.tournament !== tournament
    || typeof value.alert !== "string" || !value.alert || !Number.isSafeInteger(value.version) || value.version < 1
    || !Object.prototype.hasOwnProperty.call(status, value.action) || !(value.note === null || (typeof value.note === "string" && value.note.length <= 500))
    || typeof value.request !== "string" || !/^floor-alert:[a-f0-9-]{36}$/i.test(value.request)) throw new Error("INVALID_TRANSITION_JOURNAL");
  return value;
}

/** Owns the durable browser intent; the canonical RPC still authorizes every call. */
export function useFloorAlertTransition(actor: string | undefined, tournament: string) {
  const client = useSupabaseClient();
  const key = `vinpoker:floor-alert-transition:v1:${actor ?? "anonymous"}:${tournament}`;
  const [journal, setJournal] = useState<Journal>({ key, intent: null, error: null });
  const [busy, setBusy] = useState(false);
  const flight = useRef<number | null>(null), lifetime = useRef(0);
  useEffect(() => {
    const generation = ++lifetime.current;
    flight.current = null;
    setBusy(false);
    const refresh = () => {
      try { setJournal({ key, intent: read(key, actor, tournament), error: null }); }
      catch { setJournal({ key, intent: null, error: "Không đọc được mã phục hồi. Giữ dữ liệu trình duyệt; chưa gửi thao tác." }); }
    };
    refresh();
    const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) refresh(); };
    window.addEventListener("storage", storage);
    return () => { lifetime.current = generation + 1; window.removeEventListener("storage", storage); };
  }, [actor, key, tournament]);
  const active = journal.key === key ? journal : { key, intent: null, error: null };

  const send = async (intent: Intent, recovery: boolean) => {
    if (flight.current !== null || !actor || intent.actor !== actor || intent.tournament !== tournament) return false;
    const generation = lifetime.current;
    flight.current = generation;
    const current = () => generation === lifetime.current;
    let lockTimer: ReturnType<typeof setTimeout> | undefined;
    setBusy(true);
    try {
      if (!navigator.locks) throw new Error("Thiếu khóa trình duyệt an toàn; chưa gửi thao tác.");
      const controller = new AbortController();
      lockTimer = setTimeout(() => controller.abort(), 20_000);
      return await navigator.locks.request(key, { mode: "exclusive", signal: controller.signal }, async () => {
        clearTimeout(lockTimer);
        if (!current()) return false;
        const prior = read(key, actor, tournament);
        const raw = JSON.stringify(intent);
        if ((recovery && !prior) || (prior && JSON.stringify(prior) !== raw)) {
          setJournal({ key, intent: prior, error: "Yêu cầu đã thay đổi ở tab khác. Kiểm tra lại yêu cầu cũ." });
          return false;
        }
        localStorage.setItem(key, raw);
        if (localStorage.getItem(key) !== raw) throw new Error("Không lưu được mã phục hồi; chưa gửi thao tác.");
        setJournal({ key, intent, error: unknown });
        const { data, error } = await waitForManualPlayerResponse(Promise.resolve(client.rpc("transition_tracker_floor_alert" as never, {
          p_alert_id: intent.alert, p_expected_version: intent.version, p_transition: intent.action,
          p_note: intent.note, p_idempotency_key: intent.request,
        } as never)));
        if (!current()) return false;
        const receipt = data as Record<string, unknown> | null;
        const confirmed = !error && receipt?.ok === true && receipt.alert_id === intent.alert
          && receipt.status === status[intent.action] && receipt.version === intent.version + 1 && typeof receipt.duplicate === "boolean";
        // Only post-receipt-lookup rejections prove this key did not commit.
        // Lost permission or a missing alert can hide an earlier receipt.
        const rejected = !error && receipt?.ok === false
          && ["stale_alert_version", "invalid_alert_transition"].includes(String(receipt.error));
        if (!confirmed && !rejected) return false;
        if (localStorage.getItem(key) !== raw) throw new Error("Mã phục hồi đã thay đổi. Giữ nguyên để kiểm tra.");
        localStorage.removeItem(key);
        if (localStorage.getItem(key) !== null) throw new Error("Chưa xác nhận xóa mã đã xử lý.");
        setJournal({ key, intent: null, rejected, error: rejected ? `Máy chủ từ chối: ${String(receipt?.error)}. Hãy làm mới cảnh báo.` : null });
        return confirmed;
      });
    } catch {
      if (current()) {
        let pending: Intent | null = null;
        try { pending = read(key, actor, tournament); } catch { /* preserve invalid storage */ }
        setJournal({ key, intent: pending, error: pending ? unknown : "Không xác minh được mã phục hồi hoặc khóa trình duyệt; chưa gửi yêu cầu mới." });
      }
      return false;
    } finally { clearTimeout(lockTimer); if (flight.current === generation) flight.current = null; if (current()) setBusy(false); }
  };
  const run = async (alert: string, version: number, action: Action, note: string | null) => {
    if (active.intent || (active.error && !active.rejected) || !actor) return false;
    return send({ actor, tournament, alert, version, action, note, request: `floor-alert:${crypto.randomUUID()}` }, false);
  };
  const recover = async () => {
    if (!active.intent) return false;
    return send(active.intent, true);
  };
  return { run, recover, busy, pending: active.intent, message: active.error ?? (active.intent ? unknown : !actor ? "Chưa xác minh tài khoản để cập nhật cảnh báo." : null),
    blocked: !actor || !!active.intent || (!!active.error && !active.rejected) || busy };
}
