import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  getSubscriptionState,
  requestPushPermission,
  optOutPush,
  isOneSignalSupported,
} from "@/lib/onesignal";

type Prefs = {
  welcome?: boolean;
  staking?: boolean;
  important?: boolean;
  club?: boolean;
  news?: boolean;
  chat?: boolean;
};

// label/desc hold i18n keys, resolved via t() inside the component map.
const CATEGORIES: { key: keyof Prefs; label: string; desc: string }[] = [
  { key: "staking", label: "notifSettings.catStakingLabel", desc: "notifSettings.catStakingDesc" },
  { key: "important", label: "notifSettings.catImportantLabel", desc: "notifSettings.catImportantDesc" },
  { key: "news", label: "notifSettings.catNewsLabel", desc: "notifSettings.catNewsDesc" },
];

const PUSH_CATEGORIES: { key: string; label: string; desc: string }[] = [
  { key: "news", label: "notifSettings.pushNewsLabel", desc: "notifSettings.pushNewsDesc" },
  { key: "livestream", label: "notifSettings.pushLivestreamLabel", desc: "notifSettings.pushLivestreamDesc" },
  { key: "staking_highlight", label: "notifSettings.pushStakingHighlightLabel", desc: "notifSettings.pushStakingHighlightDesc" },
  { key: "important", label: "notifSettings.pushImportantLabel", desc: "notifSettings.pushImportantDesc" },
  { key: "tools", label: "notifSettings.pushToolsLabel", desc: "notifSettings.pushToolsDesc" },
];
// Note: chat & club categories are push-only (no email).


export default function NotificationSettings() {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Đang xác minh phiên đăng nhập…</p>;
  if (!user) return <p role="alert">Đăng nhập để xem và thay đổi tùy chọn thông báo.</p>;
  return <NotificationSettingsScope key={user.id} />;
}
function NotificationSettingsScope() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.id;
  const [enabled, setEnabled] = useState(true);
  const [prefs, setPrefs] = useState<Prefs>({});
  const [pushPrefs, setPushPrefs] = useState<Record<string, boolean>>({});
  const [pushPreferencesAvailable, setPushPreferencesAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [emailAvailable, setEmailAvailable] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const active = useRef(true), saveLock = useRef(false);
  useEffect(() => { active.current = true;return () => { active.current = false; }; }, []);

  // Web Push state
  const [pushPerm, setPushPerm] = useState<"granted" | "denied" | "default">("default");
  const [pushOptedIn, setPushOptedIn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const pushSupported = typeof window !== "undefined" && isOneSignalSupported();
  const isPreviewHost =
    typeof window !== "undefined" &&
    (window.location.hostname.includes("id-preview--") ||
      window.location.hostname.includes("lovableproject.com") ||
      window.location.hostname === "localhost");

  const refreshPush = async () => {
    if (!pushSupported || isPreviewHost) return;
    const s = await getSubscriptionState();
    if (!active.current) return;
    setPushPerm(s.permission);
    setPushOptedIn(s.optedIn);
  };

  useEffect(() => {
    refreshPush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enablePush = async () => {
    setPushBusy(true);
    try {
      const ok = await requestPushPermission(["tournaments", "news", "tools"]);
      if (ok) toast.success(t("notifSettings.pushEnabled"));
      else toast.error(t("notifSettings.pushPermissionDenied"));
      await refreshPush();
    } finally {
      setPushBusy(false);
    }
  };

  const disablePush = async () => {
    setPushBusy(true);
    try {
      await optOutPush();
      toast.success(t("notifSettings.pushDisabled"));
      await refreshPush();
    } finally {
      setPushBusy(false);
    }
  };
  useEffect(() => {
    let disposed = false;
    setEmailAvailable(false); setPushPreferencesAvailable(false); setPrefs({}); setPushPrefs({}); setEnabled(false); setPreferenceError(null);
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    (async () => {
      try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (disposed) return;
      if (error) { setPreferenceError("Không tải được tùy chọn thông báo. Hãy tải lại trang."); return; }
      if (!data) { setPreferenceError("Không tìm thấy hồ sơ để xác minh tùy chọn thông báo. Hãy tải lại trang."); return; }
      if (data) {
        const emailEnabled = "email_notifications_enabled" in data ? data.email_notifications_enabled : null;
        const emailPrefs = "email_prefs" in data ? data.email_prefs : null;
        setEmailAvailable("email_notifications_enabled" in data && "email_prefs" in data);
        setEnabled(typeof emailEnabled === "boolean" ? emailEnabled : false);
        setPrefs(emailPrefs && typeof emailPrefs === "object" && !Array.isArray(emailPrefs) ? emailPrefs as Prefs : {});
        if ('push_prefs' in data) {
          const raw = data.push_prefs;
          if (raw !== null && (!raw || typeof raw !== 'object' || Array.isArray(raw))) {
            setPreferenceError('Không xác minh được tùy chọn loại push. Hãy tải lại trang trước khi thay đổi.');
            return;
          }
          const verified: Record<string, boolean> = {};
          for (const [key, value] of Object.entries(raw ?? {})) {
            if (typeof value !== 'boolean') {
              setPreferenceError('Không xác minh được tùy chọn loại push. Hãy tải lại trang trước khi thay đổi.');
              return;
            }
            verified[key] = value;
          }
          setPushPrefs(verified);
          setPushPreferencesAvailable(true);
        }
      }
      } catch {
        if (!disposed) setPreferenceError("Không kết nối được để tải tùy chọn thông báo.");
      } finally { if (!disposed) setLoading(false); }
    })();
    return () => { disposed = true; };
  }, [userId]);

  const persistPreference = async (payload: Record<string, unknown>, verified: () => void) => {
    if (!user || loading || preferenceError || saveLock.current || !active.current) return;
    saveLock.current = true;setSaving(true);
    try {
      // Optional email columns vary by environment; verify an affected actor row,
      // not merely an error-free UPDATE response with zero affected records.
      const writer = supabase.from('profiles') as unknown as { update(value: Record<string, unknown>): {
        eq(column: string, value: string): { select(columns: string): { maybeSingle(): PromiseLike<{ data: { user_id: string } | null; error: unknown }> } };
      } };
      const result = await writer.update(payload).eq('user_id', user.id).select('user_id').maybeSingle();
      if (!active.current) return;
      if (result.error || result.data?.user_id !== user.id) throw new Error('preference_save_unverified');
      verified();
    } catch {
      if (active.current) setPreferenceError('Chưa xác minh được việc lưu tùy chọn. Hãy tải lại trang để đọc trạng thái từ server trước khi tiếp tục.');
    } finally { saveLock.current = false;if (active.current) setSaving(false); }
  };
  const togglePushPref = async (key: string, val: boolean) => {
    if (!pushPreferencesAvailable) return;
    const next = { ...pushPrefs, [key]: val };
    await persistPreference({ push_prefs: next }, () => setPushPrefs(next));
  };

  const save = async (next: { enabled?: boolean; prefs?: Prefs }) => {
    if (!user || !emailAvailable || preferenceError) return;
    const payload: Record<string, unknown> = {};
    if (next.enabled !== undefined) payload.email_notifications_enabled = next.enabled;
    if (next.prefs) payload.email_prefs = next.prefs;
    await persistPreference(payload, () => {
      if (next.enabled !== undefined) setEnabled(next.enabled);
      if (next.prefs) setPrefs(next.prefs);
      toast.success(t("notifSettings.saved"));
    });
  };

  const togglePref = (key: keyof Prefs, val: boolean) => {
    const next = { ...prefs, [key]: val };
    void save({ prefs: next });
  };

  if (loading) return <div className="container mx-auto p-6">{t("notifSettings.loading")}</div>;

  const subscribed = pushPerm === "granted" && pushOptedIn;

  return (
    <div className="container mx-auto p-4 max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">{t("notifSettings.title")}</h1>
      {preferenceError && <p role="alert" className="text-sm text-destructive">{preferenceError}</p>}

      {/* Web Push section */}
      <Card className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${subscribed ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
            {subscribed ? <BellRing className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
          </div>
          <div className="flex-1">
            <Label className="text-base font-semibold">{t("notifSettings.webPushLabel")}</Label>
            <p className="text-sm text-muted-foreground">
              {t("notifSettings.webPushDesc")}
            </p>
          </div>
        </div>

        {!pushSupported && (
          <p className="text-xs text-muted-foreground">{t("notifSettings.notSupported")}</p>
        )}
        {isPreviewHost && (
          <p className="text-xs text-warning">
            {t("notifSettings.previewNoticePrefix")} <a className="underline" href="https://www.vinpoker.live" target="_blank" rel="noopener">https://www.vinpoker.live</a> {t("notifSettings.previewNoticeSuffix")}
          </p>
        )}
        {pushSupported && !isPreviewHost && (
          <>
            <div className="text-xs">
              {t("notifSettings.statusLabel")}{" "}
              {pushPerm === "denied" ? (
                <span className="text-destructive font-semibold">{t("notifSettings.statusBlocked")}</span>
              ) : subscribed ? (
                <span className="text-primary font-semibold">{t("notifSettings.statusOn")}</span>
              ) : pushPerm === "granted" ? (
                <span className="text-muted-foreground font-semibold">{t("notifSettings.statusGrantedNotSubscribed")}</span>
              ) : (
                <span className="text-muted-foreground font-semibold">{t("notifSettings.statusOff")}</span>
              )}
            </div>
            {pushPerm === "denied" ? (
              <p className="text-xs text-muted-foreground">
                {t("notifSettings.deniedHelp")}
              </p>
            ) : subscribed ? (
              <Button variant="outline" size="sm" onClick={disablePush} disabled={pushBusy}>
                {pushBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <BellOff className="w-3.5 h-3.5 mr-1.5" />}
                {t("notifSettings.disablePushBtn")}
              </Button>
            ) : (
              <Button onClick={enablePush} disabled={pushBusy} className="gradient-neon text-primary-foreground border-0">
                {pushBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <BellRing className="w-3.5 h-3.5 mr-1.5" />}
                {t("notifSettings.enablePushBtn")}
              </Button>
            )}
          </>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <Label className="text-base font-semibold">{t("notifSettings.pushByCategory")}</Label>
        <p className="text-xs text-muted-foreground">{t("notifSettings.pushByCategoryDesc")}</p>
        {!pushPreferencesAvailable && !preferenceError && <p className="text-sm text-muted-foreground">Tùy chọn loại push chưa có backend trong môi trường này. Chưa thể thay đổi.</p>}
        {PUSH_CATEGORIES.map((c) => (
          <div key={c.key} className="flex items-start justify-between gap-4 py-1.5 border-b border-border last:border-0">
            <div>
              <Label className="font-semibold">{t(c.label)}</Label>
              <p className="text-xs text-muted-foreground mt-0.5">{t(c.desc)}</p>
            </div>
            <Switch
              aria-label={t(c.label)}
              checked={pushPreferencesAvailable && pushPrefs[c.key] !== false}
              disabled={saving || !pushPreferencesAvailable || !!preferenceError}
              onCheckedChange={(v) => togglePushPref(c.key, v)}
            />
          </div>
        ))}
      </Card>

      <h2 className="text-xl font-bold pt-2">Email</h2>
      {!emailAvailable && <p className="text-sm text-muted-foreground">Tùy chọn email chưa có backend trong môi trường này. Không thay đổi thiết lập email.</p>}
      <Card className="p-4 flex items-center justify-between">
        <div>
          <Label className="text-base font-semibold">{t("notifSettings.emailMasterLabel")}</Label>
          <p className="text-sm text-muted-foreground">{t("notifSettings.emailMasterDesc")}</p>
        </div>
        <Switch
          aria-label={t("notifSettings.emailMasterLabel")}
          checked={enabled}
          disabled={saving || !emailAvailable || !!preferenceError}
          onCheckedChange={(v) => {
            void save({ enabled: v });
          }}
        />
      </Card>

      <Card className="p-4 space-y-4">
        <p className="text-sm text-muted-foreground">{t("notifSettings.emailPickDesc")}</p>
        {CATEGORIES.map((c) => (
          <div key={c.key} className="flex items-start justify-between gap-4 py-2 border-b border-border last:border-0">
            <div>
              <Label className="font-semibold">{t(c.label)}</Label>
              <p className="text-xs text-muted-foreground mt-1">{t(c.desc)}</p>
            </div>
            <Switch
              aria-label={t(c.label)}
              disabled={saving || !enabled || !emailAvailable || !!preferenceError}
              checked={prefs[c.key] ?? false}
              onCheckedChange={(v) => togglePref(c.key, v)}
            />
          </div>
        ))}
      </Card>
    </div>
  );
}
