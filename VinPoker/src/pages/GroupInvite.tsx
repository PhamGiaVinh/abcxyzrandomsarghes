import { useEffect, useRef, useState } from "react";
import { z } from 'zod';
import { waitForManualPlayerResponse } from '@/lib/floorManualPlayerIntent';
import { readGroupInviteIntent, persistGroupInviteIntent, clearGroupInviteIntent, type GroupInviteIntent } from '@/lib/groupInviteIntent';
import { Navigate, useNavigate, useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, Users, Globe, Lock, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface Preview {
  group_id: string | null;
  group_name: string | null;
  avatar_url: string | null;
  is_public: boolean | null;
  member_count: number;
  valid: boolean;
  reason: string;
}

const GroupInvite = () => {
  const { token } = useParams<{ token: string }>();
  const { user, loading: authLoading } = useAuth();
  if (authLoading) return <div role="status">Đang xác minh phiên đăng nhập…</div>;
  if (!user) return <Navigate to={`/auth?redirect=${encodeURIComponent(`/invite/${token ?? ''}`)}`} replace />;
  return <GroupInviteScope key={`${user.id}:${token ?? ''}`} token={token} actorId={user.id} />;
};
const PreviewSchema = z.object({ group_id: z.string().uuid().nullable(), group_name: z.string().nullable(), avatar_url: z.string().nullable(),
  is_public: z.boolean().nullable(), member_count: z.number().int().nonnegative(), valid: z.boolean(), reason: z.string() })
  .refine(value => !value.valid || (!!value.group_id && value.reason === 'ok'));
const AcceptSchema = z.object({ ok: z.boolean(), outcome: z.enum(['joined', 'already_member', 'replayed', 'no_longer_member']), request_id: z.string().uuid(), group_id: z.string().uuid() });
const GroupInviteScope = ({ token, actorId }: { token: string | undefined; actorId: string }) => {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(true);
  const [joining, setJoining] = useState(false);
  const [readError, setReadError] = useState(false), [reload, setReload] = useState(0), [joinUnknown, setJoinUnknown] = useState(false);
  const [intent, setIntent] = useState<GroupInviteIntent | null>(null), [noLongerMember, setNoLongerMember] = useState(false);
  const active = useRef(true), joinLock = useRef(false);
  useEffect(() => { active.current = true;return () => { active.current = false; }; }, []);

  const reasonText = (r: string) =>
    t(`groupChat.invitePage.reasons.${r}`, { defaultValue: t("groupChat.invitePage.unavailable") });

  useEffect(() => {
    let alive = true;setPreview(null);setReadError(false);
    if (!token) { setBusy(false);return; }
    void (async () => {
      setBusy(true);
      try {
        const saved = await readGroupInviteIntent(sessionStorage, actorId, token);
        if (!alive) return;setIntent(saved);
        const { data, error } = await waitForManualPlayerResponse(Promise.resolve(supabase.rpc("get_invite_preview", { _token: token })));
        if (!alive) return;
        const parsed = PreviewSchema.safeParse(Array.isArray(data) && data.length === 1 ? data[0] : data);
        if (error || !parsed.success || (saved && parsed.data.group_id && saved.groupId !== parsed.data.group_id)) throw new Error('invite_preview_unavailable');
        setPreview({group_id:parsed.data.group_id,group_name:parsed.data.group_name,avatar_url:parsed.data.avatar_url,
          is_public:parsed.data.is_public,member_count:parsed.data.member_count,valid:parsed.data.valid,reason:parsed.data.reason});
      } catch { if (alive) setReadError(true); }
      finally { if (alive) setBusy(false); }
    })();
    return () => { alive = false; };
  }, [token, actorId, reload]);

  const join = async () => {
    if (!token || !preview || (!intent && (!preview.valid || !preview.group_id)) || noLongerMember || busy || readError || joinLock.current || !active.current) return;
    joinLock.current = true;
    setJoining(true);
    try {
      const saved = await persistGroupInviteIntent(sessionStorage, actorId, token, intent?.groupId ?? preview.group_id!);
      if (!active.current) return;setIntent(saved);
      const rpc = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
      const { data, error } = await waitForManualPlayerResponse(Promise.resolve(rpc.call(supabase, 'accept_group_invite_v2', { _token: token, _request_id: saved.requestId })));
      if (!active.current) return;
      const receipt = AcceptSchema.safeParse(data);
      if (error || !receipt.success || receipt.data.request_id !== saved.requestId || receipt.data.group_id !== saved.groupId) throw new Error('invite_accept_unverified');
      if (!receipt.data.ok || receipt.data.outcome === 'no_longer_member') { setNoLongerMember(true);return; }
      clearGroupInviteIntent(sessionStorage, saved);
      toast.success(t("groupChat.invitePage.joined"));nav(`/group/${saved.groupId}`);
    } catch { if (active.current) setJoinUnknown(true); }
    finally { joinLock.current = false;if (active.current) setJoining(false); }
  };

  if (busy) {
    return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  if (readError) return <Card className="max-w-md mx-auto p-8 mt-12 space-y-3"><p role="alert">Không xác minh được lời mời. Lỗi kết nối không có nghĩa link đã hết hạn.</p><Button onClick={() => setReload(value => value + 1)}>Thử tải lại lời mời</Button></Card>;

  if (!preview || (preview.reason === "not_found" && !intent)) {
    return (
      <Card className="max-w-md mx-auto p-8 text-center border-destructive/40 mt-12">
        <AlertCircle className="w-10 h-10 mx-auto text-destructive mb-2" />
        <p className="text-sm font-semibold">{t("groupChat.invitePage.invalid")}</p>
        <p className="text-xs text-muted-foreground mt-1">{reasonText("not_found")}</p>
        <Button asChild className="mt-4" size="sm"><Link to="/inbox">{t("groupChat.invitePage.backInbox")}</Link></Button>
      </Card>
    );
  }

  return (
    <Card className="max-w-md mx-auto p-8 text-center mt-12 space-y-4">
      <Avatar className="h-20 w-20 mx-auto">
        <AvatarImage src={preview.avatar_url ?? undefined} />
        <AvatarFallback className="bg-primary/20 text-primary"><Users className="w-7 h-7" /></AvatarFallback>
      </Avatar>
      <div>
        <h1 className="text-lg font-bold flex items-center justify-center gap-2">
          {preview.group_name ?? t("groupChat.invitePage.fallbackName")}
          {preview.is_public ? <Globe className="w-4 h-4 text-muted-foreground" /> : <Lock className="w-4 h-4 text-muted-foreground" />}
        </h1>
        <p className="text-xs text-muted-foreground mt-1">{t("groupChat.invitePage.membersN", { n: preview.member_count })}</p>
      </div>
      {preview.valid || intent ? (
        <><Button onClick={join} disabled={joining || noLongerMember || (joinUnknown && !intent)} className="w-full">
          {joining ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Users className="w-4 h-4 mr-1" />}
          {intent ? 'Kiểm tra lại yêu cầu đã gửi' : t("groupChat.invitePage.joinBtn")}
        </Button>{noLongerMember ? <p role="alert">Bạn không còn trong membership đã xác nhận. Yêu cầu cũ không tự thêm bạn lại.</p> : joinUnknown && <p role="alert">Chưa xác minh được việc tham gia. Chỉ kiểm tra lại cùng yêu cầu; <Link to="/inbox" className="underline">mở hộp thư để kiểm tra nhóm</Link>.</p>}</>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-destructive flex items-center justify-center gap-1">
            <AlertCircle className="w-4 h-4" />
            {reasonText(preview.reason)}
          </div>
          <Button asChild variant="outline" size="sm"><Link to="/inbox">{t("groupChat.invitePage.backInbox")}</Link></Button>
        </div>
      )}
    </Card>
  );
};

export default GroupInvite;
