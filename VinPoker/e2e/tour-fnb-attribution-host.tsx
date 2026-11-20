import { createRoot } from "react-dom/client";
import { SupabaseClientProvider } from "@/integrations/supabase/SupabaseClientContext";
import TourRevenuePanel from "@/ops/finance/TourRevenuePanel";

export function mountTourReport({ clubId, restUrl, jwt }: { clubId: string; restUrl: string; jwt: string }) {
  const channel = { on: () => channel, subscribe: () => channel };
  const client = {
    channel: () => channel,
    removeChannel: async () => "ok",
    rpc: async (name: string, body: object) => {
      const response = await fetch(`${restUrl}/rpc/${name}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      return response.ok ? { data, error: null } : { data: null, error: data };
    },
  };
  createRoot(document.getElementById("root")!).render(
    <SupabaseClientProvider client={client as never}>
      <TourRevenuePanel clubId={clubId} />
    </SupabaseClientProvider>,
  );
}
