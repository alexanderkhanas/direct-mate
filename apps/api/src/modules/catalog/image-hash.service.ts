import { Injectable, Logger } from '@nestjs/common';
// `import x = require()` is the CJS-interop form. Sharp's package
// uses `module.exports = function sharp(...)`, so `import sharp from
// 'sharp'` would compile to `sharp_1.default(...)` and fail at
// runtime under our tsconfig (esModuleInterop off).
import sharp = require('sharp');

/**
 * Computes a 64-bit dHash (difference hash) from images. Used to detect
 * when a customer-attached photo in a DM matches a product image we
 * already have stored.
 *
 * Algorithm: resize to 9×8 grayscale; for each row, compare each pixel
 * to its right neighbour (8 comparisons × 8 rows = 64 bits). Two images
 * with Hamming distance ≤ 5 are usually the same photo (different
 * compression / re-uploads). Higher distances are not the same image.
 *
 * Why dHash and not pHash (DCT) or aHash: dHash is more robust to
 * brightness shifts than aHash and simpler than pHash, while still
 * being effectively perfect for "exact image" matching. For our
 * use case (catalog vs. screenshot of catalog) any of the three would
 * work; dHash wins on simplicity.
 */
@Injectable()
export class ImageHashService {
  private readonly logger = new Logger(ImageHashService.name);

  /** Hamming-distance threshold below which two hashes count as the same image. */
  static readonly MATCH_THRESHOLD = 5;

  /** Compute dHash from a remote URL. Returns null on any failure. */
  async hashFromUrl(url: string): Promise<string | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        this.logger.warn(`hashFromUrl: ${url} → HTTP ${res.status}`);
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return await this.hashFromBuffer(buf);
    } catch (err: any) {
      this.logger.warn(`hashFromUrl(${url}) failed: ${err.message ?? err}`);
      return null;
    }
  }

  /** Compute dHash from raw image bytes. Returns null on decode failure. */
  async hashFromBuffer(buffer: Buffer): Promise<string | null> {
    try {
      // Trim uniform-colour borders BEFORE resize. This pulls Instagram
      // story screenshots (dark chrome around the product card) and bare
      // catalog photos (white margins around the model) into a consistent
      // "centered on product" frame so their hashes are comparable.
      // Without this the 9×8 dHash of a screenshot is dominated by chrome
      // and lands ~17 bits away from the equivalent catalog photo, well
      // outside any reasonable matching threshold.
      //
      // .trim() can fail on solid-color images (nothing to trim, sharp
      // throws); fall back to the un-trimmed buffer in that case.
      let trimmed: Buffer;
      try {
        trimmed = await sharp(buffer).trim().toBuffer();
      } catch {
        trimmed = buffer;
      }

      // 9×8 grayscale: 9 columns so we can do 8 horizontal comparisons per row.
      const data = await sharp(trimmed)
        .resize(9, 8, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer();

      // 9 cols × 8 rows = 72 grayscale bytes.
      let bits = 0n;
      let bit = 63;
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const left = data[row * 9 + col];
          const right = data[row * 9 + col + 1];
          if (left < right) bits |= 1n << BigInt(bit);
          bit--;
        }
      }
      return bits.toString(16).padStart(16, '0');
    } catch (err: any) {
      this.logger.warn(`hashFromBuffer failed: ${err.message ?? err}`);
      return null;
    }
  }

  /** Hamming distance between two 16-char hex hashes. */
  hammingDistance(a: string, b: string): number {
    if (a.length !== 16 || b.length !== 16) return Number.MAX_SAFE_INTEGER;
    let xor = BigInt('0x' + a) ^ BigInt('0x' + b);
    let dist = 0;
    while (xor > 0n) {
      dist += Number(xor & 1n);
      xor >>= 1n;
    }
    return dist;
  }
}
