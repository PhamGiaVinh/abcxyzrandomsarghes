import {
  authorizeInternalTrigger,
  getIdempotencyKey,
  isUuid,
  parsePushPayload,
} from "../_shared/internal-trigger-auth.ts";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = authorizeInternalTrigger(req);
  if (!auth.ok) return json({ error: auth.code }, auth.status);

  const jobKey = getIdempotencyKey(req);
  if (!isUuid(jobKey)) return json({ error: "invalid_idempotency_key" }, 400);

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 4096) {
    return json({ error: "payload_too_large" }, 413);
  }

  const payload = parsePushPayload(await req.json().catch(() => null));
  if (!payload) return json({ error: "invalid_payload" }, 400);

  const appId = Deno.env.get("ONESIGNAL_APP_ID");
  const apiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
  if (!appId || !apiKey) return json({ error: "push_not_configured" }, 503);

  const notification: Record<string, unknown> = {
    app_id: appId,
    include_aliases: { external_id: [payload.userId] },
    target_channel: "push",
    // Reuse the durable outbox ID after unknown outcomes, never a new retry ID.
    idempotency_key: jobKey,
    headings: { en: payload.heading, vi: payload.heading },
    contents: { en: payload.message, vi: payload.message },
  };
  if (payload.url) notification.url = payload.url;

  try {
    const response = await fetch("https://api.onesignal.com/notifications?c=push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(notification),
    });
    const data: unknown = await response.json().catch(() => null);

    if (!response.ok) return json({ error: "push_provider_failed" }, 502);
    if (!data || typeof data !== 'object' || Array.isArray(data) || !('id' in data)) {
      return json({error:'push_provider_ack_unverified'},502);
    }
    // OneSignal can return HTTP 200 without creating a message. Do not call
    // that success or expose the provider's recipient/error details.
    if (data.id === '' && 'errors' in data && Array.isArray(data.errors)
      && data.errors.length > 0 && data.errors.every(item=>typeof item==='string')
      && (!('recipients' in data) || data.recipients===0)) {
      return json({ok:false,status:'not_created',error:'push_not_created',recipients:0});
    }
    const recipients='recipients' in data?data.recipients:null;
    if (!isUuid(data.id) || recipients!==null && (typeof recipients!=='number' || !Number.isSafeInteger(recipients) || recipients<0)) {
      return json({error:'push_provider_ack_unverified'},502);
    }
    // Provider creation is not proof of device delivery. Missing count is unknown.
    return json({ok:true,status:'provider_accepted',id:data.id,recipients});
  } catch {
    return json({ error: "push_provider_failed" }, 502);
  }
});
