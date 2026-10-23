import { expect, states, test } from "./fixtures";

const PAGE = `<!doctype html><meta charset="utf-8"><body>
  <a href="https://example.com/"><img id="ai" src="/ocsp.jpg" width="300"></a>
  <img id="signed" src="/CA.jpg" width="300">
  <img id="plain" src="/no_manifest.jpg" width="300">
  <div id="later"></div>
  <script>
    setTimeout(() => {
      const i = document.createElement("img");
      i.id = "lazy"; i.src = "/ocsp.jpg?lazy"; i.width = 200;
      document.getElementById("later").append(i);
    }, 500);
  </script>`;

test("hides AI-labelled images and nothing else, including ones added later", async ({ context, site }) => {
  const { origin } = await site({ "/": PAGE });
  const page = await context.newPage();
  await page.goto(origin);
  await expect.poll(() => states(page)).toEqual({ ai: "blocked", signed: null, plain: null, lazy: "blocked" });
  expect(await page.getAttribute("#ai", "data-aiblock-mode")).toBe("hide");
  expect(await page.getAttribute("#ai", "title")).toContain("AI-generated");
});

test("first click reveals instead of following the link", async ({ context, site }) => {
  const { origin } = await site({ "/": PAGE });
  const page = await context.newPage();
  await page.goto(origin);
  await expect.poll(() => page.getAttribute("#ai", "data-aiblock")).toBe("blocked");
  await page.click("#ai");
  expect(await page.getAttribute("#ai", "data-aiblock")).toBe("revealed");
  expect(page.url()).toBe(`${origin}/`);
});

test("counts hidden images on the toolbar badge", async ({ context, site, badge }) => {
  const { origin } = await site({ "/": PAGE });
  const page = await context.newPage();
  await page.goto(origin);
  await expect.poll(() => badge(`${origin}/*`)).toBe("2");
});

test("only downloads the first 256 KB of a JPEG", async ({ context, site }) => {
  const { origin, hits } = await site({ "/": PAGE });
  const page = await context.newPage();
  await page.goto(origin);
  await expect.poll(() => states(page)).toMatchObject({ signed: null, plain: null, ai: "blocked" });
  await page.waitForTimeout(300);
  for (const file of ["/CA.jpg", "/no_manifest.jpg", "/ocsp.jpg"]) {
    const extension = hits.filter((h) => h.path === file && h.range);
    expect(extension, `${file} range requests`).toHaveLength(1);
    expect(extension[0]?.range).toBe("bytes=0-262143");
    // The only full download is the page's own.
    expect(
      hits.filter((h) => h.path === file && !h.range),
      `${file} full downloads`,
    ).toHaveLength(1);
  }
});

test("settings apply live: mode, allowlist and off switch", async ({ context, site, setSettings }) => {
  const { origin } = await site({ "/": PAGE });
  const page = await context.newPage();
  await page.goto(origin);
  await expect.poll(() => page.getAttribute("#ai", "data-aiblock")).toBe("blocked");

  await setSettings({ mode: "blur" });
  await expect.poll(() => page.getAttribute("#ai", "data-aiblock-mode")).toBe("blur");

  await setSettings({ allowlist: ["127.0.0.1"] });
  await expect.poll(() => page.getAttribute("#ai", "data-aiblock")).toBeNull();

  await setSettings({ allowlist: [] });
  await expect.poll(() => page.getAttribute("#ai", "data-aiblock")).toBe("blocked");

  await setSettings({ enabled: false });
  await expect.poll(() => states(page)).toEqual({ ai: null, signed: null, plain: null, lazy: null });
});
