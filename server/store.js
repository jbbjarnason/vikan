// JSON-file store on the data volume. Small household data: one file per week,
// plus family.json (preferences) and feedback.json (ratings/comments).
import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
const WEEKS = path.join(DATA_DIR, "weeks");
const SEED = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../seed");

const WEEK_ID = /^\d{4}-\d{2}-\d{2}$/;

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}

// Write to a temp file then rename, so a reader never sees half a file.
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

// Serialize writes so concurrent phone taps don't clobber each other.
let queue = Promise.resolve();
function locked(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export async function init() {
  await fs.mkdir(WEEKS, { recursive: true });
  if ((await fs.readdir(WEEKS)).length === 0) {
    await fs.cp(SEED, DATA_DIR, { recursive: true, force: false });
  }
}

export function assertWeekId(id) {
  if (!WEEK_ID.test(id)) throw new Error(`Week id must be the Monday date, YYYY-MM-DD (got "${id}")`);
}

export async function listWeeks() {
  const files = (await fs.readdir(WEEKS)).filter((f) => f.endsWith(".json")).sort().reverse();
  return Promise.all(
    files.map(async (f) => {
      const w = await readJson(path.join(WEEKS, f));
      return { id: w.id, title: w.title, updatedAt: w.updatedAt };
    }),
  );
}

export async function getWeek(id) {
  assertWeekId(id);
  return readJson(path.join(WEEKS, `${id}.json`), null);
}

export async function putWeek(week) {
  assertWeekId(week.id);
  return locked(async () => {
    const prev = await getWeek(week.id);
    // Keep what the family did on the phone if the planner re-sends the week.
    const merged = {
      ...week,
      days: week.days.map((d) => {
        const old = prev?.days?.find((p) => p.date === d.date);
        const chosen = d.chosen ?? old?.chosen ?? null;
        return { ...d, chosen: d.options.includes(chosen) ? chosen : (d.options[0] ?? null) };
      }),
      bought: prev?.bought ?? {},
      updatedAt: new Date().toISOString(),
    };
    await writeJson(path.join(WEEKS, `${week.id}.json`), merged);
    return merged;
  });
}

export async function updateWeek(id, fn) {
  return locked(async () => {
    const w = await getWeek(id);
    if (!w) throw new Error(`No week ${id}`);
    fn(w);
    w.updatedAt = new Date().toISOString();
    await writeJson(path.join(WEEKS, `${id}.json`), w);
    return w;
  });
}

export const getFamily = () => readJson(path.join(DATA_DIR, "family.json"), {});
export const putFamily = (f) =>
  locked(() => writeJson(path.join(DATA_DIR, "family.json"), { ...f, updatedAt: new Date().toISOString() }));

export const getFeedback = () => readJson(path.join(DATA_DIR, "feedback.json"), []);
export const addFeedback = (entry) =>
  locked(async () => {
    const all = await getFeedback();
    all.push({ ...entry, at: new Date().toISOString() });
    await writeJson(path.join(DATA_DIR, "feedback.json"), all);
    return entry;
  });

// The grocery list for a week: items from each day's chosen recipe plus extras,
// merged by SKU (or name when there is no SKU). Shared packs (one hakk pack for
// two dinners) are listed once: the planner gives the same SKU and qty in both.
export function groceryList(week) {
  const out = new Map();
  const add = (item, forLabel) => {
    const key = item.sku || item.name.toLowerCase();
    const cur = out.get(key);
    if (cur) {
      cur.qty = Math.max(cur.qty ?? 1, item.qty ?? 1);
      if (forLabel && !cur.for.includes(forLabel)) cur.for.push(forLabel);
    } else {
      out.set(key, { ...item, key, qty: item.qty ?? 1, for: forLabel ? [forLabel] : [] });
    }
  };
  for (const d of week.days ?? []) {
    const r = d.chosen && week.recipes?.[d.chosen];
    for (const item of r?.buy ?? []) add(item, d.day);
  }
  for (const item of week.extras ?? []) add(item, item.reason || "Annað");
  return [...out.values()];
}

// Aggregate history per product: how many of the recent weeks it was on the
// list, ticked into the cart, or marked "til heima", and when last bought.
export async function groceryHistory(weeksBack = 12) {
  const weeks = (await listWeeks()).slice(0, weeksBack);
  const stats = new Map();
  const meals = [];
  for (const { id } of weeks) {
    const w = await getWeek(id);
    for (const d of w.days ?? []) {
      const r = w.recipes?.[d.chosen];
      if (r) meals.push({ week: id, day: d.day, recipe: r.name, source: r.source?.url });
    }
    for (const item of groceryList(w)) {
      const s = stats.get(item.key) ?? { name: item.name, sku: item.sku, category: item.category, listed: 0, bought: 0, hadAtHome: 0, lastBought: null };
      s.listed++;
      const state = w.bought?.[item.key];
      if (state === "cart") {
        s.bought++;
        s.lastBought ??= id;
        (s.boughtWeeks ??= []).push(id);
      } else if (state === "home") {
        s.hadAtHome++;
      }
      stats.set(item.key, s);
    }
  }
  // "Due" staples: bought at least twice, and the typical gap between buys
  // (median, in weeks) has passed since the last time.
  const now = weeks[0]?.id;
  const weeksBetween = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 6048e5);
  for (const s of stats.values()) {
    const bw = s.boughtWeeks ?? [];
    delete s.boughtWeeks;
    if (bw.length < 2) continue;
    const gaps = bw.slice(1).map((w, i) => weeksBetween(bw[i], w)).sort((a, b) => a - b);
    s.medianGapWeeks = gaps[Math.floor(gaps.length / 2)];
    s.dueNextWeek = weeksBetween(now, s.lastBought) + 1 >= s.medianGapWeeks;
  }
  return {
    weeksCounted: weeks.length,
    products: [...stats.values()].sort((a, b) => b.bought - a.bought || b.listed - a.listed),
    meals,
  };
}
