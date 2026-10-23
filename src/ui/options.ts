import { loadSettings, type Mode, normaliseHost, saveSettings } from "../settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const main = async () => {
  const s = await loadSettings();

  const enabled = $<HTMLInputElement>("enabled");
  enabled.checked = s.enabled;
  enabled.addEventListener("change", () => void saveSettings({ enabled: enabled.checked }));

  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
    radio.checked = radio.value === s.mode;
    radio.addEventListener("change", () => radio.checked && void saveSettings({ mode: radio.value as Mode }));
  }

  const heuristics = $<HTMLInputElement>("heuristics");
  heuristics.checked = s.heuristics;
  heuristics.addEventListener("change", () => void saveSettings({ heuristics: heuristics.checked }));

  const platformLabels = $<HTMLInputElement>("platformLabels");
  platformLabels.checked = s.platformLabels;
  platformLabels.addEventListener("change", () => void saveSettings({ platformLabels: platformLabels.checked }));

  const allowlist = $<HTMLTextAreaElement>("allowlist");
  allowlist.value = s.allowlist.join("\n");
  $("save").addEventListener("click", async () => {
    const hosts = [...new Set(allowlist.value.split(/\s+/).map(normaliseHost).filter(Boolean))];
    await saveSettings({ allowlist: hosts });
    allowlist.value = hosts.join("\n");
    $("saved").textContent = "Saved.";
    setTimeout(() => ($("saved").textContent = ""), 2000);
  });
};

void main();
