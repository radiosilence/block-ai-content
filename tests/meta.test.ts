// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { findLabels, isMetaHost, mediaIn, platformName, postFor } from "../src/platforms/meta";

/** Media hidden in each post, as the content script would compute it. */
const hiddenIds = () =>
  findLabels(document.body)
    .map(postFor)
    .filter((p): p is Element => !!p)
    .flatMap((p) => mediaIn(p).map((m) => m.id));

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("hosts", () => {
  it("recognises Meta's sites and nothing else", () => {
    for (const h of [
      "www.facebook.com",
      "m.facebook.com",
      "facebook.com",
      "www.instagram.com",
      "www.threads.net",
      "www.threads.com",
    ])
      expect(isMetaHost(h)).toBe(true);
    for (const h of ["notfacebook.com", "facebook.com.evil.example", "example.com"]) expect(isMetaHost(h)).toBe(false);
    expect(platformName("www.instagram.com")).toBe("Instagram");
    expect(platformName("m.facebook.com")).toBe("Facebook");
  });
});

describe("Facebook feed", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div role="main"><div role="feed">
        <div aria-posinset="1">
          <div><a href="/u1"><img id="avatar1" width="40" src="a.jpg"></a>
            <span>Some Page</span> · <div role="button"><span><span>AI info</span></span></div></div>
          <div><img id="ai-photo" width="500" src="p1.jpg"></div>
          <div><video id="ai-video"></video></div>
        </div>
        <div aria-posinset="2">
          <div><img id="avatar2" width="40" src="a2.jpg"><span>Someone else</span></div>
          <div><img id="normal-photo" width="500" src="p2.jpg"></div>
        </div>
        <div aria-posinset="3">
          <p>Has anyone else noticed the AI info label everywhere now?</p>
          <img id="mentions-photo" width="500" src="p3.jpg">
        </div>
      </div></div>`;
  });

  it("hides the labelled post's photo and video", () => {
    expect(hiddenIds().toSorted()).toEqual(["ai-photo", "ai-video"]);
  });

  it("leaves avatars alone", () => {
    expect(hiddenIds()).not.toContain("avatar1");
  });

  it("judges size as drawn, not as served (avatars are often big files shown small)", () => {
    const avatar = document.getElementById("avatar1") as HTMLImageElement;
    avatar.removeAttribute("width");
    Object.defineProperty(avatar, "naturalWidth", { value: 960 });
    avatar.getBoundingClientRect = () => ({ width: 40, height: 40 }) as DOMRect;
    expect(hiddenIds()).not.toContain("avatar1");
  });

  it("does not trigger on posts that merely mention the label", () => {
    expect(hiddenIds()).not.toContain("mentions-photo");
  });

  it("finds labels inside a newly added subtree", () => {
    const post = document.createElement("div");
    post.setAttribute("aria-posinset", "4");
    post.innerHTML = `<span>Made with AI</span><img id="late" width="600">`;
    document.querySelector('[role="feed"]')!.append(post);
    expect(findLabels(post).map(postFor)).toEqual([post]);
  });

  it("finds a label carried only in aria-label", () => {
    document.body.innerHTML = `<div role="article"><div role="button" aria-label="AI info"></div><img id="x" width="300"></div>`;
    expect(hiddenIds()).toEqual(["x"]);
  });

  it("finds a label in a bare text node handed over by a mutation", () => {
    document.body.innerHTML = `<div role="article"><span id="s"></span><img id="x" width="300"></div>`;
    const text = document.createTextNode("AI info");
    document.getElementById("s")!.append(text);
    expect(findLabels(text).map((l) => l.id)).toEqual(["s"]);
  });
});

describe("Instagram", () => {
  it("uses the <article> as the post", () => {
    document.body.innerHTML = `
      <main>
        <article><header><img id="ig-avatar" width="32"><a>creator</a><div><span>AI info</span></div></header>
          <div><img id="ig-photo" width="470"></div></article>
        <article><header><img width="32"><a>other</a></header><div><img id="ig-other" width="470"></div></article>
      </main>`;
    expect(hiddenIds()).toEqual(["ig-photo"]);
  });
});

describe("markup without ARIA landmarks", () => {
  it("climbs to the nearest ancestor holding media", () => {
    document.body.innerHTML = `<div role="feed"><div><div><span>AI info</span></div><div><img id="near" width="400"></div></div>
      <div><img id="far" width="400"></div></div>`;
    expect(hiddenIds()).toEqual(["near"]);
  });

  it("refuses to climb into the feed when the labelled post has no media", () => {
    document.body.innerHTML = `<div role="feed"><div><span>AI info</span><p>text-only post</p></div>
      <div><img id="someone-elses" width="400"></div></div>`;
    expect(hiddenIds()).toEqual([]);
  });
});
