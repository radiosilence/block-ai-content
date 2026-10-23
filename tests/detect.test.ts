import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { detect } from "../src/detect";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
const enc = (s: string) => new TextEncoder().encode(s);
const strict = { heuristics: false };
const loose = { heuristics: true };

const XMP_AI = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
 Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/>
</rdf:RDF></x:xmpmeta>`;

// --- tiny file builders -----------------------------------------------------

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const join = (...parts: ArrayLike<number>[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)));

const jpegSegment = (marker: number, payload: Uint8Array) => join([0xff, marker], u16(payload.length + 2), payload);
const jpeg = (...segments: Uint8Array[]) =>
  join([0xff, 0xd8], ...segments, [0xff, 0xda, 0x00, 0x02], enc("pixels pixels"), [0xff, 0xd9]);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type: string, data: Uint8Array) => {
  const body = join(enc(type), data);
  return join(u32(data.length), body, u32(crc(body)));
};
const png = (...chunks: Uint8Array[]) =>
  join(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk("IHDR", new Uint8Array(13)),
    ...chunks,
    pngChunk("IDAT", deflateSync(new Uint8Array(64))),
    pngChunk("IEND", new Uint8Array(0)),
  );

// --- real-world files (C2PA reference SDK fixtures) -------------------------

describe("real C2PA files", () => {
  it("flags a signed JPEG whose manifest declares AI generation", async () => {
    const d = await detect(fixture("ocsp.jpg"), strict);
    expect(d.ai).toBe(true);
    expect(d.c2pa).toBe(true);
  });

  it("does not flag a signed JPEG with no AI declaration", async () => {
    const d = await detect(fixture("CA.jpg"), loose);
    expect(d).toMatchObject({ ai: false, c2pa: true });
  });

  it("does not flag a plain JPEG", async () => {
    expect(await detect(fixture("no_manifest.jpg"), loose)).toMatchObject({ ai: false, c2pa: false });
  });

  it("does not flag a WebP with ordinary XMP", async () => {
    expect(await detect(fixture("test_xmp.webp"), loose)).toMatchObject({ ai: false });
  });
});

// --- JPEG -------------------------------------------------------------------

describe("JPEG", () => {
  it("reads the IPTC digital source type from XMP", async () => {
    const file = jpeg(jpegSegment(0xe1, join(enc("http://ns.adobe.com/xap/1.0/\0"), enc(XMP_AI))));
    const d = await detect(file, strict);
    expect(d.ai).toBe(true);
    expect(d.reasons[0]).toMatch(/AI-generated/);
  });

  it("distinguishes partly-AI composites", async () => {
    const xmp = XMP_AI.replace("trainedAlgorithmicMedia", "compositeWithTrainedAlgorithmicMedia");
    const d = await detect(jpeg(jpegSegment(0xe1, enc(xmp))), strict);
    expect(d.reasons[0]).toMatch(/partly/);
  });

  it("finds a label split across APP11 JUMBF continuation segments", async () => {
    const label = enc("http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia");
    const jumd = join(u32(8 + 16 + 1 + 5), enc("jumd"), new Uint8Array(16), [3], enc("c2pa\0"));
    const content = join(new Uint8Array(40), label, new Uint8Array(40));
    const box = join(u32(8 + jumd.length + content.length), enc("jumb"), jumd, content);
    // Split inside "trainedAlgorithmicMedia"; continuation segments repeat the 8-byte box header.
    const cut = 8 + jumd.length + 40 + label.indexOf(0x41); // "trained" | "Algorithmic..."
    const header = box.subarray(0, 8);
    const seg = (seq: number, body: Uint8Array) => jpegSegment(0xeb, join(enc("JP"), u16(1), u32(seq), body));
    const file = jpeg(seg(1, box.subarray(0, cut)), seg(2, join(header, box.subarray(cut))));

    const d = await detect(file, strict);
    expect(d).toMatchObject({ ai: true, c2pa: true });
  });

  it("ignores the string if it only appears in pixel data", async () => {
    const file = join([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02], enc("trainedAlgorithmicMedia"), [0xff, 0xd9]);
    expect((await detect(file, loose)).ai).toBe(false);
  });

  it("survives truncated and garbage input", async () => {
    const full = jpeg(jpegSegment(0xe1, enc(XMP_AI)));
    for (let n = 0; n < full.length; n += 7) await detect(full.subarray(0, n), loose);
    await detect(enc("not an image at all"), loose);
    await detect(new Uint8Array(0), loose);
  });
});

// --- PNG --------------------------------------------------------------------

describe("PNG", () => {
  it("reads XMP from an uncompressed iTXt chunk", async () => {
    const itxt = join(enc("XML:com.adobe.xmp\0"), [0, 0], enc("\0\0"), enc(XMP_AI));
    expect((await detect(png(pngChunk("iTXt", itxt)), strict)).ai).toBe(true);
  });

  it("reads XMP from a compressed iTXt chunk", async () => {
    const itxt = join(enc("XML:com.adobe.xmp\0"), [1, 0], enc("\0\0"), deflateSync(enc(XMP_AI)));
    expect((await detect(png(pngChunk("iTXt", itxt)), strict)).ai).toBe(true);
  });

  it("notices a caBX (C2PA) chunk", async () => {
    const d = await detect(png(pngChunk("caBX", enc("jumb...c2pa..."))), strict);
    expect(d).toMatchObject({ ai: false, c2pa: true });
  });

  it("flags Stable Diffusion parameters only when heuristics are on", async () => {
    const file = png(pngChunk("tEXt", enc("parameters\0a cat in a hat\nSteps: 20, Sampler: Euler a, Seed: 1")));
    expect((await detect(file, strict)).ai).toBe(false);
    const d = await detect(file, loose);
    expect(d.ai).toBe(true);
    expect(d.reasons).toContain("Stable Diffusion generation parameters");
  });

  it("does not treat any old 'parameters' text as Stable Diffusion", async () => {
    const file = png(pngChunk("tEXt", enc("parameters\0exposure=+1")));
    expect((await detect(file, loose)).ai).toBe(false);
  });

  it("flags ComfyUI workflows in zTXt", async () => {
    const body = deflateSync(enc('{"3":{"class_type":"KSampler","inputs":{}}}'));
    const file = png(pngChunk("zTXt", join(enc("prompt\0"), [0], body)));
    expect((await detect(file, loose)).reasons).toContain("ComfyUI workflow");
  });
});

// --- WebP / others ----------------------------------------------------------

describe("WebP and other formats", () => {
  const riff = (...chunks: [string, Uint8Array][]) => {
    const body = chunks.flatMap(([type, data]) => {
      const len = data.length;
      return [...enc(type), len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, len >>> 24, ...data, ...(len & 1 ? [0] : [])];
    });
    const size = body.length + 4;
    return join(enc("RIFF"), [size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, size >>> 24], enc("WEBP"), body);
  };

  it("reads XMP from a WebP chunk", async () => {
    const file = riff(["VP8 ", new Uint8Array(11)], ["XMP ", enc(XMP_AI)]);
    expect((await detect(file, strict)).ai).toBe(true);
  });

  it("falls back to a whole-file scan for unknown containers", async () => {
    const file = join(enc("GIF89a"), new Uint8Array(20), enc(XMP_AI));
    expect((await detect(file, strict)).ai).toBe(true);
  });

  it("matches Google's credit line only with heuristics", async () => {
    const xmp = `<photoshop:Credit>Made with Google AI</photoshop:Credit>`;
    const file = jpeg(jpegSegment(0xe1, enc(xmp)));
    expect((await detect(file, strict)).ai).toBe(false);
    expect((await detect(file, loose)).ai).toBe(true);
  });
});
