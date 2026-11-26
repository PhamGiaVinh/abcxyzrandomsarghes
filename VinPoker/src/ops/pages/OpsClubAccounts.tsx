import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, Navigate } from "react-router-dom";
import { MailPlus, ShieldCheck, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { observeTrackerContextRead } from "@/lib/tournament/observeTrackerContextRead";
import {
  inviteStatusLabel,
  isOperatorInviteRole,
  type OperatorInviteRole,
} from "@/ops/clubAdmin/clubOperatorInviteModel";

type InviteRow = {
  id: string;
  club_id: string;
  email_normalized: string;
  operator_role: OperatorInviteRole;
  status: string;
};

export default function OpsClubAccounts() {
  const auth = useOpsAuth();
  const capabilities = useOpsCapabilities();
  if (auth.loading || capabilities.loading) return null;
  if (!auth.user || capabilities.scopeError || !capabilities.hasOwnerAccess) return <Navigate to="/ops" replace />;
  const owners = capabilities.scope.filter(row => row.can_owner).map(row => row.club_id).sort();
  return <OpsClubAccountsSession key={JSON.stringify([auth.user.id, sessionReadEpoch(auth.session), owners])} />;
}

function OpsClubAccountsSession() {
  const client = useSupabaseClient();
  const capabilities = useOpsCapabilities();
  const ownerClubs = useMemo(
    () => capabilities.scope.filter((row) => row.can_owner),
    [capabilities.scope],
  );
  const [clubId, setClubId] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OperatorInviteRole>("floor");
  const [rows, setRows] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [readError, setReadError] = useState(false);
  const [reading, setReading] = useState(false);
  const active = useRef(true);
  const writing = useRef(false);
  const readRevision = useRef(0);
  const currentClub = useRef(clubId);
  currentClub.current = clubId;
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; readRevision.current += 1; };
  }, []);

  const load = useCallback(async (selectedClubId: string) => {
    const revision = ++readRevision.current;
    const current = () => active.current && readRevision.current === revision && currentClub.current === selectedClubId;
    setRows([]); setReadError(false);
    if (!selectedClubId) { setReading(false); return; }
    setReading(true);
    try {
    // Generated Database types cannot include an unapplied migration. The API
    // boundary is covered by a contract test until types regenerate after apply.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await observeTrackerContextRead<{data: InviteRow[] | null; error: unknown}>((client.from as any)("club_operator_invites")
      .select("id,club_id,email_normalized,operator_role,status")
      .eq("club_id", selectedClubId).order("created_at", { ascending: false }));
    if (!current()) return;
    if (error || !Array.isArray(data) || data.some(row => !row || row.club_id !== selectedClubId ||
      typeof row.id !== 'string' || typeof row.email_normalized !== 'string' ||
      !isOperatorInviteRole(row.operator_role) || !['pending','active','revoked'].includes(row.status))) throw Error('unverified_invite_scope');
    setRows(data);
    } catch {
      if (current()) { setRows([]); setReadError(true); }
    } finally { if (current()) setReading(false); }
  }, [client]);

  useEffect(() => {
    if (!clubId && ownerClubs.length === 1) setClubId(ownerClubs[0].club_id);
  }, [clubId, ownerClubs]);
  useEffect(() => {
    void load(clubId);
  }, [clubId, load]);
  if (capabilities.loading) return null;
  if (!capabilities.hasOwnerAccess) return <Navigate to="/ops" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const selectedClubId = clubId;
    if (writing.current || !ownerClubs.some(row => row.club_id === selectedClubId)) return;
    if (!clubId || !email.trim()) {
      return setMessage("Chọn CLB và nhập email nhân viên.");
    }
    writing.current = true; setLoading(true);
    setMessage(null);
    let result;
    try { result = await client.functions.invoke("ops-club-accounts", {
      body: { action: "invite", club_id: selectedClubId, email, operator_role: role },
    }); } catch { result = { data: null, error: true }; }
    if (!active.current || currentClub.current !== selectedClubId) return;
    const { data, error } = result;
    writing.current = false;
    setLoading(false);
    if (error || !data?.status) {
      return setMessage(
        data?.error === "INVITE_CONFIGURATION_REQUIRED"
          ? "Hệ thống gửi lời mời chưa được cấu hình. Liên hệ quản trị hệ thống."
          : "Không gửi được lời mời. Kiểm tra lại email hoặc thử lại.",
      );
    }
    setEmail("");
    setMessage(
      data.status === "INVITED" || data.status === "RESENT"
        ? "Đã gửi email để nhân viên tự đặt mật khẩu. Quyền hiển thị ở trạng thái chờ xác nhận."
        : "Tài khoản đã xác nhận: đã cấp đúng quyền CLB, không đổi mật khẩu.",
    );
    await load(selectedClubId);
  };

  const revoke = async (inviteId: string) => {
    const selectedClubId = clubId;
    if (writing.current || reading || readError || !rows.some(row => row.id === inviteId && row.club_id === selectedClubId && row.status !== 'revoked')) return;
    writing.current = true; setLoading(true);
    setMessage(null);
    let result;
    try { result = await client.functions.invoke("ops-club-accounts", {
      body: { action: "revoke", invite_id: inviteId },
    }); } catch { result = { error: true }; }
    if (!active.current || currentClub.current !== selectedClubId) return;
    const { error } = result;
    writing.current = false;
    setLoading(false);
    if (error) return setMessage("Không thu hồi được quyền. Vui lòng thử lại.");
    setMessage(
      "Đã thu hồi quyền Floor/Cashier của CLB này. Tài khoản Auth không bị xóa.",
    );
    await load(selectedClubId);
  };

  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 p-4 pb-28 sm:p-6">
      <Link
        to="/ops/account"
        className="text-sm text-emerald-300 underline-offset-4 hover:underline"
      >
        ← Tài khoản Ops
      </Link>
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
          Quản trị CLB
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-white">
          Tài khoản vận hành
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Chủ CLB chỉ mời Floor hoặc Cashier cho CLB của mình. Nhân viên tự đặt
          mật khẩu qua email; không có nút cấp Owner ở đây.
        </p>
      </header>
      <Card className="border-emerald-300/20 bg-emerald-300/5 text-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MailPlus className="h-5 w-5 text-emerald-300" /> Mời nhân viên
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Quyền được gắn theo CLB, không dùng global role.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="ops-invite-club">CLB</Label>
              <Select value={clubId} onValueChange={value => {
                if (loading) return;
                readRevision.current += 1;
                setRows([]); setMessage(null); setReadError(false); setReading(Boolean(value)); setClubId(value);
              }}>
                <SelectTrigger
                  id="ops-invite-club"
                  className="min-h-11 bg-black/20"
                >
                  <SelectValue placeholder="Chọn CLB" />
                </SelectTrigger>
                <SelectContent>
                  {ownerClubs.map((club) => (
                    <SelectItem key={club.club_id} value={club.club_id}>
                      {capabilities.clubs.find((item) =>
                        item.id === club.club_id
                      )?.name ?? "CLB của bạn"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ops-invite-email">Email nhân viên</Label>
              <Input
                id="ops-invite-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="min-h-11 bg-black/20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ops-invite-role">Vai trò</Label>
              <Select
                value={role}
                onValueChange={(value) =>
                  isOperatorInviteRole(value) && setRole(value)}
              >
                <SelectTrigger
                  id="ops-invite-role"
                  className="min-h-11 bg-black/20"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="floor">Floor</SelectItem>
                  <SelectItem value="cashier">Cashier</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="submit"
              disabled={loading || !ownerClubs.length}
              className="min-h-11 sm:col-span-2"
            >
              Gửi lời mời bảo mật
            </Button>
          </form>
          {message && (
            <p className="mt-3 text-sm text-zinc-300" role="status">
              {message}
            </p>
          )}
        </CardContent>
      </Card>
      <Card className="border-white/10 bg-white/[0.035] text-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5 text-emerald-300" /> Danh sách lời mời
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {reading && <p role="status">Đang tải lời mời của CLB…</p>}
          {readError && <div role="alert">Chưa tải được danh sách lời mời. <Button variant="outline" onClick={() => void load(clubId)}>Thử lại</Button></div>}
          {!rows.length && !reading && !readError && (
            <p className="text-sm text-zinc-400">
              Chưa có lời mời nào cho CLB này.
            </p>
          )}
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/20 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{row.email_normalized}</p>
                <p className="mt-1 text-xs text-zinc-400">
                  {row.operator_role === "floor" ? "Floor" : "Cashier"} ·{" "}
                  {inviteStatusLabel(row.status)}
                </p>
              </div>
              {row.status !== "revoked" && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={loading}
                  onClick={() => void revoke(row.id)}
                  className="min-h-11 border-rose-300/30 text-rose-200"
                >
                  <UserMinus className="mr-2 h-4 w-4" />Thu hồi
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
