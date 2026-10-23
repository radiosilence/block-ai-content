import { ascii, concat, decodeLatin1, decodeUtf8, fourcc, inflate, startsWith, u16be, u32be, u32le } from "./bytes";

/**
 * The bits of an image file that can carry provenance labels, pulled out of the
 * container so we never go looking for strings inside compressed pixel data.
 */
export interface Metadata {
  format: "jpeg" | "png" | "webp" | "other";
  /** Raw metadata payloads: XMP packets, EXIF, JUMBF (C2PA) boxes, comments. */
  blobs: Uint8Array[];
  /** True when the file carries a C2PA manifest store (Content Credentials). */
  c2pa: boolean;
  /** PNG text chunks, keyed by their keyword. */
  text: Map<string, string>;
}

const PNG_SIG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JP = ascii("JP");

export const extractMetadata = async (b: Uint8Array): Promise<Metadata> => {
  if (b[0] === 0xff && b[1] === 0xd8) return jpeg(b);
  if (startsWith(b, PNG_SIG)) return png(b);
  if (fourcc(b, 0) === "RIFF" && fourcc(b, 8) === "WEBP") return webp(b);
  // GIF, AVIF, HEIC, MP4 and friends: fall back to treating the whole file as
  // metadata. A 20+ character label turning up by chance in compressed data is
  // not a realistic concern.
  return { format: "other", blobs: [b], c2pa: false, text: new Map() };
};

/**
 * JPEG: metadata lives in APPn/COM segments before the first scan. C2PA
 * manifests sit in APP11 as JUMBF, split across as many segments as needed, so
 * we stitch those back together per box instance before handing them on.
 */
const jpeg = (b: Uint8Array): Metadata => {
  const blobs: Uint8Array[] = [];
  const jumbf = new Map<number, Uint8Array[]>();
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) break;
    const marker = b[i + 1] ?? 0;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2; // standalone markers, no length
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const len = u16be(b, i + 2);
    if (len < 2) break;
    const payload = b.subarray(i + 4, Math.min(i + 2 + len, b.length));
    if (marker === 0xeb && startsWith(payload, JP)) {
      // APP11 JUMBF: CI(2) En(2) Z(4), then box data. Continuation segments
      // (Z > 1) repeat the box header, which we drop so the box reads contiguously.
      const instance = u16be(payload, 2);
      const seq = u32be(payload, 4);
      let body = payload.subarray(8);
      if (seq > 1) body = body.subarray(u32be(body, 0) === 1 ? 16 : 8);
      const parts = jumbf.get(instance) ?? [];
      parts.push(body);
      jumbf.set(instance, parts);
    } else if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      blobs.push(payload);
    }
    i += 2 + len;
  }
  let c2pa = false;
  for (const parts of jumbf.values()) {
    const box = concat(parts);
    blobs.push(box);
    if (isC2paJumbf(box)) c2pa = true;
  }
  return { format: "jpeg", blobs, c2pa, text: new Map() };
};

/**
 * A JUMBF superbox whose description box is labelled "c2pa" is a C2PA manifest
 * store. Layout: jumb header (8), jumd header (8), type UUID (16), toggles (1), label.
 */
const isC2paJumbf = (box: Uint8Array): boolean =>
  fourcc(box, 4) === "jumb" && fourcc(box, 12) === "jumd" && decodeLatin1(box.subarray(33, 38)) === "c2pa\0";

/**
 * PNG: text lives in tEXt/zTXt/iTXt chunks, EXIF in eXIf, and C2PA in caBX.
 * Chunks can appear after IDAT, so we walk the lot.
 */
const png = async (b: Uint8Array): Promise<Metadata> => {
  const blobs: Uint8Array[] = [];
  const text = new Map<string, string>();
  let c2pa = false;
  let i = 8;
  while (i + 8 <= b.length) {
    const len = u32be(b, i);
    const type = fourcc(b, i + 4);
    const data = b.subarray(i + 8, Math.min(i + 8 + len, b.length));
    i += 12 + len;
    if (type === "IEND") break;
    if (type === "caBX") {
      c2pa = true;
      blobs.push(data);
    } else if (type === "eXIf") {
      blobs.push(data);
    } else if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      const entry = await pngText(type, data);
      if (!entry) continue;
      text.set(entry[0], entry[1]);
      blobs.push(new TextEncoder().encode(entry[1]));
    }
  }
  return { format: "png", blobs, c2pa, text };
};

const pngText = async (type: string, data: Uint8Array): Promise<[string, string] | null> => {
  const nul = data.indexOf(0);
  if (nul < 1) return null;
  const key = decodeLatin1(data.subarray(0, nul));
  if (type === "tEXt") return [key, decodeLatin1(data.subarray(nul + 1))];
  if (type === "zTXt") {
    const body = await inflate(data.subarray(nul + 2));
    return body ? [key, decodeLatin1(body)] : null;
  }
  // iTXt: key \0 flag method lang \0 translated-key \0 text
  const compressed = data[nul + 1] === 1;
  const langEnd = data.indexOf(0, nul + 3);
  const tkeyEnd = langEnd < 0 ? -1 : data.indexOf(0, langEnd + 1);
  if (tkeyEnd < 0) return null;
  const raw = data.subarray(tkeyEnd + 1);
  const body = compressed ? await inflate(raw) : raw;
  return body ? [key, decodeUtf8(body)] : null;
};

/** WebP: a RIFF file whose XMP, EXIF and C2PA live in their own chunks. */
const webp = (b: Uint8Array): Metadata => {
  const blobs: Uint8Array[] = [];
  let c2pa = false;
  let i = 12;
  while (i + 8 <= b.length) {
    const type = fourcc(b, i);
    const len = u32le(b, i + 4);
    const data = b.subarray(i + 8, Math.min(i + 8 + len, b.length));
    i += 8 + len + (len & 1);
    if (type === "C2PA") {
      c2pa = true;
      blobs.push(data);
    } else if (type === "XMP " || type === "EXIF") {
      blobs.push(data);
    }
  }
  return { format: "webp", blobs, c2pa, text: new Map() };
};
