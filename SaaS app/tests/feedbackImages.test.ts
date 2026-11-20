import { describe, expect, it } from "vitest";
import { safeImageName, sniffImage, MAX_IMAGE_BYTES, MAX_IMAGES_PER_ITEM } from "../src/lib/feedback/images";

const bytes = (...n: number[]) => Uint8Array.from(n);

describe("sniffImage", () => {
  it("recognises PNG, JPEG, GIF and WebP by signature", () => {
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImage(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1))).toBe("image/gif");
    expect(sniffImage(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe("image/webp");
  });
  it("rejects SVG, HTML, text and empty or short input", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(sniffImage(enc("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
    expect(sniffImage(enc("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImage(enc("hello world"))).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
    expect(sniffImage(bytes(0x89, 0x50))).toBeNull();
  });
  it("limits and names", () => {
    expect(MAX_IMAGE_BYTES).toBe(3 * 1024 * 1024);
    expect(MAX_IMAGES_PER_ITEM).toBe(5);
    expect(safeImageName('a/../b"<x>.png')).toBe("a_.._b__x_.png");
    expect(safeImageName("")).toBe("screenshot");
  });
});
