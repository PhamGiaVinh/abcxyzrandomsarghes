import { useNavigate } from "react-router-dom";
import { FloorVoiceAlertInbox } from "@/components/floor/FloorVoiceAlertInbox";
import { useTournaments } from "@/hooks/useTournaments";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";
import { useOpsWorkspace } from "@/ops/workspace/OpsWorkspaceProvider";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";

export default function OpsAlerts() {
  const navigate = useNavigate();
  const { user } = useOpsAuth();
  const { selectedClubId } = useOpsWorkspace();
  const { floorClubIds, isSuperAdmin, loading: scopeLoading, scopeError } = useOpsCapabilities();
  const activeClub = selectedClubId && (isSuperAdmin || floorClubIds.includes(selectedClubId))
    ? selectedClubId
    : undefined;
  const { data: tournaments, isLoading, error } = useTournaments(activeClub, user?.id);

  return (
    <div className="ios-in space-y-4 pt-2">
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Cảnh báo Floor</h1>
        <p className="mt-1 text-sm text-[#9b8e97]">Chạm cảnh báo để xem toàn bộ action của đúng ván.</p>
      </header>
      {!activeClub && !scopeLoading && <p className="rounded-xl border border-amber-400/30 p-4 text-sm text-amber-200">Chọn CLB bạn được phân quyền Floor để xem cảnh báo.</p>}
      {scopeError && <p className="text-sm text-rose-300">Không tải được quyền Floor: {scopeError}</p>}
      {activeClub && isLoading && <p className="text-sm text-zinc-400">Đang tải cảnh báo...</p>}
      {activeClub && error && <p className="text-sm text-rose-300">Không tải được giải đấu: {error.message}</p>}
      {activeClub && !isLoading && !error && (
        <>
          <FloorVoiceAlertInbox
            tournaments={(tournaments ?? []).map((tournament) => ({ id: tournament.id, name: tournament.name }))}
            onSelect={(tournamentId, alertId) => navigate(`/ops/floor/tournaments/${tournamentId}/tables?club=${encodeURIComponent(activeClub)}&alert=${encodeURIComponent(alertId)}`)}
          />
          <p className="px-1 text-xs text-[#9b8e97]">Nếu hand đã void, Floor có thể đóng cảnh báo sau khi kiểm tra nhật ký. Hand đang mở cần Dealer sửa thủ công; hand đã lưu cần luồng sửa hand.</p>
        </>
      )}
    </div>
  );
}
