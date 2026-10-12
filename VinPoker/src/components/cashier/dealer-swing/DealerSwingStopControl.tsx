import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";

type StopIntent = { actorId: string; clubId: string; requestId: string; resolved?: boolean };
// Narrow bridge until the deployed RPC is represented in generated DB types.
const stopApi = supabase as unknown as { rpc(name: "operator_stop_dealer_swing_v1", args: {
  p_club_id: string; p_request_id: string; p_expected_actor_id: string;
}): PromiseLike<{ data: unknown; error: { message: string } | null }> };
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readIntent(key: string, actorId: string, clubId: string): StopIntent | null {
  const raw = sessionStorage.getItem(key);
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.actorId !== actorId || value.clubId !== clubId ||
    (value.resolved !== undefined && typeof value.resolved !== "boolean") || typeof value.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)) {
    throw new Error("Không đọc được yêu cầu Dừng đã lưu. Chưa gửi thao tác mới.");
  }
  return { actorId, clubId, requestId: value.requestId, resolved: value.resolved === true };
}

/** Shared emergency OFF control: must remain available when operational reads fail. */
export function DealerSwingStopControl({ clubId, onStopped }: { clubId: string | null; onStopped: () => void }) {
  const { user } = useAuth();
  const scopeKey = JSON.stringify([user?.id ?? null, clubId]);
  const scopeRef = useRef({ key: scopeKey });
  if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey };
  const lifetime = useRef({ active: false, generation: 0 });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const savingRef = useRef(false);
  useEffect(() => {
    const mountedLifetime = lifetime.current;
    mountedLifetime.active = true;
    mountedLifetime.generation += 1;
    return () => { mountedLifetime.active = false; mountedLifetime.generation += 1; };
  }, []);
  useEffect(() => {
    setOpen(false);
    setSaving(false);
    savingRef.current = false;
    setFailure(null);
  }, [scopeKey]);
  const stop = async () => {
    if (!clubId || !user?.id || savingRef.current) return;
    const scope = scopeRef.current;
    const generation = lifetime.current.generation;
    const isCurrent = () => lifetime.current.active && lifetime.current.generation === generation && scopeRef.current === scope;
    savingRef.current = true;
    setSaving(true);
    setFailure(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const key = `vinpoker:stop-swing:${JSON.stringify([user.id, clubId])}`;
      const previous = readIntent(key, user.id, clubId);
      const intent = previous && !previous.resolved ? previous : { actorId: user.id, clubId, requestId: crypto.randomUUID() };
      sessionStorage.setItem(key, JSON.stringify(intent));
      if (readIntent(key, user.id, clubId)?.requestId !== intent.requestId) {
        throw new Error("Không lưu được mã yêu cầu. Chưa gửi thao tác Dừng.");
      }
      const { data, error } = await Promise.race([
        Promise.resolve(stopApi.rpc("operator_stop_dealer_swing_v1", {
          p_club_id: intent.clubId, p_request_id: intent.requestId, p_expected_actor_id: intent.actorId,
        })),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(
          "Chưa xác minh được kết quả. Bấm Dừng để kiểm tra lại cùng yêu cầu; không tự gửi yêu cầu mới."
        )), 15000); }),
      ]);
      if (!isCurrent()) return;
      if (error) throw new Error("Không xác minh được kết quả Dừng. Thử lại cùng yêu cầu sau khi kết nối hoặc quyền đã phục hồi.");
      if (!record(data) || data.ok !== true) {
        const code = record(data) && typeof data.error === "string" ? data.error : "UNKNOWN";
        throw new Error(code === "actor_not_allowed" || code === "unauthorized" || code === "ACTOR_CHANGED"
          ? "Không xác minh được quyền Dealer Control cho tài khoản hiện tại. Yêu cầu được giữ lại."
          : code === "settings_missing" || code === "settings_unverified"
            ? "Thiết lập Swing của CLB chưa hợp lệ. Không tạo thiết lập hoặc bật Swing tự động."
            : "Chưa xác minh được kết quả Dừng. Yêu cầu được giữ lại để kiểm tra lại.");
      }
      const receipt = data.receipt;
      const current = data.current_state;
      if (!record(receipt) || receipt.actor_id !== intent.actorId || receipt.club_id !== intent.clubId ||
        receipt.request_id !== intent.requestId || receipt.auto_swing_enabled !== false ||
        !["applied", "unchanged"].includes(String(receipt.outcome)) || !record(current) ||
        current.club_id !== intent.clubId || typeof current.auto_swing_enabled !== "boolean") {
        throw new Error("Phản hồi Dừng không khớp yêu cầu. Chưa xác nhận thành công; giữ mã để kiểm tra lại.");
      }
      const pending = readIntent(key, user.id, clubId);
      if (pending && pending.requestId !== intent.requestId) {
        setFailure("Có yêu cầu Dừng mới hơn đang chờ xác minh. Không dùng phản hồi cũ để cập nhật trạng thái.");
        return;
      }
      // Keep the last settled ID as a fence against another mounted widget's
      // late response, including after the newer intent has also settled.
      if (pending?.requestId === intent.requestId) sessionStorage.setItem(key, JSON.stringify({ ...intent, resolved: true }));
      if (current.auto_swing_enabled) {
        setFailure("Yêu cầu trước đã được xử lý nhưng Auto-Swing hiện đang ON. Bấm Dừng lần nữa để tạo yêu cầu mới.");
        return;
      }
      onStopped();
      setOpen(false);
      toast.success("Đã tắt Auto-Swing");
    } catch (error) {
      if (isCurrent()) setFailure(error instanceof Error ? error.message : "Không xác minh được trạng thái Swing. Yêu cầu được giữ lại.");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (isCurrent()) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  };
  return <>
    <button disabled={!clubId || !user?.id || saving} onClick={() => setOpen(true)}
      className="text-xs text-destructive hover:text-destructive/80 px-2 py-1" title="Tắt Auto-Swing">⏹ Dừng Swing</button>
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Tắt Auto-Swing</AlertDialogTitle>
          <AlertDialogDescription>Đặt Auto-Swing về OFF. Không đóng bàn, giải phóng dealer hoặc hủy phân công đã hoàn tất. Phân công thủ công vẫn theo quyền hiện có.</AlertDialogDescription>
        </AlertDialogHeader>
        {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Huỷ</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive hover:bg-destructive text-destructive-foreground"
            onClick={(event) => { event.preventDefault(); void stop(); }} disabled={saving}>
            {saving ? "Đang dừng..." : "Dừng"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
