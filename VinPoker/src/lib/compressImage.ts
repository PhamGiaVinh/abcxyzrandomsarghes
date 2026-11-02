/**
 * Compress an image File on the client before upload.
 * - Resize so the longest edge is <= maxEdge
 * - Re-encode as JPEG at the given quality (PNG is preserved when alpha may matter)
 * - Falls back to returning the original file if compression fails or yields a larger file
 */
export async function compressImage(
  file: File,
  opts: { maxEdge?: number; quality?: number } = {}
): Promise<File> {
  const maxEdge = opts.maxEdge ?? 1600;
  const quality = opts.quality ?? 0.8;

  if (!file.type.startsWith("image/")) return file;
  // Skip GIFs (animation would be lost) and SVG (vector).
  if (file.type === "image/gif" || file.type === "image/svg+xml") return file;

  try {
    const bitmap = await createImageBitmap(file);
    let canvas: HTMLCanvasElement;
    try {
      const { width, height } = bitmap;
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));

      canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, w, h);
    } finally {
      // The decoded allocation belongs to this operation, including fallback
      // paths. Release it before waiting for the asynchronous canvas encoder.
      bitmap.close?.();
    }

    const outType = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, outType, quality)
    );
    if (!blob) return file;
    if (blob.size >= file.size) return file; // no benefit

    const newName = file.name.replace(/\.(jpe?g|png|webp|heic|heif)$/i, "") +
      (outType === "image/png" ? ".png" : ".jpg");
    return new File([blob], newName, { type: outType, lastModified: Date.now() });
  } catch (e) {
    console.warn("compressImage failed, using original", e);
    return file;
  }
}
