// Vikan: phone UI. Hash routes, plain DOM, data from /api.
const $view = document.getElementById("view");
const $title = document.getElementById("title");
const $subtitle = document.getElementById("subtitle");

const AISLES = ["Grænmeti og ávextir", "Brauð", "Kjöt og fiskur", "Mjólkurvörur og ostar", "Þurrvara", "Krydd og sósur", "Frystivara", "Annað"];
const DAYS = ["sunnudagur", "mánudagur", "þriðjudagur", "miðvikudagur", "fimmtudagur", "föstudagur", "laugardagur"];
// Accusative with the article, for "á mánudaginn".
const DAYS_ACC = ["sunnudaginn", "mánudaginn", "þriðjudaginn", "miðvikudaginn", "fimmtudaginn", "föstudaginn", "laugardaginn"];
const MONTHS = ["janúar", "febrúar", "mars", "apríl", "maí", "júní", "júlí", "ágúst", "september", "október", "nóvember", "desember"];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const kr = (n) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} kr.`;
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const fmtDate = (iso) => { const d = new Date(iso + "T12:00:00"); return `${d.getDate()}. ${MONTHS[d.getMonth()]}`; };
const fmtShort = (iso) => { const d = new Date(iso + "T12:00:00"); return `${d.getDate()}. ${MONTHS[d.getMonth()].slice(0, 3)}`; };
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 2200);
}

function store(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(val));
  } catch { return undefined; }
}

async function api(path, opts = {}) {
  const res = await fetch(`/api/${path}`, {
    ...opts,
    headers: { "content-type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

// ---- data ----
let weeks = null;
const weekCache = new Map();

async function loadWeeks(fresh = false) {
  if (fresh || !weeks) weeks = await api("weeks");
  return weeks;
}
async function loadWeek(id, fresh = false) {
  if (!fresh && weekCache.has(id)) return weekCache.get(id);
  const w = await api(`weeks/${id}`);
  weekCache.set(id, w);
  return w;
}

// The week we're in, else the next one coming, else the latest.
async function currentWeekId() {
  const list = await loadWeeks();
  const t = todayIso();
  const ids = list.map((w) => w.id).sort();
  return ids.find((id) => id <= t && t < addDays(id, 7)) ?? ids.find((id) => id > t) ?? ids.at(-1);
}

// The dinner for a date: the last day entry starting on or before it.
function dayFor(week, iso) {
  const days = [...week.days].sort((a, b) => a.date.localeCompare(b.date));
  if (iso < days[0].date) return { day: days[0], upcoming: true };
  return { day: days.filter((d) => d.date <= iso).at(-1), upcoming: false };
}

// The days before and after one day, across week boundaries: {prev, next}, each {w, d}.
async function neighbours(weekId, date) {
  const ids = (await loadWeeks()).map((x) => x.id).sort();
  const i = ids.indexOf(weekId);
  const near = await Promise.all([ids[i - 1], weekId, ids[i + 1]].filter(Boolean).map((id) => loadWeek(id)));
  const days = near.flatMap((w) => [...w.days].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ w, d })));
  const k = days.findIndex((x) => x.w.id === weekId && x.d.date === date);
  return k < 0 ? {} : { prev: days[k - 1], next: days[k + 1] };
}

// Previous/next day buttons; swiping left/right on the page follows them.
function pager({ prev, next }, href, middle = "") {
  const link = (x, dir) =>
    x
      ? `<a class="pg ${dir}" href="${href(x)}" aria-label="${dir === "prev" ? "Fyrri" : "Næsti"} dagur: ${esc(x.d.day)}">${dir === "prev" ? "‹ " : ""}<span>${esc(x.d.day.slice(0, 3))} ${fmtShort(x.d.date)}</span>${dir === "next" ? " ›" : ""}</a>`
      : `<span class="pg ${dir} off"></span>`;
  return `<nav class="pager">${link(prev, "prev")}${middle}${link(next, "next")}</nav>`;
}
const dayHref = (x) => `#/dagur/${x.w.id}/${x.d.date}`;

// Previous/next week buttons for the week and list pages (swipe follows them too).
async function weekPager(id, base) {
  const list = [...(await loadWeeks())].sort((a, b) => a.id.localeCompare(b.id));
  const i = list.findIndex((x) => x.id === id);
  const cur = await currentWeekId();
  const label = (x) => (x.title || "").split(" · ")[0] || fmtShort(x.id);
  const link = (x, dir) =>
    x
      ? `<a class="pg ${dir}" href="#/${base}/${x.id}" aria-label="${dir === "prev" ? "Fyrri" : "Næsta"} vika: ${esc(x.title)}">${dir === "prev" ? "‹ " : ""}<span>${esc(label(x))}</span>${dir === "next" ? " ›" : ""}</a>`
      : `<span class="pg ${dir} off"></span>`;
  const middle = id !== cur ? `<a class="pg now" href="#/${base}/${cur}">Þessi vika</a>` : "";
  return `<nav class="pager">${link(list[i - 1], "prev")}${middle}${link(list[i + 1], "next")}</nav>`;
}
const recipeHref = (x) => `#/uppskrift/${x.w.id}/${x.d.chosen}/${x.d.date}`;

const recipeImg = (r, cls = "") =>
  r.image
    ? `<div class="pic ${cls}"><img src="${esc(r.image)}" alt="" loading="lazy">${r.imageGenerated ? `<span class="ai">Mynd gerð með gervigreind</span>` : ""}</div>`
    : `<div class="noimg ${cls}">${esc((r.name || "?")[0])}</div>`;

const metaChips = (r) => {
  const chips = [r.minutes && `${r.minutes} mín`, r.servings && `${r.servings} skammtar`, ...(r.tags || []).slice(0, 3)].filter(Boolean);
  return chips.length ? `<ul class="meta">${chips.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : "";
};

function setHeader(title, sub = "") {
  $title.textContent = title;
  $subtitle.textContent = sub;
  document.title = title === "Vikan" ? "Vikan" : `${title} · Vikan`;
}

// ---- views ----
// One day's dinner. Without a date: tonight (or the first dinner of the coming week).
async function viewDay(weekId, date) {
  const id = weekId || (await currentWeekId());
  if (!id) return viewEmpty();
  const w = await loadWeek(id);
  const t = todayIso();
  const { day, upcoming } = dayFor(w, date || t);
  const now = dayFor(w, t);
  const tonight = !now.upcoming && now.day === day;
  const r = w.recipes[day.chosen];
  if (!date) setHeader("Í kvöld", upcoming ? `Næsta vika byrjar á ${DAYS_ACC[new Date(day.date + "T12:00").getDay()]}, ${fmtDate(day.date)}` : `${DAYS[new Date().getDay()]} ${fmtDate(t)}`);
  else setHeader(tonight ? "Í kvöld" : day.day, fmtDate(day.date));
  const next = w.days.filter((x) => x.date > day.date).slice(0, 3);
  const nb = await neighbours(w.id, day.date);
  $view.innerHTML = `
    ${pager(nb, dayHref, date && !tonight ? `<a class="pg now" href="#/">Í dag</a>` : "")}
    <article class="card hero">
      ${recipeImg(r)}
      <div class="body">
        <div class="eyebrow">${upcoming && !date ? `${esc(day.day)} · fyrsti kvöldmatur` : esc(day.day)}</div>
        <h2>${esc(r.name)}</h2>
        ${r.intro ? `<p class="muted small">${esc(r.intro)}</p>` : ""}
        ${metaChips(r)}
        <div class="row" style="margin-top:14px">
          <a class="btn" href="#/uppskrift/${w.id}/${day.chosen}/${day.date}">Uppskrift</a>
          ${r.steps?.length ? `<a class="btn ghost" href="#/elda/${w.id}/${day.chosen}">Elda</a>` : ""}
        </div>
      </div>
    </article>
    ${day.options.length > 1 ? `<p class="small muted" style="margin:10px 2px">Langar ykkur í eitthvað annað? <a href="#/vika/${w.id}">${day.options.length - 1} aðrir valmöguleikar</a></p>` : ""}
    ${next.length ? `<h3>Næstu daga</h3><div class="card">${next.map((x) => dayRow(w, x)).join("")}</div>` : ""}
    ${w.prep?.length && upcoming && !date ? `<h3>Á innkaupadegi</h3><div class="card"><div class="body"><ul class="ingredients">${w.prep.map((p, i) => checkLi(`prep-${w.id}-${i}`, p)).join("")}</ul></div></div>` : ""}
    ${installHint()}`;
  bindChecks();
}

const dayRow = (w, d) => {
  const r = w.recipes[d.chosen];
  const today = d.date === todayIso();
  return `<a class="day${today ? " today" : ""}" href="#/uppskrift/${w.id}/${d.chosen}/${d.date}">
    <span class="when">${esc(d.day)} · ${fmtDate(d.date)}</span>
    <span class="what">${esc(r?.name ?? "—")}</span>
    <span class="chev">›</span></a>`;
};

function checkLi(key, label) {
  const checked = store(`chk:${key}`) ? "checked" : "";
  return `<li><input type="checkbox" data-key="${esc(key)}" ${checked} aria-label="${esc(label)}"><span>${esc(label)}</span></li>`;
}
function bindChecks() {
  $view.querySelectorAll("input[data-key]").forEach((el) =>
    el.addEventListener("change", () => store(`chk:${el.dataset.key}`, el.checked)),
  );
}

async function viewWeek(id) {
  await loadWeeks(true); // a week Claude just planned shows up without a reload
  id ||= await currentWeekId();
  if (!id) return viewEmpty();
  const w = await loadWeek(id);
  setHeader("Vikan", w.title);
  $view.innerHTML = `
    ${await weekPager(w.id, "vika")}
    ${w.summary ? `<p class="muted">${esc(w.summary)}</p>` : ""}
    ${w.days.map((d) => {
      const r = w.recipes[d.chosen];
      return `<section class="card" data-date="${d.date}">
        ${dayRow(w, d)}
        ${d.options.length > 1 ? `<div class="optlabel">Veldu rétt · ${d.options.length} valmöguleikar</div>
        <div class="options">${d.options.map((o) => {
          const x = w.recipes[o];
          return `<button class="option" aria-pressed="${o === d.chosen}" data-date="${d.date}" data-recipe="${esc(o)}">
            ${recipeImg(x)}<div class="t">${esc(x.name)}<span>${[x.minutes && `${x.minutes} mín`, x.source?.name].filter(Boolean).map(esc).join(" · ")}</span></div></button>`;
        }).join("")}</div>` : ""}
        ${d.note ? `<p class="small muted" style="padding:0 16px 12px;margin:0">${esc(d.note)}</p>` : ""}
      </section>`;
    }).join("")}
    ${w.prep?.length ? `<h3>Undirbúningur</h3><div class="card"><div class="body"><ul class="ingredients">${w.prep.map((p, i) => checkLi(`prep-${w.id}-${i}`, p)).join("")}</ul></div></div>` : ""}
    <a class="btn block ghost" style="margin-top:16px" href="#/listi/${w.id}">Innkaupalisti fyrir þessa viku</a>`;
  bindChecks();
  $view.querySelectorAll(".option").forEach((b) =>
    b.addEventListener("click", async () => {
      if (b.getAttribute("aria-pressed") === "true") return;
      try {
        const updated = await api(`weeks/${w.id}/choose`, { method: "POST", body: { date: b.dataset.date, recipe: b.dataset.recipe } });
        weekCache.set(w.id, updated);
        toast(`Valið: ${updated.recipes[b.dataset.recipe].name}`);
        viewWeek(w.id);
      } catch (e) {
        toast(`Tókst ekki: ${e.message}`);
      }
    }),
  );
}

async function viewRecipe(weekId, rid, date) {
  const w = await loadWeek(weekId);
  const r = w.recipes[rid];
  if (!r) return viewEmpty("Uppskrift fannst ekki");
  const day = (date && w.days.find((d) => d.date === date)) ?? w.days.find((d) => d.chosen === rid) ?? w.days.find((d) => d.options.includes(rid));
  setHeader(r.name, day ? `${day.day} · ${fmtDate(day.date)}` : "");
  const mine = (store("feedback") || {})[`${weekId}/${rid}`];
  const nb = day ? await neighbours(weekId, day.date) : {};
  $view.innerHTML = `
    ${day ? pager(nb, recipeHref) : ""}
    <article class="card hero">${recipeImg(r)}<div class="body">
      ${r.intro ? `<p style="margin-top:0">${esc(r.intro)}</p>` : ""}
      ${metaChips(r)}
      ${r.source?.url ? `<p class="small" style="margin-bottom:0">Uppruni: <a href="${esc(r.source.url)}" target="_blank" rel="noopener">${esc(r.source.name)}</a></p>` : r.source ? `<p class="small muted" style="margin-bottom:0">${esc(r.source.name)}</p>` : ""}
    </div></article>
    ${r.steps?.length ? `<a class="btn block" style="margin-top:14px" href="#/elda/${weekId}/${rid}">Byrja að elda</a>` : ""}
    <h2>Hráefni</h2>
    <ul class="ingredients">${r.ingredients.map((x, i) => checkLi(`ing-${weekId}-${rid}-${i}`, x)).join("")}</ul>
    ${r.steps?.length ? `<h2>Aðferð</h2><ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
    ${r.tip ? `<div class="tip">${esc(r.tip)}</div>` : ""}
    <h2>Hvernig smakkaðist?</h2>
    <p class="small muted" style="margin-top:-4px">Hjálpar næstu viku að passa ykkur betur.</p>
    <div class="rate">
      <button data-r="-1" aria-pressed="${mine?.rating === -1}">👎<span>Ekki aftur</span></button>
      <button data-r="1" aria-pressed="${mine?.rating === 1}">👍<span>Gott</span></button>
      <button data-r="2" aria-pressed="${mine?.rating === 2}">❤️<span>Uppáhald</span></button>
    </div>
    <label class="field"><span>Athugasemd (valfrjálst)</span><textarea id="comment" placeholder="t.d. krakkarnir vildu minna sterkt, of mikið fyrir tvo…">${esc(mine?.comment ?? "")}</textarea></label>
    <label class="field"><span>Hver?</span><input type="text" id="who" value="${esc(store("who") ?? "")}" placeholder="Nafn"></label>
    <button class="btn block" id="send" style="margin-top:12px">Senda</button>`;
  bindChecks();
  let rating = mine?.rating ?? null;
  $view.querySelectorAll(".rate button").forEach((b) =>
    b.addEventListener("click", () => {
      rating = Number(b.dataset.r);
      $view.querySelectorAll(".rate button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    }),
  );
  $view.querySelector("#send").addEventListener("click", async () => {
    if (rating === null) return toast("Veldu 👎, 👍 eða ❤️");
    const who = $view.querySelector("#who").value.trim();
    const comment = $view.querySelector("#comment").value.trim();
    store("who", who);
    try {
      await api("feedback", { method: "POST", body: { week: weekId, recipe: rid, name: r.name, rating, who, comment } });
      store("feedback", { ...(store("feedback") || {}), [`${weekId}/${rid}`]: { rating, comment } });
      toast("Takk! Tekið með í næstu viku.");
    } catch (e) {
      toast(`Tókst ekki: ${e.message}`);
    }
  });
}

let wakeLock = null;
async function viewCook(weekId, rid, step = 0) {
  const w = await loadWeek(weekId);
  const r = w.recipes[rid];
  const n = r.steps.length;
  step = Math.max(0, Math.min(step, n - 1));
  try {
    wakeLock ??= await navigator.wakeLock?.request("screen");
    wakeLock?.addEventListener?.("release", () => (wakeLock = null));
  } catch { /* not supported: fine */ }
  $view.innerHTML = `<div class="cook">
    <button class="close" id="x">Loka ✕</button>
    <div class="progress"><i style="width:${((step + 1) / n) * 100}%"></i></div>
    <div class="stepno">Skref ${step + 1} af ${n} · ${esc(r.name)}</div>
    <div class="steptext">${esc(r.steps[step])}</div>
    <div class="nav">
      <button class="btn ghost" id="prev" ${step === 0 ? "disabled" : ""}>‹ Fyrra</button>
      <button class="btn" id="next">${step === n - 1 ? "Búið 🎉" : "Næsta ›"}</button>
    </div></div>`;
  const go = (s) => {
    history.replaceState(null, "", `#/elda/${weekId}/${rid}/${s}`);
    viewCook(weekId, rid, s);
  };
  $view.querySelector("#prev").onclick = () => go(step - 1);
  $view.querySelector("#next").onclick = () => (step === n - 1 ? (location.hash = `#/uppskrift/${weekId}/${rid}`) : go(step + 1));
  $view.querySelector("#x").onclick = () => (location.hash = `#/uppskrift/${weekId}/${rid}`);
}
function releaseWake() {
  wakeLock?.release?.();
  wakeLock = null;
}

async function viewList(id, cached) {
  if (!cached) await loadWeeks(true);
  id ||= await currentWeekId();
  if (!id) return viewEmpty();
  const w = cached ?? (await loadWeek(id, true));
  const list = w.groceryList;
  const state = (i) => w.bought?.[i.key] ?? null;
  const todo = list.filter((i) => !state(i));
  const done = list.filter((i) => state(i));
  const total = todo.reduce((s, i) => s + (i.price || 0), 0);
  const cartUrl = `https://kronan.is/snjallverslun/vorulisti?items=${encodeURIComponent(todo.filter((i) => i.sku).map((i) => `${i.sku}:${i.qty}`).join(","))}`;
  setHeader("Innkaupalisti", w.title);
  // Ticked items stay in their aisle (after the rest), so a wrong tap is easy to undo.
  const hideDone = !!store("list:hideDone");
  const shown = hideDone ? todo : [...todo, ...done];
  const groups = AISLES.map((a) => [a, shown.filter((i) => (AISLES.includes(i.category) ? i.category : "Annað") === a)]).filter(([, g]) => g.length);
  const li = (i) => `<li class="item ${state(i) === "cart" ? "cart" : state(i) === "home" ? "home-state" : ""}" data-key="${esc(i.key)}">
      <span class="box">${state(i) === "home" ? "⌂" : state(i) ? "✓" : ""}</span>
      <span><span class="name">${esc(i.name)}</span>${i.qty > 1 ? ` <span class="muted">× ${i.qty}</span>` : ""}<br>
        <span class="for">${esc([i.amount, i.for.join(", ")].filter(Boolean).join(" · "))}</span><br>
        ${state(i)
          ? `<span class="tag">${state(i) === "home" ? "Til heima" : "Í körfu"}</span> <button class="home" data-undo>Afturkalla</button>`
          : `<button class="home" data-home="${esc(i.key)}">Til heima</button>`}</span>
      <span class="price">${i.price ? kr(i.price) : ""}</span></li>`;
  $view.innerHTML = `
    ${await weekPager(id, "listi")}
    <div class="summary"><b>${todo.length}</b><span class="muted">eftir · um ${kr(total)} hjá Krónunni</span></div>
    ${todo.some((i) => i.sku) ? `<a class="btn block" href="${cartUrl}" target="_blank" rel="noopener">Setja í körfu í Snjallverslun</a>` : ""}
    ${groups.map(([a, g]) => `<h3>${esc(a)}</h3><ul class="items card">${g.map(li).join("")}</ul>`).join("")}
    ${!todo.length ? `<div class="empty">Allt komið í körfuna 🎉</div>` : ""}
    ${done.length ? `<button class="btn ghost block" id="toggleDone" style="margin-top:14px">${hideDone ? `Sýna merktar vörur (${done.length})` : `Fela merktar vörur (${done.length})`}</button>` : ""}
    ${w.pantryAssumed?.length ? `<p class="small muted">Gert ráð fyrir að sé til heima: ${esc(w.pantryAssumed.join(", "))}.</p>` : ""}`;

  const set = async (key, next) => {
    w.bought ??= {};
    const prev = w.bought[key] ?? null;
    if (next) w.bought[key] = next;
    else delete w.bought[key];
    viewList(id, w);
    try {
      await api(`weeks/${id}/check`, { method: "POST", body: { key, state: next } });
    } catch {
      if (prev) w.bought[key] = prev;
      else delete w.bought[key];
      viewList(id, w);
      toast("Engin tenging, reyndu aftur");
    }
  };
  $view.querySelector("#toggleDone")?.addEventListener("click", () => {
    store("list:hideDone", !hideDone);
    viewList(id, w);
  });
  $view.querySelectorAll(".item").forEach((el) =>
    el.addEventListener("click", (e) => {
      const home = e.target.closest("[data-home]");
      const key = el.dataset.key;
      if (home) return set(key, "home");
      set(key, w.bought?.[key] ? null : "cart");
    }),
  );
  weekCache.set(id, w);
}

async function viewHistory() {
  setHeader("Saga", "Hvað borðuðum við og hvað keyptum við");
  const [list, hist, feedback] = await Promise.all([loadWeeks(), api("history?weeks=26"), api("feedback")]);
  const byRecipe = new Map(feedback.map((f) => [`${f.week}/${f.recipe}`, f]));
  const emoji = { "-1": "👎", 1: "👍", 2: "❤️" };
  const weeksHtml = await Promise.all(
    list.map(async ({ id, title }) => {
      const w = await loadWeek(id);
      return `<div class="w"><div class="row"><b>${esc(title)}</b><span class="spacer"></span><a class="small" href="#/listi/${id}">Listi</a></div>
        <div class="small">${w.days.map((d) => {
          const r = w.recipes[d.chosen];
          const f = byRecipe.get(`${id}/${d.chosen}`);
          return `<div><span class="muted">${esc(d.day.slice(0, 3))}.</span> <a href="#/uppskrift/${id}/${d.chosen}/${d.date}">${esc(r?.name)}</a> ${f ? emoji[f.rating] : ""}</div>`;
        }).join("")}</div></div>`;
    }),
  );
  const due = hist.products.filter((p) => p.dueNextWeek);
  const top = hist.products.filter((p) => p.bought > 0).slice(0, 15);
  const max = Math.max(1, hist.weeksCounted);
  $view.innerHTML = `
    <h3>Vikur</h3><div class="card hist">${weeksHtml.join("")}</div>
    ${due.length ? `<h3>Líklega þörf í næstu viku</h3><div class="card">${due.map((p) => `<div class="prod"><span>${esc(p.name)}</span><span class="badge">á ${p.medianGapWeeks} vikna fresti</span></div>`).join("")}</div>` : ""}
    <h3>Oftast keypt</h3>
    ${top.length ? `<div class="card">${top.map((p) => `<div class="prod"><span>${esc(p.name)}</span><span class="small muted">${p.bought} af ${max} vikum</span><div class="bar" style="grid-column:1/-1"><i style="width:${(p.bought / max) * 100}%"></i></div></div>`).join("")}</div>`
      : `<p class="muted small">Hakaðu við vörur á innkaupalistanum í búðinni, þá byggist sagan upp hér og næsti listi verður betri.</p>`}
    ${feedback.length ? `<h3>Umsagnir</h3><div class="card">${feedback.slice(-20).reverse().map((f) => `<div class="prod"><span>${emoji[f.rating]} ${esc(f.name)}${f.comment ? `<br><span class="small muted">„${esc(f.comment)}“</span>` : ""}</span><span class="small muted">${esc(f.who ?? "")}</span></div>`).join("")}</div>` : ""}`;
}

const listField = (label, key, f, hint) =>
  `<label class="field"><span>${label}</span><input type="text" data-list="${key}" value="${esc((f[key] || []).join(", "))}">${hint ? `<small>${hint}</small>` : ""}</label>`;
const numField = (label, key, f, hint) =>
  `<label class="field"><span>${label}</span><input type="number" inputmode="numeric" data-num="${key}" value="${esc(f[key] ?? "")}">${hint ? `<small>${hint}</small>` : ""}</label>`;

async function viewFamily() {
  setHeader("Við", "Svo vikan passi fjölskyldunni");
  const f = await api("family");
  $view.innerHTML = `
    <p class="muted small">Þetta les Claude á hverjum sunnudegi áður en vikan er sett saman. Umsagnir og hvað þið veljið hafa líka áhrif.</p>
    ${listField("Hver borðar?", "members", f, "t.d. Jón, Anna, Sól (6 ára)")}
    ${listField("Finnst gott", "likes", f, "t.d. fiskur, pasta, indverskt, súpur")}
    ${listField("Viljum ekki", "dislikes", f, "t.d. sveppir, mjög sterkt, lifur")}
    ${listField("Ofnæmi eða óþol", "allergies", f)}
    ${numField("Skammtar", "servings", f)}
    ${numField("Kvöldmáltíðir á viku", "dinnersPerWeek", f)}
    ${numField("Hámark mínútur á virkum dögum", "maxWeeknightMinutes", f)}
    ${numField("Vikulegt hámark (kr.)", "budgetIskPerWeek", f)}
    <label class="field"><span>Annað sem Claude á að vita</span><textarea data-text="notes">${esc(f.notes ?? "")}</textarea><small>t.d. „fiskur á mánudögum“, „pizza á föstudögum“, „nýta frystinn“</small></label>
    <button class="btn block" id="save" style="margin-top:16px">Vista</button>
    ${f.recipeSources?.length ? `<h3>Uppskriftaveitur</h3><div class="card">${f.recipeSources.map((s) => `<div class="prod"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a><span></span></div>`).join("")}</div>` : ""}`;
  $view.querySelector("#save").addEventListener("click", async () => {
    const next = { ...f };
    $view.querySelectorAll("[data-list]").forEach((el) => (next[el.dataset.list] = el.value.split(",").map((s) => s.trim()).filter(Boolean)));
    $view.querySelectorAll("[data-num]").forEach((el) => (next[el.dataset.num] = el.value === "" ? null : Number(el.value)));
    $view.querySelectorAll("[data-text]").forEach((el) => (next[el.dataset.text] = el.value.trim()));
    delete next.updatedAt;
    try {
      await api("family", { method: "PUT", body: next });
      toast("Vistað");
    } catch (e) {
      toast(`Tókst ekki: ${e.message}`);
    }
  });
}

function viewEmpty(msg = "Engin vika komin enn. Claude setur hana inn á sunnudaginn.") {
  setHeader("Vikan");
  $view.innerHTML = `<div class="empty">${esc(msg)}</div>`;
}

function installHint() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!ios || navigator.standalone || store("hint-dismissed")) return "";
  setTimeout(() => document.getElementById("hint-x")?.addEventListener("click", () => {
    store("hint-dismissed", true);
    document.getElementById("hint")?.remove();
  }));
  return `<p class="install muted" id="hint" style="margin-top:20px">Ýttu á Deila → <b>Bæta á heimaskjá</b> til að fá Vikuna sem app. <a href="#" id="hint-x" onclick="return false">Fela</a></p>`;
}

// ---- router ----
async function route() {
  const [name = "", ...args] = location.hash.replace(/^#\/?/, "").split("/");
  const tab = { "": "kvold", dagur: "kvold", vika: "vika", uppskrift: "vika", elda: "vika", listi: "listi", saga: "saga", vid: "vid" }[name] ?? "kvold";
  document.querySelectorAll(".tabs a").forEach((a) => (a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  if (name !== "elda") releaseWake();
  try {
    if (name === "vika") await viewWeek(args[0]);
    else if (name === "dagur") await viewDay(args[0], args[1]);
    else if (name === "uppskrift") await viewRecipe(args[0], args[1], args[2]);
    else if (name === "elda") await viewCook(args[0], args[1], Number(args[2] || 0));
    else if (name === "listi") await viewList(args[0]);
    else if (name === "saga") await viewHistory();
    else if (name === "vid") await viewFamily();
    else await viewDay();
  } catch (e) {
    console.error(e);
    viewEmpty(navigator.onLine ? `Villa: ${e.message}` : "Engin tenging við heimaþjóninn.");
  }
  if (name !== "elda") window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);
// Swipe left/right to the next/previous day wherever the page has a day pager.
let touch = null;
$view.addEventListener("touchstart", (e) => (touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null), { passive: true });
$view.addEventListener("touchend", (e) => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x;
  const dy = e.changedTouches[0].clientY - touch.y;
  touch = null;
  if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6 || e.target.closest(".options")) return;
  const a = $view.querySelector(`.pager a.${dx < 0 ? "next" : "prev"}`);
  if (a) location.hash = a.getAttribute("href");
});
// A home-screen app can stay open for days: reload when a new version is deployed.
let appVersion = null;
async function checkVersion() {
  try {
    const { version } = await api("version");
    if (appVersion && version !== appVersion && !location.hash.startsWith("#/elda")) return location.reload();
    appVersion = version;
  } catch {}
}
checkVersion();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  checkVersion();
  if (location.hash.startsWith("#/elda")) route();
});
route();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
