import { includesAsciiCI } from "./bytes";
import { extractMetadata } from "./containers";

export interface Detection {
  /** The file says it was made (wholly or partly) by generative AI. */
  ai: boolean;
  /** The file carries C2PA Content Credentials, AI or not (cameras sign too). */
  c2pa: boolean;
  /** Human-readable reasons for the verdict, for the tooltip and popup. */
  reasons: string[];
  /** False if the input was a partial file that stopped before its metadata did. */
  complete: boolean;
}

export interface DetectOptions {
  /**
   * Also act on tell-tale metadata that common image generators leave behind
   * but that isn't a formal disclosure (e.g. Stable Diffusion prompt chunks).
   */
  heuristics: boolean;
}

/**
 * IPTC "digital source type" codes. These are the vocabulary C2PA manifests and
 * XMP use to say "a model made this", and what the EU AI Act Code of Practice
 * points providers at. We match the term, not the full URI, because some tools
 * write it as `digsrctype:trainedAlgorithmicMedia` and others spell out the URL.
 * Case-insensitive, so `trainedalgorithmicmedia` also catches
 * `compositeWithTrainedAlgorithmicMedia`.
 */
const SOURCE_TYPES: ReadonlyArray<[needle: string, reason: string]> = [
  ["compositewithtrainedalgorithmicmedia", "Labelled as partly AI-generated (IPTC digital source type)"],
  ["trainedalgorithmicmedia", "Labelled as AI-generated (IPTC digital source type)"],
];

/** Phrases some vendors write into IPTC credit/description fields. */
const VENDOR_PHRASES: ReadonlyArray<[needle: string, reason: string]> = [
  ["made with google ai", 'Credit line says "Made with Google AI"'],
];

/** PNG text chunks written by local Stable Diffusion front-ends. */
const GENERATOR_CHUNKS: ReadonlyArray<[key: string, test: (v: string) => boolean, reason: string]> = [
  ["parameters", (v) => /\b(Steps|Sampler|CFG scale|Seed):/.test(v), "Stable Diffusion generation parameters"],
  ["prompt", (v) => v.includes('"class_type"'), "ComfyUI workflow"],
  ["workflow", (v) => v.includes('"nodes"'), "ComfyUI workflow"],
  ["invokeai_metadata", () => true, "InvokeAI generation metadata"],
  ["sd-metadata", () => true, "Stable Diffusion generation metadata"],
  ["Dream", () => true, "Stable Diffusion (dream) generation metadata"],
];

export const detect = async (bytes: Uint8Array, opts: DetectOptions, truncated = false): Promise<Detection> => {
  const meta = await extractMetadata(bytes, truncated);
  const reasons = new Set<string>();

  const scan = (table: ReadonlyArray<[string, string]>) => {
    for (const blob of meta.blobs) {
      for (const [needle, reason] of table) {
        if (includesAsciiCI(blob, needle)) {
          reasons.add(reason);
          return; // first (most specific) match wins
        }
      }
    }
  };

  scan(SOURCE_TYPES);
  if (opts.heuristics) {
    scan(VENDOR_PHRASES);
    for (const [key, test, reason] of GENERATOR_CHUNKS) {
      const value = meta.text.get(key);
      if (value !== undefined && test(value)) reasons.add(reason);
    }
  }

  const list = [...reasons];
  if (list.length > 0 && meta.c2pa) list.push("Has C2PA Content Credentials");
  return { ai: list.length > 0, c2pa: meta.c2pa, reasons: list, complete: meta.complete };
};
