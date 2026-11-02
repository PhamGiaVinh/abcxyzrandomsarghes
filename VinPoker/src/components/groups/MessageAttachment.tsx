import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, FileText, FileImage, FileArchive, File as FileIcon } from "lucide-react";

interface Props {
  url: string;
  type: string | null;
  name?: string | null;
  size?: number | null;
  onLoadError?: () => void;
}

const fmtSize = (b?: number | null) => {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

const iconFor = (name?: string | null) => {
  const ext = (name ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return FileArchive;
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return FileImage;
  if (["pdf", "doc", "docx", "txt", "xls", "xlsx"].includes(ext)) return FileText;
  return FileIcon;
};

export const MessageAttachment = ({ url, type, name, size, onLoadError }: Props) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (type === "image") {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="block max-w-[260px] rounded-lg overflow-hidden border border-border/40 bg-muted/40"
        >
          <img src={url} alt={name ?? "image"} onError={onLoadError} className="block w-full max-h-[280px] object-cover" loading="lazy" />
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-3xl p-2">
            <img src={url} alt={name ?? "image"} onError={onLoadError} className="w-full max-h-[80vh] object-contain rounded" />
            <div className="flex justify-end pt-2">
              <Button asChild size="sm" variant="secondary">
                <a href={url} download={name ?? undefined} target="_blank" rel="noreferrer">
                  <Download className="w-3.5 h-3.5 mr-1" /> {t("groupChat.attachment.download")}
                </a>
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  const Icon = iconFor(name);
  return (
    <a
      href={url}
      download={name ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 max-w-[280px] px-3 py-2 rounded-lg border border-border/40 bg-card/60 hover:bg-card transition-colors"
    >
      <Icon className="w-5 h-5 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold truncate">{name ?? t("groupChat.attachment.file")}</div>
        <div className="text-[10px] text-muted-foreground">{fmtSize(size)}</div>
      </div>
      <Download className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </a>
  );
};
