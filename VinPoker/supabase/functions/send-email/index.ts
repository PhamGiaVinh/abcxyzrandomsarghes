// Internal email sender via Resend. Called from other edge functions only.
// Body: { to: string | string[], subject: string, html: string }
// Auth: requires Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> (internal only).
import { parseBody, z } from "../_shared/validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FROM = "VBacker Staking <onboarding@resend.dev>";

const Email = z.string().email().max(320);
const BodySchema = z.object({
  to: z.union([Email, z.array(Email).min(1).max(50)]),
  subject: z.string().trim().min(1).max(200),
  html: z.string().min(1).max(200_000),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Require internal service-role auth — this function is for internal callers only.
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!serviceKey || !token || token !== serviceKey) {
      return j({ error: "Unauthorized" }, 401);
    }

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) return j({ error: "RESEND_API_KEY not configured" }, 500);

    const parsed = await parseBody(req, BodySchema, corsHeaders);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const to = Array.isArray(body.to) ? body.to : [body.to];

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from: FROM, to, subject: body.subject, html: body.html }),
    });
    const data:unknown = await r.json().catch(() => null);
    if (!r.ok) {
      console.error("email_provider_rejected", r.status);
      return j({ error: "Email send failed" }, 502);
    }
    if(!data||typeof data!=='object'||Array.isArray(data)||!('id' in data)
      ||typeof data.id!=='string'||!data.id.trim()){
      console.error('email_provider_ack_unverified');
      return j({error:'Email acknowledgement unverified'},502);
    }
    return j({ success: true, id: data.id });
  } catch {
    console.error('email_send_unverified');
    return j({ error: 'Email send unverified' }, 500);
  }
});

function j(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
