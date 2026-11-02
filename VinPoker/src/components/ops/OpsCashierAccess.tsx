import type { ReactNode } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { useOperatorClubs } from "@/hooks/useOperatorClubs";
import {Button} from '@/components/ui/button';

export default function OpsCashierAccess({ children }: { children: ReactNode }) {
  const { loading, user, hasCashierAccess,error,scopeVerified,refresh } = useOperatorClubs();
  if (loading) {
    return <div className="ios-card flex flex-col items-center gap-2 py-12 text-center"><Loader2 className="h-7 w-7 animate-spin text-[#c9a86a]" /><p className="text-sm text-[#9b8e97]">Đang kiểm tra quyền Cashier…</p></div>;
  }
  if(error&&!scopeVerified)return <div className="ios-card space-y-3 px-5 py-12 text-center"><p role="alert">{error}</p><Button onClick={refresh}>Thử lại</Button></div>;
  if (!user || !hasCashierAccess) {
    return <div className="ios-card flex flex-col items-center gap-2 px-5 py-12 text-center"><ShieldCheck className="h-8 w-8 text-amber-300" /><h1 className="text-lg font-semibold text-[#f2ece6]">Không có quyền Cashier</h1><p className="max-w-sm text-sm leading-6 text-[#9b8e97]">Màn hình này chỉ dành cho chủ CLB hoặc tài khoản thu ngân được phân công.</p></div>;
  }
  return <>{error&&<div role="status" className="mb-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground"><span>{error}</span><Button variant="outline" onClick={refresh}>Thử lại</Button></div>}{children}</>;
}
