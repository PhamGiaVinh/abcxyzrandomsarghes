import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, History, Radio, RefreshCw } from "lucide-react";
import TournamentLivePanel from "@/components/cashier/TournamentLivePanel";

type ClubRow = { id: string; name: string };
type TrackerReadResult<T> = { data: T | null; error: unknown | null };

function isTransientReadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const detail = error as { status?: unknown; message?: unknown };
  return (typeof detail.status === "number" && (detail.status === 0 || detail.status >= 500)) ||
    (error instanceof TypeError && typeof detail.message === "string" && /failed to fetch|network|timeout/i.test(detail.message)) ||
    (typeof detail.message === "string" && /failed to fetch|network|timeout|temporar/i.test(detail.message));
}

function trackerReadErrorMessage(error: unknown): string {
  if (error instanceof TypeError || (error && typeof error === "object" &&
      "message" in error && typeof error.message === "string" && /failed to fetch|network|timeout/i.test(error.message))) {
    return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử tải lại.";
  }
  return "Máy chủ chưa xác minh được danh sách CLB. Vui lòng thử lại.";
}

async function readWithRetry<T>(
  read: () => PromiseLike<TrackerReadResult<T>>,
  isCurrentRequest: () => boolean,
): Promise<TrackerReadResult<T>> {
  let result: TrackerReadResult<T> = { data: null, error: null };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!isCurrentRequest()) return result;
    try {
      result = await read();
    } catch (error) {
      result = { data: null, error };
    }
    if (!result.error || !isTransientReadError(result.error) || attempt === 2) return result;
    await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
  }
  return result;
}

export default function TrackerDashboard() {
  const { user, loading, isAdmin, rolesLoading, rolesError } = useAuth();
  const userId = user?.id ?? null;
  const nav = useNavigate();
  const [clubs, setClubs] = useState<ClubRow[] | null>(null);
  // TournamentLivePanel keys its read/subscription effects on this reference.
  // A selected-tour update must not look like a different verified club scope.
  const clubIds = useMemo(() => (clubs ?? []).map((club) => club.id), [clubs]);
  const [clubsError, setClubsError] = useState<string | null>(null);
  const [clubsForUserId, setClubsForUserId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [historyTournamentId, setHistoryTournamentId] = useState<string | null>(null);
  const clubRequestId = useRef(0);

  useEffect(() => {
    if (loading) return;
    if (!userId) { nav("/auth"); return; }
  }, [loading, userId, nav]);

  const loadClubs = useCallback(async (requestedUserId: string) => {
    const requestId = ++clubRequestId.current;
    const isCurrentRequest = () => clubRequestId.current === requestId;
    setClubs(null);
    setClubsError(null);
    setClubsForUserId(null);

    // Read scopes only. Floor visibility does not grant Tracker/card writes;
    // every operational RPC still verifies its own actor/tenant/session fence.
    const [trackerScope, floorScope] = await Promise.all([
      readWithRetry(() => supabase.rpc("tracker_club_ids", { _user_id: requestedUserId }), isCurrentRequest),
      readWithRetry(() => supabase.rpc("floor_club_ids", { _user_id: requestedUserId }), isCurrentRequest),
    ]);
    if (!isCurrentRequest()) return;
    const scopeError = trackerScope.error || floorScope.error;
    if (scopeError) {
      setClubsError(trackerReadErrorMessage(scopeError));
      setClubsForUserId(requestedUserId);
      return;
    }

    if (!Array.isArray(trackerScope.data) || !Array.isArray(floorScope.data)
      || [...trackerScope.data, ...floorScope.data].some((clubId) => typeof clubId !== "string" || !clubId.trim())) {
      setClubsError("Dữ liệu phạm vi CLB không hợp lệ. Hãy thử lại.");
      setClubsForUserId(requestedUserId);
      return;
    }
    const idArr = [...new Set([...trackerScope.data, ...floorScope.data]
      .filter((clubId): clubId is string => typeof clubId === "string"))];
    if (!idArr.length) {
      setClubsError(null);
      setClubs([]);
      setClubsForUserId(requestedUserId);
      return;
    }

    const clubResult = await readWithRetry(
      () => supabase.from("clubs").select("id, name").in("id", idArr),
      isCurrentRequest,
    );
    if (!isCurrentRequest()) return;
    const resolvedIds = new Set((clubResult.data ?? []).map((club) => club.id));
    const missingClubId = idArr.some((clubId) => !resolvedIds.has(clubId));
    if (clubResult.error || !clubResult.data?.length || missingClubId) {
      setClubsError(clubResult.error
        ? trackerReadErrorMessage(clubResult.error)
        : "Quyền CLB đã được xác nhận nhưng thông tin CLB không khớp. Cần kiểm tra dữ liệu.");
      setClubsForUserId(requestedUserId);
      return;
    }

    setClubsError(null);
    setClubs(clubResult.data as ClubRow[]);
    setClubsForUserId(requestedUserId);
  }, []);

  useEffect(() => {
    if (!userId) {
      clubRequestId.current += 1;
      setClubs(null);
      setClubsError(null);
      setClubsForUserId(null);
      return;
    }

    void loadClubs(userId);
    return () => { clubRequestId.current += 1; };
  }, [userId, reloadKey, loadClubs]);

  const effectiveClubsError = clubsError || (clubs?.length === 0 && !isAdmin && !rolesLoading ? rolesError : null);
  if (loading || !user || (clubs?.length === 0 && rolesLoading)) {
    return <div className="container mx-auto p-6"><Skeleton className="h-96 rounded-xl" /></div>;
  }
  if (clubsForUserId !== userId) {
    return <div className="container mx-auto p-6"><Skeleton className="h-96 rounded-xl" /></div>;
  }
  if (effectiveClubsError) {
    return (
      <div className="container mx-auto p-6">
        <Card className="p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 mx-auto text-destructive" />
          <div className="text-lg font-bold">Không tải được danh sách CLB</div>
          <p className="text-sm text-muted-foreground">{effectiveClubsError}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (!clubsError && rolesError) { window.location.reload(); return; }
              setClubsError(null); setClubs(null); setReloadKey((k) => k + 1);
            }}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" /> Thử lại
          </Button>
        </Card>
      </div>
    );
  }
  if (clubs === null) {
    return <div className="container mx-auto p-6"><Skeleton className="h-96 rounded-xl" /></div>;
  }
  if (clubs.length === 0 && !isAdmin) {
    return (
      <div className="container mx-auto p-6">
        <Card className="p-8 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 mx-auto text-warning" />
          <div className="text-lg font-bold">Bạn chưa được phân công CLB nào</div>
          <p className="text-sm text-muted-foreground">
            Liên hệ Super Admin để được gán quyền Tracker cho câu lạc bộ.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-3 md:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/15 text-emerald-400 rounded-md text-xs font-bold border border-emerald-500/30">
            <Radio className="w-3.5 h-3.5" /> LIVE TRACKER
          </div>
          <div className="text-sm text-muted-foreground">
            {clubs.length === 1 ? clubs[0].name : `${clubs.length} CLB`}
          </div>
        </div>
        <Button type="button" variant="outline" className="min-h-11 border-amber-500/35 text-amber-200" onClick={() => nav(historyTournamentId ? `/tracker/history?t=${encodeURIComponent(historyTournamentId)}` : "/tracker/history")}>
          <History className="mr-2 h-4 w-4" /> Lịch sử & sửa hand
        </Button>
      </div>
      <TournamentLivePanel mode="tracker" clubIds={clubIds} clubs={clubs} onSelectedTournamentChange={setHistoryTournamentId} />
    </div>
  );
}
