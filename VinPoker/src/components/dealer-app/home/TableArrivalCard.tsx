import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTableArrival } from "@/hooks/dealer/useTableArrival";

export function TableArrivalCard({ dealerId }: { dealerId?: string }) {
  const { t } = useTranslation();
  const { live, query, acknowledge } = useTableArrival(dealerId);
  if (!live) return null;
  if (query.isLoading) return <p role="status" className="my-3 text-sm text-muted-foreground">{t("dealer.arrival.loading", "Đang tải phân công bàn…")}</p>;
  if (query.isError) return (
    <Card className="my-3 p-4">
      <p role="alert" className="text-sm">{t("dealer.arrival.loadFailed", "Chưa tải được phân công bàn.")}</p>
      <Button variant="outline" className="mt-2" onClick={() => void query.refetch()}>{t("common.retry", "Thử lại")}</Button>
    </Card>
  );
  if (!query.data?.length) return null;
  return (
    <div className="my-3 space-y-2">
      {query.data.map((arrival) => (
        <Card key={`${arrival.assignment_id}:${arrival.attendance_id}:${arrival.dispatch_at}`} className="p-4 space-y-2">
          <h2 className="text-sm font-bold">{arrival.table_name}</h2>
          {arrival.incoming && <p className="text-xs text-primary">{t("dealer.arrival.upcoming", "Phân công tiếp theo")}</p>}
          <p className="text-xs text-muted-foreground">{t("dealer.arrival.hint", "Bấm khi bạn đã đến bàn. Bàn giao vẫn theo lịch xoay.")}</p>
          {arrival.acknowledged_at ? (
            <p role="status" className="text-sm text-primary">{t("dealer.arrival.confirmed", "Đã xác nhận đến bàn")}</p>
          ) : (
            <Button className="w-full" disabled={acknowledge.isPending || query.isFetching}
              onClick={() => { void acknowledge.mutateAsync(arrival).catch(() => undefined); }}>
              {acknowledge.isPending ? t("dealer.arrival.sending", "Đang xác nhận…") : t("dealer.arrival.ready", "Sẵn sàng — đã đến bàn")}
            </Button>
          )}
        </Card>
      ))}
      {acknowledge.isError && <p role="alert" className="text-sm text-destructive">{t("dealer.arrival.failed", "Chưa xác nhận được. Kiểm tra lại phân công rồi thử lại.")}</p>}
    </div>
  );
}
