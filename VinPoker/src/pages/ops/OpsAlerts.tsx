import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { FloorVoiceAlertList, type FloorVoiceAlertRow } from "@/components/floor/FloorVoiceAlertInbox";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { sessionReadEpoch } from "@/lib/sessionReadEpoch";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";

export default function OpsAlerts() {
  const { user, session, loading: authLoading } = useOpsAuth();
  const { selectedClubId } = useOpsWorkspace();
  const { floorClubIds, isSuperAdmin, loading: scopeLoading, scopeError } = useOpsCapabilities();
  const activeClub = selectedClubId && (isSuperAdmin || floorClubIds.includes(selectedClubId))
    ? selectedClubId
    : undefined;
  const epoch = session?.access_token ? sessionReadEpoch(session) : 0;
  const ready = !scopeLoading && !scopeError && !authLoading && epoch > 0;

  return (
    <div className="ios-in space-y-4 pt-2">
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Cảnh báo Floor</h1>
        <p className="mt-1 text-sm text-[#9b8e97]">Chạm cảnh báo để xem toàn bộ action của đúng ván.</p>
      </header>
      {!activeClub && !scopeLoading && <p className="rounded-xl border border-amber-400/30 p-4 text-sm text-amber-200">Chọn CLB bạn được phân quyền Floor để xem cảnh báo.</p>}
      {scopeError && <p className="text-sm text-rose-300">Không tải được quyền Floor: {scopeError}</p>}
      {ready && user && activeClub && (
        <>
          <ClubAlerts key={JSON.stringify([user.id, activeClub, epoch])} clubId={activeClub} actorId={user.id} epoch={epoch} />
          <p className="px-1 text-xs text-[#9b8e97]">Nếu hand đã void, Floor có thể đóng cảnh báo sau khi kiểm tra nhật ký. Hand đang mở cần Dealer sửa thủ công; hand đã lưu cần luồng sửa hand.</p>
        </>
      )}
    </div>
  );
}

type AlertCursor = { created_at: string; id: string };
type ClubAlert = FloorVoiceAlertRow & AlertCursor & { tournaments: { name: string } };
const PAGE_SIZE = 50;

function ClubAlerts({ clubId, actorId, epoch }: { clubId: string; actorId: string; epoch: number }) {
  const client = useSupabaseClient();
  const navigate = useNavigate();
  const [cursors, setCursors] = useState<AlertCursor[]>([]);
  const cursor = cursors.at(-1);
  const query = useQuery({
    queryKey: ["ops", clubId, "floor-alerts", actorId, epoch, cursor],
    queryFn: async ({ signal }): Promise<ClubAlert[]> => {
      const request = client.from("tracker_floor_alerts")
        .select("id,tournament_id,physical_table_id,hand_id,title,priority,status,created_at,tournaments!tracker_floor_alerts_tournament_id_fkey!inner(name)")
        .eq("club_id", clubId)
        .eq("tournaments.club_id", clubId)
        .is("tournaments.deleted_at", null)
        .in("status", ["open", "acknowledged", "in_progress"])
        .order("created_at")
        .order("id")
        .limit(PAGE_SIZE + 1);
      if (cursor) request.or(`created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`);
      const { data, error } = await request.abortSignal(signal);
      if (error || !Array.isArray(data)) throw new Error("Không tải được cảnh báo.");
      if (data.some(row => !/^[0-9a-f-]{36}$/i.test(row.id)
        || !/^[0-9T:.+Z-]+$/.test(row.created_at) || !Number.isFinite(Date.parse(row.created_at)))) {
        throw new Error("Máy chủ trả trang cảnh báo không hợp lệ.");
      }
      return data;
    },
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
  const alerts = query.isError ? [] : (query.data ?? []).slice(0, PAGE_SIZE);
  const names = new Map(alerts.map(row => [row.tournament_id, row.tournaments.name]));
  const last = alerts.at(-1);

  return (
    <div className="space-y-3">
      {query.isLoading && <p role="status" className="text-sm text-zinc-400">Đang tải cảnh báo…</p>}
      {query.isError && <Button variant="outline" onClick={() => void query.refetch()}>Tải lại cảnh báo</Button>}
      {!query.isLoading && !query.isError && !alerts.length && <p role="status" className="text-sm text-zinc-400">Không có cảnh báo chờ xử lý trên trang này.</p>}
      <FloorVoiceAlertList
        alerts={alerts}
        error={query.error?.message ?? null}
        names={names}
        onSelect={(tournamentId, alertId) => navigate(`/ops/floor/tournaments/${tournamentId}/tables?club=${encodeURIComponent(clubId)}&alert=${encodeURIComponent(alertId)}`)}
      />
      <div className="flex flex-wrap gap-2">
        {cursor && <Button variant="outline" onClick={() => setCursors(previous => previous.slice(0, -1))}>Trang trước</Button>}
        {last && (query.data?.length ?? 0) > PAGE_SIZE && (
          <Button variant="outline" onClick={() => setCursors(previous => [...previous, { created_at: last.created_at, id: last.id }])}>Trang sau</Button>
        )}
      </div>
    </div>
  );
}
