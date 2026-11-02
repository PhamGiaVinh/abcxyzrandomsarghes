import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Landmark } from "lucide-react";
import { toast } from "sonner";

interface BankAccount {
  id?: string;
  bank_name: string;
  account_number: string;
  account_holder: string;
  qr_code_url: string | null;
  notes: string | null;
}

interface Props {
  account?: BankAccount;
  className?: string;
}

export const BankInfoCard = ({ account: provided, className }: Props) => {
  const { t } = useTranslation();
  const [account, setAccount] = useState<BankAccount | null>(provided ?? null);
  const [loading, setLoading] = useState(!provided);

  const copy = (txt: string, label: string) => {
    navigator.clipboard.writeText(txt);
    toast.success(t("bankInfo.copied", { label }));
  };

  useEffect(() => {
    if (provided) { setAccount(provided); setLoading(false); return; }
    let mounted = true;
    (async () => {
      const { data, error } = await supabase
        .from("platform_bank_accounts")
        .select("id, bank_name, account_number, account_holder, qr_code_url, notes")
        .eq("account_type", "escrow")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!mounted) return;
      if (error) toast.error(error.message);
      else setAccount((data as BankAccount) ?? null);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [provided]);

  if (loading) return <Skeleton className={`h-32 rounded-xl ${className ?? ""}`} />;

  if (!account) {
    return (
      <div className={`rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm ${className ?? ""}`}>
        {t("bankInfo.noEscrow")}
      </div>
    );
  }

  return (
    <div className={`min-w-0 w-full rounded-xl border border-primary/30 bg-card p-4 space-y-3 ${className ?? ""}`}>
      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
        <Landmark className="w-4 h-4" /> {t("bankInfo.title")}
      </div>

      <div className="space-y-2">
        <BankRow label={t("bankInfo.bank")} value={account.bank_name} />
        <BankRow label={t("bankInfo.holder")} value={account.account_holder} />
        <BankRow
          label={t("bankInfo.acctNumber")}
          value={account.account_number}
          mono
          highlight
          onCopy={() => copy(account.account_number, t("bankInfo.copyAcct"))}
        />
      </div>

      {account.qr_code_url && (
        <div className="pt-2 border-t border-border/60">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{t("bankInfo.qrTitle")}</div>
          <img
            src={account.qr_code_url}
            alt={`QR ${account.bank_name}`}
            className="w-full max-w-[240px] mx-auto rounded-lg border border-border"
          />
        </div>
      )}

      {account.notes && (
        <div className="text-[11px] text-muted-foreground italic">{account.notes}</div>
      )}
    </div>
  );
};

const BankRow = ({
  label, value, mono, highlight, onCopy,
}: { label: string; value: string; mono?: boolean; highlight?: boolean; onCopy?: () => void }) => (
  <div className={`flex items-center justify-between gap-2 p-2.5 rounded-lg border ${highlight ? "border-primary/40 bg-primary/5" : "border-border bg-background/40"}`}>
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`truncate ${mono ? "font-mono" : ""} ${highlight ? "text-primary font-bold text-base" : "font-medium"}`}>{value}</div>
    </div>
    {onCopy && (
      <Button size="icon" variant="ghost" onClick={onCopy} title="Copy" className="shrink-0">
        <Copy className="w-4 h-4" />
      </Button>
    )}
  </div>
);
