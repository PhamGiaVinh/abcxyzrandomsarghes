import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarRange, Clock, Eye } from "lucide-react";
import DealerPayrollTab from "@/components/cashier/DealerPayrollTab";
import DealerPtWageTab from "@/components/cashier/DealerPtWageTab";
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';

/**
 * Salary-C — Dealer salary v2: two sub-tabs.
 *   • "Theo tháng · Full-time" → the EXISTING DealerPayrollTab, reused as-is (legacy flow +
 *     payment lifecycle untouched).
 *   • "Theo giờ · Part-time"  → DealerPtWageTab (live accruing balance + full-pay/reset).
 *
 * Rendered only when FEATURES.salaryTabV2 is ON (default OFF). When OFF the parent renders the
 * legacy DealerPayrollTab directly, so the live behaviour is byte-identical until flipped.
 */

type ClubRow = { id: string; name: string };

interface Props {
  clubIds: string[];
  clubs: ClubRow[];
}

export default function DealerPayrollTabV2({ clubIds, clubs }: Props) {
  const { isAdmin, isClubAdmin, isClubOwner } = useAuth();
  const [sub, setSub] = useState("hourly");
  return (
    <Tabs value={sub} onValueChange={setSub} className="w-full">
      <TabsList className="grid w-full grid-cols-2 h-auto mb-3">
        <TabsTrigger value="month"><CalendarRange className="w-4 h-4 mr-1" /> Theo tháng · Full-time</TabsTrigger>
        <TabsTrigger value="hourly"><Clock className="w-4 h-4 mr-1" /> Theo giờ · Part-time</TabsTrigger>
      </TabsList>
      <TabsContent value="month">
        <DealerPayrollTab clubIds={clubIds} clubs={clubs} />
      </TabsContent>
      <TabsContent value="hourly">
        <div className="mb-3 flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
          <Eye className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
          <div>
            <div className="font-semibold">Theo dõi và chốt phiếu PT</div>
            <div className="mt-0.5 text-emerald-100/75">
              Số tiền đang hiển thị là tạm tính theo dữ liệu máy chủ. Chốt và ghi nhận chi theo phiếu tại quầy thu ngân.
            </div>
            {(isAdmin || isClubAdmin || isClubOwner) && <Button asChild size="sm" variant="outline" className="mt-2">
              <Link to="/cashier?tab=pt_wages">Chốt và chi phiếu PT tại quầy</Link>
            </Button>}
          </div>
        </div>
        <DealerPtWageTab clubIds={clubIds} clubs={clubs} readOnly finalizeStatements />
      </TabsContent>
    </Tabs>
  );
}
