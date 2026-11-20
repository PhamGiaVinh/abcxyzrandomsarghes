import {
  type FormEvent,
  useCallback,
  useEffect,
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
  const capabilities = useOpsCapabilities();
  const { user, session } = useOpsAuth();
  const actorScope = JSON.stringify([user?.id, sessionReadEpoch(session)]);
  const [selection, setSelection] = useState({ actorScope: "", clubId: "" });
  const ownerClubs = capabilities.scope.filter((row) => row.can_owner);
  const selectedClubId = selection.actorScope === actorScope ? selection.clubId : "";
  const clubId = ownerClubs.some(row => row.club_id === selectedClubId) ? selectedClubId
    : ownerClubs.length === 1 ? ownerClubs[0].club_id : "";
  if (capabilities.loading) return null;
  if (!user || !capabilities.hasOwnerAccess || capabilities.scopeError) return <Navigate to="/ops" replace />;
  return <ClubAccountScope key={JSON.stringify([actorScope, clubId])} clubId={clubId}
    capabilities={capabilities} ownerClubs={ownerClubs} setClubId={clubId => setSelection({ actorScope, clubId })} />;
}

function ClubAccountScope({ clubId, capabilities, ownerClubs, setClubId }: {
  clubId: string;
  capabilities: ReturnType<typeof useOpsCapabilities>;
  ownerClubs: ReturnType<typeof useOpsCapabilities>["scope"];
  setClubId: (clubId: string) => void;
}) {
  const client = useSupabaseClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OperatorInviteRole>("floor");
  const [rows, setRows] = useState<InviteRow[] | null>(null);
  const [readError, setReadError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef(false);
  const sequence = useRef(0);
  const writeBusy = useRef(false);

  const load = useCallback(async () => {
    if (!clubId || !active.current) return;
    const generation = ++sequence.current;
    setRows(null);
    setReadError(false);
    // Generated Database types cannot include an unapplied migration. The API
    // boundary is covered by a contract test until types regenerate after apply.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try {
      const { data, error } = await observeTrackerContextRead((client.from as any)("club_operator_invites")
        .select("id,club_id,email_normalized,operator_role,status")
        .eq("club_id", clubId).order("created_at", { ascending: false })) as { data: InviteRow[] | null; error: unknown };
      if (error || !Array.isArray(data) || data.some(row => !row || row.club_id !== clubId
        || typeof row.id !== "string" || !row.id || typeof row.email_normalized !== "string"
        || !isOperatorInviteRole(row.operator_role) || !["pending", "active", "revoked"].includes(row.status))) {
        throw new Error("invite_scope_unverified");
      }
      if (active.current && generation === sequence.current) setRows(data);
    } catch {
      if (active.current && generation === sequence.current) setReadError(true);
    }
  }, [client, clubId]);

  useEffect(() => {
    active.current = true;
    void load();
    return () => { active.current = false; sequence.current++; };
  }, [load]);

  const write = async (body: Record<string, string>, confirm: (data: Record<string, unknown>) => string | null) => {
    if (writeBusy.current || !active.current) return;
    writeBusy.current = true;
    setLoading(true);
    setMessage(null);
    try {
      const { data, error } = await client.functions.invoke("ops-club-accounts", { body });
      if (error || !data || typeof data !== "object") throw new Error("invite_outcome_unverified");
      if (!active.current) return;
      const confirmed = confirm(data);
      if (!confirmed) throw new Error("invite_outcome_unverified");
      setMessage(confirmed);
    } catch {
      if (active.current) setMessage("Chưa xác minh được kết quả. Kiểm tra danh sách trước khi thao tác lại.");
    } finally {
      if (active.current) {
        await load();
        setLoading(false);
      }
      writeBusy.current = false;
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!clubId || !email.trim()) return setMessage("Chọn CLB và nhập email nhân viên.");
    await write({ action: "invite", club_id: clubId, email, operator_role: role }, data => {
      if (typeof data.invite_id !== "string" || !data.invite_id) return null;
      if ((data.status === "INVITED" || data.status === "RESENT") && data.invite_status === "pending") {
        setEmail("");
        return "Đã gửi email. Lời mời đang chờ nhân viên xác nhận.";
      }
      if ((data.status === "GRANTED_EXISTING" || data.status === "ALREADY_ACTIVE") && data.invite_status === "active") {
        setEmail("");
        return "Tài khoản đã có vai trò vận hành tại CLB này.";
      }
      return null;
    });
  };

  const revoke = async (inviteId: string) => {
    if (loading || !rows?.some(row => row.id === inviteId && row.club_id === clubId && row.status !== "revoked")) return;
    await write({ action: "revoke", invite_id: inviteId }, data =>
      data.invite_id === inviteId && data.invite_status === "revoked"
        && (data.status === "REVOKED" || data.status === "ALREADY_REVOKED")
        ? "Lời mời hoặc vai trò tại CLB này đã được thu hồi." : null);
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
              <Select value={clubId} onValueChange={setClubId}>
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
              disabled={loading || !clubId}
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
            <ShieldCheck className="h-5 w-5 text-emerald-300" /> Lời mời và trạng thái quyền
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {clubId && readError && <p role="alert">Chưa tải được danh sách lời mời. <button type="button" className="underline" onClick={() => void load()}>Thử lại</button></p>}
          {clubId && !readError && rows === null && <p role="status">Đang xác minh lời mời của CLB…</p>}
          {rows?.length === 0 && (
            <p className="text-sm text-zinc-400">
              Chưa có lời mời nào cho CLB này.
            </p>
          )}
          {rows?.map((row) => (
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
