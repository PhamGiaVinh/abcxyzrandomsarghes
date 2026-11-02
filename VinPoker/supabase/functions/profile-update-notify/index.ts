import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { constantTimeEqual } from "../_shared/internal-trigger-auth.ts";
import { parseBody, z } from "../_shared/validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FIELD_LABELS: Record<string, string> = {
  bank_name: "Ngân hàng",
  bank_account_number: "Số tài khoản",
  bank_account_holder: "Chủ tài khoản",
  phone: "Số điện thoại",
  display_name: "Tên hiển thị",
  bio: "Giới thiệu",
  avatar_url: "Ảnh đại diện",
};

const BodySchema=z.object({record:z.object({
  id:z.string().uuid(),user_id:z.string().uuid(),club_id:z.string().uuid().nullable(),
  changed_fields:z.array(z.string().refine(field=>Object.prototype.hasOwnProperty.call(FIELD_LABELS,field))).min(1).max(Object.keys(FIELD_LABELS).length),
  old_values:z.record(z.unknown()),new_values:z.record(z.unknown()),
})});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({error:'method_not_allowed'},405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!supabaseUrl||!serviceKey)return json({error:'internal_auth_not_configured'},503);
    const authorization=req.headers.get('authorization')??'';
    const token=authorization.startsWith('Bearer ')?authorization.slice(7):'';
    if(!token||!constantTimeEqual(token,serviceKey))return json({error:'internal_auth_denied'},401);
    const parsed=await parseBody(req,BodySchema,corsHeaders);
    if(!parsed.ok)return parsed.response;
    const record=parsed.data.record;
    const admin = createClient(supabaseUrl, serviceKey);

    const { user_id, club_id, changed_fields, old_values, new_values } = record;

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("display_name")
      .eq("user_id", user_id)
      .maybeSingle();
    if(profileError)return json({error:'profile_notification_read_failed'},502);
    const playerName = profile?.display_name ?? "Người dùng";

    const changedLabels = changed_fields
      .map((f: string) => FIELD_LABELS[f] ?? f)
      .join(", ");

    const title = "Cập nhật hồ sơ";
    const bodyText = `${playerName} đã cập nhật: ${changedLabels}.`;

    const recipients = new Set<string>();

    if (club_id) {
      const { data: cashiers, error: cashiersError } = await admin
        .from("club_cashiers")
        .select("user_id")
        .eq("club_id", club_id);
      if(cashiersError)return json({error:'profile_notification_read_failed'},502);
      if (cashiers) {
        for (const c of cashiers) recipients.add(c.user_id);
      }

      const { data: club, error: clubError } = await admin
        .from("clubs")
        .select("owner_id")
        .eq("id", club_id)
        .maybeSingle();
      if(clubError)return json({error:'profile_notification_read_failed'},502);
      if (club?.owner_id) recipients.add(club.owner_id);
    } else {
      const { data: superAdmins, error: superAdminsError } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "super_admin");
      if(superAdminsError)return json({error:'profile_notification_read_failed'},502);
      if (superAdmins) {
        for (const sa of superAdmins) recipients.add(sa.user_id);
      }
    }

    recipients.delete(user_id);

    if (recipients.size > 0) {
      const notificationRows = Array.from(recipients).map((uid) => ({
        user_id: uid,
        type: "profile_updated",
        title,
        body: bodyText,
        data: {
          updated_user_id: user_id,
          club_id,
          changed_fields,
          old_values,
          new_values,
        },
      }));

      const { error: notifErr } = await admin.from("notifications").insert(notificationRows);
      if (notifErr) {
        console.error('profile_notification_insert_failed');
        return json({error:'profile_notification_insert_failed'},502);
      }

      // The notification INSERT owns push enqueueing through fn_dispatch_push.
      // Delivery and retries belong to that outbox, not a second HTTP path.
    }

    const changesSummary = changed_fields.map((f: string) => {
      const label = FIELD_LABELS[f] ?? f;
      const oldVal = formatValue(old_values[f]);
      const newVal = formatValue(new_values[f]);
      return `${label}: "${oldVal}" → "${newVal}"`;
    });

    return json({
      ok: true,
      recipient_count: recipients.size,
      changes: changesSummary,
    });
  } catch {
    console.error('profile_notification_unverified');
    return json({ error: 'profile_notification_unverified' }, 500);
  }
});

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "(trống)";
  return String(val);
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
