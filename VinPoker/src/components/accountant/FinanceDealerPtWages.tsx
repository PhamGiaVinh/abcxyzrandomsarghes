import DealerPtWageTab from "@/components/cashier/DealerPtWageTab";
import { useAuth } from "@/hooks/useAuth";
import { financeSessionReadEpoch } from "@/lib/financeSummaryRead";

export function FinanceDealerPtWages({ club }: {club: {id: string; name: string}}) {
  const {user, session, loading, rolesLoading, authError, rolesError} = useAuth();
  if (loading || rolesLoading) return <p role="status">Đang xác minh phiên đăng nhập…</p>;
  if (authError || rolesError) return <p role="alert">Chưa xác minh được quyền xem lương PT. Vui lòng thử lại.</p>;
  if (!user) return <p role="alert">Vui lòng đăng nhập để xem lương PT.</p>;
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Lương PT tạm tính hiện tại theo dữ liệu ca làm trên máy chủ.</p>
    <DealerPtWageTab
      key={JSON.stringify([user.id, financeSessionReadEpoch(session), club.id])}
      clubIds={[club.id]}
      clubs={[club]}
      financeRead
      readOnly
    />
  </div>;
}
