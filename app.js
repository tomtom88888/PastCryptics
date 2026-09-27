"use strict";

// ---------------------------------------------------------------------------
// Past Cryptics — practice archived Minute Cryptic clues.
// Routes: #/            archive list
//         #/YYYY-MM-DD  play that day's clue
// ---------------------------------------------------------------------------

const app = document.getElementById("app");
const COMMUNITY_PAR_START = "2025-09-22";
const COMMUNITY_PAR_MIN_SOLVERS = 400;
const HINT_LABELS = { indicators: "indicators", fodder: "fodder", definition: "definition", hint: "hint" };
const HINT_COLOURS = { indicators: "pink", fodder: "yellow", definition: "blue" };

let index = [];
const puzzleCache = new Map();
let game = null; // current game state
let keyHandler = null;

// ---------- icons ----------
const icon = {
  back: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 5l-7 7 7 7"/></svg>',
  info: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-5M12 8h.01"/></svg>',
  close: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>',
  flag: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 21V4M5 4h12l-2 4 2 4H5"/></svg>',
  check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>',
  del: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H8l-6 7 6 7h13z"/><path d="M17 9l-6 6M11 9l6 6"/></svg>',
  shuffle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
};

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function parseDate(d) { const [y, m, day] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1, day)); }
function longDate(d) { const x = parseDate(d); return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}, ${x.getUTCFullYear()}`; }
const pattern = (config) => `(${config.join(", ")})`;
const clueString = (p) => p.clue.map((c) => c.text).join(" ");
const setterName = (s) => (s || "").replace(/^Member:\s*/i, "");

function storageGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}
const progressKey = (date) => `pastcryptics:${date}`;

function effectivePar(p) {
  if (p.date < COMMUNITY_PAR_START) return typeof p.par === "number" ? p.par : null;
  const d = p.parDetails;
  // Imported puzzles carry an average par without a solver count.
  if (d && typeof d.averagePar === "number" && (d.solveCount == null || d.solveCount >= COMMUNITY_PAR_MIN_SOLVERS)) return Math.round(d.averagePar);
  return null;
}

function scoreText(helpCount, par) {
  if (par == null) return helpCount === 0 ? "No help used" : `${helpCount} ${helpCount === 1 ? "hint" : "hints"} used`;
  const s = helpCount - par;
  if (s === 0) return "Even par";
  return s < 0 ? `${-s} under par` : `${s} over par`;
}

function hintsFor(p) {
  if (Array.isArray(p.hints) && p.hints.length) return p.hints;
  if (typeof p.hint === "string" && p.hint.trim()) return [{ text: p.hint, type: "hint", colour: "pink", highlighting: [] }];
  return [];
}

async function loadIndex() {
  const res = await fetch("puzzles/index.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("Could not load puzzle index");
  index = await res.json();
}

async function loadPuzzle(date) {
  if (puzzleCache.has(date)) return puzzleCache.get(date);
  const res = await fetch(`puzzles/${date}.json`);
  if (!res.ok) throw new Error(`No puzzle for ${date}`);
  const p = await res.json();
  puzzleCache.set(date, p);
  return p;
}

// ---------- router ----------
async function route() {
  closeSheet();
  if (keyHandler) { document.removeEventListener("keydown", keyHandler); keyHandler = null; }
  game = null;
  const m = location.hash.match(/^#\/(\d{4}-\d{2}-\d{2})$/);
  try {
    if (!index.length) await loadIndex();
    if (m) await renderGame(m[1]);
    else renderArchive();
  } catch (e) {
    app.innerHTML = `<div class="topBar"><a class="iconButton" href="#/" aria-label="Back to archive">${icon.back}</a></div>
      <div class="completionCard"><h2>Something went wrong</h2><p>${esc(e.message)}</p>
      <p>If you opened this file directly, serve the folder instead (e.g. <code>python3 -m http.server</code>).</p></div>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

// ===========================================================================
// Archive
// ===========================================================================
let archiveFilter = storageGet("pastcryptics:filter") || "all";

function statusOf(date) {
  const s = storageGet(progressKey(date));
  if (!s) return { kind: "new" };
  if (s.status === "solved") return { kind: "solved", help: s.help.length };
  if (s.status === "revealed") return { kind: "gaveup" };
  if (s.help?.length || s.inputs?.some(Boolean)) return { kind: "started" };
  return { kind: "new" };
}

function renderArchive() {
  document.title = "Past Cryptics";
  const statuses = new Map(index.map((e) => [e.date, statusOf(e.date)]));
  const solved = [...statuses.values()].filter((s) => s.kind === "solved").length;
  const filtered = index.filter((e) => {
    const k = statuses.get(e.date).kind;
    if (archiveFilter === "unsolved") return k === "new" || k === "started";
    if (archiveFilter === "done") return k === "solved" || k === "gaveup";
    return true;
  });

  let html = `
    <header class="archiveHeader">
      <a class="brandMark" href="#/" aria-label="Past Cryptics home">m</a>
      <h1>past cryptics</h1>
      <button class="iconButton" id="infoBtn" aria-label="How to play">${icon.info}</button>
    </header>
    <p class="archiveIntro">Practise every archived Minute Cryptic clue. Your progress is saved in this browser.</p>
    <div class="archiveStats">
      <span class="chip">${index.length} puzzles</span>
      <span class="chip">${solved} solved</span>
    </div>
    <div class="filterRow">
      <button class="pillButton hintButton" id="randomBtn">${icon.shuffle.replace("<svg", '<svg style="vertical-align:-3px;margin-right:6px"')}random</button>
      <div class="seg" role="group" aria-label="Filter">
        ${["all", "unsolved", "done"].map((f) => `<button data-filter="${f}" aria-pressed="${archiveFilter === f}">${f}</button>`).join("")}
      </div>
    </div>`;

  if (!filtered.length) {
    html += `<p class="emptyState">Nothing here yet.</p>`;
  } else {
    let month = "";
    html += `<div class="puzzleList">`;
    for (const e of filtered) {
      const d = parseDate(e.date);
      const mLabel = `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      if (mLabel !== month) {
        if (month) html += `</div><div class="puzzleList">`;
        html += `<h2 class="monthHeading">${mLabel}</h2>`;
        month = mLabel;
      }
      const st = statuses.get(e.date);
      const badge = st.kind === "solved" ? { cls: "solved", txt: String(st.help), label: `solved with ${st.help} help` }
        : st.kind === "gaveup" ? { cls: "gaveup", txt: icon.flag.replace(/20/g, "14"), label: "answer revealed" }
        : st.kind === "started" ? { cls: "started", txt: "…", label: "in progress" }
        : { cls: "", txt: "", label: "not started" };
      html += `
        <a class="puzzleRow" href="#/${e.date}">
          <div class="rowDate"><span class="day">${d.getUTCDate()}</span><span class="dow">${DOW[d.getUTCDay()]}</span></div>
          <div class="rowClue">${esc(e.clue)} <span class="pattern">${pattern(e.config)}</span></div>
          <div class="rowStatus ${badge.cls}" title="${badge.label}" aria-label="${badge.label}">${badge.txt}</div>
        </a>`;
    }
    html += `</div>`;
  }
  html += `<p class="footerNote">Clues, hints and explainer videos are by the Minute Cryptic team and setters at minutecryptic.com. This is an unofficial practice archive.</p>`;
  app.innerHTML = html;

  app.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => {
    archiveFilter = b.dataset.filter;
    storageSet("pastcryptics:filter", archiveFilter);
    renderArchive();
  }));
  document.getElementById("randomBtn").addEventListener("click", () => {
    const pool = index.filter((e) => ["new", "started"].includes(statuses.get(e.date).kind));
    const pick = (pool.length ? pool : index)[Math.floor(Math.random() * (pool.length || index.length))];
    if (pick) location.hash = `#/${pick.date}`;
  });
  document.getElementById("infoBtn").addEventListener("click", openInfo);
}

// ===========================================================================
// Game
// ===========================================================================
async function renderGame(date) {
  const p = await loadPuzzle(date);
  const letters = p.answer.replace(/[^A-Za-z]/g, "").toUpperCase().split("");
  const saved = storageGet(progressKey(date));
  game = {
    p,
    letters,
    hints: hintsFor(p),
    par: effectivePar(p),
    inputs: saved?.inputs?.length === letters.length ? saved.inputs : letters.map(() => ""),
    revealed: saved?.revealed || [],     // letter indices revealed as help
    hintsSeen: saved?.hintsSeen || [],   // hint indices opened
    help: saved?.help || [],             // ordered help events: "HINT" | "LETTER"
    status: saved?.status || "playing",  // playing | solved | revealed
    active: 0,
  };
  game.active = nextEmpty(-1) ?? 0;
  document.title = `${longDate(date)} · Past Cryptics`;

  keyHandler = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector(".sheetBackdrop")) {
      if (e.key === "Escape") closeSheet();
      return;
    }
    if (game.status !== "playing") return;
    if (/^[a-zA-Z]$/.test(e.key)) { typeLetter(e.key.toUpperCase()); e.preventDefault(); }
    else if (e.key === "Backspace") { backspace(); e.preventDefault(); }
    else if (e.key === "Enter") { check(); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { moveActive(-1); e.preventDefault(); }
    else if (e.key === "ArrowRight") { moveActive(1); e.preventDefault(); }
  };
  document.addEventListener("keydown", keyHandler);
  drawGame();
}

function save() {
  const { inputs, revealed, hintsSeen, help, status } = game;
  storageSet(progressKey(game.p.date), { inputs, revealed, hintsSeen, help, status });
}

function neighbours() {
  const i = index.findIndex((e) => e.date === game.p.date);
  return { newer: index[i - 1]?.date, older: index[i + 1]?.date };
}

function clueHTML() {
  const text = clueString(game.p);
  const colours = new Array(text.length).fill(null);
  game.hintsSeen.forEach((hi) => {
    const h = game.hints[hi];
    if (!h) return;
    const colour = h.colour || HINT_COLOURS[h.type] || "pink";
    (h.highlighting || []).forEach(([a, b]) => { for (let i = a; i < Math.min(b, text.length); i++) colours[i] = colour; });
  });
  let out = "", i = 0;
  while (i < text.length) {
    const c = colours[i];
    let j = i;
    while (j < text.length && colours[j] === c) j++;
    const chunk = esc(text.slice(i, j));
    out += c ? `<span class="hl ${c}">${chunk}</span>` : chunk;
    i = j;
  }
  return `${out} <span class="cluePattern">${pattern(game.p.config)}</span>`;
}

function tilesHTML() {
  const done = game.status !== "playing";
  let k = 0;
  return game.p.config.map((len) => {
    let g = `<div class="tileGroup">`;
    for (let n = 0; n < len; n++, k++) {
      const revealed = game.revealed.includes(k);
      const val = done ? game.letters[k] : game.inputs[k];
      const cls = ["tile", done && game.status === "solved" ? "solved" : "", revealed ? "revealed" : "", !done && k === game.active && !revealed ? "active" : ""].join(" ");
      g += `<button class="${cls}" data-i="${k}" aria-label="Letter ${k + 1}${val ? `: ${val}` : ""}" ${revealed || done ? "tabindex=-1" : ""}>${esc(val || "")}</button>`;
    }
    return g + `</div>`;
  }).join("");
}

function dotsHTML() {
  const total = game.letters.length + game.hints.length;
  const parIndex = game.par == null ? null : Math.max(0, Math.min(game.par - 1, total - 1));
  let html = "";
  for (let i = 0; i < total; i++) {
    const kind = game.help[i];
    const cls = ["dot", kind === "HINT" ? "hintDot" : "", kind === "LETTER" ? "letterDot" : "", i === parIndex ? "parDot" : ""].join(" ");
    html += `<div class="progressSlot"><div class="${cls}"></div>${i === parIndex ? '<span class="parWord">par</span>' : ""}</div>`;
  }
  const parNote = game.par == null && game.p.date >= COMMUNITY_PAR_START && !game.p.source ? `<p class="noPar">No community par yet</p>` : "";
  return `<div class="progressDots${total > 12 ? " many" : ""}" aria-label="${game.help.length} help used${game.par != null ? `, par ${game.par}` : ""}">${html}</div>${parNote}`;
}

function completionHTML() {
  const solved = game.status === "solved";
  const dots = game.help.map((k) => `<div class="dot ${k === "HINT" ? "hintDot" : "letterDot"}"></div>`).join("")
    + `<div class="dot ${solved ? "" : "giveUpDot"}"></div>`;
  const { newer, older } = neighbours();
  const video = game.p.explainerVideo
    ? `<a class="videoLink" href="${esc(game.p.explainerVideo)}" target="_blank" rel="noopener">
        ${game.p.thumbnail ? `<img src="${esc(game.p.thumbnail)}" alt="" loading="lazy">` : `<div style="height:60px"></div>`}
        <span>watch the explainer</span></a>` : "";
  const unseen = game.hints.map((h, i) => ({ h, i })).filter(({ i }) => !game.hintsSeen.includes(i));
  return `
    <section class="completionCard">
      <div class="completionDots">${dots}</div>
      <div>
        <h2>${solved ? scoreText(game.help.length, game.par) : "Answer revealed"}</h2>
        <p style="margin-top:10px">${solved
          ? `You solved it with ${game.help.length === 0 ? "no help" : `${game.help.length} ${game.help.length === 1 ? "hint" : "hints"}`}${game.par != null ? ` (par ${game.par})` : ""}.`
          : "Better luck on the next one!"}</p>
      </div>
      <div class="answerReveal">${esc(game.p.answer.toLowerCase())}</div>
      ${game.hints.length ? `<div class="hintChoices" style="justify-items:center;gap:14px">
        ${game.hints.map((h, i) => `<button class="hintChoice u-${h.colour || HINT_COLOURS[h.type] || "pink"}" data-hint="${i}"><span>explain ${HINT_LABELS[h.type] || h.type}</span></button>`).join("")}
      </div>` : ""}
      ${video}
      <div class="completionNav">
        ${older ? `<a class="pillButton secondary" href="#/${older}">older</a>` : ""}
        <a class="pillButton" href="#/">archive</a>
        ${newer ? `<a class="pillButton secondary" href="#/${newer}">newer</a>` : ""}
      </div>
      <button class="hintChoice u-red" id="resetBtn"><span>play again</span></button>
    </section>`;
}

function keyboardHTML() {
  const rows = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
  const r = rows.map((row) => row.split("").map((c) => `<button class="key" data-key="${c}">${c}</button>`).join(""));
  return `<div class="keyboard" aria-label="Keyboard">
    <div class="keyboardRow">${r[0]}</div>
    <div class="keyboardRow">${r[1]}</div>
    <div class="keyboardRow"><button class="key wide" data-key="ENTER" aria-label="Check" ${allFilled() ? "" : "disabled"}>${icon.check}</button>${r[2]}<button class="key wide" data-key="BACK" aria-label="Delete">${icon.del}</button></div>
  </div>`;
}

function allFilled() { return game.inputs.every(Boolean); }

function drawGame() {
  const p = game.p;
  const playing = game.status === "playing";
  app.innerHTML = `
    <header class="topBar">
      <a class="iconButton" href="#/" aria-label="Back to archive">${icon.back}</a>
      <div class="titleBlock">
        <div class="dateText">${longDate(p.date)}</div>
        ${p.setterName ? `<div class="byline">By ${esc(setterName(p.setterName))}</div>` : ""}
      </div>
      <button class="iconButton" id="infoBtn" aria-label="How to play">${icon.info}</button>
      <a class="brandMark" href="#/" aria-label="Archive">m</a>
    </header>
    <div class="clueCard"><h2 id="clue">${clueHTML()}</h2></div>
    <div class="solveArea"><div class="tileGroups" id="tiles">${tilesHTML()}</div></div>
    ${playing ? `
      <div class="progressWrap">${dotsHTML()}</div>
      <div class="actionRow">
        <button class="pillButton hintButton" id="hintBtn">hints</button>
        <button class="pillButton checkButton" id="checkBtn" ${allFilled() ? "" : "disabled"}>check</button>
      </div>
      <p class="toast" id="toast" role="status" aria-live="polite"></p>
      ${keyboardHTML()}` : completionHTML()}
  `;

  document.getElementById("infoBtn").addEventListener("click", openInfo);
  app.querySelectorAll(".tile").forEach((t) => t.addEventListener("click", () => {
    const i = Number(t.dataset.i);
    if (game.status !== "playing" || game.revealed.includes(i)) return;
    game.active = i;
    refreshTiles();
  }));
  if (playing) {
    document.getElementById("hintBtn").addEventListener("click", openHints);
    document.getElementById("checkBtn").addEventListener("click", check);
    app.querySelectorAll(".key").forEach((k) => k.addEventListener("click", () => {
      const key = k.dataset.key;
      if (key === "ENTER") check();
      else if (key === "BACK") backspace();
      else typeLetter(key);
    }));
  } else {
    app.querySelectorAll("[data-hint]").forEach((b) => b.addEventListener("click", () => showHintDetail(Number(b.dataset.hint), true)));
    document.getElementById("resetBtn").addEventListener("click", () => {
      storageSet(progressKey(p.date), null);
      try { localStorage.removeItem(progressKey(p.date)); } catch { /* ignore */ }
      renderGame(p.date);
    });
  }
}

function refreshTiles() {
  document.getElementById("tiles").innerHTML = tilesHTML();
  app.querySelectorAll(".tile").forEach((t) => t.addEventListener("click", () => {
    const i = Number(t.dataset.i);
    if (game.status !== "playing" || game.revealed.includes(i)) return;
    game.active = i;
    refreshTiles();
  }));
  const filled = allFilled();
  const cb = document.getElementById("checkBtn");
  if (cb) cb.disabled = !filled;
  const ek = app.querySelector('[data-key="ENTER"]');
  if (ek) ek.disabled = !filled;
  const toast = document.getElementById("toast");
  if (toast) toast.textContent = "";
}

function editable(i) { return i >= 0 && i < game.letters.length && !game.revealed.includes(i); }
function nextEmpty(from) {
  for (let i = from + 1; i < game.letters.length; i++) if (editable(i) && !game.inputs[i]) return i;
  for (let i = 0; i <= from && i < game.letters.length; i++) if (editable(i) && !game.inputs[i]) return i;
  return null;
}
function moveActive(dir) {
  let i = game.active + dir;
  while (i >= 0 && i < game.letters.length && !editable(i)) i += dir;
  if (editable(i)) { game.active = i; refreshTiles(); }
}

function typeLetter(c) {
  if (!editable(game.active)) { const n = nextEmpty(-1); if (n == null) return; game.active = n; }
  game.inputs[game.active] = c;
  let i = game.active + 1;
  while (i < game.letters.length && !editable(i)) i++;
  if (i < game.letters.length) game.active = i;
  save();
  refreshTiles();
}

function backspace() {
  if (editable(game.active) && game.inputs[game.active]) {
    game.inputs[game.active] = "";
  } else {
    let i = game.active - 1;
    while (i >= 0 && !editable(i)) i--;
    if (i < 0) return;
    game.active = i;
    game.inputs[i] = "";
  }
  save();
  refreshTiles();
}

function check() {
  if (game.status !== "playing" || !allFilled()) return;
  if (game.inputs.join("") === game.letters.join("")) {
    game.status = "solved";
    save();
    drawGame();
    return;
  }
  const tiles = document.getElementById("tiles");
  tiles.classList.remove("shake");
  void tiles.offsetWidth;
  tiles.classList.add("shake");
  document.getElementById("toast").textContent = "Not quite — try again";
}

// ---------- sheets ----------
function openSheet(inner, { center = false } = {}) {
  closeSheet();
  const el = document.createElement("div");
  el.className = `sheetBackdrop${center ? " center" : ""}`;
  el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${inner}</div>`;
  el.addEventListener("click", (e) => { if (e.target === el) closeSheet(); });
  document.body.appendChild(el);
  el.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeSheet));
  el.querySelector("button")?.focus({ preventScroll: true });
  return el;
}
function closeSheet() { document.querySelector(".sheetBackdrop")?.remove(); }

function openHints() {
  const g = game;
  const nextLetter = (g.p.letterRevealOrder || g.letters.map((_, i) => i)).find((i) => !g.revealed.includes(i));
  const choices = g.hints.map((h, i) => {
    const colour = h.colour || HINT_COLOURS[h.type] || "pink";
    const used = g.hintsSeen.includes(i);
    return `<button class="hintChoice u-${colour}${used ? " used" : ""}" data-hint="${i}"><span>show ${esc(HINT_LABELS[h.type] || h.type)}</span></button>`;
  }).join("");
  const el = openSheet(`
    <div class="sheetHeader"><h2>Select a hint</h2><button class="iconButton" data-close aria-label="Close">${icon.close}</button></div>
    <div class="hintChoices">
      ${choices || `<p style="color:var(--muted);font-weight:700">No written hints for this clue.</p>`}
      <div class="sheetDivider"></div>
      <button class="hintChoice u-yellow" id="letterChoice" ${nextLetter == null ? "disabled" : ""}><span>show letter</span></button>
      <button class="hintChoice u-red" id="giveUpChoice">${icon.flag}<span>reveal answer</span></button>
    </div>`);
  el.querySelectorAll("[data-hint]").forEach((b) => b.addEventListener("click", () => showHintDetail(Number(b.dataset.hint))));
  el.querySelector("#letterChoice").addEventListener("click", () => {
    if (nextLetter == null) return;
    g.revealed.push(nextLetter);
    g.inputs[nextLetter] = g.letters[nextLetter];
    g.help.push("LETTER");
    if (g.active === nextLetter) g.active = nextEmpty(nextLetter) ?? nextLetter;
    save();
    closeSheet();
    if (allFilled() && g.inputs.join("") === g.letters.join("")) {
      g.status = "solved"; save();
    }
    drawGame();
  });
  el.querySelector("#giveUpChoice").addEventListener("click", confirmGiveUp);
}

function showHintDetail(i, fromCompletion = false) {
  const h = game.hints[i];
  if (!h) return;
  if (!game.hintsSeen.includes(i)) {
    game.hintsSeen.push(i);
    if (game.status === "playing") game.help.push("HINT");
    save();
  }
  const el = openSheet(`
    <div class="sheetHeader">
      ${fromCompletion ? "" : `<button class="iconButton" id="sheetBack" aria-label="Back to hints">${icon.back}</button>`}
      <h2 class="serif" style="font-size:1.3rem">${esc(HINT_LABELS[h.type] || h.type)}</h2>
      <button class="iconButton" data-close aria-label="Close">${icon.close}</button>
    </div>
    <div class="hintDetail"><p>${esc(h.text)}</p></div>`);
  el.querySelector("#sheetBack")?.addEventListener("click", openHints);
  // update clue highlighting + dots behind the sheet
  const clue = document.getElementById("clue");
  if (clue) clue.innerHTML = clueHTML();
  const dots = app.querySelector(".progressWrap");
  if (dots) dots.innerHTML = dotsHTML();
}

function confirmGiveUp() {
  const el = openSheet(`
    <div class="sheetHeader"><h2>Reveal the answer?</h2><button class="iconButton" data-close aria-label="Close">${icon.close}</button></div>
    <div class="sheetBody"><p>This ends the puzzle and marks it as not solved.</p></div>
    <div class="sheetActions">
      <button class="pillButton" style="background:var(--paper)" data-close>cancel</button>
      <button class="pillButton" style="background:var(--red)" id="doGiveUp">reveal</button>
    </div>`, { center: true });
  el.querySelector("#doGiveUp").addEventListener("click", () => {
    game.status = "revealed";
    save();
    closeSheet();
    drawGame();
  });
}

function openInfo() {
  openSheet(`
    <div class="sheetHeader"><h2 class="serif" style="font-size:1.4rem">how to play</h2><button class="iconButton" data-close aria-label="Close">${icon.close}</button></div>
    <div class="sheetBody">
      <p>Every clue has a <b>definition</b> (at the start or end) and <b>wordplay</b> that leads to the same answer. The number in brackets is the answer length.</p>
      <h3>hints</h3>
      <p>Stuck? Open <b>hints</b> to reveal the <span class="hl pink">indicators</span>, the <span class="hl yellow">fodder</span> or the <span class="hl blue">definition</span>, or show a letter.</p>
      <h3>par</h3>
      <p>Each hint or letter fills a dot. Try to solve in fewer hints than <b>par</b> — the average number the community needed.</p>
      <h3>archive</h3>
      <p>These are past Minute Cryptic clues. Progress is saved in this browser, so you can come back any time.</p>
    </div>`, { center: true });
}

route();
