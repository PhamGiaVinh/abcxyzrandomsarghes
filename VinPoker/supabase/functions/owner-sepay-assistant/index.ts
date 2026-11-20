import { createHandler } from './handler.ts';

Deno.serve(createHandler({
  url: Deno.env.get('SUPABASE_URL') ?? '',
  anonKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  enabled: Deno.env.get('OWNER_SEPAY_ASSISTANT_ENABLED') === 'true',
  // Dedicated server key: do not inherit another feature's potentially paid key.
  geminiKey: Deno.env.get('OWNER_SEPAY_GEMINI_API_KEY') ?? '',
  geminiModel: Deno.env.get('OWNER_SEPAY_GEMINI_MODEL') ?? '',
  freeTierConfirmed: Deno.env.get('OWNER_SEPAY_GEMINI_BILLING_DISABLED_CONFIRMED') === 'true',
}));
