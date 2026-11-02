import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useNotifications, ICON_FOR, routeForNotification, timeAgo } from "@/hooks/useNotifications";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Notifications() {
  const { t } = useTranslation();
  const { items, unreadCount, loading, error, markRead, markAllRead, refresh } = useNotifications(100);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const nav = useNavigate();

  const list = tab === "unread" ? items.filter((n) => !n.is_read) : items;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("notifications.title")}</h1>
        <Button variant="outline" size="sm" onClick={markAllRead} disabled={unreadCount === 0 || loading || Boolean(error)}>
          {t("notifications.markAllRead")}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => { if (v === "all" || v === "unread") setTab(v); }}>
        <TabsList>
          <TabsTrigger value="all">{t("notifications.tabAll", { n: items.length })}</TabsTrigger>
          <TabsTrigger value="unread">{t("notifications.tabUnread", { n: unreadCount })}</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-4">
          {error && <div role="alert" className="py-3 text-sm text-destructive">
            {t("notifications.loadError")}
            <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>{t("notifications.retry")}</Button>
          </div>}
          {loading && <div role="status" className="py-3 text-muted-foreground">{t("common.loading")}</div>}
          {list.length === 0 && !loading && !error ? (
            <div className="py-16 text-center text-muted-foreground">{t("notifications.empty")}</div>
          ) : (
            <ul className="border border-border rounded-lg overflow-hidden">
              {list.map((n) => (
                <li key={n.id} className="border-b border-border/50 last:border-b-0">
                <button
                  type="button"
                  onClick={async () => {
                    if (!n.is_read && !(await markRead(n.id))) return;
                    nav(routeForNotification(n));
                  }}
                  className={cn(
                    "w-full text-left px-4 py-3 hover:bg-muted/40 flex gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    !n.is_read && "bg-primary/5 border-l-2 border-l-primary",
                    n.is_read && "opacity-70",
                  )}
                >
                  <span aria-hidden="true" className="text-2xl leading-none shrink-0">{ICON_FOR[n.type]}</span>
                  <span className="flex-1 min-w-0">
                    <span className={cn("block text-sm", !n.is_read && "font-semibold")}>{n.title}</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">{n.body}</span>
                    <span className="block text-[10px] text-muted-foreground mt-1">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
