import { createClient } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SupabaseClientProvider } from "@/integrations/supabase/SupabaseClientContext";
import type { Database } from "@/integrations/supabase/types";
import { OnlineSatelliteTableContent } from "@/pages/OnlineSatelliteTable";
import { OnlineSatelliteRegistrationContent } from "@/pages/OnlineSatelliteRegistration";

const parameters = new URLSearchParams(location.search);
const client = createClient<Database>(location.origin, "disposable-publishable", { auth: { persistSession: false } });
const pilotId = parameters.get("pilot") ?? "";
const route = `/poker/satellite/${pilotId}`;
createRoot(document.getElementById("root")!).render(
  <SupabaseClientProvider client={client}>
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[parameters.has("register") ? route : `${route}/table`]}>
        <Routes>
          <Route path={route} element={<OnlineSatelliteRegistrationContent pilotId={pilotId} />} />
          <Route path={`${route}/table`} element={<OnlineSatelliteTableContent actorId={parameters.get("actor") ?? undefined}
            pilotId={pilotId} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  </SupabaseClientProvider>,
);
