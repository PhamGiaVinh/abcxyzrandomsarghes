import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Navigate } from "react-router-dom";
import {
  useTournaments,
  useCreateTournament,
  useUpdateTournament,
  useDeleteTournament,
} from "@/hooks/useTournaments";
import { useActiveTables } from "@/hooks/useDealerSwing";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { TournamentWithTables } from "@/types/tournament";

export default function TournamentConfigPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading, isAdmin, roles } = useAuth();
  const hasDealerControl = (roles as any[]).some((r) => r === "dealer_control");
  const role = isAdmin
    ? "super_admin"
    : hasDealerControl
      ? ("dealer_control" as any)
      : roles.includes("club_admin")
        ? "club_admin"
        : null;
  const { clubId } = useParams<{ clubId: string }>();
  const clubIdStr = clubId ?? "";

  const { data: tournaments, isLoading: toursLoading } = useTournaments(clubIdStr);
  const { data: allTables } = useActiveTables(clubIdStr ? [clubIdStr] : []);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTournament, setEditingTournament] = useState<TournamentWithTables | null>(null);

  if (authLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> {t("tournamentConfig.loading")}
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  const canManageSwing =
    isAdmin ||
    role === "dealer_control" ||
    role === "club_admin";

  if (!canManageSwing) {
    return (
      <div className="p-6 text-muted-foreground">
        {t("tournamentConfig.noPermission")}
      </div>
    );
  }

  if (!clubId) {
    return (
      <div className="p-6 text-muted-foreground">
        {t("tournamentConfig.selectClubFromUrl")}
      </div>
    );
  }

  if (toursLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> {t("tournamentConfig.loading")}
      </div>
    );
  }

  // Tables chưa được assign vào tournament nào
  const assignedTableIds = new Set(
    tournaments?.flatMap((t) => t.tournament_tables.map((tt) => tt.table_id)) ?? []
  );
  const unassignedTables = (allTables as any[] | undefined)?.filter((t) => !assignedTableIds.has(t.id)) ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("tournamentConfig.pageTitle")}</h1>
          <p className="text-muted-foreground">
            {t("tournamentConfig.pageSubtitle")}
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>{t("tournamentConfig.createBtn")}</Button>
      </div>

      {/* Unassigned Tables Warning */}
      {unassignedTables.length > 0 && (
        <Card className="border-warning/30 bg-warning/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-warning">
              {t("tournamentConfig.unassignedTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {unassignedTables.map((table) => (
                <Badge key={table.id} variant="outline">
                  {table.table_name ?? table.name ?? table.id.slice(0, 8)}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {t("tournamentConfig.unassignedDesc")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Tournament List */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tournaments?.map((tournament) => (
          <TournamentCard
            key={tournament.id}
            tournament={tournament}
            onEdit={() => setEditingTournament(tournament)}
          />
        ))}
        {(!tournaments || tournaments.length === 0) && (
          <Card className="col-span-full">
            <CardContent className="py-12 text-center text-muted-foreground">
              {t("tournamentConfig.emptyState")}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create Dialog */}
      <TournamentDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        clubId={clubIdStr}
        allTables={allTables ?? []}
        assignedTableIds={assignedTableIds}
      />

      {/* Edit Dialog */}
      {editingTournament && (
        <TournamentDialog
          open={!!editingTournament}
          onOpenChange={(open) => !open && setEditingTournament(null)}
          clubId={clubIdStr}
          tournament={editingTournament}
          allTables={allTables ?? []}
          assignedTableIds={assignedTableIds}
        />
      )}
    </div>
  );
}

// ─── Tournament Card ─────────────────────────────────────────────────────────

function TournamentCard({
  tournament,
  onEdit,
}: {
  tournament: TournamentWithTables;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const deleteMutation = useDeleteTournament();

  const handleDelete = async () => {
    if (!confirm(t("tournamentConfig.confirmDelete", { name: tournament.name }))) return;
    try {
      await deleteMutation.mutateAsync({
        id: tournament.id,
        club_id: tournament.club_id,
      });
      toast.success(t("tournamentConfig.deleted"));
    } catch {
      toast.error(t("tournamentConfig.deleteError"));
    }
  };

  const statusColors: Record<string, string> = {
    active: "bg-success/20 text-success",
    completed: "bg-muted-foreground/20 text-muted-foreground",
    cancelled: "bg-destructive/20 text-destructive",
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{tournament.name}</CardTitle>
            {tournament.description && (
              <CardDescription>{tournament.description}</CardDescription>
            )}
          </div>
          <Badge className={statusColors[tournament.status] ?? ""}>
            {tournament.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 bg-muted rounded">
            <div className="text-2xl font-bold text-primary">
              {tournament.swing_duration_minutes}
            </div>
            <div className="text-xs text-muted-foreground">{t("tournamentConfig.minPerSwing")}</div>
          </div>
          <div className="p-2 bg-muted rounded">
            <div className="text-lg font-semibold text-warning">
              {tournament.warn_at_minutes}
            </div>
            <div className="text-xs text-muted-foreground">warn</div>
          </div>
          <div className="p-2 bg-muted rounded">
            <div className="text-lg font-semibold text-destructive">
              {tournament.crit_at_minutes}
            </div>
            <div className="text-xs text-muted-foreground">crit</div>
          </div>
        </div>

        <div>
          <div className="text-xs text-muted-foreground mb-1">
            {t("tournamentConfig.tablesCount", { count: tournament.tournament_tables.length })}
          </div>
          <div className="flex flex-wrap gap-1">
              {tournament.tournament_tables.map((tt, index) => {
                const physicalId = tt.game_table_id ?? tt.table_id;
                const conflictingIdentity = !!tt.game_table_id && !!tt.table_id
                  && tt.game_table_id !== tt.table_id;
                const physicalTable = tt.game_table_id ? tt.canonical_game_table : tt.game_tables;
                const label = conflictingIdentity || !physicalId
                  || (physicalTable && physicalTable.id !== physicalId)
                  ? t("participation.repairRequired")
                  : physicalTable?.table_name ?? physicalId.slice(0, 8);
                return <Badge key={tt.id ?? `${physicalId ?? 'missing'}-${index}`} variant="secondary" className="text-xs">
                {label}
              </Badge>
              })}
            {tournament.tournament_tables.length === 0 && (
              <span className="text-xs text-muted-foreground">{t("tournamentConfig.noTables")}</span>
            )}
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={onEdit}
          >
            {t("tournamentConfig.edit")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
          >
            {t("tournamentConfig.delete")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tournament Dialog (Create / Edit) ───────────────────────────────────────

function TournamentDialog({
  open,
  onOpenChange,
  clubId,
  tournament,
  allTables,
  assignedTableIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubId: string;
  tournament?: TournamentWithTables;
  allTables: { id: string; table_name?: string; name?: string }[];
  assignedTableIds: Set<string>;
}) {
  const { t } = useTranslation();
  const isEditing = !!tournament;
  const createMutation = useCreateTournament();
  const updateMutation = useUpdateTournament();

  const [name, setName] = useState(tournament?.name ?? "");
  const [description, setDescription] = useState(tournament?.description ?? "");
  const [swingDuration, setSwingDuration] = useState(
    tournament?.swing_duration_minutes ?? 45
  );
  const [warnAt, setWarnAt] = useState(tournament?.warn_at_minutes ?? 5);
  const [critAt, setCritAt] = useState(tournament?.crit_at_minutes ?? 2);
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>(
    tournament?.tournament_tables.map((tt) => tt.table_id) ?? []
  );

  const availableTables = allTables.filter(
    (t) => !assignedTableIds.has(t.id) || selectedTableIds.includes(t.id)
  );

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error(t("tournamentConfig.errNameRequired"));
      return;
    }
    if (swingDuration < 5) {
      toast.error(t("tournamentConfig.errSwingMin"));
      return;
    }
    try {
      if (isEditing) {
        await updateMutation.mutateAsync({
          id: tournament!.id,
          club_id: clubId,
          name,
          description: description || undefined,
          swing_duration_minutes: swingDuration,
          warn_at_minutes: warnAt,
          crit_at_minutes: critAt,
          table_ids: selectedTableIds,
        });
        toast.success(t("tournamentConfig.updated"));
      } else {
        await createMutation.mutateAsync({
          club_id: clubId,
          name,
          description: description || undefined,
          swing_duration_minutes: swingDuration,
          warn_at_minutes: warnAt,
          crit_at_minutes: critAt,
          table_ids: selectedTableIds,
        });
        toast.success(t("tournamentConfig.created"));
      }
      onOpenChange(false);
    } catch {
      toast.error(isEditing ? t("tournamentConfig.updateError") : t("tournamentConfig.createError"));
    }
  };

  const toggleTable = (tableId: string) => {
    setSelectedTableIds((prev) =>
      prev.includes(tableId)
        ? prev.filter((id) => id !== tableId)
        : [...prev, tableId]
    );
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? t("tournamentConfig.editTitle") : t("tournamentConfig.createTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">{t("tournamentConfig.nameLabel")}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("tournamentConfig.namePh")}
            />
          </div>

          <div>
            <label className="text-sm font-medium">{t("tournamentConfig.descLabel")}</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("tournamentConfig.descPh")}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium">{t("tournamentConfig.swingField")}</label>
              <Input
                type="number"
                min={5}
                max={120}
                value={swingDuration}
                onChange={(e) => setSwingDuration(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t("tournamentConfig.warnField")}</label>
              <Input
                type="number"
                min={1}
                max={30}
                value={warnAt}
                onChange={(e) => setWarnAt(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t("tournamentConfig.critField")}</label>
              <Input
                type="number"
                min={1}
                max={10}
                value={critAt}
                onChange={(e) => setCritAt(Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">
              {t("tournamentConfig.selectTables", { count: selectedTableIds.length })}
            </label>
            <div className="mt-2 max-h-48 overflow-y-auto border rounded p-2 space-y-1">
              {availableTables.map((table) => (
                <label
                  key={table.id}
                  className="flex items-center gap-2 p-1 hover:bg-muted rounded cursor-pointer"
                >
                  <Checkbox
                    checked={selectedTableIds.includes(table.id)}
                    onCheckedChange={() => toggleTable(table.id)}
                  />
                  <span className="text-sm">
                    {table.table_name ?? table.name ?? table.id.slice(0, 8)}
                  </span>
                </label>
              ))}
              {availableTables.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-4">
                  {t("tournamentConfig.allTablesAssigned")}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              {t("tournamentConfig.cancel")}
            </Button>
            <Button
              className="flex-1"
              onClick={handleSubmit}
              disabled={isPending}
            >
              {isPending ? t("tournamentConfig.saving") : isEditing ? t("tournamentConfig.update") : t("tournamentConfig.create")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
