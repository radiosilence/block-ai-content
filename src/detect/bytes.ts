const textDecoder = new TextDecoder("utf-8", { fatal: false });
const latin1Decoder = new TextDecoder("latin1");

export const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

export const decodeUtf8 = (b: Uint8Array): string => textDecoder.decode(b);
export const decodeLatin1 = (b: Uint8Array): string => latin1Decoder.decode(b);

export const u16be = (b: Uint8Array, i: number): number => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);

export const u32be = (b: Uint8Array, i: number): number =>
  (((b[i] ?? 0) << 24) >>> 0) + (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0));

export const u32le = (b: Uint8Array, i: number): number =>
  (((b[i + 3] ?? 0) << 24) >>> 0) + (((b[i + 2] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i] ?? 0));

export const startsWith = (b: Uint8Array, prefix: Uint8Array, at = 0): boolean => {
  if (at + prefix.length > b.length) return false;
  for (let i = 0; i < prefix.length; i++) if (b[at + i] !== prefix[i]) return false;
  return true;
};

export const fourcc = (b: Uint8Array, i: number): string =>
  String.fromCharCode(b[i] ?? 0, b[i + 1] ?? 0, b[i + 2] ?? 0, b[i + 3] ?? 0);

/** ASCII case-insensitive search. `needle` must already be lower-case. */
export const includesAsciiCI = (hay: Uint8Array, needle: string): boolean => {
  const n = ascii(needle);
  const first = n[0];
  if (first === undefined) return true;
  const last = hay.length - n.length;
  outer: for (let i = 0; i <= last; i++) {
    if (((hay[i] ?? 0) | 0x20) !== first) continue;
    for (let j = 1; j < n.length; j++) {
      const h = hay[i + j] ?? 0;
      const c = n[j] ?? 0;
      // Only fold case for letters; leave punctuation exact.
      if (h !== c && !(c >= 0x61 && c <= 0x7a && (h | 0x20) === c)) continue outer;
    }
    return true;
  }
  return false;
};

export const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** zlib inflate via the platform's DecompressionStream. Returns null on corrupt input. */
export const inflate = async (data: Uint8Array): Promise<Uint8Array | null> => {
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
};
