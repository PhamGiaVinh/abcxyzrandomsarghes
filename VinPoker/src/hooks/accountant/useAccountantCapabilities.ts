import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CapabilityState = "ok" | "not_installed" | "forbidden" | "network_error" | "loading";

export interface AccountantCapabilities {
  state: CapabilityState;
  isAccountant: boolean;
  payroll: boolean;
  staff: boolean;
  expenses: boolean;
  fnbReport: boolean;
  financeSummary: boolean;
}

const NONE: Omit<AccountantCapabilities, "state"> = {
  isAccountant: false,
  payroll: false,
  staff: false,
  expenses: false,
  fnbReport: false,
  financeSummary: false,
};

function isMissingFunction(error: any): boolean {
  const code = error?.code ?? "";
  const msg = `${error?.message ?? ""}`.toLowerCase();
  return code === "42883" || code === "PGRST202" || msg.includes("could not find the function");
}

/**
 * Per-domain capability probe for the accountant workspace. One RPC per club tells the
 * UI exactly which tabs the CALLER can use (booleans mirror the real server authz).
 * States: `ok` (RPC answered) · `not_installed` (get_accountant_capabilities missing on
 * live = migration 20261236000000 not applied yet) · `forbidden` · `network_error`.
 * Never infer "no permission" from an empty result — that is what these states are for.
 */
export function useAccountantCapabilities(clubId: string | null) {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["accountant", "capabilities", user?.id, clubId],
    enabled: !!user?.id && !!clubId,
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<AccountantCapabilities> => {
      const { data, error } = await (supabase.rpc as any)("get_accountant_capabilities", {
        p_club_id: clubId,
      });
      if (error) {
        if (isMissingFunction(error)) return { state: "not_installed", ...NONE };
        if (error.code === "42501") return { state: "forbidden", ...NONE };
        return { state: "network_error", ...NONE };
      }
      return {
        state: "ok",
        isAccountant: Boolean(data?.is_accountant),
        payroll: Boolean(data?.payroll),
        staff: Boolean(data?.staff),
        expenses: Boolean(data?.expenses),
        fnbReport: Boolean(data?.fnb_report),
        financeSummary: Boolean(data?.finance_summary),
      };
    },
  });

  const caps: AccountantCapabilities = q.data ?? { state: "loading", ...NONE };
  return { ...q, caps };
}
