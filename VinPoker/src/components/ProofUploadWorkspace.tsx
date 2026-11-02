import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { Upload, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { compressImage } from "@/lib/compressImage";

export interface ProofUploaderProps {
  folder: string;
  value?: string | null;
  /** Display transport only; value remains the canonical persisted reference. */
  previewUrl?: string | null;
  onChange: (url: string | null) => void;
  label?: string;
  className?: string;
  required?: boolean;
  /** Writes a unique path intended for long lived, published media. */
  versioned?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
}

const MAX_BYTES = 5 * 1024 * 1024;

export const ProofUploadWorkspace = ({actorId,sessionEpoch,...props}:ProofUploaderProps&{actorId:string|undefined;sessionEpoch:number}) =>
  <ScopedProofUploader key={JSON.stringify([actorId,sessionEpoch,props.folder,props.versioned??false])} {...props} actorId={actorId}/>;

const ScopedProofUploader = ({ folder, value, previewUrl, onChange, label, className, required, versioned = false, onUploadingChange,actorId }: ProofUploaderProps&{actorId:string|undefined}) => {
  const { t } = useTranslation();
  const supabase = useSupabaseClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [failedPreview,setFailedPreview]=useState<string|null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const uploadObserver = useRef(onUploadingChange);
  uploadObserver.current = onUploadingChange;
  useEffect(() => { alive.current = true; return () => { alive.current = false; uploadObserver.current?.(false); }; }, []);
  const lbl = label ?? t("proofUpload.defaultLabel");

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (inFlight.current) return;
    const input = e.currentTarget;
    const raw = e.target.files?.[0];
    if (!raw) return;
    if (!raw.type.startsWith("image/")) {
      toast.error(t("proofUpload.onlyImg"));
      return;
    }
    if (raw.size > MAX_BYTES) {
      toast.error(t("proofUpload.max5"));
      return;
    }
    inFlight.current = true;
    setUploading(true);
    try {
      uploadObserver.current?.(true);
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (!alive.current) return;
      const user = authData.user;
      if (authError || !user || user.id!==actorId) {
        toast.error("Please sign in again before uploading.");
        return;
      }
      const file = await compressImage(raw, { maxEdge: 1600, quality: 0.8 });
      if (!alive.current) return;
      // Versioned TV references accept PNG/JPEG only. The codec may preserve
      // the original on failure or when re-encoding would increase its size.
      // Never upload those retained bytes under an invented .jpg extension.
      if (versioned && file.type !== "image/png" && file.type !== "image/jpeg") {
        toast.error("TV images must be PNG or JPEG. Convert this image and try again.");
        return;
      }
      const ext = file.type === "image/png" ? "png" : "jpg";
      const path = versioned
        ? `${user.id}/${folder}/v1/${crypto.randomUUID()}.${ext}`
        : `${user.id}/${folder}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("backing-proofs").upload(path, file, {
        cacheControl: versioned ? "31536000" : "3600",
        upsert: false,
        contentType: file.type,
      });
      if (!alive.current) return;
      if (error) {
        toast.error(error.message);
        return;
      }
      const { data } = supabase.storage.from("backing-proofs").getPublicUrl(path);
      onChange(data.publicUrl);
      toast.success(t("proofUpload.uploadedOk"));
    } catch (error: unknown) {
      if (alive.current) toast.error(error instanceof Error ? error.message : "Upload failed. Please try again.");
    } finally {
      inFlight.current = false;
      input.value = "";
      if (alive.current) { setUploading(false); uploadObserver.current?.(false); }
    }
  };

  return (
    <div className={className}>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={handleFile} />
      {value ? (
        <div className="relative inline-block">
          <img key={value} src={previewUrl ?? value} alt="proof" className="h-24 w-24 object-cover rounded-md border border-border"
            onError={()=>setFailedPreview(value)} onLoad={()=>setFailedPreview(current=>current===value?null:current)}/>
          {failedPreview===value&&<p role="alert" className="mt-1 max-w-xs text-xs text-destructive">{
            t('proofUpload.previewUnavailable','Image preview unavailable. The stored reference has not been removed.')
          }</p>}
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            aria-invalid={required && !value ? true : undefined}
            className={required && !value ? "border-destructive text-destructive hover:bg-destructive/10" : undefined}
          >
            {uploading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
            {lbl}
          </Button>
          {required && !value && (
            <span className="text-[10px] font-semibold text-destructive uppercase tracking-wider">* Bắt buộc</span>
          )}
        </div>
      )}
    </div>
  );
};
