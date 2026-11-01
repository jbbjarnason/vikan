// Read a schema.org Recipe from a public recipe page (JSON-LD), compactly.
import dns from "node:dns/promises";
import net from "node:net";

function isPrivate(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

// The MCP runs on a home network: only fetch public hosts.
async function assertPublic(url) {
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Only http(s) URLs");
  const addrs = await dns.lookup(url.hostname, { all: true });
  if (addrs.some((a) => isPrivate(a.address))) throw new Error("Refusing to fetch a private address");
}

const text = (v) => (typeof v === "string" ? v.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "");
const minutes = (iso) => {
  const m = typeof iso === "string" && iso.match(/P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  return m && (m[1] || m[2]) ? Number(m[1] || 0) * 60 + Number(m[2] || 0) : undefined;
};

function flattenSteps(ins) {
  if (!ins) return [];
  if (typeof ins === "string") return [text(ins)];
  if (!Array.isArray(ins)) ins = [ins];
  return ins.flatMap((s) => (typeof s === "string" ? [text(s)] : s.itemListElement ? flattenSteps(s.itemListElement) : [text(s.text || s.name)])).filter(Boolean);
}

function findRecipe(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) return node.map(findRecipe).find(Boolean) || null;
  const t = node["@type"];
  if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) return node;
  return findRecipe(node["@graph"]) || findRecipe(node.mainEntity);
}

// Fetch a public URL, following redirects by hand so every hop is checked
// against private addresses. Returns the response and the final URL.
export async function safeFetch(raw, accept = "text/html") {
  let url = new URL(raw);
  let res;
  for (let hop = 0; ; hop++) {
    await assertPublic(url);
    res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      headers: { "user-agent": "Vikan/1.0 (heimilis-matseðill; Claude-User)", accept },
    });
    const loc = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !loc) break;
    if (hop >= 4) throw new Error("Too many redirects");
    url = new URL(loc, url);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url.hostname}`);
  return { res, url };
}

const ogImage = (html, base) => {
  const m =
    html.match(/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i);
  // Fallbacks: microdata ImageObject url, then the first WordPress upload.
  const md = m || html.match(/itemprop=["']image["'][\s\S]{0,400}?(?:content|src)=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/i);
  const wp = md || html.match(/["'](https?:\/\/[^"' ]+\/wp-content\/uploads\/[^"' ]+\.(?:jpe?g|png|webp))["']/i);
  try {
    return wp ? new URL(wp[1].replace(/&amp;/g, "&"), base).href : undefined;
  } catch {
    return undefined;
  }
};

export async function readRecipePage(raw) {
  const { res, url } = await safeFetch(raw);
  const html = (await res.text()).slice(0, 3_000_000);
  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, body] of blocks) {
    let data;
    try {
      data = JSON.parse(body.trim());
    } catch {
      continue;
    }
    const r = findRecipe(data);
    if (!r) continue;
    const img = Array.isArray(r.image) ? r.image[0] : r.image;
    return {
      found: true,
      url: url.href,
      name: text(r.name),
      image: (typeof img === "string" ? img : img?.url) || ogImage(html, url),
      minutes: minutes(r.totalTime) ?? minutes(r.cookTime),
      servings: text(Array.isArray(r.recipeYield) ? r.recipeYield[0] : String(r.recipeYield ?? "")),
      ingredients: (r.recipeIngredient || []).map(text),
      steps: flattenSteps(r.recipeInstructions),
      category: r.recipeCategory,
      cuisine: r.recipeCuisine,
    };
  }
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  return { found: false, url: url.href, title: text(title), image: ogImage(html, url), hint: "No schema.org Recipe on this page; read the page text instead." };
}
