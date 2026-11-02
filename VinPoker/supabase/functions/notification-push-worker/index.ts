import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { constantTimeEqual, isUuid, parsePushPayload } from "../_shared/internal-trigger-auth.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});

// One claim per invocation; scheduler activation is a separate reviewed step.
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (Deno.env.get("NOTIFICATION_PUSH_WORKER_ENABLED") !== "true") {
    return json({ ok: false, error: "worker_disabled" }, 404);
  }
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const internalSecret = Deno.env.get("DEALER_TRIGGER_INTERNAL_SECRET");
  if (!url || !serviceKey || !internalSecret) return json({ ok: false, error: "worker_not_configured" }, 503);
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ") || !constantTimeEqual(auth.slice(7), serviceKey)) {
    return json({ ok: false, error: "worker_unauthorized" }, 401);
  }
  try {
    const raw = await req.text();
    if (raw.length > 1024) return json({ ok: false, error: "invalid_worker_request" }, 400);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ ok: false, error: "invalid_worker_request" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some(key => key !== "notification_id")) {
      return json({ ok: false, error: "invalid_worker_request" }, 400);
    }
    const scope = "notification_id" in body ? body.notification_id : null;
    if (scope !== null && !isUuid(scope)) return json({ ok: false, error: "invalid_notification_scope" }, 400);
    const service = createClient(url, serviceKey);
    const { data, error } = await service.rpc("claim_notification_push_v1", { p_notification_id: scope });
    if (error || !data || data.ok !== true || !("job" in data)) {
      return json({ ok: false, error: "push_claim_unverified" }, 503);
    }
    if (data.job === null) return json({ ok: true, status: data.attention ? "needs_attention" : "no_claimable_jobs", provider_accepted: 0 });
    const job = data.job;
    if (!job || !isUuid(job.id) || !isUuid(job.notification_id) || !isUuid(job.lease_token)
      || job.state !== "processing" || typeof job.lease_expires_at !== "string"
      || !Number.isFinite(Date.parse(job.lease_expires_at)) || Date.parse(job.lease_expires_at) <= Date.now()
      || scope !== null && job.notification_id !== scope) {
      return json({ ok: false, error: "push_claim_unverified" }, 503);
    }
    const finish = async (outcome: string, providerId: string | null = null) => {
      const result = await service.rpc("finish_notification_push_v1", {
        p_id: job.id, p_token: job.lease_token, p_outcome: outcome, p_provider_id: providerId,
      });
      return !result.error && result.data === true;
    };
    if (!parsePushPayload(job.payload)) {
      if (!await finish("needs_attention")) return json({ ok: false, error: "push_finish_unverified" }, 503);
      return json({ ok: true, status: "needs_attention", provider_accepted: 0 });
    }
    // Unknown provider/finish outcomes retain the lease. Reclaim reuses job.id,
    // preserving the provider idempotency identity even after response loss.
    const response = await fetch(`${url.replace(/\/$/, "")}/functions/v1/send-push-notification`, {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`,
        "x-vinpoker-internal-secret": internalSecret, "x-idempotency-key": job.id },
      body: JSON.stringify(job.payload),
    });
    const ack = await response.json().catch(() => null);
    if (!response.ok || !ack || typeof ack !== "object") return json({ ok: false, error: "push_outcome_unknown" }, 503);
    let outcome: "provider_accepted" | "not_created";
    let providerId: string | null = null;
    if (ack.ok === true && ack.status === "provider_accepted" && isUuid(ack.id)) {
      outcome = "provider_accepted"; providerId = ack.id;
    } else if (ack.ok === false && ack.status === "not_created" && ack.error === "push_not_created" && ack.recipients === 0) {
      outcome = "not_created";
    } else return json({ ok: false, error: "push_outcome_unknown" }, 503);
    if (!await finish(outcome, providerId)) return json({ ok: false, error: "push_finish_unverified" }, 503);
    return json({ ok: true, status: "processed", provider_accepted: outcome === "provider_accepted" ? 1 : 0, not_created: outcome === "not_created" ? 1 : 0 });
  } catch {
    return json({ ok: false, error: "push_outcome_unknown" }, 503);
  }
});
