import { useEffect, useState, useCallback, useRef, useId } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { playSuccessSound, playErrorSound, playWarningSound, playInfoSound, playAlertSound } from "@/lib/notifySound";
import i18n from "@/i18n";
import { waitForManualPlayerResponse } from "@/lib/floorManualPlayerIntent";

export type NotificationType =
  | "deal_committed"
  | "deal_funded"
  | "purchase_funded"
  | "deal_auto_cancelled"
  | "deal_auto_closed"
  | "deal_expiring_soon"
  | "deal_refunded"
  | "player_checked_in"
  | "result_entered"
  | "result_verified"
  | "result_disputed"
  | "release_requested"
  | "payout_executed"
  | "system_announcement"
  | "schedule_updated"
  | "club_schedule_updated"
  | "registration_confirmed"
  | "tournament_created"
  | "stream_live"
  | "chat_message"
  | "verification_approved"
  | "verification_rejected"
  | "package_purchase_paid"
  | "player_busted_out"
  | "profile_updated";

export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

const ROUTE_FOR: Record<NotificationType, (data: Record<string, unknown>) => string> = {
  deal_committed: () => "/staking/my-deals",
  deal_funded: () => "/staking/my-deals",
  purchase_funded: () => "/staking/my-deals",
  deal_auto_cancelled: () => "/staking/my-deals",
  deal_auto_closed: () => "/staking/my-deals",
  deal_expiring_soon: () => "/staking/portfolio",
  deal_refunded: () => "/staking/my-deals",
  player_checked_in: () => "/staking/portfolio",
  result_entered: () => "/admin/staking",
  result_verified: () => "/staking/portfolio",
  result_disputed: () => "/staking/my-deals",
  release_requested: () => "/staking/portfolio",
  payout_executed: () => "/staking/portfolio",
  system_announcement: () => "/",
  schedule_updated: () => "/",
  club_schedule_updated: () => "/",
  registration_confirmed: () => "/",
  tournament_created: () => "/",
  stream_live: () => "/",
  chat_message: (data) => typeof data?.group_id === "string"
    && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(data.group_id)
      ? `/group/${data.group_id}` : "/inbox",
  verification_approved: () => "/account",
  verification_rejected: () => "/account",
  package_purchase_paid: () => "/packages",
  player_busted_out: () => "/staking/my-deals",
  profile_updated: () => "/account",
};

export const ICON_FOR: Record<NotificationType, string> = {
  deal_committed: "🤝",
  deal_funded: "💰",
  purchase_funded: "💰",
  deal_auto_cancelled: "⏰",
  deal_auto_closed: "🚪",
  deal_expiring_soon: "⏳",
  deal_refunded: "💸",
  player_checked_in: "🎯",
  result_entered: "📝",
  result_verified: "✅",
  result_disputed: "⚠️",
  release_requested: "🔐",
  payout_executed: "🎉",
  system_announcement: "📣",
  schedule_updated: "📅",
  club_schedule_updated: "📅",
  registration_confirmed: "🎫",
  tournament_created: "🏆",
  stream_live: "🔴",
  chat_message: "💬",
  verification_approved: "🆔",
  verification_rejected: "❌",
  package_purchase_paid: "🎫",
  player_busted_out: "💥",
  profile_updated: "📝",
};

const SOUND_FOR: Record<string, () => void> = {
  deal_committed: playSuccessSound,
  deal_funded: playSuccessSound,
  purchase_funded: playSuccessSound,
  payout_executed: playSuccessSound,
  verification_approved: playSuccessSound,
  player_checked_in: playSuccessSound,
  result_verified: playSuccessSound,
  deal_auto_cancelled: playErrorSound,
  deal_auto_closed: playErrorSound,
  deal_refunded: playErrorSound,
  verification_rejected: playErrorSound,
  result_disputed: playErrorSound,
  deal_expiring_soon: playWarningSound,
  release_requested: playWarningSound,
  result_entered: playInfoSound,
  system_announcement: playAlertSound,
  club_schedule_updated: playInfoSound,
  tournament_created: playInfoSound,
  stream_live: playAlertSound,
  package_purchase_paid: playSuccessSound,
  player_busted_out: playErrorSound,
  profile_updated: playInfoSound,
};

export function routeForNotification(n: Pick<NotificationRow, "type" | "data">) {
  return ROUTE_FOR[n.type]?.(n.data) ?? "/";
}

export function useNotifications(limit = 20, onNewNotification?: (notification: NotificationRow) => void) {
  const instanceId = useId();
  const subscriptionGeneration = useRef(0);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const scopeRef = useRef({ userId });
  if (scopeRef.current.userId !== userId) scopeRef.current = { userId };
  const actorScope = scopeRef.current;
  const announced = useRef({ scope: actorScope, ids: new Set<string>() });
  if (announced.current.scope !== actorScope) announced.current = { scope: actorScope, ids: new Set<string>() };
  const lifetime = useRef({ mounted: false, generation: 0 });
  const isCurrentScope = useCallback((generation = lifetime.current.generation) =>
    lifetime.current.mounted && lifetime.current.generation === generation && scopeRef.current === actorScope,
  [actorScope]);
  const readGeneration = useRef(0);
  const activeRead = useRef<AbortController | null>(null);
  const [snapshotScope, setSnapshotScope] = useState<typeof actorScope | null>(null);
  const [failure, setFailure] = useState<{ scope: typeof actorScope; message: string } | null>(null);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const currentLifetime = lifetime.current;
    currentLifetime.mounted = true;
    currentLifetime.generation += 1;
    return () => {
      currentLifetime.mounted = false;
      currentLifetime.generation += 1;
    };
  }, []);

  const fetchAll = useCallback(async () => {
    // A response belongs to both its actor and its request generation.
    if (!isCurrentScope()) return;
    const capturedLifetime = lifetime.current.generation;
    const generation = ++readGeneration.current;
    activeRead.current?.abort();
    activeRead.current = null;
    if (!userId) {
      setItems([]);
      setUnreadCount(0);
      setSnapshotScope(null);
      setFailure(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailure(null);
    const controller = new AbortController();
    activeRead.current = controller;
    try {
    const [list, count] = await waitForManualPlayerResponse(Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit)
        .abortSignal(controller.signal),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_read", false)
        .abortSignal(controller.signal),
    ]), 10000);
    if (!isCurrentScope(capturedLifetime) || generation !== readGeneration.current) return;
    if (list.error || count.error) throw list.error ?? count.error;
    if (!Array.isArray(list.data) || typeof count.count !== "number"
      || !Number.isSafeInteger(count.count) || count.count < 0) {
      throw new Error("Không xác minh được danh sách hoặc số thông báo chưa đọc. Hãy thử lại.");
    }
    setItems(list.data as NotificationRow[]);
    setUnreadCount(count.count);
    setSnapshotScope(actorScope);
    } catch (reason) {
      if (isCurrentScope(capturedLifetime) && generation === readGeneration.current) {
        setFailure({ scope: actorScope, message: reason instanceof Error && reason.message === "MANUAL_PLAYER_OUTCOME_UNKNOWN"
          ? "Không tải được thông báo trong 10 giây. Hãy thử lại."
          : reason instanceof Error ? reason.message : String((reason as { message?: string })?.message ?? "Không tải được thông báo") });
      }
    } finally {
      controller.abort();
      if (activeRead.current === controller) activeRead.current = null;
      if (isCurrentScope(capturedLifetime) && generation === readGeneration.current) setLoading(false);
    }
  }, [userId, limit, actorScope, isCurrentScope]);

  useEffect(() => {
    fetchAll();
    return () => { activeRead.current?.abort(); };
  }, [fetchAll]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const ch = supabase
      .channel(`notifications:${userId}:${instanceId}:${++subscriptionGeneration.current}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (!active || !isCurrentScope() || payload.new?.user_id !== userId) return;
          const notificationId = payload.new?.id;
          if (typeof notificationId !== "string") return;
          if (announced.current.ids.has(notificationId)) { void fetchAll(); return; }
          announced.current.ids.add(notificationId);
          if (announced.current.ids.size > 512) {
            const oldest = announced.current.ids.values().next().value;
            if (oldest !== undefined) announced.current.ids.delete(oldest);
          }
          onNewNotification?.(payload.new as NotificationRow);
          const newType = payload.new?.type as string;
          (SOUND_FOR[newType] ?? playAlertSound)();
          fetchAll();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => { if (active) void fetchAll(); },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => { if (active) void fetchAll(); },
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(ch);
    };
  }, [userId, fetchAll, onNewNotification, isCurrentScope, instanceId]);

  const markRead = useCallback(async (id: string) => {
    if (!userId || !isCurrentScope()) return false;
    const capturedLifetime = lifetime.current.generation;
    try {
      const result = await waitForManualPlayerResponse(Promise.resolve(
        supabase.from("notifications").update({ is_read: true }).eq("id", id).eq("user_id", userId),
      ), 10000);
      if (!isCurrentScope(capturedLifetime)) return false;
      if (result.error) throw result.error;
      await fetchAll();
      return isCurrentScope(capturedLifetime);
    } catch (reason) {
      if (isCurrentScope(capturedLifetime)) setFailure({ scope: actorScope, message: reason instanceof Error && reason.message === "MANUAL_PLAYER_OUTCOME_UNKNOWN"
        ? "Chưa xác minh được thao tác đã đọc trong 10 giây. Hãy tải lại danh sách để đối chiếu."
        : reason instanceof Error ? reason.message : String((reason as { message?: string })?.message ?? "Không đánh dấu được thông báo") });
      return false;
    }
  }, [userId, fetchAll, isCurrentScope, actorScope]);

  const markAllRead = useCallback(async () => {
    if (!userId || !isCurrentScope()) return false;
    const capturedLifetime = lifetime.current.generation;
    try {
    const result = await waitForManualPlayerResponse(Promise.resolve(supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false)), 10000);
    if (!isCurrentScope(capturedLifetime)) return false;
    if (result.error) throw result.error;
    await fetchAll();
    return isCurrentScope(capturedLifetime);
    } catch (reason) {
      if (isCurrentScope(capturedLifetime)) setFailure({ scope: actorScope, message: reason instanceof Error && reason.message === "MANUAL_PLAYER_OUTCOME_UNKNOWN"
        ? "Chưa xác minh được thao tác đã đọc trong 10 giây. Hãy tải lại danh sách để đối chiếu."
        : reason instanceof Error ? reason.message : String((reason as { message?: string })?.message ?? "Không đánh dấu được thông báo") });
      return false;
    }
  }, [userId, fetchAll, isCurrentScope, actorScope]);

  const sameScope = snapshotScope === actorScope;
  const error = failure?.scope === actorScope ? failure.message : null;
  return { items: sameScope ? items : [], unreadCount: sameScope ? unreadCount : 0, loading: loading || (Boolean(userId) && !sameScope && !error), error, markRead, markAllRead, refresh: fetchAll };
}

export function timeAgo(iso: string) {
  const sec = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return i18n.t("timeAgo.secondsAgo", { count: sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return i18n.t("timeAgo.minutesAgo", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return i18n.t("timeAgo.hoursAgo", { count: hr });
  const d = Math.floor(hr / 24);
  if (d < 7) return i18n.t("timeAgo.daysAgo", { count: d });
  return new Date(iso).toLocaleDateString("vi-VN");
}
