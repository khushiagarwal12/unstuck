/** Shrink a photo in the browser so it uploads quickly: longest side 1600px, JPEG. Returns base64 without the prefix. */
export async function shrinkImage(
  file: File,
  maxSide = 1600,
): Promise<{ mimeType: "image/jpeg"; data: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't process images.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { mimeType: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
}
