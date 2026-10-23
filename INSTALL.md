# Installing Block AI Content

This guide assumes no technical knowledge. It takes about five minutes.

**Works in:** Google Chrome on Windows or Mac. Microsoft Edge, Brave, Arc, Vivaldi and Opera work too.
**Doesn't work in:** Safari (including iPhone and iPad) or Firefox, yet.

> **On a work computer?** Many firms lock their browsers down so you can't add
> extensions yourself. If you get stuck at Step 3 because the **Developer mode**
> switch is greyed out or missing, that's why. Ask your IT team; there's nothing
> you can do about it on your own.

---

## Step 1: Download it

1. Go to the **[Releases page](https://github.com/radiosilence/block-ai-content/releases/latest)**.
2. Under the heading **Assets**, click the file called **`block-ai-content-0.2.0.zip`** (the number may be higher).
   Don't click the ones called "Source code".
3. It will save to your **Downloads** folder.

## Step 2: Unzip it and put it somewhere safe

The browser runs the extension straight from this folder. **If you delete or move
the folder later, the extension stops working**, so put it somewhere you won't tidy away.

**On Windows**

1. Open your **Downloads** folder.
2. Right-click **`block-ai-content-0.2.0.zip`** and choose **Extract All…**
3. Click **Browse…**, pick your **Documents** folder, then click **Extract**.
4. You now have a folder called **`block-ai-content-0.2.0`** in Documents.

**On a Mac**

1. Open your **Downloads** folder in Finder.
2. Double-click **`block-ai-content-0.2.0.zip`**. A folder called **`block-ai-content-0.2.0`** appears next to it.
3. Drag that folder into **Documents** (in the Finder sidebar).

> Check: open the folder. You should see a file called **`manifest.json`** among
> others. If instead you see a single folder, open that one; the folder you want
> is whichever one has `manifest.json` directly inside it.

## Step 3: Add it to your browser

1. Open your browser and type this into the address bar, then press Enter:

   | Browser | Type this |
   | ------- | --------- |
   | Chrome  | `chrome://extensions` |
   | Edge    | `edge://extensions` |
   | Brave   | `brave://extensions` |
   | Others  | `chrome://extensions` usually works |

2. Turn on **Developer mode**.
   - **Chrome / Brave:** the switch is in the **top-right corner** of the page.
   - **Edge:** the switch is in the **left-hand panel**, near the bottom.

   This only lets you add extensions from a folder on your computer. It doesn't
   change anything else about your browser.

3. A new row of buttons appears. Click **Load unpacked**.
4. In the window that opens, go to **Documents**, click once on the
   **`block-ai-content-0.2.0`** folder, and click **Select** (Windows) or
   **Open** / **Select** (Mac).
5. **Block AI Content** now appears in your list of extensions. That's it: it's on.

## Step 4 (optional): Pin the button to your toolbar

1. Click the **jigsaw-piece icon** to the right of the address bar.
2. Find **Block AI Content** and click the **pin** next to it.

A red "no entry" button now sits on your toolbar. Click it to see how many
images it has hidden on the current page, to switch it off for a particular
site, or to open the settings.

---

## Using it

- AI-labelled images are replaced with a grey box saying **"AI-generated image hidden"**.
- **Click the box once** to see the image anyway. Click again to use it normally (for example, to follow a link).
- On **Facebook, Instagram and Threads** it hides the pictures and videos in any
  post that Facebook itself has marked **"AI info"** (you'll see those words
  next to the poster's name).
- In **Settings** you can choose to **blur** images instead of hiding them, or just **outline them in red**.

## What it will and won't catch

It's important to know the limits, because "no grey boxes" does **not** mean "no AI".

- ✅ It catches images whose **file contains a "made by AI" label**. OpenAI,
  Adobe Firefly, Google, Microsoft and others add these labels. The EU AI Act
  requires providers of AI image generators to label their output in a
  machine-readable way; this is what reads those labels.
- ❌ It **can't** catch AI images with no label. Older images, many open-source
  tools, and anyone who deliberately removes the label all get through.
- ❌ Many websites **strip this information out** when people upload images, so
  the label is gone before you ever see the picture.
- ⚠️ **Facebook, Instagram and Threads** strip it too, but they show their own
  "AI info" label instead, and the extension reads that. So on those sites it
  catches exactly what Facebook catches: no more, no less. This currently only
  works if your Facebook is set to **English**.
- ❌ It **can't** read invisible watermarks (such as Google's SynthID). Only the
  company that made them can check those.
- ❌ It **can't** detect AI-written text. No tool can do that reliably; the ones
  that claim to are wrong often enough to be useless.

## Is it safe? What are those warnings?

When you add it, the browser says the extension can **"read and change all your
data on all websites"**. That sounds alarming, so here's what it actually does
with that access:

- **Read:** it looks at the images on each page and downloads each one a second
  time to read the label inside the file.
- **Change:** it covers up the images that are labelled as AI.

It sends nothing anywhere, has no account, collects no data and contains no
tracking. The full source code is public in this repository for anyone to check.

Chrome may occasionally show a message about **"developer mode extensions"**.
That's a generic warning about anything installed this way. You can dismiss it.

## Updating to a new version

1. Download the new zip from the [Releases page](https://github.com/radiosilence/block-ai-content/releases/latest) and unzip it into **Documents**, as in Steps 1 and 2.
2. Go to `chrome://extensions` (or `edge://extensions`), click **Remove** on the old Block AI Content, then **Load unpacked** and choose the new folder.
3. Delete the old folder.

## Removing it

Go to `chrome://extensions` (or `edge://extensions`), click **Remove** under
Block AI Content, then delete the folder from Documents. You can turn
**Developer mode** back off afterwards.
