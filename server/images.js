// Recipe photos, stored on the data volume and served from /images/.
// Order: the recipe's own image URL, then the source page's photo (JSON-LD or
// og:image), then a generated photo if OPENAI_API_KEY is set.
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { safeFetch, readRecipePage } from "./recipepage.js";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
export const IMAGES_DIR = path.join(DATA_DIR, "images");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const IMAGE_MODEL = process.env.IMAGE_MODEL || "gpt-image-1";
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif", "image/gif": "gif" };
const MAX_BYTES = 8_000_000;

const isLocal = (src) => typeof src === "string" && src.startsWith("/images/");
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 20);

async function save(name, buf) {
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  await fs.writeFile(path.join(IMAGES_DIR, name), buf);
  return `/images/${name}`;
}

async function download(url) {
  const { res } = await safeFetch(url, "image/avif,image/webp,image/jpeg,image/png,image/*");
  const type = (res.headers.get("content-type") || "").split(";")[0].trim();
  if (!EXT[type]) throw new Error(`Not an image (${type || "unknown type"})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("Image too large");
  return save(`${hash(url)}.${EXT[type]}`, buf);
}

async function generate(id, r) {
  const prompt =
    r.imagePrompt ||
    `Realistic home food photography of "${r.name}", plated for a family dinner on a simple ceramic plate on a ` +
    `wooden kitchen table. Natural window light, shallow depth of field, appetizing and true to how this dish ` +
    `actually looks when cooked at home. Main ingredients: ${r.ingredients.slice(0, 8).join(", ")}. ` +
    `No text, no labels, no hands, no logos.`;
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    signal: AbortSignal.timeout(180000),
    headers: { authorization: `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: "1536x1024", quality: "medium", n: 1 }),
  });
  if (!res.ok) throw new Error(`Image API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const b64 = (await res.json()).data?.[0]?.b64_json;
  if (!b64) throw new Error("Image API returned no image");
  return save(`gen-${hash(id + prompt)}.png`, Buffer.from(b64, "base64"));
}

// Resolve one recipe's photo. Mutates the recipe; returns a short status.
async function resolve(id, r) {
  if (isLocal(r.image)) return "ok";
  const tried = [];
  for (const src of [r.image, r.source?.url && "page"]) {
    if (!src) continue;
    try {
      const url = src === "page" ? (await readRecipePage(r.source.url)).image : src;
      if (!url) continue;
      r.imageSource = url;
      r.image = await download(url);
      r.imageGenerated = false;
      return "source";
    } catch (e) {
      tried.push(e.message);
    }
  }
  if (OPENAI_API_KEY) {
    try {
      r.image = await generate(id, r);
      r.imageGenerated = true;
      delete r.imageSource;
      return "generated";
    } catch (e) {
      tried.push(e.message);
    }
  }
  delete r.image;
  return `none (${tried.join("; ") || (OPENAI_API_KEY ? "no source" : "no source and image generation is off")})`;
}

// Resolve photos for every recipe in a week, a few at a time.
export async function resolveImages(week) {
  const entries = Object.entries(week.recipes ?? {});
  const status = {};
  for (let i = 0; i < entries.length; i += 3) {
    await Promise.all(entries.slice(i, i + 3).map(async ([id, r]) => (status[id] = await resolve(id, r))));
  }
  return status;
}

export const generationEnabled = () => Boolean(OPENAI_API_KEY);
