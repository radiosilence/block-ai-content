export type Mode = "hide" | "blur" | "label";

export interface Settings {
  enabled: boolean;
  /** What to do with an image once it's identified as AI-generated. */
  mode: Mode;
  /** Act on generator leftovers as well as formal disclosures. */
  heuristics: boolean;
  /** Hostnames where the extension does nothing (subdomains included). */
  allowlist: string[];
}

export const DEFAULTS: Settings = {
  enabled: true,
  mode: "hide",
  heuristics: true,
  allowlist: [],
};

export const loadSettings = async (): Promise<Settings> => {
  const stored = (await chrome.storage.sync.get(DEFAULTS)) as Partial<Settings>;
  return { ...DEFAULTS, ...stored };
};

export const saveSettings = (patch: Partial<Settings>): Promise<void> => chrome.storage.sync.set(patch);

export const onSettingsChanged = (fn: (s: Settings) => void): void => {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "sync") void loadSettings().then(fn);
  });
};

export const normaliseHost = (input: string): string => {
  const s = input.trim().toLowerCase();
  if (!s) return "";
  try {
    return new URL(s.includes("://") ? s : `https://${s}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export const isAllowlisted = (host: string, allowlist: readonly string[]): boolean => {
  const h = host.toLowerCase().replace(/^www\./, "");
  return allowlist.some((entry) => h === entry || h.endsWith(`.${entry}`));
};
