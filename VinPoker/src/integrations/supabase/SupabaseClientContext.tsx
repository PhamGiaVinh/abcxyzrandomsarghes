import { createContext, useContext, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type VinPokerSupabaseClient = SupabaseClient<Database>;

const SupabaseClientContext = createContext<VinPokerSupabaseClient | null>(null);
const SupabaseBackendScopeContext = createContext<string | null>(null);

export function SupabaseClientProvider({
  client,
  backendScope,
  children,
}: {
  client: VinPokerSupabaseClient;
  backendScope?: string;
  children: ReactNode;
}) {
  return (
    <SupabaseBackendScopeContext.Provider value={backendScope ?? null}>
      <SupabaseClientContext.Provider value={client}>{children}</SupabaseClientContext.Provider>
    </SupabaseBackendScopeContext.Provider>
  );
}

// Explicit provider identity: never inspect protected SDK fields or guess from window.location.
// eslint-disable-next-line react-refresh/only-export-components
export function useSupabaseBackendScope() { return useContext(SupabaseBackendScopeContext); }

// Context hooks intentionally live with the provider so both application
// entries share one small injection seam.
// eslint-disable-next-line react-refresh/only-export-components
export function useSupabaseClient(): VinPokerSupabaseClient {
  const client = useContext(SupabaseClientContext);
  if (!client) {
    throw new Error("SupabaseClientProvider is required for this application shell.");
  }
  return client;
}
