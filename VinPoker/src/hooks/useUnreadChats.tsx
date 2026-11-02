import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { playNotifySound } from "@/lib/notifySound";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";

type RefreshOptions = { silent?: boolean };
type Scope = { actor: string | null; epoch: number };
type Snapshot = { scope: Scope; count: number; perChat: Record<string, number>; error: string | null };

/** Booking-chat unread count; direct/group chats have separate read models. */
export const useUnreadChats = () => {
  const { user, session, loading: authLoading } = useAuth();
  const actor = authLoading ? null : user?.id ?? null;
  const epoch = sessionReadEpoch(session);
  const scope = useMemo<Scope>(() => ({ actor, epoch }), [actor, epoch]);
  const [snapshot, setSnapshot] = useState<Snapshot>({ scope, count: 0, perChat: {}, error: null });
  const refreshRef = useRef<(options?: RefreshOptions) => Promise<void>>(() => Promise.resolve());
  const refresh = useCallback((options?: RefreshOptions) => refreshRef.current(options), []);
  useEffect(() => {
    if (!scope.actor) { refreshRef.current = () => Promise.resolve(); return; }
    const userId = scope.actor;
    let active = true, initialized = false, prevTotal = 0;
    let flight: Promise<void> | null = null, pending = false, pendingSilent = true;
    let controller: AbortController | null = null;
    const compute = (options?: RefreshOptions): Promise<void> => {
      if (!active) return Promise.resolve();
      if (flight) { pending = true; pendingSilent = pendingSilent && options?.silent === true; return flight; }
      const request = new AbortController();
      controller = request;
      flight = Promise.resolve().then(async () => {
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const interrupted = new Promise<never>((_, reject) => {
          request.signal.addEventListener("abort", () => reject(new Error("unread_read_cancelled")), { once: true });
          deadline = setTimeout(() => request.abort(), 15_000);
        });
        try {
          if (!active || request.signal.aborted) return;
          const read = async () => {
            const { data: chats, error: chatError } = await supabase.from("booking_chats").select("*").is("archived_at", null).abortSignal(request.signal);
            if (!active || request.signal.aborted) return null;
            if (chatError || !Array.isArray(chats)) throw new Error("chat_read_failed");
            const counts: Record<string, number> = {};
            let total = 0;
            if (chats.length) {
              const { data: messages, error: messageError } = await supabase.from("chat_messages")
                .select("chat_id, sender_id, created_at, kind").in("chat_id", chats.map(chat => chat.id)).abortSignal(request.signal);
              if (!active || request.signal.aborted) return null;
              if (messageError || !Array.isArray(messages)) throw new Error("message_read_failed");
              for (const chat of chats) {
                const lastRead = chat.player_id === userId ? chat.player_last_read_at : chat.club_last_read_at;
                const cutoff = lastRead ? new Date(lastRead).getTime() : 0;
                const count = messages.filter(message => message.chat_id === chat.id && message.sender_id !== userId
                  && new Date(message.created_at).getTime() > cutoff).length;
                if (count) counts[chat.id] = count;
                total += count;
              }
            }
            return {total, counts};
          };
          const result = await Promise.race([read(), interrupted]);
          if (!result || !active || request.signal.aborted) return;
          const {total, counts} = result;
          setSnapshot({ scope, count: total, perChat: counts, error: null });
          if (initialized && !options?.silent && total > prevTotal) playNotifySound();
          prevTotal = total; initialized = true;
        } catch {
          if (active) setSnapshot(previous => ({ scope,
            count: previous.scope === scope ? previous.count : 0,
            perChat: previous.scope === scope ? previous.perChat : {},
            error: "Không xác minh được số tin nhắn chưa đọc. Hãy tải lại khi kết nối ổn định." }));
        } finally {
          clearTimeout(deadline);
          request.abort();
          if (controller === request) controller = null;
        }
      }).finally(() => {
        flight = null;
        if (pending && active) {
          const silent = pendingSilent; pending = false; pendingSilent = true;
          void compute({ silent });
        }
      });
      return flight;
    };
    refreshRef.current = compute;
    void compute({ silent: true });
    const channel = supabase.channel(`unread-${userId}-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, () => { void compute(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_chats" }, () => { void compute({ silent: true }); })
      .subscribe();
    return () => { active = false; controller?.abort(); refreshRef.current = () => Promise.resolve(); void supabase.removeChannel(channel); };
  }, [scope]);
  const visible = scope.actor && snapshot.scope === scope;
  return { count: visible ? snapshot.count : 0, perChat: visible ? snapshot.perChat : {},
    error: visible ? snapshot.error : null, refresh };
};
