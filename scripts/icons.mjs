// Draws the toolbar icon (an AI "sparkle" under a no-entry sign) as PNGs, so
// the repo needs no binary assets or image tooling.
import { deflateSync } from "node:zlib";

const RED = [179, 38, 30];
const INK = [60, 60, 72];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/** Colour of a point in unit space (-1..1), or null for transparent. */
const shade = (x, y) => {
  const r = Math.hypot(x, y);
  const ring = r <= 0.96 && r >= 0.76;
  // Slash from top-left to bottom-right, clipped to the disc.
  const slash = Math.abs(x - y) / Math.SQRT2 <= 0.1 && r <= 0.8;
  if (ring || slash) return RED;
  // Four-pointed sparkle (an astroid), the usual shorthand for "AI".
  const s = 0.52;
  if (Math.sqrt(Math.abs(x) / s) + Math.sqrt(Math.abs(y) / s) <= 1) return INK;
  return null;
};

export const icon = (size) => {
  const SS = 4; // supersampling for anti-aliasing
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const c = shade(((px + (sx + 0.5) / SS) / size) * 2 - 1, ((py + (sy + 0.5) / SS) / size) * 2 - 1);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      if (a) { raw[o] = r / a; raw[o + 1] = g / a; raw[o + 2] = b / a; }
      raw[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};
