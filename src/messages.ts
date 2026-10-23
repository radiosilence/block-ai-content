import type { Detection } from "./detect";

export type Request =
  | { type: "check"; url: string; heuristics: boolean }
  | { type: "blocked" }
  | { type: "count"; tabId: number };

export type CheckResponse = Detection | { error: string };

export const send = <T>(msg: Request): Promise<T> => chrome.runtime.sendMessage(msg);
