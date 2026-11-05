// CI-only dependency warmer. This function contains no VinPoker handler,
// schema, fixture or credential. It is invoked before the isolated stack is
// created so the pinned Edge dependencies remain available after outbound
// networking is denied.
import "npm:@supabase/supabase-js@2.105.4";
import "npm:zod@3.25.76";
import "https://esm.sh/@supabase/supabase-js@2.45.0";
// Existing Dealer shared-module type imports use this exact specifier. Warm
// its graph before outbound isolation too; production handler source is intact.
import "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(() => new Response(null, { status: 204 }));
