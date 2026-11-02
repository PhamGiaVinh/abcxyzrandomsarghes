import { useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Plus, Search, X, Pencil, Trash2, Loader2, Send, Copy, Unlink2, Link2 } from "lucide-react";
import { useAllDealers, useDealerScores, type DealerRecord, type DealerScore } from "@/hooks/useDealerManagement";
import AddDealerDialog from "./AddDealerDialog";
import DealerAdjustDialog from "./DealerAdjustDialog";
import { BulkDealerImportDialog } from "./BulkDealerImportDialog";
import { BulkSalaryDialog } from "./BulkSalaryDialog";
import { BulkShiftPreferenceDialog } from "./BulkShiftPreferenceDialog";
import { BulkEditDialog } from "./BulkEditDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { FEATURES } from "@/lib/featureFlags";
import { toast } from "sonner";
import { useAuth } from '@/hooks/useAuth';
import { sessionReadEpoch } from '@/lib/sessionReadEpoch';

type MainTab = "dealers" | "telegram";

interface DealerManagementTabProps {
  clubIds: string[];
  clubFilter: string | null;
}

type FilterMode = "all" | "full_time" | "part_time" | "A" | "B" | "C";

export default function DealerManagementTab(props: DealerManagementTabProps) {
  const {user,session}=useAuth();
  return <DealerManagementSession key={JSON.stringify([user?.id??null,sessionReadEpoch(session),[...props.clubIds].sort(),props.clubFilter])} {...props}/>;
}

function DealerManagementSession({ clubIds, clubFilter }: DealerManagementTabProps) {
  const activeClubId = clubFilter ?? clubIds[0] ?? "";
  const { data: dealers, loading: dealersLoading, error: dealersError, refetch: refetchDealers } = useAllDealers(clubIds);
  const { data: scores, loading: scoresLoading, error: scoresError, refetch: refetchScores } = useDealerScores(activeClubId);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedDealer, setSelectedDealer] = useState<string | null>(null);
  const [adjustDealer, setAdjustDealer] = useState<DealerRecord | null>(null);
  const [deleteDealerId, setDeleteDealerId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>("dealers");
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [usernameDrafts, setUsernameDrafts] = useState<Record<string, string>>({});
  // Multi-select for bulk delete / bulk edit (tier + employment).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Soft-delete handler
  const handleSoftDelete = async () => {
    if (!deleteDealerId) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("dealers")
        .update({ deleted_at: new Date().toISOString(), status: "inactive" })
        .eq("id", deleteDealerId);
      if (error) throw error;
      toast.success("Đã xoá dealer");
      setDeleteDealerId(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi xoá dealer");
    } finally {
      setDeleting(false);
    }
  };

  // ── Multi-select helpers ────────────────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Bulk soft-delete (same as single: deleted_at + status inactive), grouped .in().
  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBulkDeleting(true);
    try {
      const { error } = await supabase
        .from("dealers")
        .update({ deleted_at: new Date().toISOString(), status: "inactive" })
        .in("id", ids);
      if (error) throw error;
      toast.success(`Đã xoá ${ids.length} dealer`);
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      refetchDealers();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi xoá hàng loạt");
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleUnlink = async (dealerId: string) => {
    setUnlinkingId(dealerId);
    try {
      const { error } = await supabase
        .from("dealers")
        .update({ telegram_user_id: null, telegram_username: null })
        .eq("id", dealerId);
      if (error) throw error;
      toast.success("Đã huỷ liên kết Telegram");
      refetchDealers();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi huỷ liên kết");
    } finally {
      setUnlinkingId(null);
    }
  };

  // Operator-side link: store the dealer's @username (handle). The bot fills in
  // the numeric telegram_user_id automatically the first time that dealer
  // messages it (e.g. their first /checkin) — see telegram-bot username match.
  const handleSetUsername = async (dealerId: string) => {
    const handle = (usernameDrafts[dealerId] ?? "").trim().replace(/^@+/, "");
    if (!handle) {
      toast.error("Nhập @username Telegram của dealer");
      return;
    }
    setLinkingId(dealerId);
    try {
      const { error } = await supabase
        .from("dealers")
        .update({ telegram_username: handle })
        .eq("id", dealerId);
      if (error) throw error;
      toast.success(`Đã lưu @${handle}. Dealer gõ /checkin lần đầu là tự liên kết.`);
      setUsernameDrafts((d) => {
        const next = { ...d };
        delete next[dealerId];
        return next;
      });
      refetchDealers();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi lưu username");
    } finally {
      setLinkingId(null);
    }
  };

  const handleCopyInviteLink = (dealerName: string) => {
    const link = `https://t.me/VBACKERBOT?start=${encodeURIComponent(dealerName)}`;
    navigator.clipboard.writeText(link).then(
      () => toast.success("Đã sao chép liên kết mời"),
      () => toast.error("Không thể sao chép")
    );
  };

  // Build a map of dealer_id → score
  const scoreMap = useMemo(() => {
    const map = new Map<string, DealerScore>();
    for (const s of scores) map.set(s.dealer_id, s);
    return map;
  }, [scores]);

  // Filter + search
  const filtered = useMemo(() => {
    let list = dealers;

    if (filterMode === "full_time") {
      list = list.filter((d) => d.employment_type === "full_time");
    } else if (filterMode === "part_time") {
      list = list.filter((d) => d.employment_type === "part_time");
    } else if (filterMode === "A" || filterMode === "B" || filterMode === "C") {
      list = list.filter((d) => d.tier === filterMode);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((d) => d.full_name.toLowerCase().includes(q));
    }

    // Sort by score desc (name asc as tiebreaker)
    return [...list].sort((a, b) => {
      const sa = scoreMap.get(a.id)?.score ?? 0;
      const sb = scoreMap.get(b.id)?.score ?? 0;
      if (sb !== sa) return sb - sa;
      return a.full_name.localeCompare(b.full_name);
    });
  }, [dealers, filterMode, searchQuery, scoreMap]);

  const loading = dealersLoading || scoresLoading;

  // ── Sub-component: dealer detail panel ─────────────────────────────────
  const SelectedDetail = () => {
    if (!selectedDealer) return null;
    const dealer = dealers.find((d) => d.id === selectedDealer);
    const score = scoreMap.get(selectedDealer);
    if (!dealer) return null;

    return (
      <div className="mt-4 p-4 rounded-lg bg-card border border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-white">{dealer.full_name}</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedDealer(null)}
            className="text-muted-foreground hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">Hạng:</span>{" "}
            <span className="text-white">{dealer.tier}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Loại:</span>{" "}
            <span className="text-white">
              {dealer.employment_type === "part_time" ? "Part-time" : "Full-time"}
            </span>
          </div>
          {dealer.employment_type === "part_time" ? (
            dealer.hourly_rate_vnd != null && (
              <div>
                <span className="text-muted-foreground">Lương giờ:</span>{" "}
                <span className="text-white">{dealer.hourly_rate_vnd.toLocaleString("vi-VN")} VND/h</span>
              </div>
            )
          ) : (
            <>
              {dealer.monthly_salary_vnd != null && dealer.monthly_salary_vnd > 0 && (
                <div>
                  <span className="text-muted-foreground">Lương tháng:</span>{" "}
                  <span className="text-success font-semibold">{dealer.monthly_salary_vnd.toLocaleString("vi-VN")} VND</span>
                </div>
              )}
              {dealer.hourly_rate_vnd != null && (
                <div>
                  <span className="text-muted-foreground">Lương giờ:</span>{" "}
                  <span className="text-white">{dealer.hourly_rate_vnd.toLocaleString("vi-VN")} VND/h</span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Giờ chuẩn/ca:</span>{" "}
                <span className="text-white">{dealer.standard_hours_per_shift ?? 8}h</span>
              </div>
              <div>
                <span className="text-muted-foreground">OT:</span>{" "}
                <span className="text-white">×{dealer.ot_multiplier ?? 1.5}</span>
              </div>
            </>
          )}
          {score && (
            <>
              <div>
                <span className="text-muted-foreground">Điểm:</span>{" "}
                <span className="text-success font-semibold">{score.score.toFixed(1)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Giờ làm (30 ngày):</span>{" "}
                <span className="text-white">{score.total_hours.toFixed(1)}h</span>
              </div>
              <div>
                <span className="text-muted-foreground">Số swing:</span>{" "}
                <span className="text-white">{score.total_swings}</span>
              </div>
            </>
          )}
          {dealer.phone && (
            <div>
              <span className="text-muted-foreground">SĐT:</span>{" "}
              <span className="text-white">{dealer.phone}</span>
            </div>
          )}
          {dealer.notes && (
            <div className="col-span-2">
              <span className="text-muted-foreground">Ghi chú:</span>{" "}
              <span className="text-white text-sm">{dealer.notes}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Filter buttons ─────────────────────────────────────────────────────
  const filters: { key: FilterMode; label: string }[] = [
    { key: "all", label: "Tất cả" },
    { key: "full_time", label: "Full-time" },
    { key: "part_time", label: "Part-time" },
    { key: "A", label: "Hạng A" },
    { key: "B", label: "Hạng B" },
    { key: "C", label: "Hạng C" },
  ];

  if (dealersError || scoresError) return <div role="alert" className="space-y-3 rounded-lg border border-destructive/40 p-4 text-sm">
    <p>Không xác minh được dữ liệu dealer. Đây không phải xác nhận danh sách trống; chưa dùng dữ liệu này để chỉnh sửa.</p>
    <Button variant="outline" onClick={() => { refetchDealers(); refetchScores(); }}>Thử tải lại dữ liệu dealer</Button>
  </div>;

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-2">
        <button
          onClick={() => setMainTab("dealers")}
          className={`px-4 py-1.5 text-sm rounded-md transition-colors font-medium ${
            mainTab === "dealers"
              ? "bg-success text-success-foreground"
              : "bg-muted text-muted-foreground hover:text-white hover:bg-secondary"
          }`}
        >
          Danh sách
        </button>
        <button
          onClick={() => setMainTab("telegram")}
          className={`px-4 py-1.5 text-sm rounded-md transition-colors font-medium flex items-center gap-1.5 ${
            mainTab === "telegram"
              ? "bg-success text-success-foreground"
              : "bg-muted text-muted-foreground hover:text-white hover:bg-secondary"
          }`}
        >
          <Send className="w-3.5 h-3.5" />
          Telegram
        </button>
      </div>

      {mainTab === "dealers" ? (
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {filters.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilterMode(f.key)}
                className={`px-3 py-1 text-xs rounded-full transition-colors ${
                  filterMode === f.key
                    ? "bg-success text-success-foreground"
                    : "bg-muted text-muted-foreground hover:text-white hover:bg-secondary"
                }`}
              >
                {f.label}
              </button>
            ))}
            <div className="flex-1" />
            <div className="relative w-48">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm dealer..."
                className="pl-7 h-8 text-xs bg-card border-border text-white"
              />
            </div>
            <Button
              size="sm"
              onClick={() => setAddDialogOpen(true)}
              className="bg-success hover:bg-success/90 text-success-foreground h-8 text-xs"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Thêm dealer
            </Button>
            {FEATURES.bulkDealerImport && activeClubId && (
              <BulkDealerImportDialog
                clubId={activeClubId}
                existingNames={dealers.map((d) => d.full_name)}
                onDone={refetchDealers}
              />
            )}
            {FEATURES.bulkSalaryApply && activeClubId && (
              <BulkSalaryDialog
                dealers={dealers.filter((d) => d.club_id === activeClubId)}
                onDone={refetchDealers}
              />
            )}
            {activeClubId && (
              <BulkShiftPreferenceDialog
                dealers={dealers.filter((d) => d.club_id === activeClubId)}
                onDone={refetchDealers}
              />
            )}
          </div>

          {/* Bulk-select action bar */}
          {selectedIds.size > 0 && (
            <div className="mb-2 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs">
              <span>Đã chọn <b className="text-foreground">{selectedIds.size}</b> dealer</span>
              <span className="flex-1" />
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setBulkEditOpen(true)}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Sửa hàng loạt
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={() => setBulkDeleteOpen(true)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Xoá {selectedIds.size}
              </Button>
              <button className="text-muted-foreground hover:underline" onClick={() => setSelectedIds(new Set())}>
                Bỏ chọn
              </button>
            </div>
          )}

          {/* Table */}
          <ScrollArea className="flex-1">
            {loading && filtered.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                Đang tải...
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                Không có dealer
              </div>
            ) : (
              <div className="space-y-1">
                {/* Header */}
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    className="shrink-0"
                    aria-label="Chọn tất cả"
                    checked={filtered.length > 0 && filtered.every((d) => selectedIds.has(d.id))}
                    onCheckedChange={(v) => setSelectedIds(v === true ? new Set(filtered.map((d) => d.id)) : new Set())}
                  />
                  <div className="flex-1 grid grid-cols-12 gap-2 px-3 py-2 text-xs text-muted-foreground font-medium">
                    <div className="col-span-1 text-center">#</div>
                    <div className="col-span-3">Tên</div>
                    <div className="col-span-1">Hạng</div>
                    <div className="col-span-1">Loại</div>
                    <div className="col-span-2 text-right">Giờ</div>
                    <div className="col-span-2 text-right">Lương</div>
                    <div className="col-span-1 text-right">Điểm</div>
                    <div className="col-span-1 text-center">Sửa</div>
                  </div>
                </div>
                {/* Rows */}
                {filtered.map((dealer, idx) => {
                  const score = scoreMap.get(dealer.id);
                  const rank = idx + 1;
                  const isSelected = selectedDealer === dealer.id;
                  const monthlyPay = dealer.employment_type === "part_time"
                    ? (score ? Math.round(score.total_hours * (dealer.hourly_rate_vnd ?? 0)) : null)
                    : dealer.monthly_salary_vnd ?? dealer.base_rate_vnd;
                  // PT with no worked hours yet (e.g. fresh bulk import): the month
                  // estimate above is null/0, which rendered "—" and looked like the
                  // salary was never saved (owner 2026-07-07). Fall back to showing
                  // the configured hourly RATE so a set salary is always visible.
                  const ptHourlyRate = dealer.employment_type === "part_time"
                    ? dealer.hourly_rate_vnd ?? null
                    : null;
                  return (
                    <div key={dealer.id} className="flex items-center gap-1.5">
                      <Checkbox
                        className="shrink-0"
                        aria-label={`Chọn ${dealer.full_name}`}
                        checked={selectedIds.has(dealer.id)}
                        onCheckedChange={() => toggleSelect(dealer.id)}
                      />
                    <button
                      onClick={() => setSelectedDealer(isSelected ? null : dealer.id)}
                      className={`flex-1 grid grid-cols-12 gap-2 px-3 py-2 text-sm rounded transition-colors text-left ${
                        isSelected
                          ? "bg-success/10 border border-success/30"
                          : "hover:bg-muted/50 border border-transparent"
                      }`}
                    >
                      <div className="col-span-1 text-center text-muted-foreground">
                        {rank <= 3 ? (
                          <span
                            className={
                              rank === 1
                                ? "text-warning font-bold"
                                : rank === 2
                                ? "text-foreground font-bold"
                                : "text-warning font-bold"
                            }
                          >
                            {rank}
                          </span>
                        ) : (
                          rank
                        )}
                      </div>
                      <div className="col-span-3 text-white truncate flex items-center gap-1.5">
                        <span className="truncate">{dealer.full_name}</span>
                        {(dealer.shift_preference === "som" || dealer.shift_preference === "muon") && (
                          <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0 text-[10px] text-primary">
                            {dealer.shift_preference === "som" ? "Sớm" : "Muộn"}
                          </span>
                        )}
                      </div>
                      <div className="col-span-1">
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            dealer.tier === "A"
                              ? "border-destructive text-destructive"
                              : dealer.tier === "B"
                              ? "border-[hsl(var(--ds-active))] text-[hsl(var(--ds-active))]"
                              : "border-border text-muted-foreground"
                          }`}
                        >
                          {dealer.tier}
                        </Badge>
                      </div>
                      <div className="col-span-1 text-foreground">
                        {dealer.employment_type === "part_time" ? (
                          <span className="text-warning">PT</span>
                        ) : (
                          <span className="text-success">FT</span>
                        )}
                      </div>
                      <div className="col-span-2 text-right text-foreground">
                        {score ? `${score.total_hours.toFixed(1)}h` : "—"}
                      </div>
                      <div className="col-span-2 text-right text-success text-xs">
                        {monthlyPay
                          ? `${(monthlyPay / 1000000).toFixed(1)}M`
                          : ptHourlyRate
                            ? `${Math.round(ptHourlyRate / 1000)}k/h`
                            : "—"}
                      </div>
                      <div className="col-span-1 text-right">
                        {score ? (
                          <span className={rank <= 3 ? "text-success font-semibold" : "text-foreground"}>
                            {score.score.toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                      <div className="col-span-1 text-center flex items-center justify-center gap-0.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); setAdjustDealer(dealer); }}
                          className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-secondary text-muted-foreground hover:text-white transition-colors"
                          title="Điều chỉnh"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteDealerId(dealer.id); }}
                          className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-secondary text-muted-foreground hover:text-destructive transition-colors"
                          title="Xoá"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </button>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {/* Detail panel */}
          <SelectedDetail />
        </>
      ) : (
        /* ── Telegram Tab ─────────────────────────────── */
        <ScrollArea className="flex-1">
          {dealersLoading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              Đang tải...
            </div>
          ) : dealers.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              Không có dealer
            </div>
          ) : (
            <div className="space-y-1">
              {/* Header */}
              <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs text-muted-foreground font-medium">
                <div className="col-span-3">Tên</div>
                <div className="col-span-2">Hạng</div>
                <div className="col-span-4">Telegram</div>
                <div className="col-span-3 text-right">Hành động</div>
              </div>
              {/* Rows */}
              {dealers.map((dealer) => {
                const isLinked = dealer.telegram_user_id != null;
                const isPending = !isLinked && !!dealer.telegram_username;
                const draft = usernameDrafts[dealer.id] ?? "";
                return (
                  <div
                    key={dealer.id}
                    className="grid grid-cols-12 gap-2 px-3 py-2 text-sm rounded hover:bg-muted/50 border border-transparent items-center"
                  >
                    <div className="col-span-3 text-white truncate">
                      {dealer.full_name}
                    </div>
                    <div className="col-span-2">
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          dealer.tier === "A"
                            ? "border-destructive text-destructive"
                            : dealer.tier === "B"
                            ? "border-[hsl(var(--ds-active))] text-[hsl(var(--ds-active))]"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {dealer.tier}
                      </Badge>
                    </div>
                    <div className="col-span-4">
                      {isLinked ? (
                        <span className="text-success text-xs">
                          {dealer.telegram_username
                            ? `@${dealer.telegram_username}`
                            : `ID: ${dealer.telegram_user_id}`}
                        </span>
                      ) : isPending ? (
                        <span className="text-warning text-xs">
                          ⏳ @{dealer.telegram_username} · chờ dealer nhắn bot
                        </span>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground text-xs">@</span>
                          <Input
                            value={draft}
                            onChange={(e) =>
                              setUsernameDrafts((d) => ({ ...d, [dealer.id]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSetUsername(dealer.id);
                            }}
                            placeholder="username Telegram"
                            className="h-7 text-xs bg-card border-border"
                          />
                        </div>
                      )}
                    </div>
                    <div className="col-span-3 flex items-center justify-end gap-1">
                      {isLinked || isPending ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleUnlink(dealer.id)}
                          disabled={unlinkingId === dealer.id}
                          className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          {unlinkingId === dealer.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                          ) : isLinked ? (
                            <Unlink2 className="w-3.5 h-3.5 mr-1" />
                          ) : (
                            <X className="w-3.5 h-3.5 mr-1" />
                          )}
                          {isLinked ? "Huỷ liên kết" : "Huỷ"}
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSetUsername(dealer.id)}
                            disabled={linkingId === dealer.id || !draft.trim()}
                            className="h-7 text-xs text-success hover:text-success hover:bg-success/10"
                          >
                            {linkingId === dealer.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                            ) : (
                              <Link2 className="w-3.5 h-3.5 mr-1" />
                            )}
                            Liên kết
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyInviteLink(dealer.full_name)}
                            title="Copy link mời (cách cũ)"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-success hover:bg-success/10"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      )}

      {/* Add dealer dialog */}
      <AddDealerDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        clubId={activeClubId}
        onDealerAdded={() => {
          // Refetch is automatic via polling
        }}
      />
      {/* Adjust dealer dialog — always mounted, controlled by open prop */}
      <DealerAdjustDialog
        dealer={adjustDealer}
        open={!!adjustDealer}
        onClose={() => setAdjustDealer(null)}
        onSaved={() => {
          setAdjustDealer(null);
        }}
      />

      {/* Bulk edit (Hạng + Loại) */}
      <BulkEditDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        dealers={dealers.filter((d) => selectedIds.has(d.id))}
        onDone={() => { setSelectedIds(new Set()); refetchDealers(); }}
      />

      {/* Bulk soft-delete confirmation */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá {selectedIds.size} dealer?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedIds.size} dealer đã chọn sẽ bị xoá (ẩn khỏi danh sách + vô hiệu hoá). Lịch sử chấm công / lương vẫn giữ.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Huỷ</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleBulkDelete(); }}
              disabled={bulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleting ? "Đang xoá..." : `Xoá ${selectedIds.size} dealer`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Soft-delete confirmation */}
      <AlertDialog open={!!deleteDealerId} onOpenChange={(o) => { if (!o) setDeleteDealerId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá dealer?</AlertDialogTitle>
            <AlertDialogDescription>
              Dealer sẽ bị ẩn khỏi danh sách nhưng dữ liệu vẫn được giữ. Hành động này có thể hoàn tác bằng cách đặt lại trạng thái.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={handleSoftDelete} disabled={deleting} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
              {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Xoá
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
