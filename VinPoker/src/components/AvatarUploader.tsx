import { useEffect,useRef, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { compressImage } from "@/lib/compressImage";
import {sessionReadEpoch} from '@/lib/sessionReadEpoch';

interface Props {
  avatarUrl?: string | null;
  displayName?: string | null;
  onUploaded: (url: string) => void;
}

export const AvatarUploader = (props:Props) => {
  const {user,session}=useAuth();
  return <AvatarUploadScope key={JSON.stringify([user?.id,sessionReadEpoch(session)])} {...props} actorId={user?.id}/>;
};
function AvatarUploadScope({avatarUrl,displayName,onUploaded,actorId}:Props&{actorId:string|undefined}){
  const supabase=useSupabaseClient();
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const live=useRef(false),inflight=useRef(false);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);

  const handleFile = async (rawFile: File) => {
    if (!actorId||!live.current||inflight.current) return;
    if (rawFile.size > 10 * 1024 * 1024) {
      toast.error(t("account.avatarTooLarge"));
      return;
    }
    inflight.current=true;setUploading(true);
    try{
      const file = await compressImage(rawFile, { maxEdge: 800, quality: 0.85 });
      if(!live.current)return;
      const ext = file.type === "image/png" ? "png" : "jpg";
      const path = `${actorId}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, {
        upsert: true,
        cacheControl: "3600",
        contentType: file.type,
      });
      if(!live.current)return;
      if(upErr)throw upErr;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = data.publicUrl;
      const { error: updErr } = await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("user_id", actorId);
      if(!live.current)return;
      if(updErr)throw updErr;
      onUploaded(publicUrl);
      toast.success(t("account.avatarUpdated"));
    }catch(cause){
      if(live.current)toast.error(cause&&typeof cause==='object'&&'message' in cause?String(cause.message):t('common.error'));
    }finally{inflight.current=false;if(live.current)setUploading(false);}
  };

  const initial = (displayName?.[0] || "?").toUpperCase();

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading||!actorId}
        aria-label={t("account.avatarHint")}
        className="relative w-20 h-20 rounded-full overflow-hidden gradient-gold flex items-center justify-center shadow-gold border-2 border-gold/40 hover:opacity-90 transition group"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt={displayName ?? "avatar"} className="w-full h-full object-cover" />
        ) : (
          <span className="text-2xl font-display font-bold text-primary-foreground">{initial}</span>
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
          {uploading ? (
            <Loader2 className="w-5 h-5 text-white animate-spin" />
          ) : (
            <Camera className="w-5 h-5 text-white" />
          )}
        </div>
      </button>
      <span className="text-[10px] text-muted-foreground">{t("account.avatarHint")}</span>
      <input
        ref={inputRef}
        type="file"
        disabled={uploading||!actorId}
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
};
