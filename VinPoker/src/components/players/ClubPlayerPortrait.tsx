import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { Camera, ImagePlus } from "lucide-react";

export type PortraitTarget = { kind: "member"; club: string; member: string }
  | { kind: "booking"; tour: string; chat: string; player: string }
  | { kind: "seat"; tour: string; seat: string; player: string };
type Portrait = { name: string | null; club: string; member: string; version: string | null; url: string | null };
type Client = SupabaseClient<Database>;

async function request(client: Client, target: PortraitTarget, action = "read", baseline?: Portrait, upload?: string) {
  // Narrow adapter until the candidate RPC is in the generated production schema.
  const rpc = client.rpc.bind(client) as unknown as (name: string, args: Record<string, unknown>) =>
    Promise<{ data: Portrait | null; error: { message: string } | null }>;
  const { data, error } = await rpc("club_player_portrait_v1", {
    p_context: { ...target, expected_member: baseline?.member }, p_action: action,
    p_expected: baseline?.version ?? null, p_upload: upload ?? null,
  });
  if (error || !data?.member || !data.club) throw new Error(error?.message ?? "portrait_invalid_response");
  return data;
}

export async function preparePortrait(file: File): Promise<Blob> {
  if (file.size === 0 || file.size > 16 * 1024 * 1024) throw new Error("portrait_size");
  if (!["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"].includes(file.type)) throw new Error("portrait_format");
  const source = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = source;
    await img.decode();
    // Re-encode every image, even small ones, so the uploaded copy has no camera metadata.
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error("portrait_format");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.min(side, 384);
    const g = canvas.getContext("2d");
    if (!g) throw new Error("portrait_format");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, (img.naturalWidth-side)/2, (img.naturalHeight-side)/2, side, side,
      0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob || blob.type !== "image/jpeg" || blob.size > 131072) throw new Error("portrait_format");
    return blob;
  } finally { URL.revokeObjectURL(source); }
}

function errorMessage(e: unknown) {
  const message = e instanceof Error ? e.message : "";
  if (message.includes("portrait_member_unavailable")) return "Ghế chưa liên kết với hồ sơ thành viên của CLB. Hãy kiểm tra ở quầy.";
  if (message.includes("portrait_forbidden")) return "Bạn chưa có quyền cập nhật ảnh tại CLB này.";
  if (message.includes("portrait_changed") || message.includes("portrait_upload_conflict")) return "Hồ sơ hoặc ảnh đã thay đổi. Đóng rồi mở lại để xem ảnh mới.";
  if (message.includes("portrait_upload_expired")) return "Phiên lưu ảnh đã hết hạn. Hãy chọn lại ảnh.";
  if (message.includes("portrait_storage_unconfigured")) return "CLB chưa bật nơi lưu ảnh.";
  if (message.includes("portrait_size")) return "Chọn ảnh có dung lượng tối đa 16 MB.";
  if (message.includes("portrait_format") || message.includes("decode")) return "Không đọc được ảnh. Hãy chọn ảnh JPEG, PNG hoặc WebP.";
  return "Chưa xác nhận được ảnh với máy chủ. Vui lòng thử lại.";
}

export function ClubPlayerPortrait({ client, target, name }: { client: Client; target: PortraitTarget; name: string }) {
  const [open, setOpen] = useState(false);
  if (import.meta.env.VITE_CLUB_PLAYER_PORTRAITS !== "true") return null;
  return <section className="mt-3 rounded-xl border border-border p-3">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
      className="flex min-h-11 w-full items-center gap-2 text-left text-sm font-semibold">
      <Camera size={18} aria-hidden="true"/>Ảnh người chơi của CLB
    </button>
    {open && <Editor key={JSON.stringify(target)} client={client} target={target} name={name}/>}
  </section>;
}

function Editor({ client, target, name }: { client: Client; target: PortraitTarget; name: string }) {
  const [current, setCurrent] = useState<Portrait | null>(null);
  const [draft, setDraft] = useState<{ blob: Blob; url: string; id: string } | null>(null);
  const [busy, setBusy] = useState(true);
  const [allowTableDisplay, setAllowTableDisplay] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef<object | null>(null);
  const saving = useRef(false);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const scope = JSON.stringify(target);
  useEffect(() => {
    const session = {}; active.current = session;
    void request(client, JSON.parse(scope)).then(data => {
      if (active.current === session) setCurrent(data);
    }).catch(e => { if (active.current === session) setMessage(errorMessage(e)); })
      .finally(() => { if (active.current === session) setBusy(false); });
    return () => { active.current = null; };
  }, [client, scope]);
  useEffect(() => () => { if (draft) URL.revokeObjectURL(draft.url); }, [draft]);
  async function select(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || saving.current) return;
    const session = active.current;
    saving.current = true; setBusy(true); setMessage(""); setAllowTableDisplay(false);
    try {
      const blob = await preparePortrait(file);
      if (active.current === session) setDraft({ blob, url: URL.createObjectURL(blob), id: crypto.randomUUID() });
    } catch (e) { if (active.current === session) setMessage(errorMessage(e)); }
    finally { saving.current = false; if (active.current === session) setBusy(false); }
  }
  async function save() {
    if (!current || !draft || !allowTableDisplay || saving.current) return;
    const session = active.current;
    saving.current = true; setBusy(true); setMessage("");
    try {
      let next = await request(client, target, "prepare", current, draft.id);
      if (active.current !== session) return;
      if (next.version !== draft.id) {
        const { error } = await client.storage.from("club-player-portraits").upload(draft.id + ".jpg", draft.blob,
          { contentType: "image/jpeg", upsert: false, cacheControl: "86400" });
        // A retry may find the immutable object already present. The DB verifies its owner and size.
        if (error && !["409", "Duplicate", "ResourceAlreadyExists"].includes(String(error.statusCode ?? error.name))
            && !/already exists/i.test(error.message)) throw error;
        if (active.current !== session) return;
        next = await request(client, target, "publish", current, draft.id);
      }
      if (next.version !== draft.id) throw new Error("portrait_invalid_response");
      if (active.current === session) { setCurrent(next); setDraft(null); setMessage("Đã lưu ảnh vào hồ sơ CLB."); }
    } catch (e) { if (active.current === session) setMessage(errorMessage(e)); }
    finally { saving.current = false; if (active.current === session) setBusy(false); }
  }
  const label = current?.name || name;
  const src = draft?.url || current?.url;
  return <div className="space-y-3 text-sm" aria-busy={busy}>
    {current && <>
      <div className="flex items-center gap-3">
        {src && <img src={src} width={64} height={64} className="h-16 w-16 rounded-full object-cover" alt={`Ảnh của ${label}`}/>}
        <div><strong>{label}</strong><p className="text-muted-foreground">{draft ? "Ảnh đang chọn" : current.url ? "Ảnh đang dùng tại CLB" : "Chưa có ảnh tại CLB"}</p></div>
      </div>
      <input ref={camera} type="file" hidden accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif" capture="environment" onChange={select}/>
      <input ref={gallery} type="file" hidden accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif" onChange={select}/>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => camera.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3"><Camera size={16}/>Chụp ảnh</button>
        <button type="button" disabled={busy} onClick={() => gallery.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3"><ImagePlus size={16}/>Chọn từ máy</button>
      </div>
      {draft && <><label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={allowTableDisplay} disabled={busy} onChange={event => setAllowTableDisplay(event.target.checked)}/>
        Người chơi đồng ý hiển thị ảnh trên bàn và trang khán giả của CLB.
      </label>
        <button type="button" disabled={busy || !allowTableDisplay} onClick={save} className="min-h-11 rounded-lg bg-primary px-4 font-semibold text-primary-foreground">Lưu ảnh cho {label}</button></>}
    </>}
    <p role="status" className="text-muted-foreground">{busy ? "Đang xử lý…" : message}</p>
  </div>;
}
