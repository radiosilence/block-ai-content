import { send } from "../messages";
import { isAllowlisted, loadSettings, normaliseHost, saveSettings } from "../settings";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const main = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const settings = await loadSettings();
  const host = tab?.url?.startsWith("http") ? normaliseHost(tab.url) : "";

  const enabled = $<HTMLInputElement>("enabled");
  enabled.checked = settings.enabled;
  enabled.addEventListener("change", () => void saveSettings({ enabled: enabled.checked }));

  if (tab?.id !== undefined) $("count").textContent = String(await send<number>({ type: "count", tabId: tab.id }));

  const site = $<HTMLInputElement>("site");
  if (!host) {
    $("site-row").hidden = true;
  } else {
    $("host").textContent = host;
    site.checked = isAllowlisted(host, settings.allowlist);
    site.addEventListener("change", async () => {
      const { allowlist } = await loadSettings();
      const next = site.checked ? [...new Set([...allowlist, host])] : allowlist.filter((h) => h !== host);
      await saveSettings({ allowlist: next });
    });
  }

  $("options").addEventListener("click", (e) => {
    e.preventDefault();
    void chrome.runtime.openOptionsPage();
  });
};

void main();
