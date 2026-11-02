import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import { CalendarCheck, Clock, Moon, Bell, CalendarX2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDealerLink } from "@/hooks/dealer/useDealerLink";
import { useTodayShift } from "@/hooks/dealer/useTodayShift";
import { useWeeklySchedule } from "@/hooks/dealer/useWeeklySchedule";
import { localTodayDate } from "@/lib/dealerApp/clock";
import { weekSummary } from "@/lib/dealerApp/selectors";
import { DEALER_GOLD } from "@/lib/dealerApp/constants";
import { TodayShiftCard } from "./TodayShiftCard";
import { TableArrivalCard } from "./TableArrivalCard";
import { QuickActionGrid } from "./QuickActionGrid";
import { UpcomingShiftList } from "./UpcomingShiftList";
import { DealerNotLinkedScreen } from "../DealerNotLinkedScreen";

interface Stat {
  Icon: LucideIcon;
  value: string;
  sub?: string;
  label: string;
  gold?: boolean;
  night?: boolean;
}

export function DealerHomeScreen() {
  const { t } = useTranslation();
  const { dealer, isDealer, loading: linkLoading } = useDealerLink();
  const today = localTodayDate();
  const { data: todayShift, isLoading: todayLoading } = useTodayShift(dealer?.dealerId, today);
  const { data: weekShifts } = useWeeklySchedule(dealer?.dealerId, today);

  if (linkLoading) return <HomeSkeleton />;
  if (!isDealer) return <DealerNotLinkedScreen />;

  const summary = weekSummary(weekShifts ?? [], today);
  const notif = (weekShifts ?? []).filter((s) => s.status === "published").length;
  const firstName = (dealer?.fullName ?? "").trim().split(" ").slice(-1)[0] || dealer?.fullName || "";

  const stats: Stat[] = [
    { Icon: CalendarCheck, value: todayShift ? "1" : "0", label: t("dealer.home.statToday", "Ca hôm nay") },
    { Icon: Clock, value: `${summary.totalHours}`, sub: `/${summary.targetHours}h`, label: t("dealer.home.statWeekHours", "Giờ tuần này") },
    { Icon: Moon, value: `${summary.nightShifts}`, label: t("dealer.home.statNight", "Ca đêm"), night: true },
    { Icon: Bell, value: `${notif}`, label: t("dealer.home.statNotif", "Thông báo"), gold: true },
  ];

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-display font-bold text-foreground">
          {t("dealer.home.greeting", "Chào {{name}}", { name: firstName })}
        </h1>
        <p className="text-[13px] text-muted-foreground">
          {t("dealer.home.greetingSub", "Chúc bạn một ngày làm việc hiệu quả.")}
        </p>
      </div>

      {todayLoading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : todayShift ? (
        <TodayShiftCard shift={todayShift} />
      ) : (
        <NoShiftCard />
      )}

      <div className="grid grid-cols-2 gap-2 my-3">
        {stats.map((s, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <s.Icon
                className={s.night ? "w-3.5 h-3.5 text-[hsl(var(--ds-active))]" : "w-3.5 h-3.5 text-primary"}
                style={s.gold ? { color: DEALER_GOLD } : undefined}
              />
              {s.label}
            </div>
            <div className="text-lg font-display font-bold text-foreground mt-1">
              {s.value}
              {s.sub && <span className="text-xs text-muted-foreground">{s.sub}</span>}
            </div>
          </div>
        ))}
      </div>

      <TableArrivalCard key={dealer?.dealerId} dealerId={dealer?.dealerId} />
      <QuickActionGrid />
      <UpcomingShiftList shifts={weekShifts ?? []} today={today} />
    </div>
  );
}

function NoShiftCard() {
  const { t } = useTranslation();
  return (
    <Card className="p-6 flex flex-col items-center text-center gap-2 border-border">
      <CalendarX2 className="w-8 h-8 text-muted-foreground" />
      <div className="text-sm font-bold text-foreground">{t("dealer.home.noShiftToday", "Hôm nay bạn không có ca")}</div>
      <p className="text-xs text-muted-foreground">
        {t("dealer.home.noShiftHint", "Kiểm tra lịch tuần để xem các ca sắp tới.")}
      </p>
    </Card>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-12 w-40 rounded-lg" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
