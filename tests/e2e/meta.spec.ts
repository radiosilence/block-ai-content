import { expect, fixture, states, test } from "./fixtures";

// Served at https://www.facebook.com/ via request interception, so the
// extension sees the real hostname. Images are data: URLs so nothing leaves
// the machine.
const IMG = `data:image/jpeg;base64,${fixture("no_manifest.jpg").toString("base64")}`;

const FEED = `<!doctype html><meta charset="utf-8"><body>
<div role="main"><div role="feed" style="width:520px">
  <div aria-posinset="1">
    <div><img id="avatar" src="${IMG}" style="width:40px;height:40px"> <b>Totally Real Photos</b> · <span role="button"><span>AI info</span></span></div>
    <img id="labelled" src="${IMG}" width="480">
    <video id="clip" width="480" muted loop></video>
  </div>
  <div aria-posinset="2">
    <div><img id="avatar2" src="${IMG}" style="width:40px;height:40px"> <b>Your Aunt</b></div>
    <img id="aunt" src="${IMG}" width="480">
  </div>
</div></div>`;

test.beforeEach(async ({ context }) => {
  await context.route("https://www.facebook.com/**", (route) =>
    route.fulfill({ body: FEED, contentType: "text/html; charset=utf-8" }),
  );
});

test("hides media in posts Facebook labels 'AI info', not avatars or other posts", async ({ context }) => {
  const page = await context.newPage();
  await page.goto("https://www.facebook.com/");
  await expect
    .poll(() => states(page))
    .toEqual({ avatar: null, labelled: "blocked", clip: "blocked", avatar2: null, aunt: null });
  expect(await page.getAttribute("#labelled", "title")).toContain('Facebook labelled this post "AI info"');
});

test("follows infinite scroll and carousels", async ({ context }) => {
  const page = await context.newPage();
  await page.goto("https://www.facebook.com/");
  await expect.poll(() => page.getAttribute("#labelled", "data-aiblock")).toBe("blocked");

  await page.evaluate((src) => {
    const post = document.createElement("div");
    post.setAttribute("aria-posinset", "3");
    post.innerHTML = `<div><b>Another Page</b> · <span>AI info</span></div><img id="scrolled" src="${src}" width="480">`;
    document.querySelector('[role="feed"]')?.append(post);

    const extra = document.createElement("img");
    extra.id = "carousel";
    extra.src = src;
    extra.width = 480;
    document.querySelector('[aria-posinset="1"]')?.append(extra);
  }, IMG);

  await expect.poll(() => states(page)).toMatchObject({ scrolled: "blocked", carousel: "blocked", aunt: null });
});

test("un-hides when React reuses the post's container for an unlabelled post", async ({ context }) => {
  const page = await context.newPage();
  await page.goto("https://www.facebook.com/");
  await expect.poll(() => page.getAttribute("#labelled", "data-aiblock")).toBe("blocked");
  await page.evaluate(() => document.querySelector('[aria-posinset="1"] [role="button"]')?.remove());
  await expect.poll(() => states(page)).toMatchObject({ labelled: null, clip: null });
});

test("keeps hidden videos paused through autoplay", async ({ context }) => {
  const page = await context.newPage();
  await page.goto("https://www.facebook.com/");
  await expect.poll(() => page.getAttribute("#clip", "data-aiblock")).toBe("blocked");
  // Give the video something it can genuinely play: a live canvas stream.
  const paused = await page.evaluate(async () => {
    const v = document.getElementById("clip") as HTMLVideoElement;
    const canvas = document.createElement("canvas");
    canvas.getContext("2d")?.fillRect(0, 0, 10, 10);
    v.srcObject = canvas.captureStream();
    await v.play().catch(() => {}); // the extension pausing it may reject this promise
    await new Promise((r) => setTimeout(r, 200));
    return v.paused;
  });
  expect(paused).toBe(true);
});

test("respects the Facebook switch in settings", async ({ context, setSettings }) => {
  const page = await context.newPage();
  await page.goto("https://www.facebook.com/");
  await expect.poll(() => page.getAttribute("#labelled", "data-aiblock")).toBe("blocked");
  await setSettings({ platformLabels: false });
  await expect.poll(() => page.getAttribute("#labelled", "data-aiblock")).toBeNull();
});
