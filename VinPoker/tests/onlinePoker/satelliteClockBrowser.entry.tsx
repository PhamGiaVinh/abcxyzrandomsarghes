import { createClient } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { SupabaseClientProvider } from "@/integrations/supabase/SupabaseClientContext";
import type { Database } from "@/integrations/supabase/types";
import { OnlineSatelliteTableContent } from "@/pages/OnlineSatelliteTable";

const parameters = new URLSearchParams(location.search);
const client = createClient<Database>(location.origin, "disposable-publishable", { auth: { persistSession: false } });
createRoot(document.getElementById("root")!).render(
  <SupabaseClientProvider client={client}>
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <OnlineSatelliteTableContent actorId={parameters.get("actor") ?? undefined}
          pilotId={parameters.get("pilot") ?? undefined} />
      </MemoryRouter>
    </QueryClientProvider>
  </SupabaseClientProvider>,
);
