import { useState, useCallback } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useNotifications, ICON_FOR, routeForNotification, timeAgo, NotificationRow } from "@/hooks/useNotifications";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const NotificationBell = () => {
  const { t } = useTranslation();
  const notify = useCallback((notification: NotificationRow) => {
    if (!notification.is_read) toast(notification.title, { description: notification.body });
  }, []);
  const { items, unreadCount, loading, error, markRead, markAllRead, refresh } = useNotifications(15, notify);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();

  const handleClick = async (n: NotificationRow) => {
    if (!n.is_read && !(await markRead(n.id))) return;
    setOpen(false);
    nav(routeForNotification(n));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative px-2.5 py-1.5 rounded-lg border border-border hover:border-primary/60 text-muted-foreground hover:text-primary inline-flex items-center gap-1.5 transition-colors"
          title={t("notifications.bellTitle")}
          aria-label={t("notifications.bellTitle")}
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="font-semibold">{t("notifications.title")}</div>
          <button
            onClick={markAllRead}
            disabled={unreadCount === 0 || loading || Boolean(error)}
            className="text-xs text-primary hover:underline disabled:opacity-40 disabled:no-underline"
          >
            {t("notifications.markAllRead")}
          </button>
        </div>
        <ScrollArea className="max-h-[420px]">
          {error && <div role="alert" className="px-4 py-3 text-sm text-destructive">
            {t("notifications.loadError")}
            <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>{t("notifications.retry")}</Button>
          </div>}
          {loading && <div role="status" className="px-4 py-3 text-sm text-muted-foreground">{t("common.loading")}</div>}
          {items.length === 0 && !loading && !error ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              {t("notifications.none")}
            </div>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id} className="border-b border-border/50">
                <button
                  type="button"
                  onClick={() => handleClick(n)}
                  className={cn(
                    "w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors flex gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    !n.is_read && "bg-primary/5 border-l-2 border-l-primary",
                    n.is_read && "opacity-70",
                  )}
                >
                  <span aria-hidden="true" className="text-xl leading-none shrink-0">{ICON_FOR[n.type]}</span>
                  <span className="flex-1 min-w-0">
                    <span className={cn("block text-sm leading-tight", !n.is_read && "font-semibold")}>
                      {n.title}
                    </span>
                    <span className="block text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</span>
                    <span className="block text-[10px] text-muted-foreground mt-1">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
        <div className="px-4 py-2 border-t border-border text-center">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs w-full"
            onClick={() => {
              setOpen(false);
              nav("/notifications");
            }}
          >
            {t("notifications.viewAll")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
