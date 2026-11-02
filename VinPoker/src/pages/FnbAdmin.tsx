import { useState } from "react";
import { Navigate } from "react-router-dom";
import { FEATURES } from "@/lib/featureFlags";
import { useAuth } from "@/hooks/useAuth";
import { useFnbClubs } from "@/hooks/useFnbClubs";
import { FnbClubReadError } from "@/components/fnb/FnbClubReadError";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldAlert } from "lucide-react";
import { CategoryManager } from "@/components/fnb/admin/CategoryManager";
import { MenuManager } from "@/components/fnb/admin/MenuManager";
import { FnbSettingsPanel } from "@/components/fnb/admin/FnbSettingsPanel";
import { IngredientManager } from "@/components/fnb/admin/IngredientManager";
import { RecipeEditor } from "@/components/fnb/admin/RecipeEditor";
import { StockInForm } from "@/components/fnb/admin/StockInForm";
import { StocktakeBoard } from "@/components/fnb/admin/StocktakeBoard";
import { FnbStaffManager } from "@/components/fnb/admin/FnbStaffManager";
import { FnbReportPanel } from "@/components/fnb/FnbReportPanel";
import { FnbTableQrManager } from "@/components/fnb/admin/FnbTableQrManager";

/**
 * F&B admin (/fnb/admin) — owner-only menu/inventory/settings management. Gate: FEATURES.fnbModule.
 * F2 ships the shell + Thực đơn / Danh mục / Cài đặt. Inventory + Nhân sự tabs are added by F3/F4
 * (the shell only renders tabs whose component exists at that patch). Admin writes are owner-only at
 * the RPC, so a non-owner F&B staff sees a read-only notice rather than the tabs.
 */
export default function FnbAdmin() {
  if (!FEATURES.fnbModule) return <Navigate to="/" replace />;
  return <FnbAdminInner />;
}

function FnbAdminInner() {
  const { loading: authLoading, isClubOwner, isAdmin } = useAuth();
  const { clubs, error: clubError, reload: reloadClubs } = useFnbClubs();
  const [clubId, setClubId] = useState<string>("");

  const isOwner = isClubOwner || isAdmin;

  if (clubError) return <FnbClubReadError message={clubError} onRetry={reloadClubs} />;
  if (authLoading || clubs === null) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-6 space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full max-w-sm" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-6">
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <ShieldAlert className="h-4 w-4 text-warning" />
            Khu vực quản trị F&amp;B chỉ dành cho chủ câu lạc bộ.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (clubs.length === 0) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-6">
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            Bạn chưa sở hữu câu lạc bộ F&amp;B nào.
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeClub = clubs.find(club => club.id === clubId)?.id ?? clubs[0].id;
  const activeClubName = clubs.find((club) => club.id === activeClub)?.name ?? "VinPoker Club";

  return (
    <div className="container mx-auto max-w-5xl px-4 py-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">F&amp;B · Quản trị</h1>
          <p className="text-xs text-muted-foreground">Thực đơn, kho và cài đặt cho F&amp;B của câu lạc bộ.</p>
        </div>
        {clubs.length > 1 && (
          <div className="w-full max-w-xs">
            <Label className="mb-1 block text-xs text-muted-foreground">Câu lạc bộ</Label>
            <Select value={activeClub} onValueChange={setClubId}>
              <SelectTrigger className="bg-card border-border text-foreground"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-card border-border text-foreground">
                {clubs.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name ?? c.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <Tabs defaultValue="menu" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="menu">Thực đơn</TabsTrigger>
          <TabsTrigger value="category">Danh mục</TabsTrigger>
          {FEATURES.fnbInventory && <TabsTrigger value="ingredient">Nguyên liệu</TabsTrigger>}
          {FEATURES.fnbInventory && <TabsTrigger value="recipe">Công thức</TabsTrigger>}
          {FEATURES.fnbInventory && <TabsTrigger value="stockin">Nhập kho</TabsTrigger>}
          {FEATURES.fnbInventory && <TabsTrigger value="stocktake">Kiểm kho</TabsTrigger>}
          <TabsTrigger value="staff">Nhân sự</TabsTrigger>
          {FEATURES.fnbTableLink && <TabsTrigger value="report">Báo cáo</TabsTrigger>}
          {FEATURES.fnbGuestOrder && <TabsTrigger value="qr">QR bàn</TabsTrigger>}
          <TabsTrigger value="settings">Cài đặt</TabsTrigger>
        </TabsList>
        <TabsContent value="menu" className="mt-4">
          <MenuManager clubId={activeClub} clubName={activeClubName} />
        </TabsContent>
        <TabsContent value="category" className="mt-4">
          <CategoryManager clubId={activeClub} />
        </TabsContent>
        {FEATURES.fnbInventory && (
          <TabsContent value="ingredient" className="mt-4"><IngredientManager clubId={activeClub} /></TabsContent>
        )}
        {FEATURES.fnbInventory && (
          <TabsContent value="recipe" className="mt-4"><RecipeEditor clubId={activeClub} /></TabsContent>
        )}
        {FEATURES.fnbInventory && (
          <TabsContent value="stockin" className="mt-4"><StockInForm clubId={activeClub} /></TabsContent>
        )}
        {FEATURES.fnbInventory && (
          <TabsContent value="stocktake" className="mt-4"><StocktakeBoard clubId={activeClub} /></TabsContent>
        )}
        <TabsContent value="staff" className="mt-4">
          <FnbStaffManager clubId={activeClub} />
        </TabsContent>
        {FEATURES.fnbTableLink && (
          <TabsContent value="report" className="mt-4"><FnbReportPanel clubId={activeClub} /></TabsContent>
        )}
        {FEATURES.fnbGuestOrder && (
          <TabsContent value="qr" className="mt-4"><FnbTableQrManager clubId={activeClub} /></TabsContent>
        )}
        <TabsContent value="settings" className="mt-4">
          <FnbSettingsPanel clubId={activeClub} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
