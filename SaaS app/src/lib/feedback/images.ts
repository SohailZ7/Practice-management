// Screenshots on feedback items. Raster images only (no SVG, which can carry script), checked by file signature rather than the
// name or the browser's type. Stored in the database like billing files. Nothing about an image is written to the audit log but ids and byte counts.
import { db } from "../db";
import { audit } from "../audit";
import { FeedbackError } from "./service";

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_IMAGES_PER_ITEM = 5;

export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** The real type from the first bytes, or null when it is not a PNG, JPEG, GIF or WebP. */
export function sniffImage(b: Uint8Array): ImageMime | null {
  const at = (i: number, s: number[]) => s.every((v, k) => b[i + k] === v);
  if (b.length >= 8 && at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (b.length >= 3 && at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (b.length >= 6 && (at(0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || at(0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))) return "image/gif";
  if (b.length >= 12 && at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}

export const safeImageName = (n: string) => n.replace(/[^\w.\- ()]/g, "_").slice(0, 80) || "screenshot";

export type ImageMeta = { id: string; name: string; size: number };

export async function addFeedbackImages(user: { id: string; email: string }, itemId: string, files: File[]): Promise<number> {
  const real = files.filter((f) => f.size > 0);
  if (real.length === 0) return 0;
  const item = await db.feedbackItem.findUnique({ where: { id: itemId }, select: { id: true, authorId: true } });
  if (!item) throw new FeedbackError(404, "not_found");
  if (item.authorId !== user.id) throw new FeedbackError(403, "forbidden");
  const have = await db.feedbackImage.count({ where: { itemId } });
  if (have + real.length > MAX_IMAGES_PER_ITEM) throw new FeedbackError(400, "too_many_images");
  const rows: { itemId: string; name: string; mime: string; size: number; data: Buffer }[] = [];
  for (const f of real) {
    if (f.size > MAX_IMAGE_BYTES) throw new FeedbackError(413, "image_too_large");
    const data = Buffer.from(await f.arrayBuffer());
    const mime = sniffImage(data);
    if (!mime) throw new FeedbackError(400, "not_an_image");
    rows.push({ itemId, name: safeImageName(f.name), mime, size: data.length, data });
  }
  await db.feedbackImage.createMany({ data: rows });
  await audit(user.email, "feedback.image.add", `${itemId} count=${rows.length} bytes=${rows.reduce((a, r) => a + r.size, 0)}`);
  return rows.length;
}

export async function listImages(itemIds: string[]): Promise<Record<string, ImageMeta[]>> {
  if (itemIds.length === 0) return {};
  const rows = await db.feedbackImage.findMany({ where: { itemId: { in: itemIds } }, orderBy: { createdAt: "asc" }, select: { id: true, itemId: true, name: true, size: true } });
  const out: Record<string, ImageMeta[]> = {};
  for (const r of rows) (out[r.itemId] ??= []).push({ id: r.id, name: r.name, size: r.size });
  return out;
}
