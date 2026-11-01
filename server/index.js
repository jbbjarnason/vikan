// One process: static phone site at /, a small JSON API at /api for the
// phone's taps, and the MCP endpoint at /mcp for the weekly planner run.
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as store from "./store.js";
import { handleMcp } from "./mcp.js";
import { IMAGES_DIR, resolveImages } from "./images.js";

const PORT = Number(process.env.PORT || 8080);
const MCP_TOKEN = process.env.MCP_TOKEN || "";
const PUBLIC = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../public");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
};

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readBody(req, limit = 1_000_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error("Body too large"), { status: 413 });
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

function tokenOk(req, url) {
  if (!MCP_TOKEN) return false;
  const given = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || url.searchParams.get("token") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(MCP_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const str = (v, max = 500) => (typeof v === "string" ? v.slice(0, max) : undefined);

async function api(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // drop "api"
  const method = req.method;

  if (method === "GET" && parts[0] === "weeks" && parts.length === 1) return send(res, 200, await store.listWeeks());
  if (method === "GET" && parts[0] === "weeks" && parts.length === 2) {
    const w = await store.getWeek(parts[1]);
    return w ? send(res, 200, { ...w, groceryList: store.groceryList(w) }) : send(res, 404, { error: "not found" });
  }
  if (method === "POST" && parts[0] === "weeks" && parts[2] === "choose") {
    const { date, recipe } = (await readBody(req)) ?? {};
    const w = await store.updateWeek(parts[1], (w) => {
      const d = w.days.find((d) => d.date === date);
      if (!d || !d.options.includes(recipe)) throw Object.assign(new Error("Unknown day or option"), { status: 400 });
      d.chosen = recipe;
    });
    return send(res, 200, { ...w, groceryList: store.groceryList(w) });
  }
  if (method === "POST" && parts[0] === "weeks" && parts[2] === "check") {
    const { key, state } = (await readBody(req)) ?? {};
    if (!str(key) || ![null, "cart", "home"].includes(state ?? null)) return send(res, 400, { error: "bad check" });
    await store.updateWeek(parts[1], (w) => {
      w.bought ??= {};
      if (state) w.bought[key] = state;
      else delete w.bought[key];
    });
    return send(res, 200, { ok: true });
  }
  if (method === "GET" && parts[0] === "family") return send(res, 200, await store.getFamily());
  if (method === "PUT" && parts[0] === "family") {
    const f = await readBody(req);
    if (!f || typeof f !== "object") return send(res, 400, { error: "bad profile" });
    await store.putFamily(f);
    return send(res, 200, await store.getFamily());
  }
  if (method === "GET" && parts[0] === "feedback") return send(res, 200, await store.getFeedback());
  if (method === "POST" && parts[0] === "feedback") {
    const b = (await readBody(req)) ?? {};
    const rating = Number(b.rating);
    if (![-1, 1, 2].includes(rating) || !str(b.recipe)) return send(res, 400, { error: "bad feedback" });
    const entry = { week: str(b.week, 10), recipe: str(b.recipe, 200), name: str(b.name, 200), rating, who: str(b.who, 50), comment: str(b.comment) };
    return send(res, 200, await store.addFeedback(entry));
  }
  if (method === "GET" && parts[0] === "history") return send(res, 200, await store.groceryHistory(Number(url.searchParams.get("weeks")) || 12));
  return send(res, 404, { error: "not found" });
}

async function imageFile(res, pathname) {
  const file = path.join(IMAGES_DIR, path.basename(decodeURIComponent(pathname)));
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "image/jpeg", "cache-control": "public, max-age=31536000, immutable" });
    res.end(data);
  } catch {
    send(res, 404, "not found", "text/plain");
  }
}

async function staticFile(res, pathname) {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return send(res, 403, "forbidden", "text/plain");
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "cache-control": rel === "sw.js" || rel === "index.html" ? "no-cache" : "public, max-age=300",
    });
    res.end(data);
  } catch {
    // Unknown paths fall back to the app shell (hash routing).
    const data = await fs.readFile(path.join(PUBLIC, "index.html"));
    res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-cache" });
    res.end(data);
  }
}

await store.init();

// Make sure the two newest weeks have local photos (e.g. the seed week).
for (const { id } of (await store.listWeeks()).slice(0, 2)) {
  store.refreshImages(id, resolveImages).then(
    (s) => console.log(`images ${id}:`, JSON.stringify(s)),
    (e) => console.error(`images ${id}:`, e.message),
  );
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://local");
    try {
      if (url.pathname === "/healthz") return send(res, 200, { ok: true });
      if (url.pathname === "/mcp") {
        const ok = tokenOk(req, url);
        res.on("finish", () =>
          console.log(`mcp ${req.method} ${res.statusCode} token:${ok ? "ok" : "no"} access:${req.headers["cf-access-jwt-assertion"] ? "jwt" : "none"} ua:${(req.headers["user-agent"] || "").slice(0, 40)}`),
        );
        if (!ok) return send(res, 401, { error: "Missing or wrong bearer token" });
        const body = req.method === "POST" ? await readBody(req, 5_000_000) : undefined;
        return await handleMcp(req, res, body);
      }
      // No OAuth here: answer discovery probes with a plain 404, not the app shell.
      if (url.pathname.startsWith("/.well-known/")) return send(res, 404, { error: "not found" });
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      if (url.pathname.startsWith("/images/")) return await imageFile(res, url.pathname);
      return await staticFile(res, url.pathname);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, e.status || 500, { error: e.message });
    }
  })
  .listen(PORT, () => console.log(`vikan on :${PORT}${MCP_TOKEN ? "" : " (MCP disabled: set MCP_TOKEN)"}`));
