const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//.test(u) ? u : null);

const badge = (value, kind = "evidence") => value ? `<span class="badge ${kind}-${esc(String(value).split(/[ |]/)[0].toLowerCase())}">${esc(value)}</span>` : "";
const list = (items) => (items && items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p class="muted">None found.</p>`);

// ---------- plain-language tooltips ----------
// Jargon in a guide gets a one-line explanation on hover or tap. These base terms are fixed and
// checked by hand; a guide's own glossary adds app-specific ones.
const BASE_GLOSSARY = [
  ["Composio", "A service that handles signing in to apps like Gmail or HubSpot for your agent, so you don't have to build it."],
  ["redirect URI", "The address the app sends your user back to after they say yes. It must match what you registered, character for character."],
  ["callback URL", "Another name for the redirect URI: where the user lands after approving access."],
  ["client secret", "A password for your OAuth app. Keep it private; never put it in front-end code."],
  ["client ID", "A public identifier for your OAuth app, like a username."],
  ["consent screen", "The page your user sees that says which app wants access and to what."],
  ["scopes", "The specific permissions your app asks for, like 'read email' or 'send email'."],
  ["scope", "One specific permission your app asks for, like 'read email'."],
  ["access token", "A short-lived key your agent uses to call the app's API on the user's behalf."],
  ["refresh token", "A longer-lived key used to get a new access token when the old one expires."],
  ["OAuth", "The standard way an app lets your product act for a user without sharing their password."],
  ["auth config", "Composio's saved settings for how users sign in to one app: managed by Composio, or using your own credentials."],
  ["managed auth", "Composio uses its own registered app, so you skip creating one. The sign-in screen shows Composio's name."],
  ["connected account", "One user's signed-in connection to an app, stored by Composio so your agent can act for them."],
  ["webhook", "A URL the app calls when something happens, so your agent can react without checking constantly."],
  ["API key", "A single secret string that gives access to one account. Simpler than OAuth, but not for acting on behalf of many users."],
  ["admin consent", "An IT admin approving your app for everyone in their company."],
  ["app review", "The provider checking your app before it can be used by the public."],
  ["verification", "The provider checking your app or company before it can be used by the public."],
];

function glossaryFor(g) {
  const own = (g?.glossary || []).filter((x) => x.term && x.plain).map((x) => [x.term, x.plain]);
  const seen = new Set();
  return [...own, ...BASE_GLOSSARY].filter(([t]) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

// Escape text, then wrap the first mention of each known term in a tooltip.
function explain(text, g) {
  let html = esc(text);
  const terms = glossaryFor(g).sort((a, b) => b[0].length - a[0].length);
  for (const [term, plain] of terms) {
    const re = new RegExp(`(^|[^\\w>-])(${esc(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\w<])`, "i");
    // Don't match inside a tooltip we already added.
    const masked = html.replace(/<span class="term"[^>]*>[^<]*<\/span>/g, (m) => "\u0000".repeat(m.length));
    const m = masked.match(re);
    if (!m) continue;
    const at = m.index + m[1].length;
    html = html.slice(0, at) + `<span class="term" tabindex="0" data-tip="${esc(plain)}">${html.slice(at, at + m[2].length)}</span>` + html.slice(at + m[2].length);
  }
  return html;
}
// Same, plus **bold** for the exact buttons and fields in a step's actions.
const explainMd = (text, g) => explain(text, g).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

// ---------- routing ----------

async function route() {
  const m = location.pathname.match(/^\/g\/([a-z0-9-]+)/);
  document.body.classList.remove("focus");
  loadLibrary();
  if (m) return showGuide(m[1]);
  if (location.pathname === "/evidence") return showEvidence();
  loadReadyMade();
  $("#guide").classList.add("hidden");
  $("#home").classList.remove("hidden");
  // Links from other tools (e.g. the test agent) can prefill the form: /?app=HubSpot&job=...
  const q = new URLSearchParams(location.search);
  if (q.get("app")) $("#app").value = q.get("app");
  if (q.get("job")) $("#job").value = q.get("job");
  $("#home").classList.remove("is-working", "is-fit");
  $("#fit").classList.add("hidden");
  $("#progress").className = "hidden";
}
window.addEventListener("popstate", route);

// Sidebar list of saved guides, with how far you got in each.
function planStatus(id) {
  try {
    const p = JSON.parse(localStorage.getItem(`plan:${id}`));
    if (!p?.steps?.length) return "Not started";
    const done = p.steps.filter((t) => p.done[t.uid]).length;
    return done === p.steps.length ? "Done" : `${done} of ${p.steps.length} done`;
  } catch { return "Not started"; }
}
async function loadLibrary() {
  const { demo, guides } = await fetch("/api/guides").then((r) => r.json());
  $("#demo-banner").classList.toggle("hidden", !demo);
  const current = location.pathname.match(/^\/g\/([a-z0-9-]+)/)?.[1];
  $("#library").innerHTML = guides.length
    ? guides.slice(0, 12).map((g) => `<li><a href="/g/${g.id}" data-nav class="${g.id === current ? "on" : ""}" title="${esc(g.job || "")}"><span>${esc(g.app)}</span><span class="lib-st">${esc(planStatus(g.id))}</span></a></li>`).join("")
    : `<li class="muted small">No guides yet.</li>`;
}

// What was tried, checked against sources, corrected and left unverified, per library guide.
const VERDICT = { confirmed: ["✓", "Confirmed"], corrected: ["✎", "Corrected"], unverified: ["?", "Couldn't verify"] };
async function showEvidence() {
  $("#home").classList.add("hidden");
  const el = $("#guide");
  el.classList.remove("hidden");
  const ev = await fetch("/api/evidence").then((r) => r.json()).catch(() => ({}));
  const link = (u, t) => (safeUrl(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t || new URL(u).hostname)}</a>` : "");
  el.innerHTML = `
  <div class="ev">
    <h1>What we tested</h1>
    ${ev.summary ? `<p class="lede">${esc(ev.summary)}</p>` : ""}
    ${ev.as_of ? `<p class="small muted">Checked ${esc(ev.as_of)}. Provider rules change; each claim links to the page it was checked against.</p>` : ""}
    ${(ev.method || []).length ? `<section class="card ev-method"><h2>How we checked</h2><ul>${ev.method.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>` : ""}
    ${(ev.learnings || []).length ? `<section class="ev-learn"><h2>What we learned</h2>${ev.learnings.map((l) => `<div class="card"><h3>${esc(l.title)}</h3><p>${esc(l.text)}</p></div>`).join("")}</section>` : ""}
    ${(ev.apps || []).map((a) => `
    <section class="card ev-app" id="${esc(a.id || "")}">
      <div class="ev-top"><h2>${esc(a.app)}</h2>${a.id ? `<a href="/g/${esc(a.id)}" data-nav>Open the guide →</a>` : ""}</div>
      ${(a.tried || []).length ? `<h3>Tried for real</h3><ul>${a.tried.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="small muted">Not tried hands-on: checked against sources only.</p>`}
      ${(a.checked || []).length ? `<h3>Claims checked</h3><table class="ev-table"><thead><tr><th>What the guide says</th><th>Result</th><th>Source</th></tr></thead><tbody>${a.checked.map((c) => `<tr><td>${esc(c.claim)}${c.note ? `<div class="small muted">${esc(c.note)}</div>` : ""}</td><td class="ev-v ev-${esc(c.verdict)}">${(VERDICT[c.verdict] || ["", c.verdict]).join(" ")}</td><td class="small">${link(c.source, c.source_title)}</td></tr>`).join("")}</tbody></table>` : ""}
      ${(a.unverified || []).length ? `<h3>Still uncertain</h3><ul>${a.unverified.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    </section>`).join("") || `<p class="muted">No evidence recorded yet.</p>`}
  </div>`;
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

// Ready-made guides on the home page: how hard, how long, and how far each one was tested.
const DIFF_LABEL = { easy: "Easy", moderate: "Medium", hard: "Hard", blocked: "Blocked" };
const diffKey = (d) => String(d || "unknown").split(/[ |]/)[0].toLowerCase();
async function loadReadyMade() {
  const { guides } = await fetch("/api/library").then((r) => r.json()).catch(() => ({ guides: [] }));
  $("#ready").classList.toggle("hidden", !guides.length);
  const draw = () => {
    const q = $("#lib-filter").value.trim().toLowerCase();
    const list = guides.filter((g) => !q || `${g.app} ${g.job} ${g.challenge}`.toLowerCase().includes(q));
    $("#lib-grid").innerHTML = list.map((g) => `<a class="lib-card" href="/g/${g.id}" data-nav>
      <div class="lib-top"><b>${esc(g.app)}</b><span class="dbadge b-${diffKey(g.difficulty)}">${esc(DIFF_LABEL[diffKey(g.difficulty)] || "Unknown")}</span></div>
      <div class="lib-facts">${g.time ? `<span>⏱ ${esc(g.time)}</span>` : ""}${g.wait ? `<span>⏳ ${esc(g.wait)}</span>` : ""}</div>
      ${g.challenge ? `<p class="lib-why">${esc(g.challenge)}</p>` : ""}
      ${g.tested ? `<span class="lib-ev ${/tested|tried/i.test(g.tested) ? "" : "u"}">${/tested|tried/i.test(g.tested) ? "✓ " : ""}${esc(g.tested)}</span>` : ""}
    </a>`).join("") || `<p class="muted small">No ready-made guide matches. Research it live above.</p>`;
  };
  $("#lib-filter").oninput = draw;
  draw();
}

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-nav]");
  if (!a) return;
  e.preventDefault();
  history.pushState({}, "", a.getAttribute("href"));
  route();
});

// ---------- intake: fit check, questions, then the guide ----------
// Step 1 (/api/fit) works out what the developer needs and whether Composio covers it.
// Step 2 (/api/generate) writes the guide for the route and answers they picked.

let intake = null; // { app, job, brief, answers, route }

document.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", () => {
  $("#job").value = b.dataset.example;
  $("#job").focus();
}));

// ---------- agent status while it works ----------
// Every wait shows named phases (done, now, next), elapsed time, how long it usually takes,
// a live feed of what the agent is reading, and a way to cancel.
const PHASES = {
  fit: (app) => [
    { t: "Understood your goal", d: "What your agent needs to do." },
    { t: `Researching ${app}`, d: "Reading its developer docs and searching the web.", until: /composio/i },
    { t: "Checking Composio", d: `Does Composio already support ${app}?`, until: /^composio:/i },
    { t: "Preparing your choices", d: "A few questions, with our suggestion picked." },
  ],
  guide: (app) => [
    { t: "Using your choices", d: "Your route decides which steps you need." },
    { t: `Researching each step`, d: `Finding the exact pages and buttons in ${app}.`, until: /testing \d+ links|checked \d+ of/i },
    { t: "Testing every link", d: "Opening each link so none are dead.", until: /^links:/i },
    { t: "Writing your guide", d: "Putting the steps in order." },
  ],
};
const USUAL = { fit: "Usually 30 to 60 seconds.", guide: "Usually 1 to 2 minutes." };

function startWork(kind, app, job) {
  const phases = PHASES[kind](app);
  let at = 1; // phase 0 is done the moment we start
  const feed = [];
  const started = Date.now();
  const ctl = new AbortController();
  const el = $("#progress");
  el.className = "work";
  $("#home").classList.add("is-working");
  const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  const render = (state = "running", message = "") => {
    const elapsed = mmss(Date.now() - started);
    el.innerHTML = `
      <div class="kicker">${esc(app)} · ${esc(job)}</div>
      <h2 class="work-title">${state === "error" ? "Something went wrong" : state === "cancelled" ? "Cancelled" : kind === "fit" ? "Checking what you need" : "Building your guide"}</h2>
      <p class="small muted">${state === "running" ? `${USUAL[kind]} Keep this tab open.` : esc(message)}</p>
      <div class="meter"><span style="width:${state === "running" ? Math.round((at / phases.length) * 100) : 100}%"></span></div>
      <p class="small muted" data-elapsed>Step ${Math.min(at + 1, phases.length)} of ${phases.length} · ${elapsed}</p>
      <div class="work-grid">
        <ol class="phases">${phases.map((p, k) => {
          const st = k < at ? "ok" : k === at ? (state === "running" ? "now" : state === "error" ? "fail" : "todo") : "todo";
          return `<li class="${st}"><span class="dot ${st}">${st === "ok" ? "✓" : st === "fail" ? "✗" : ""}</span><div><div class="t">${esc(p.t)}</div><div class="d">${esc(p.d)}</div></div></li>`;
        }).join("")}</ol>
        <div>
          <div class="feed" aria-label="What the agent is reading"><div class="feed-bar"><i></i><i></i><i></i></div><pre>${feed.slice(-7).map(esc).join("\n")}${state === "running" ? `${feed.length ? "\n" : ""}<span class="pulse">✻ Working…</span>` : ""}</pre></div>
          <p class="small muted">What the agent is doing, live.</p>
          ${state === "running" ? `<button type="button" class="secondary" data-cancel>Cancel</button>` : `<button type="button" class="secondary" data-retry>Back to the form</button>`}
        </div>
      </div>`;
    el.querySelector("[data-cancel]")?.addEventListener("click", () => ctl.abort());
    el.querySelector("[data-retry]")?.addEventListener("click", () => { el.className = "hidden"; $("#home").classList.remove("is-working", "is-fit"); $("#fit").classList.add("hidden"); });
  };
  const tick = setInterval(() => {
    const t = el.querySelector("[data-elapsed]");
    if (t) t.textContent = `Step ${Math.min(at + 1, phases.length)} of ${phases.length} · ${mmss(Date.now() - started)}`;
  }, 1000);
  render();
  return {
    signal: ctl.signal,
    onProgress: (d) => {
      const text = d.text || "";
      feed.push(d.kind === "search" ? `$ search "${text}"` : d.kind === "fetch" ? `$ read ${text.replace(/^https?:\/\//, "")}` : `  ${text}`);
      // Move to the next phase when its marker shows up (phases can be skipped, never go back).
      for (let k = at; k < phases.length; k++) if (phases[k].until?.test(text)) { at = Math.max(at, k + 1); break; }
      if (/composio/i.test(text) && kind === "fit") at = Math.max(at, 2);
      render();
    },
    finish: (ok, message = "") => {
      clearInterval(tick);
      if (ok) { at = phases.length; el.className = "hidden"; $("#home").classList.remove("is-working"); return; }
      render(ctl.signal.aborted ? "cancelled" : "error", ctl.signal.aborted ? "Stopped. Nothing was saved." : message);
    },
  };
}

$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const app = $("#app").value.trim();
  const job = $("#job").value.trim();
  if (!app || !job) return;

  $("#go").disabled = true;
  $("#fit").classList.add("hidden");
  const work = startWork("fit", app, job);
  try {
    const brief = await streamSSE("/api/fit", { app, job }, work.onProgress, work.signal);
    work.finish(true);
    intake = { app, job, brief, answers: {}, route: null, step: 0 };
    $("#home").classList.add("is-fit");
    renderFit();
  } catch (err) {
    work.finish(false, err.message);
  } finally {
    $("#go").disabled = false;
  }
});

const CMP = `<img class="cmp-mark" src="/composio-mark.svg" alt="Composio">`;
const YES = (v) => String(v || "").toLowerCase().startsWith("yes");

// Plain explanation of Composio, shown before any decision that mentions it. Fixed text, checked
// against Composio's "Managed vs custom auth" docs, so the model can't misdescribe it.
const COMPOSIO_EXPLAINER = `
  <details class="explainer">
    <summary>New to Composio? What it is, in 30 seconds</summary>
    <p><strong>Composio</strong> is a platform that sits between your agent and apps like Gmail or GitHub. You click Connect, sign in to your own account, and Composio stores and refreshes that access, and gives your agent ready-made actions such as "send an email".</p>
    <p>For many apps it also has its own registered app, called <strong>managed auth</strong>, so you can skip registering one. The catch: the sign-in screen shows Composio's name, rate limits are shared with other Composio users, and you get Composio's default permissions. You can instead plug <strong>your own</strong> OAuth app into Composio and keep your brand and limits.</p>
    <p><strong>Going direct</strong> means your own code does all of this: the sign-in, keeping tokens safe, refreshing them, and calling the app's API.</p>
    <p class="small muted">Source: <a href="https://docs.composio.dev/docs/custom-app-vs-managed-app" target="_blank" rel="noopener">Composio docs: Managed vs custom auth</a></p>
  </details>`;

// A decision applies unless its show_if names an earlier choice that wasn't made.
const decisionShown = (d, answers) => !d.show_if || Object.entries(d.show_if).every(([k, v]) => answers[k] === v);

// Decisions shown right now, in order. With no toolkit, the "use a different app?" choice comes first.
function shownDecisions() {
  const { brief, answers } = intake;
  const ds = (brief.decisions || []).filter((d) => decisionShown(d, answers));
  return [...ds.filter((d) => d.id === "app_choice"), ...ds.filter((d) => d.id !== "app_choice")];
}
const pickedOption = (d) => (d.options || []).find((o) => o.value === intake.answers[d.id]);
const NONE = /^(none|no wait|n\/a|-)?$/i;

function composioLine(brief) {
  const c = brief.composio || {};
  const covered = YES(c.toolkit_available) && c.covers_use_case !== "no";
  const text = covered ? `Composio already supports ${brief.app}${YES(c.managed_auth) ? ", including the sign-in" : ""}.`
    : YES(c.toolkit_available) ? `Composio supports ${brief.app}, but maybe not all of this job.`
    : `Composio doesn't support ${brief.app} yet. You can still connect it yourself, or pick a similar app it does support.`;
  return `<div class="found ${covered ? "yes" : "no"}">
    <span>${covered ? CMP : "!"}</span>
    <div>${explain(text, null)}
      ${!YES(c.toolkit_available) ? `<div class="found-act"><button type="button" class="secondary small-btn" data-request-toolkit>Ask Composio to add ${esc(brief.app)}</button> <span class="small muted" id="req-note"></span></div>` : ""}
      <details class="more"><summary>What we found</summary>
        <span class="label">What your agent needs to do</span>
        <ul class="actions-list">${(brief.actions || []).map((a) => `<li>${esc(a.action)}${a.needs_trigger ? ` <span class="pill trig" title="Your agent reacts when something happens in the app">reacts to events</span>` : ""}</li>`).join("")}</ul>
        ${c.note ? `<p class="small">${esc(c.note)} ${badge(c.api_checked ? "verified with Composio API" : c.evidence)}</p>` : ""}
        ${renderDimensions(brief.dimensions)}
        ${COMPOSIO_EXPLAINER}
      </details>
    </div>
  </div>`;
}

function optionCard(d, o) {
  const pc = [...(o.pros || []).slice(0, 3).map((x) => `<li><span class="y">✓</span>${esc(x)}</li>`), ...(o.cons || []).slice(0, 3).map((x) => `<li><span class="n">✗</span>${esc(x)}</li>`)];
  const facts = [o.time && `⏱ ${esc(o.time)}`, o.wait && !NONE.test(o.wait) && `⏳ ${esc(o.wait)}`, o.cost && `💲 ${esc(o.cost)}`].filter(Boolean);
  const picked = intake.answers[d.id] === o.value;
  return `<button type="button" class="pcard ${picked ? "sel" : ""}" data-q="${esc(d.id)}" data-v="${esc(o.value)}" aria-pressed="${picked}">
    <h3><span>${/composio/i.test(o.label) && !/own app/i.test(o.label) ? CMP + " " : ""}${explain(o.label, null)}</span>${o.recommended ? `<span class="pill agent">Recommended</span>` : ""}</h3>
    ${o.what_it_means ? `<p class="one">${explain(o.what_it_means, null)}</p>` : ""}
    ${pc.length ? `<ul class="pc">${pc.join("")}</ul>` : ""}
    ${facts.length ? `<div class="facts">${facts.map((f) => `<span class="fact">${f}</span>`).join("")}</div>` : ""}
  </button>`;
}

// A choice that only applies because of an earlier one (e.g. branding under "Use Composio") says so.
function parentNote(d, decisions) {
  const [pid] = Object.keys(d.show_if || {});
  const parent = decisions.find((x) => x.id === pid);
  const o = parent && pickedOption(parent);
  return o ? `<p class="part-of">Part of your choice: <strong>${esc(o.label)}</strong></p>` : "";
}

function renderFit() {
  const { brief, answers } = intake;
  let decisions = shownDecisions();
  // Drop answers to decisions that are no longer shown (e.g. branding after switching to "direct").
  for (const id of Object.keys(answers)) if (!decisions.some((d) => d.id === id)) delete answers[id];
  const total = decisions.length;
  intake.step = Math.max(0, Math.min(intake.step ?? 0, total));
  const n = intake.step;
  const el = $("#fit");
  el.classList.remove("hidden");
  const top = (label, pct) => `
    <div class="wiz-progress"><span>${label}</span><div class="wiz-bar"><span style="width:${pct}%"></span></div><span class="wiz-ctx">${esc(brief.app || intake.app)} · ${esc(intake.job)}</span></div>`;

  if (n < total) {
    const d = decisions[n];
    // Start from our suggestion, so Continue always works.
    if (!answers[d.id]) answers[d.id] = (d.options.find((o) => o.recommended) || d.options[0]).value;
    const rec = d.options.find((o) => o.recommended);
    el.innerHTML = `<div class="wiz">
      ${top(`Choice ${n + 1} of ${total}`, Math.round(((n + 1) / (total + 1)) * 100))}
      ${n === 0 ? composioLine(brief) : ""}
      ${parentNote(d, decisions)}
      <h1>${explain(d.title, null)}</h1>
      ${d.why_it_matters ? `<p class="sub">${explain(d.why_it_matters, null)}</p>` : ""}
      <div class="pick ${d.options.length > 2 ? "many" : ""}">${d.options.map((o) => optionCard(d, o)).join("")}</div>
      ${rec?.recommended_reason ? `<p class="why"><strong>Why we suggest this:</strong> ${explain(rec.recommended_reason, null)}</p>` : ""}
      <details class="more"><summary>Compare in more detail</summary>
        <table class="compare"><thead><tr><th></th>${d.options.map((o) => `<th>${esc(o.label)}</th>`).join("")}</tr></thead><tbody>
          <tr><td>What it means</td>${d.options.map((o) => `<td>${explain(o.what_it_means || "", null)}</td>`).join("")}</tr>
          <tr><td>Good</td>${d.options.map((o) => `<td>${esc((o.pros || []).join(". "))}</td>`).join("")}</tr>
          <tr><td>Watch out</td>${d.options.map((o) => `<td>${esc((o.cons || []).join(". "))}</td>`).join("")}</tr>
          <tr><td>Your time</td>${d.options.map((o) => `<td>${esc(o.time || "")}</td>`).join("")}</tr>
          <tr><td>Waiting</td>${d.options.map((o) => `<td>${esc(o.wait || "None")}</td>`).join("")}</tr>
          <tr><td>Cost</td>${d.options.map((o) => `<td>${esc(o.cost || "")}</td>`).join("")}</tr>
        </tbody></table>
        ${d.evidence ? `<p class="small muted">How sure we are: ${badge(d.evidence)}</p>` : ""}
      </details>
      <div class="nav">${n === 0 ? `<button type="button" class="secondary" data-restart>Start over</button>` : `<button type="button" class="secondary" data-back>← Back</button>`}<button type="button" data-next>Continue</button></div>
    </div>`;
  } else {
    const picks = decisions.map((d) => ({ d, o: pickedOption(d) }));
    const pickLine = (p, k) => `<span class="pick-q">${esc(p.d.title)}</span><strong>${explain(p.o?.label || "", null)}</strong> <span>${explain(p.o?.what_it_means || "", null)} · <a href="#" data-change="${k}">change</a></span>`;
    // "Your time" is the longest of the chosen options, so a slower sub-choice isn't hidden.
    const effort = (t) => parseTime(t)?.[1] ?? (/week/i.test(t) ? 10080 : /day/i.test(t) ? 1440 : /hour/i.test(t) ? 120 : /min/i.test(t) ? 5 : 0);
    const via = picks.map((p) => p.o || {}).reduce((a, o) => (effort(o.time) > effort(a.time) ? o : a), picks[0]?.o || {});
    const uniq = (xs) => [...new Set(xs.filter((x) => x && !NONE.test(x)))];
    const waits = uniq(picks.map((p) => p.o?.wait));
    const costs = uniq(picks.map((p) => p.o?.cost));
    el.innerHTML = `<div class="wiz">
      ${top("Ready", 100)}
      <h1>Here's your plan</h1>
      <p class="sub">${intake.answers.users === "just_me" ? "Set up for your own account only, as a prototype." : "Set up so other people can connect their own accounts."} You can change any choice before we build the guide.</p>
      <div class="sum">
        <div class="big3">
          <div><span class="label">Your time</span><strong>${esc(via.time || "Varies")}</strong></div>
          <div><span class="label">Waiting</span><strong>${esc(waits.slice(0, 2).join(" · ") || "None")}</strong></div>
          <div><span class="label">Cost</span><strong>${esc(costs.length > 1 && costs.every((c) => /free/i.test(c)) ? "Free" : costs.slice(0, 2).join(" · ") || "Free")}</strong></div>
        </div>
        <ol>${picks.map((p, k) => p.d.show_if ? "" : `<li>${pickLine(p, k)}${picks.map((c, j) => (c.d.show_if && Object.keys(c.d.show_if)[0] === p.d.id ? `<div class="sub-pick">${pickLine(c, j)}</div>` : "")).join("")}</li>`).join("")}</ol>
      </div>
      <div class="nav"><button type="button" class="secondary" data-back>← Back</button><button type="button" data-build>Build my guide</button></div>
      <p class="small muted center">Building takes about a minute.</p>
    </div>`;
  }

  el.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { intake.answers[b.dataset.q] = b.dataset.v; renderFit(); }));
  el.querySelector("[data-next]")?.addEventListener("click", () => { intake.step++; renderFit(); el.scrollIntoView({ block: "start" }); });
  el.querySelector("[data-back]")?.addEventListener("click", () => { intake.step--; renderFit(); });
  el.querySelector("[data-restart]")?.addEventListener("click", () => { intake = null; route(); $("#app").focus(); });
  el.querySelectorAll("[data-change]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); intake.step = Number(a.dataset.change); renderFit(); }));
  el.querySelector("[data-request-toolkit]")?.addEventListener("click", (e) => requestToolkit(intake.app, intake.job, e.currentTarget, $("#req-note")));
  el.querySelector("[data-build]")?.addEventListener("click", buildGuide);
}

const DIMENSION_LABELS = {
  auth_type: "Sign-in type", registration: "Who can register an app", review: "App review", distribution_limits: "User limits",
  per_customer_instance: "Per-customer setup", admin_consent: "IT admin approval", tokens: "Token expiry", scopes_vs_actions: "Permissions for your actions",
  sandbox_vs_production: "Test vs live keys", triggers: "Reacting to events", composio_layer: "Composio setup",
};

function renderDimensions(dims) {
  if (!(dims || []).length) return "";
  const rank = { yes: 0, depends: 1, no: 2 };
  const sorted = [...dims].sort((a, b) => (rank[a.applies] ?? 3) - (rank[b.applies] ?? 3));
  return `
  <details class="dims">
    <summary>What makes this app's setup easy or hard (${dims.filter((d) => d.applies !== "no").length} of ${dims.length} apply)</summary>
    <ul>${sorted.map((d) => `<li class="dim-${esc(d.applies)}"><span class="dim-mark">${d.applies === "yes" ? "●" : d.applies === "depends" ? "◐" : "○"}</span><strong>${esc(DIMENSION_LABELS[d.key] || d.key)}</strong> <span class="small muted">${esc(d.note || (d.applies === "no" ? "Doesn't apply" : ""))}</span></li>`).join("")}</ul>
    <p class="small muted">● applies · ◐ depends on your answers · ○ doesn't apply</p>
  </details>`;
}

async function requestToolkit(app, job, btn, note) {
  btn.disabled = true;
  try {
    const r = await fetch("/api/toolkit-request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app, job }) }).then((x) => x.json());
    btn.textContent = "Requested";
    if (note) note.textContent = `Logged locally (${r.count} request${r.count === 1 ? "" : "s"} for this app). In a real product this would go to Composio.`;
  } catch {
    btn.disabled = false;
  }
}

async function buildGuide() {
  const { app, job, brief, answers } = intake;
  const cv = (brief.decisions || []).find((d) => d.id === "connect_via");
  const route = cv?.options?.find((o) => o.value === answers.connect_via)?.label || null;
  $("#fit").classList.add("hidden");
  const work = startWork("guide", brief.app || app, job);
  try {
    const { id } = await streamSSE("/api/generate", { app, job, brief, answers, route }, work.onProgress, work.signal);
    work.finish(true);
    history.pushState({}, "", `/g/${id}`);
    await route_();
  } catch (err) {
    work.finish(false, err.message);
    $("#fit").classList.remove("hidden");
  }
}
const route_ = () => route();

// ---------- guide rendering ----------

async function showGuide(id) {
  document.body.classList.remove("focus");
  const res = await fetch(`/api/guides/${id}`);
  $("#home").classList.add("hidden");
  const el = $("#guide");
  el.classList.remove("hidden");
  if (!res.ok) {
    el.innerHTML = `<p>Guide not found. <a href="/" data-nav>Back</a></p>`;
    return;
  }
  const rec = await res.json();
  el.innerHTML = renderGuide(rec);
  $("#copy-link")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(location.href).catch(() => {});
    $("#copy-link").textContent = "Link copied";
  });
  $("#copy-agent")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(toAgentMarkdown(rec)).catch(() => {});
    $("#copy-agent").textContent = "Copied: paste into your coding agent";
  });
  el.querySelector("[data-request-toolkit]")?.addEventListener("click", (e) => requestToolkit(rec.guide.app, rec.guide.job, e.currentTarget, $("#req-note")));
  $("#download-md")?.addEventListener("click", () => {
    const blob = new Blob([toMarkdown(rec)], { type: "text/markdown" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${rec.id}.md` });
    a.click();
  });
  el.querySelectorAll("[data-start]").forEach((b) => b.addEventListener("click", () => startWalkthrough(rec, Number(b.dataset.start) || 0)));
  el.querySelectorAll("[data-copy-step]").forEach((b) => b.addEventListener("click", async () => {
    await navigator.clipboard.writeText(b.previousElementSibling.textContent).catch(() => {});
    b.textContent = "Copied";
  }));
  el.querySelector("[data-check-links]")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = "Testing links…";
    try {
      await streamSSE(`/api/guides/${rec.id}/check-links`, {}, () => {});
      showGuide(rec.id);
    } catch (err) {
      e.currentTarget.textContent = `Failed: ${err.message}`;
    }
  });
  el.querySelector("[data-reset-plan]")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!confirm("Reset your progress and remove added fix steps?")) return;
    try { localStorage.removeItem(`plan:${rec.id}`); } catch {}
    showGuide(rec.id);
  });
  window.scrollTo(0, 0);
}

// ---------- step map ----------

const ICONS = {
  account: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  register: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M12 12v5M9.5 14.5h5"/>',
  configure: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  scopes: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  credentials: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  test: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4V8z"/>',
  submit: '<path d="m22 2-7 20-4-9-9-4 20-7z"/><path d="M22 2 11 13"/>',
  prereq: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  wait: '<path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>',
};
const icon = (kind) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[kind] || ICONS.configure}</svg>`;

const UNIT_MIN = { min: 1, minute: 1, hour: 60, hr: 60, h: 60, day: 1440, week: 10080, wk: 10080, month: 43200 };
// "10 min", "1-2 hours", "2-4 weeks" -> [min, max] minutes. Used when the guide lacks minutes_min/max.
function parseTime(str) {
  const m = String(str || "").toLowerCase().match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)?\s*(\d+(?:\.\d+)?)?\s*(min|minute|hour|hr|h|day|week|wk|month)/);
  if (!m) return null;
  const u = UNIT_MIN[m[3]];
  return [Number(m[1]) * u, Number(m[2] || m[1]) * u];
}

function guessKind(s) {
  const t = `${s.title} ${s.detail}`.toLowerCase();
  if (/review|verif|approv|wait/.test(t)) return /submit/.test(s.title.toLowerCase()) ? "submit" : "wait";
  if (/scope|permission/.test(t)) return "scopes";
  if (/secret|client id|credential|key/.test(t)) return "credentials";
  if (/test|authori[sz]e with/.test(t)) return "test";
  if (/account|sign up|sign in/.test(t)) return "account";
  if (/create|register|new app/.test(t)) return "register";
  if (/code|implement|sdk/.test(t)) return "code";
  return "configure";
}

function normaliseSteps(g) {
  return (g.steps || []).map((s) => {
    const kind = ICONS[s.kind] ? s.kind : guessKind(s);
    const parsed = parseTime(s.time);
    const min = Number.isFinite(s.minutes_min) ? s.minutes_min : parsed?.[0] ?? null;
    const max = Number.isFinite(s.minutes_max) ? s.minutes_max : parsed?.[1] ?? min;
    const external = kind === "wait" || s.owner === "provider";
    return { ...s, kind, min, max, external };
  });
}

function fmtMinutes(m) {
  if (m == null) return "?";
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${+(m / 60).toFixed(1)} h`;
  if (m < 10080) return `${+(m / 1440).toFixed(1)} days`;
  return `${+(m / 10080).toFixed(1)} weeks`;
}
function fmtRange(a, b) {
  if (a == null) return "unknown";
  const fa = fmtMinutes(a), fb = fmtMinutes(b ?? a);
  if (fa === fb) return fa;
  const [na, ua] = fa.split(" "), [nb, ub] = fb.split(" ");
  return ua === ub ? `${na}–${nb} ${ua}` : `${fa} – ${fb}`;
}

// The map shows the developer's live plan: original steps plus any fix steps added by blocker help.
function renderRoadmap(rec) {
  const plan = loadPlan(rec);
  const steps = plan.steps;
  if (!steps.length) return "";
  const doneCount = steps.filter((t) => plan.done[t.uid]).length;
  const nextIdx = Math.max(0, steps.findIndex((t) => !plan.done[t.uid]));
  const added = steps.filter((t) => t.fix).length;
  const sum = (arr, k) => arr.reduce((t, s) => t + (s[k] || 0), 0);
  const hands = steps.filter((s) => !s.external), waits = steps.filter((s) => s.external);
  // Bar length grows with log(time) so a 5-minute step stays visible next to a 4-week wait.
  const maxLog = Math.log10(Math.max(...steps.map((s) => s.max || 1)) + 1);
  const width = (s) => (s.max ? Math.max(6, (Math.log10(s.max + 1) / maxLog) * 100) : 6);

  return `
  <section class="roadmap">
    <div class="roadmap-head">
      <div>
        <h2>Your path to launch</h2>
        <div class="roadmap-totals">
          ${steps.some(isPrereq) ? `<span class="total"><strong>${steps.filter(isPrereq).length}</strong> prerequisites${prereqsOpen(plan) ? `, ${prereqsOpen(plan)} to confirm` : ", all confirmed"}</span>` : ""}
          <span class="total"><strong>${steps.filter((t) => !isPrereq(t)).length}</strong> steps${added ? ` (incl. ${added} fix${added === 1 ? "" : "es"})` : ""}</span>
          <span class="total hands"><strong>${fmtRange(sum(hands, "min"), sum(hands, "max"))}</strong> of your work</span>
          ${waits.length ? `<span class="total wait"><strong>${fmtRange(sum(waits, "min"), sum(waits, "max"))}</strong> waiting on others</span>` : `<span class="total hands">No approval wait</span>`}
        </div>
      </div>
      <div class="start-wrap">
        <button class="start" data-start="${nextIdx}">${icon("test")} ${doneCount ? `Continue walkthrough` : steps.some(isPrereq) ? "Start: check prerequisites" : "Start walkthrough"}</button>
        ${doneCount || added ? `<span class="muted small">${doneCount} of ${steps.length} done · <a href="#" data-reset-plan>reset</a></span>` : ""}
      </div>
    </div>
    <ol class="road">
      ${steps.map((s, i) => `
      ${inPre(s) && i === 0 ? `<li class="road-group">Before you start: confirm you have these</li>` : ""}
      ${!inPre(s) && i > 0 && inPre(steps[i - 1]) ? `<li class="road-group">${prereqsOpen(plan) ? `${icon("lock")} Unlocks when all prerequisites are confirmed` : "Setup"}</li>` : ""}
      <li class="road-step ${s.external ? "external" : ""} ${s.owner === "agent" ? "agent" : ""} ${s.fix ? "fixstep" : ""} ${isPrereq(s) ? "prereq-step" : ""} ${isLocked(plan, s) ? "locked" : ""} ${plan.done[s.uid] ? "is-done" : ""}">
        <div class="road-icon">${icon(isLocked(plan, s) ? "lock" : s.kind)}</div>
        <div class="road-body">
          <div class="road-title"><span class="road-num">${plan.done[s.uid] ? "✓" : i + 1}</span>${esc(s.title)}</div>
          <div class="road-meta">
            ${isPrereq(s) ? "" : `<span class="road-time">${esc(s.time || fmtRange(s.min, s.max))}</span>`}
            ${s.external ? `<span class="pill wait">${icon("wait")} Waiting on ${esc(s.waiting_on || "provider")}</span>` : ""}
            ${isPrereq(s) ? `<span class="pill you">${plan.done[s.uid] ? "Confirmed" : "Prerequisite"}</span>` : s.external ? "" : s.owner === "agent" ? `<span class="pill agent">${icon("code")} Your agent</span>` : `<span class="pill you">${icon("account")} You</span>`}
            ${s.fix ? `<span class="pill fix">Added fix: ${esc(s.fix)}</span>` : ""}
            ${badge(s.evidence)}
          </div>
          ${isPrereq(s) ? "" : `<div class="road-bar"><span style="width:${width(s).toFixed(1)}%"></span></div>`}
          ${s.agent_prompt && !s.external ? `<details class="road-prompt"><summary>${s.owner === "agent" ? "Prompt for your agent" : "Or ask your agent"}</summary><div class="ctx agent-ctx"><pre class="agent-prompt">${esc(s.agent_prompt)}</pre><button type="button" class="secondary" data-copy-step="${i}">Copy prompt</button></div></details>` : ""}
        </div>
      </li>`).join("")}
    </ol>
    <p class="muted small legend"><span class="key hands"></span> hands-on work (<strong>You</strong> do it, or <strong>Your agent</strong> does it from a prompt) <span class="key wait"></span> waiting on the provider or an admin. Bar length shows relative time on a log scale.</p>
  </section>`;
}

// ---------- walkthrough ----------
// The plan starts as the guide's steps. Blocker help can insert fix steps into it,
// so progress is keyed by a stable uid rather than position.

// Prerequisites are the first steps of every plan. Each one is about getting the thing if you
// don't have it yet, and the rest of the plan stays locked until all of them are confirmed.
function prereqSteps(g) {
  return (g.prerequisites || []).filter((p) => p.item).map((p, k) => ({
    title: p.item,
    detail: p.how_to_get ? `If you don't have this yet: ${p.how_to_get}` : "Check you have this before you start.",
    needs: p.needs || [], actions: p.actions || [], url: p.url || null, get_time: p.time || null,
    kind: "prereq", owner: "you", time: "Check", min: null, max: null, external: false,
    done_when: p.done_when || "You have it and can use it now.", evidence: p.evidence, blocks_route: p.blocks_route,
    uid: `p${k}`, prereq: k,
  }));
}

function loadPlan(rec) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(`plan:${rec.id}`)); } catch {}
  if (saved?.steps?.length) {
    // Plans saved before prerequisites became steps get them added at the front.
    if (!saved.steps.some((t) => t.prereq != null)) saved.steps.unshift(...prereqSteps(rec.guide));
    // Pick up fields added to the guide since the plan was saved (e.g. short actions).
    const fresh = normaliseSteps(rec.guide);
    const freshPre = prereqSteps(rec.guide);
    saved.steps = saved.steps.map((t) => (!t.fix && t.prereq == null && fresh[t.orig] ? { ...fresh[t.orig], uid: t.uid, orig: t.orig }
      : t.prereq != null && freshPre[t.prereq] ? { ...freshPre[t.prereq], uid: t.uid } : t));
    saved.have ||= {}; saved.needs ||= {}; saved.chats ||= {}; saved.details ||= {}; saved.stages ||= {}; saved.ledger ||= {}; saved.handoffs ||= [];
    return saved;
  }
  const steps = normaliseSteps(rec.guide).map((s, k) => ({ ...s, uid: `s${k}`, orig: k }));
  return { steps: [...prereqSteps(rec.guide), ...steps], done: {}, notes: [], have: {}, needs: {}, chats: {}, details: {}, stages: {}, ledger: {}, handoffs: [] };
}

const isPrereq = (t) => t.prereq != null;
// Prerequisites plus any fix steps added while getting one: grouped together before the setup steps.
const inPre = (t) => isPrereq(t) || !!t.forPrereq;
const prereqsOpen = (plan) => plan.steps.filter((t) => isPrereq(t) && !plan.done[t.uid]).length;
// A step is locked while any prerequisite is unconfirmed. Prerequisites and fixes for them stay open.
const isLocked = (plan, t) => !isPrereq(t) && !t.fix && prereqsOpen(plan) > 0;
function savePlan(rec, plan) {
  // Screenshots stay in memory only; the saved chat just remembers that one was sent.
  const chats = Object.fromEntries(Object.entries(plan.chats || {}).map(([u, ms]) => [u, ms.map((m) => (m.image ? { ...m, image: undefined, hadImage: true } : m))]));
  const stages = Object.fromEntries(Object.entries(plan.stages || {}).map(([u, x]) => [u, { ...x, chat: (x.chat || []).map((m) => (m.image ? { ...m, image: undefined, hadImage: true } : m)) }]));
  try { localStorage.setItem(`plan:${rec.id}`, JSON.stringify({ ...plan, chats, stages })); } catch {}
}

const COMMON_BLOCKERS = {
  prereq: ["I don't have this yet", "Not sure if I have this", "Getting this will take too long", "I can't get this"],
  account: ["I don't have admin access to the right account", "Can't find the developer console"],
  register: ["redirect_uri_mismatch error", "Can't find this setting in the console", "Form asks for a field I don't have"],
  configure: ["redirect_uri_mismatch error", "Can't find this setting in the console", "Need a privacy policy or verified domain"],
  scopes: ["invalid_scope / scope not available", "This scope triggers a review I want to avoid"],
  credentials: ["Lost the client secret", "Not sure where to paste the credentials"],
  code: ["Token exchange fails", "Tokens expire after a few days"],
  test: ["access_denied or 'app not verified' warning", "API returns 403 after connecting", "Users see 'Need admin approval'"],
  submit: ["Missing privacy policy or verified domain", "Not sure what to put in the screencast"],
  wait: ["My submission was rejected", "No response for a long time"],
};

async function streamSSE(url, body, onProgress, signal) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const event = chunk.match(/^event: (.*)$/m)?.[1];
      const data = JSON.parse(chunk.match(/^data: (.*)$/m)?.[1] || "{}");
      if (event === "progress") onProgress(data);
      else if (event === "done") return data;
      else if (event === "error") throw new Error(data.message);
    }
  }
  throw new Error("Connection closed before an answer arrived.");
}

// Detail that used to sit on the guide page, shown only on the step it belongs to.
function stepContext(g, s, i, part = "all") {
  const parts = [];
  const watchOnly = part === "watch";
  if (part === "background" || part === "all") {
  if (s.orig === 0 && s.prereq == null && !s.fix) {
    const rp = (g.paths || []).find((p) => p.recommended);
    if (g.route) parts.push(`<div class="ctx"><span class="label">Your route</span><strong>${esc(g.route.name)}</strong><p class="small">${explain(g.route.reason || "", g)}</p></div>`);
    else if (rp) parts.push(`<div class="ctx"><span class="label">Your path</span><strong>${esc(rp.name)}</strong><p class="small">${explain(rp.when_to_choose, g)} <span class="muted">Trade-offs: ${esc(rp.tradeoffs)}</span></p></div>`);
  }
  if (s.kind === "scopes" && (g.scopes || []).length) {
    parts.push(`<div class="ctx"><span class="label">Scopes for your job</span><table><tbody>${g.scopes.map((x) => `<tr><td><code>${esc(x.scope)}</code></td><td>${esc(x.why)}</td><td>${badge(x.sensitivity, "sens")}</td></tr>`).join("")}</tbody></table></div>`);
  }
  if ((s.kind === "submit" || s.kind === "wait") && g.approval?.process) {
    parts.push(`<div class="ctx"><span class="label">About this review</span><p class="small">${esc(g.approval.process)}</p></div>`);
  }
  }
  if (part === "background") return parts.join("");
  if (watchOnly) parts.length = 0;
  const watch = (g.blockers || []).filter((b) => b.step !== null && b.step !== undefined && Number(b.step) === s.orig && !s.fix);
  if (watch.length) {
    parts.push(`<div class="ctx watch"><span class="label">Watch out</span><ul>${watch.map((b) => `<li><strong>${esc(b.blocker)}</strong> ${esc(b.mitigation)}</li>`).join("")}</ul></div>`);
  }
  return parts.join("");
}

// Agent steps carry a ready prompt for the developer's coding agent.
function agentBox(g, s) {
  // A "you" step can still carry a prompt when the agent could do it in code instead of the dashboard.
  if (s.external || (s.owner !== "agent" && !s.agent_prompt)) return "";
  const prompt = s.agent_prompt || `Help me with this step of connecting ${g.app} to my agent (${g.job}): ${s.title}. ${s.detail}`;
  return `<div class="ctx agent-ctx"><span class="label">${s.owner === "agent" ? "Prompt for your coding agent" : "Or ask your coding agent to do it"}</span><pre class="agent-prompt">${esc(prompt)}</pre><button type="button" class="secondary" data-copy-prompt>Copy prompt</button></div>`;
}

function startWalkthrough(rec, index) {
  const plan = loadPlan(rec);
  document.body.classList.add("focus"); // the plan list takes the sidebar's place
  let i = Math.min(index, plan.steps.length - 1);
  // Help chat: one conversation per step, so a follow-up builds on what was already tried.
  let chatOpen = false;
  let busy = null; // { log: [] } while the agent is answering
  const msgsFor = (t) => (plan.chats[t.uid] ||= []);
  const el = $("#guide");
  const link = (u, label) => (safeUrl(u) ? `<a class="open-link" href="${esc(u)}" target="_blank" rel="noopener">${esc(label)} ↗</a>` : "");

  // A short window of the plan around the insertion point, so it's clear nothing is removed.
  const previewPlan = (h) => {
    const before = plan.steps.slice(Math.max(0, i - 1), i).map((t) => ({ title: t.title, cls: "old" }));
    const fixes = h.fix_steps.map((f) => ({ title: f.title, cls: "new" }));
    const after = plan.steps.slice(i, i + 2).map((t) => ({ title: t.title, cls: "old" }));
    return [...before, ...fixes, ...after];
  };

  const PLAN_CHANGE = (n) => ({
    retry: "Fix this, then redo this step.",
    insert_steps: `Add ${n} fix step${n === 1 ? "" : "s"} before you carry on.`,
    switch_path: "This route looks blocked. Consider switching path.",
    wait: "Nothing to fix. This is a wait.",
  });

  // One agent answer in the chat: what it says, the question it asks back, and any fix steps.
  const helpBubble = (h, m) => {
    const n = (h.fix_steps || []).length;
    return `
      ${h.demo ? `<p class="small muted" style="margin:0 0 6px">Demo answer, not live research.</p>` : ""}
      <p>${esc(h.reply || h.diagnosis || "")}</p>
      ${h.reply && h.diagnosis && h.diagnosis !== h.reply ? `<p class="small muted">${esc(h.diagnosis)} ${badge(h.evidence)}</p>` : ""}
      ${(h.likely_causes || []).length ? `<details class="more"><summary>What might be causing it</summary><ul class="causes">${h.likely_causes.map((c) => `<li>${badge(c.likelihood, "impact")} <strong>${esc(c.cause)}</strong><br><span class="muted small">Check: ${esc(c.how_to_check)}</span></li>`).join("")}</ul></details>` : ""}
      ${n ? `<div class="plan-change ${esc(h.plan_change)}"><strong>What changes:</strong> ${PLAN_CHANGE(n)[h.plan_change] || ""}</div>
        <ol class="fix-list">${h.fix_steps.map((f) => `<li><strong>${esc(f.title)}</strong> <span class="muted small">${esc(f.time || "")}</span><br>${(f.actions || []).length ? `<ol class="todo small">${f.actions.map((x) => `<li>${explainMd(x, rec.guide)}</li>`).join("")}</ol>` : `<span class="small">${esc(f.detail || "")}</span>`}</li>`).join("")}</ol>
        ${m.applied ? `<p class="small muted">✓ Added to your plan.</p>` : `<details class="more"><summary>Your plan after adding them</summary><div class="preview"><ol>${previewPlan(h).map((t) => `<li class="${t.cls}">${esc(t.title)}${t.cls === "new" ? " <em>(new)</em>" : ""}</li>`).join("")}</ol><span class="muted small">All ${plan.steps.length} existing steps stay. Nothing is removed.</span></div></details>
        <button type="button" data-apply="${m.k}">Add ${n} fix step${n === 1 ? "" : "s"} to my plan</button>`}` : h.plan_change === "wait" ? `<div class="plan-change wait"><strong>What changes:</strong> ${PLAN_CHANGE(0).wait}</div>` : ""}
      ${h.alternative_path ? `<div class="alt"><strong>Alternative: ${esc(h.alternative_path.name)}</strong><p class="small">${esc(h.alternative_path.why)}</p><p class="muted small">Trade-offs: ${esc(h.alternative_path.tradeoffs)}</p></div>` : ""}
      ${h.meanwhile ? `<p class="small"><strong>Meanwhile:</strong> ${esc(h.meanwhile)}</p>` : ""}
      ${h.ask ? `<p class="chat-ask">${esc(h.ask)}</p>` : ""}
      ${(h.sources || []).length ? `<p class="small muted">Sources: ${h.sources.filter((x) => safeUrl(x.url)).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || x.url)}</a>`).join(" · ")}</p>` : ""}`;
  };
  const screenBubble = (a) => `
      ${a.demo ? `<p class="small muted" style="margin:0 0 6px">Demo answer, not live.</p>` : ""}
      ${a.reply ? `<p>${esc(a.reply)}</p>` : ""}
      <p class="where">You're on: ${esc(a.where || "")}</p>
      ${a.step_done ? `<p class="small"><strong>Looks like this step is done.</strong></p>` : ""}
      <ol class="todo">${(a.actions || []).map((x) => `<li>${explainMd(x, rec.guide)}</li>`).join("")}</ol>
      ${a.note ? `<p class="small muted" style="margin:8px 0 0">${explain(a.note, rec.guide)}</p>` : ""}`;

  const renderChat = (s) => {
    const msgs = msgsFor(s);
    const chips = [...new Set([...(COMMON_BLOCKERS[s.kind] || []), ...(isPrereq(s) ? [] : (rec.guide.blockers || []).slice(0, 3).map((b) => b.blocker))])];
    const bubble = (m, k) => m.role === "user"
      ? `<div class="msg me">${m.image ? `<img src="${m.image}" alt="Your screenshot">` : m.hadImage ? `<p class="small muted">📷 Screenshot</p>` : ""}${m.text ? `<p>${esc(m.text)}</p>` : ""}</div>`
      : `<div class="msg bot">${m.error ? `<p>Sorry, that didn't work: ${esc(m.error)}</p>` : m.screen ? screenBubble(m.screen) : helpBubble(m.help, { ...m, k })}</div>`;
    const last = msgs.at(-1);
    return `
    <div class="chat card" id="chat">
      <div class="chat-head"><strong>${icon("scopes")} Help with this step</strong><button type="button" class="linkbtn small" data-dismiss>Close</button></div>
      <div class="chat-msgs" aria-live="polite">
        <div class="msg bot"><p>What's blocking you? Paste the error, describe what you see, or send a screenshot. We can keep going back and forth until you're unstuck.</p></div>
        ${msgs.map(bubble).join("")}
        ${busy ? `<div class="msg bot busy"><p class="small muted"><span class="spinner" style="display:inline-block;vertical-align:-2px"></span> ${esc(busy.log.at(-1) || "Thinking…")}</p></div>` : ""}
      </div>
      ${busy ? "" : `<div class="chips">${(msgs.length ? (last?.role === "bot" || last?.role === "agent" ? ["That worked", "Still stuck", ...(last.help?.ask ? [] : ["Explain that more simply"])] : []) : chips).map((c) => `<button type="button" class="chip" data-chip="${esc(c)}">${esc(c)}</button>`).join("")}</div>`}
      <div class="chat-compose">
        <textarea id="problem" rows="2" placeholder="${msgs.length ? "Reply, or paste what you see now" : "Paste the error message, or describe what happened"}" ${busy ? "disabled" : ""}></textarea>
        <div class="chat-tools"><button type="button" class="secondary" data-chat-shot ${busy ? "disabled" : ""}>📷 Screenshot</button><button type="button" data-ask ${busy ? "disabled" : ""}>Send</button></div>
      </div>
    </div>`;
  };

  // ---- Get ready: every prerequisite on one screen, two levels at most ----
  // Level 1 is what you need ("A HubSpot developer account"); level 2 is what getting it asks for
  // ("a company website"), each with what works instead and when the real thing matters.
  const renderGetReady = () => {
    const pre = plan.steps.map((t, k) => ({ t, k })).filter(({ t }) => inPre(t));
    const ready = pre.filter(({ t }) => isPrereq(t) && plan.done[t.uid]).length;
    const total = pre.filter(({ t }) => isPrereq(t)).length;
    const setup = plan.steps.filter((t) => !inPre(t)).length;
    // Fixes for a prerequisite live inside its card (level 2), never as cards of their own.
    const fixItem = ({ t, k }) => `<li class="${plan.done[t.uid] ? "done" : ""}"><div><strong>${esc(t.title)}</strong>${(t.actions || []).length ? `<ol class="todo small">${t.actions.map((a) => `<li>${explainMd(a, rec.guide)}</li>`).join("")}</ol>` : t.detail ? `<br><span class="small">${explain(t.detail, rec.guide)}</span>` : ""} ${link(t.url, "Open")}</div>${plan.done[t.uid] ? `<span class="small muted">Done</span>` : `<button type="button" class="secondary" data-fixdone="${k}">Done</button>`}</li>`;
    const card = ({ t, k }) => {
      if (t.fix && t.forUid) return "";
      if (t.fix) {
        return `<div class="pq fixcard ${plan.done[t.uid] ? "done" : ""}"><div class="pq-head"><h3><span class="pill fix">Added fix</span> ${esc(t.title)}</h3>${plan.done[t.uid] ? "" : `<button type="button" class="secondary" data-fixdone="${k}">Done</button>`}</div>
          ${plan.done[t.uid] ? "" : `<div class="pq-body">${(t.actions || []).length ? `<ol class="todo">${t.actions.map((a) => `<li>${explainMd(a, rec.guide)}</li>`).join("")}</ol>` : `<p class="small">${explain(t.detail || "", rec.guide)}</p>`}${link(t.url, "Open")}</div>`}</div>`;
      }
      const done = plan.done[t.uid];
      const need = !done && plan.have[t.uid] === "need";
      const needs = (t.needs || []).slice(0, 4);
      return `
      <div class="pq ${done ? "done" : ""} ${need ? "open" : ""} ${k === i ? "current" : ""}" id="pq-${k}">
        <div class="pq-head">
          <h3><span>${explain(t.title, rec.guide)}</span></h3>
          ${done ? `<span class="small muted">Ready · <a href="#" data-pq-undo="${k}">change</a></span>`
            : `<div class="seg" role="group" aria-label="Do you have it?"><button type="button" data-have="${k}">I have it</button><button type="button" class="${need ? "on" : ""}" data-need="${k}">I need one</button></div>`}
        </div>
        ${!done && needs.length ? `<div class="pq-asks">${need ? "" : "Getting one asks for: "}${need ? "" : needs.map((n) => `<span class="ask">${esc(n.item)}</span>`).join("")}${!need && t.get_time ? ` · about ${esc(t.get_time)}` : ""}</div>` : ""}
        ${need ? `<div class="pq-body">
          ${pre.some((x) => x.t.forUid === t.uid) ? `<div class="sub"><h4>Added from what blocked you</h4><ul class="fixlist">${pre.filter((x) => x.t.forUid === t.uid).map(fixItem).join("")}</ul></div>` : ""}
          ${needs.length ? `<div class="sub"><h4>Have these ready</h4>${needs.map((n, j) => `<label class="need"><input type="checkbox" data-needchk="${t.uid}:${j}" ${plan.needs[`${t.uid}:${j}`] ? "checked" : ""}><span><strong>${explain(n.item, rec.guide)}</strong>${n.ok_if ? `<br><span class="ok">${explain(n.ok_if, rec.guide)}</span>` : ""}${n.later ? `<br><span class="later">Later: ${esc(n.later)}</span>` : ""}</span></label>`).join("")}</div>` : ""}
          <div class="sub"><h4>${needs.length ? "Then" : "How to get it"}</h4>${(t.actions || []).length ? `<ol class="todo">${t.actions.map((a) => `<li>${explainMd(a, rec.guide)}</li>`).join("")}</ol>` : `<p class="small" style="margin:0">${explain(t.detail || "", rec.guide)}</p>`}</div>
          ${safeUrl(t.url) ? `<div class="copybox"><span>Open the sign-up page${t.link_status === "ok" ? ` <span class="link-ok">✓ link tested</span>` : ""}</span>${link(t.url, "Open")}</div>` : ""}
          <p class="done-when" style="margin:0"><strong>Done when:</strong> ${explain(t.done_when || "you have it", rec.guide)}</p>
          <div class="pq-actions"><button type="button" class="secondary" data-pq-screen="${k}">📷 Show me your screen</button><button type="button" class="secondary" data-pq-stuck="${k}">I'm stuck</button><button type="button" data-gotit="${k}">I've got it</button></div>
          ${k === i && chatOpen ? renderChat(t) : ""}
        </div>` : ""}
      </div>`;
    };
    return `
      <div class="getready">
        <h2 class="gr-title">Get ready</h2>
        <p class="muted" style="margin:4px 0 0">You need ${total === 1 ? "one thing" : `${total} things`} before setup. Tell us what you have; we'll walk you through the rest.</p>
        <div class="ready-bar"><div class="meter"><span style="width:${total ? Math.round((ready / total) * 100) : 100}%"></span></div>${ready} of ${total} ready</div>
        ${pre.map(card).join("")}
        ${prereqsOpen(plan) ? `<div class="locked">${icon("lock")} Setup (${setup} step${setup === 1 ? "" : "s"}) unlocks when ${total === 1 ? "this is" : "all are"} ready.</div>`
          : `<div class="pq-actions"><span class="small muted">All set.</span><button type="button" data-continue>Continue to setup →</button></div>`}
      </div>`;
  };

  // After a prerequisite is ready: open the next one the user said they need, else stay on the list.
  const nextPre = () => {
    const k = plan.steps.findIndex((t) => isPrereq(t) && !plan.done[t.uid] && plan.have[t.uid] === "need");
    const any = plan.steps.findIndex((t) => isPrereq(t) && !plan.done[t.uid]);
    i = k >= 0 ? k : any >= 0 ? any : i;
    chatOpen = false;
    render();
  };

  // ---- Show me your screen: a screenshot of where you are, read by the model ----
  const readImage = (file) => new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error("That isn't an image. Take a screenshot (⌘⇧4 on Mac) and try again."));
    const img = new Image();
    img.onload = () => {
      // Shrink big retina screenshots: enough detail to read, small enough to send quickly.
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("Couldn't open that image."));
    img.src = URL.createObjectURL(file);
  });
  // Everything in the help chat goes through here: text goes to the blocker agent, a screenshot to the screen reader.
  // Earlier turns on this step go along, so each answer builds on what was tried.
  const historyOf = (msgs) => msgs.map((m) => m.role === "user"
    ? { role: "user", text: `${m.image || m.hadImage ? "[sent a screenshot] " : ""}${m.text || ""}` }
    : { role: "agent", text: m.error ? "" : m.screen ? `${m.screen.reply || ""} On: ${m.screen.where}. Do: ${(m.screen.actions || []).join(" / ")}` : [m.help.reply, m.help.diagnosis, (m.help.fix_steps || []).length ? `Fix steps: ${m.help.fix_steps.map((f) => f.title).join("; ")}` : "", m.help.ask ? `Asked: ${m.help.ask}` : ""].filter(Boolean).join(" ") });
  const scrollChat = () => { const c = el.querySelector(".chat-msgs"); if (c) c.scrollTop = c.scrollHeight; el.querySelector("#chat")?.scrollIntoView({ block: "nearest" }); };
  const sendChat = async (text, file) => {
    const t = plan.steps[i];
    const msgs = msgsFor(t);
    let image = null;
    if (file) {
      try { image = await readImage(file); }
      catch (e) { chatOpen = true; msgs.push({ role: "user", text: "" }, { role: "agent", error: e.message }); render(); return; }
    }
    const history = historyOf(msgs);
    msgs.push({ role: "user", text, image });
    chatOpen = true; busy = { log: [image ? "Looking at your screen…" : "Checking your guide and searching for this problem…"] };
    render(); scrollChat();
    const body = { id: rec.id, step: t.orig ?? 0, prereq: isPrereq(t) ? t.prereq : null, history };
    try {
      if (image) {
        const a = await fetch("/api/screen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, image, note: text }) }).then((r) => r.json());
        msgs.push(a.error ? { role: "agent", error: a.error } : { role: "agent", screen: a });
      } else {
        const h = await streamSSE("/api/unblock", { ...body, problem: text }, (d) => {
          if (d.kind === "search" || d.kind === "fetch") { busy.log.push(`${d.kind === "search" ? "Searching" : "Reading"}: ${d.text}`); const b = el.querySelector(".msg.busy p"); if (b) b.lastChild.textContent = ` ${busy.log.at(-1)}`; }
        });
        if (!history.length) plan.notes.push({ step: t.title, problem: text, diagnosis: h.diagnosis });
        msgs.push({ role: "agent", help: h });
      }
    } catch (e) { msgs.push({ role: "agent", error: e.message }); }
    busy = null;
    savePlan(rec, plan);
    if (document.body.contains(el)) { render(); scrollChat(); el.querySelector("#problem")?.focus(); }
  };
  const sendScreen = (file) => sendChat(el.querySelector("#problem")?.value.trim() || "", file);
  const pickScreen = () => {
    const f = document.createElement("input");
    f.type = "file"; f.accept = "image/*";
    f.onchange = () => f.files[0] && sendScreen(f.files[0]);
    f.click();
  };
  // Paste a screenshot anywhere while the walkthrough is open.
  window.onpaste = (e) => {
    if (!document.body.classList.contains("focus")) return;
    const file = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
    if (file) { e.preventDefault(); sendScreen(file); }
  };

  // ---- Step by step: each setup step is written in depth when it's opened ----
  // The guide is the outline; the detail is researched for the screen the builder is on now,
  // using what they did and saved in earlier steps. It's kept in the saved plan, not the guide file.
  const writing = {}; // uid -> { log: [] } while a step is being written
  const stepErr = {}; // uid -> message when writing failed (the short version shows instead)
  let differOpen = false;
  const deepable = (t) => !inPre(t) && !t.fix && !t.external && t.orig != null;
  const progressFor = () => plan.steps.filter((t) => !inPre(t) && plan.done[t.uid])
    .map((t) => ({ title: t.title, saved: (plan.details[t.uid]?.save || []).map((x) => `${x.what} → ${x.where}`) }));
  const writeStep = async (t, extra = {}) => {
    if (writing[t.uid]) return;
    writing[t.uid] = { log: [extra.image ? "Looking at your screen…" : extra.seen ? "Rewriting this step for your screen…" : `Checking ${rec.guide.app}'s current screens for this step…`] };
    delete stepErr[t.uid];
    if (plan.steps[i] === t) render();
    try {
      const d = await streamSSE("/api/step-detail", { id: rec.id, step: t.orig, progress: progressFor(), ...extra }, (p) => {
        const line = p.kind === "search" ? `$ search "${p.text}"` : p.text;
        if (!line || /^Testing \d+ links/.test(line) || writing[t.uid].log.at(-1) === line) return;
        writing[t.uid].log.push(line);
        const box = el.querySelector(`[data-writing="${t.uid}"]`);
        if (box) box.innerHTML = writing[t.uid].log.slice(-6).map(esc).join("<br>");
      });
      plan.details[t.uid] = d;
      differOpen = false;
      savePlan(rec, plan);
    } catch (e) {
      // A failed rewrite keeps the step they already had; a failed first write falls back to the short version.
      if (extra.seen || extra.image) alert(`Couldn't rewrite this step: ${e.message}`);
      else stepErr[t.uid] = e.message;
    }
    delete writing[t.uid];
    if (document.body.contains(el) && plan.steps[i] === t) render();
  };
  const writingCard = (t, k) => `
    <div class="walk-card writing-card">
      <div class="spinner" style="margin:0 auto"></div>
      <h2>Writing step ${k + 1}: ${esc(t.title)}</h2>
      <p class="muted">Checking ${esc(rec.guide.app)}'s current screens so the steps match what you see. About 10 seconds.</p>
      <div class="writing-log" data-writing="${t.uid}">${writing[t.uid].log.slice(-6).map(esc).join("<br>")}</div>
    </div>`;
  const deepCard = (s) => {
    if (!deepable(s)) return "";
    if (writing[s.uid]) return writingCard(s, i);
    const d = plan.details[s.uid];
    if (!d) return "";
    const g = rec.guide;
    const when = d.written_at ? new Date(d.written_at) : null;
    const fresh = when ? (Date.now() - when < 864e5 ? "today" : when.toLocaleDateString()) : "";
    const byAgent = s.owner === "agent";
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
    return `<div class="walk-card ${s.owner === "agent" ? "" : ""}">
      <div class="walk-kicker">
        <span class="road-icon">${icon(s.kind)}</span>
        <span>Step ${i + 1} of ${plan.steps.length}</span>
        <span class="road-time">${esc(d.time || s.time || fmtRange(s.min, s.max))}</span>
        <span class="who ${s.owner === "agent" ? "agent" : "you"}">${s.owner === "agent" ? "YOUR AGENT DOES THIS" : "YOU DO THIS"}</span>
        ${badge(d.screen_note ? "rewritten from your screen" : d.evidence)}
        <span class="sx-fresh">${d.demo ? "Demo answer, not live research" : `Checked against ${esc(g.app)}'s docs ${fresh}${(d.sources || []).length ? ` · ${d.sources.length} source${d.sources.length === 1 ? "" : "s"}` : ""}`}</span>
      </div>
      <h2>${esc(s.title)}</h2>
      ${d.so_far ? `<p class="sx-sofar">So far: ${explainMd(d.so_far, g)}</p>` : ""}
      ${byAgent ? `
      <div class="sx-agent"><b>Your coding agent does this step</b><p class="small" style="margin:2px 0 10px">You don't click anything in ${esc(g.app)}. Open your project in Cursor, Claude Code or similar, paste the prompt, and let it work.</p>
        ${agentBox(g, s)}
        ${d.prompt_context ? `<div class="sx-ctxline"><span class="small">Paste this with it, from your earlier steps:</span><br><span class="sx-val">${esc(d.prompt_context)}</span><button type="button" class="linkbtn small" data-copyval="${esc(d.prompt_context)}">Copy</button></div>` : ""}
      </div>
      ${d.you_will_see ? `<div class="sx-see"><b>What your agent should tell you</b>${explainMd(d.you_will_see, g)}</div>` : ""}
      <div class="sx-checks"><b>Check its work</b><ol class="todo sx-steps">${d.actions.map((a) => `<li>${explainMd(a.do, g)}${a.value ? `<br><span class="sx-val">${esc(a.value)}</span>` : ""}${a.why ? `<span class="sx-why">${explain(a.why, g)}</span>` : ""}</li>`).join("")}</ol></div>
      ${(d.if_different || []).length ? `<details class="more"><summary>If your agent gets stuck</summary><ul class="small sx-ifs">${d.if_different.map((x) => `<li>${explainMd(x.if, g)}: ${explainMd(x.then || "", g)}</li>`).join("")}</ul></details>` : ""}` : `
      ${d.screen_note ? `<div class="sx-diff"><strong>Rewritten for your screen.</strong> ${explainMd(d.screen_note, g)}</div>` : ""}
      ${(d.where?.path || []).length || d.where?.url ? `<div class="sx-where"><b>Where you should be</b>${(d.where.path || []).length ? `<div class="sx-crumb">${d.where.path.map(esc).join(`<span>›</span>`)}</div>` : ""}${d.where.how ? `<div class="small">${explainMd(d.where.how, g)}</div>` : ""}${link(d.where.url, "Open this page")}</div>` : ""}
      ${d.you_will_see ? `<div class="sx-see"><b>What you'll see</b>${explainMd(d.you_will_see, g)}</div>` : ""}
      <ol class="todo sx-steps">${d.actions.map((a) => `<li>${explainMd(a.do, g)}${a.value ? `<br><span class="sx-val">${esc(a.value)}</span><button type="button" class="linkbtn small" data-copyval="${esc(a.value)}">Copy</button>` : ""}${a.why ? `<span class="sx-why">${explain(a.why, g)}</span>` : ""}</li>`).join("")}</ol>
      ${byAgent ? "" : agentBox(g, s)}
      ${(d.save || []).length ? `<div class="sx-save"><b>Save these before you move on</b><ul>${d.save.map((x) => `<li><strong>${esc(x.what)}</strong> → ${explainMd(x.where || "", g)}${x.used_by ? ` <span class="muted small">(used in ${esc(x.used_by)})</span>` : ""}</li>`).join("")}</ul></div>` : ""}
      ${(d.if_different || []).length ? `<details class="more"><summary>If your screen looks different</summary><ul class="small sx-ifs">${d.if_different.map((x) => `<li>${explainMd(x.if, g)}: ${explainMd(x.then || "", g)}</li>`).join("")}</ul></details>` : ""}`}
      ${stepContext(g, s, i, "watch")}
      ${d.done_when || s.done_when ? `<p class="done-when"><strong>Done when:</strong> ${explainMd(d.done_when || s.done_when, g)}</p>` : ""}
      ${s.detail || stepContext(g, s, i, "background") ? `<details class="more"><summary>Why this step?</summary>${s.detail ? `<p class="walk-detail">${explain(s.detail, g)}</p>` : ""}${stepContext(g, s, i, "background")}</details>` : ""}
      ${(d.sources || []).length ? `<p class="small muted">Sources: ${d.sources.filter((x) => safeUrl(x.url)).map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || x.url)}</a> <span class="sx-host">${esc(host(x.url))}${x.official === false ? ", not official" : ""}</span>`).join(" · ")}</p>` : ""}
      ${byAgent ? `<div class="sx-match"><span>Did your agent finish, and do the checks pass?</span><div><button type="button" class="secondary" data-stuck>It got stuck</button><button type="button" data-done>${plan.done[s.uid] ? "Next step" : "Yes, done. Next step"}</button></div></div>` : differOpen ? `<div class="sx-differ">
          <strong>What do you see instead?</strong>
          <textarea id="seen" rows="2" placeholder="e.g. There's no Clients page, the menu shows APIs & Services › Credentials"></textarea>
          <div class="chat-tools"><button type="button" class="secondary" data-differ-shot>📷 Send a screenshot</button><button type="button" class="linkbtn small" data-differ-cancel>Cancel</button><button type="button" data-rewrite>Rewrite this step</button></div>
        </div>` : `<div class="sx-match"><span>Does your screen match this?</span><div><button type="button" class="secondary" data-differs>No, it looks different</button><button type="button" data-done>${plan.done[s.uid] ? "Next step" : "Yes, done. Next step"}</button></div></div>`}
    </div>`;
  };

  // ---- Stage chats: each stage of the OAuth setup is one conversation ----
  // It opens with instructions for the builder's screen, takes questions, errors and screenshots in the
  // same window, ticks off the Definition of done, and moves on only when the builder confirms.
  const STAGES = rec.stages || [];
  const useStages = STAGES.length > 0;
  let cur = null; // id of the open stage, or null while on prerequisites
  const stageBusy = {}; // stage id -> { log: [] }
  const stState = (id) => (plan.stages[id] ||= { chat: [], status: "open", notes: null, dod: null });
  const stageIdx = (id) => STAGES.findIndex((x) => x.id === id);
  const nextStage = () => STAGES.find((x) => plan.stages[x.id]?.status !== "done");
  const openStage = (id) => { cur = id; render(); };
  const stageDod = (st) => stState(st.id).dod || st.dod.map((item) => ({ item, met: false }));
  const stageHistory = (chat) => chat.map((m) => m.role === "user"
    ? { role: "user", text: `${m.image || m.hadImage ? "[sent a screenshot] " : ""}${m.text || ""}${m.screen ? ` (screen: ${m.screen.slice(0, 300)})` : ""}` }
    : { role: "agent", text: m.error ? "" : [m.r.reply, (m.r.actions || []).map((a) => a.do).join(" / "), m.r.ask ? `Asked: ${m.r.ask}` : ""].filter(Boolean).join(" ") });
  const stageTurn = async (st, { message = "", image = null, backFrom = null } = {}) => {
    const S = stState(st.id);
    if (stageBusy[st.id]) return;
    const history = stageHistory(S.chat);
    if (message || image) S.chat.push({ role: "user", text: message, image });
    stageBusy[st.id] = { log: [history.length ? "Thinking about your answer…" : `Checking ${rec.guide.app}'s current screens for this stage…`] };
    if (cur === st.id) { render(); scrollStage(); }
    try {
      const r = await streamSSE("/api/stage-turn", {
        id: rec.id, stage: st.id, history, message, image, ledger: plan.ledger, handoffs: plan.handoffs, notes: S.notes,
        status: Object.fromEntries(STAGES.map((x) => [x.id, plan.stages[x.id]?.status || "open"])), back_from: backFrom,
      }, (p) => {
        const line = p.kind === "search" ? `$ search "${p.text}"` : p.text;
        const b = stageBusy[st.id];
        if (!line || !b || /^Testing \d+ links/.test(line) || b.log.at(-1) === line) return;
        b.log.push(line);
        const box = el.querySelector("[data-stagelog]");
        if (box && cur === st.id) box.textContent = line;
      });
      if (r.screen) { const u = [...S.chat].reverse().find((m) => m.role === "user"); if (u) u.screen = r.screen; }
      S.chat.push({ role: "agent", r });
      S.dod = r.dod;
      if (r.research_notes) S.notes = r.research_notes;
      Object.assign(plan.ledger, r.record || {});
    } catch (e) { S.chat.push({ role: "agent", error: e.message }); }
    delete stageBusy[st.id];
    savePlan(rec, plan);
    if (document.body.contains(el) && cur === st.id) { render(); scrollStage(); }
  };
  const scrollStage = () => { const c = el.querySelector(".st-msgs"); if (c) c.scrollTop = c.scrollHeight; };
  const stageListHtml = () => `<li class="plan-group">Stages${prereqsOpen(plan) ? " (locked)" : ""}</li>${STAGES.map((x, k) => {
    const S = plan.stages[x.id], done = S?.status === "done", locked = prereqsOpen(plan) > 0;
    const met = (S?.dod || []).filter((d) => d.met).length;
    const sub = `${x.owner === "agent" ? "Your agent" : x.owner === "provider" ? "A wait" : "You"}${done ? "" : stageBusy[x.id] ? " · working…" : S?.chat?.length ? ` · ${met} of ${x.dod.length} done` : ""}`;
    return `<li><button class="plan-item ${cur === x.id ? "current" : ""} ${done ? "done" : ""} ${locked ? "locked" : ""}" data-stage="${esc(x.id)}" ${locked ? `disabled title="Confirm the prerequisites first"` : ""}><span class="plan-num">${done ? "✓" : locked ? icon("lock") : k + 1}</span><span class="plan-title">${esc(x.title)}<span class="plan-sub">${sub}</span></span></button></li>`;
  }).join("")}${Object.keys(plan.ledger).length ? `<li class="plan-group">Saved so far</li><li class="st-ledger">${Object.entries(plan.ledger).slice(0, 12).map(([k, v]) => `<div><span class="muted">${esc(k.replace(/_/g, " "))}</span> <code>${esc(v)}</code></div>`).join("")}</li>` : ""}`;
  const stageBubble = (st, m, k, S) => {
    if (m.role === "user") return `<div class="msg me">${m.image ? `<img src="${m.image}" alt="Your screenshot">` : m.hadImage ? `<p class="small">📷 Screenshot</p>` : ""}${m.text ? `<p>${esc(m.text)}</p>` : ""}</div>`;
    if (m.error) return `<div class="msg bot"><p>Sorry, that didn't work: ${esc(m.error)}</p><button type="button" class="linkbtn small" data-st-retry>Try again</button></div>`;
    const r = m.r, g = rec.guide;
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
    const back = r.go_back && STAGES.find((x) => x.id === r.go_back.stage);
    return `<div class="msg bot">
      ${r.demo ? `<p class="small muted">Demo answer, not live.</p>` : ""}
      ${r.where && ((r.where.path || []).length || r.where.url) ? `<div class="st-crumb">${(r.where.path || []).map(esc).join("<span>›</span>")}${safeUrl(r.where.url) ? ` <a href="${esc(r.where.url)}" target="_blank" rel="noopener">Open ↗</a>` : ""}</div>` : ""}
      ${r.reply ? `<p>${explainMd(r.reply, g)}</p>` : ""}
      ${(r.actions || []).length ? `<ol class="todo">${r.actions.map((a) => `<li>${explainMd(a.do, g)}${a.value ? `<br><span class="sx-val">${esc(a.value)}</span><button type="button" class="linkbtn small" data-copyval="${esc(a.value)}">Copy</button>` : ""}</li>`).join("")}</ol>` : ""}
      ${r.agent_prompt ? `<div class="ctx agent-ctx"><span class="label">Paste this into your coding agent</span><pre class="agent-prompt" data-prompt="${k}">${esc(r.agent_prompt)}</pre><button type="button" class="secondary" data-copy-st-prompt="${k}">Copy prompt</button></div>` : ""}
      ${back ? `<div class="sx-diff"><strong>This comes from an earlier stage.</strong> ${esc(r.go_back.reason || "")} <button type="button" class="linkbtn" data-goback="${esc(back.id)}" data-reason="${esc(r.go_back.reason || "")}">Go back to “${esc(back.title)}”</button></div>` : ""}
      ${r.ask ? `<p class="chat-ask">${esc(r.ask)}</p>` : ""}
      ${(r.sources || []).length ? `<p class="small muted">Sources: ${r.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || x.url)}</a> <span class="sx-host">${esc(host(x.url))}${x.official === false ? ", not official" : ""}</span>`).join(" · ")}</p>` : ""}
    </div>`;
  };
  const renderStage = () => {
    const st = STAGES.find((x) => x.id === cur);
    const S = stState(st.id), k = stageIdx(st.id);
    const dod = stageDod(st);
    const last = S.chat.at(-1);
    const doneNow = S.status !== "done" && last?.role === "agent" && last.r?.done?.met;
    const nx = STAGES.slice(k + 1).find((x) => plan.stages[x.id]?.status !== "done");
    const busy = stageBusy[st.id];
    const stepPrompts = st.owner === "agent" && !S.chat.some((m) => m.r?.agent_prompt) ? st.steps.map((j) => rec.guide.steps[j]).filter((x) => x?.agent_prompt) : [];
    return `<div class="stage-card">
      <div class="st-head">
        <div class="walk-kicker"><span>Stage ${k + 1} of ${STAGES.length}</span><span class="who ${st.owner === "agent" ? "agent" : st.owner === "provider" ? "wait" : "you"}">${st.owner === "agent" ? "YOUR AGENT DOES THIS" : st.owner === "provider" ? "WAITING ON THE PROVIDER" : "YOU DO THIS"}</span>${S.status === "done" ? `<span class="badge evidence-verified">done</span>` : ""}</div>
        <h2>${esc(st.title)}</h2>
        <p class="small muted" style="margin:0">Goal: ${esc(st.goal)}</p>
        <div class="st-dod"><strong>Done when:</strong>${dod.map((d) => `<span class="${d.met ? "ok" : ""}">${d.met ? "✓" : "○"} ${esc(d.item)}</span>`).join("")}</div>
      </div>
      <div class="st-msgs" aria-live="polite">
        ${stepPrompts.length ? `<div class="msg bot"><p>Your coding agent does this stage. Here's the prompt from your guide; I'll fill in your saved details in a moment.</p>${stepPrompts.map((x) => `<pre class="agent-prompt">${esc(x.agent_prompt)}</pre>`).join("")}</div>` : ""}
        ${S.chat.map((m, j) => stageBubble(st, m, j, S)).join("")}
        ${busy ? `<div class="msg bot busy"><p class="small muted"><span class="spinner" style="display:inline-block;vertical-align:-2px"></span> <span data-stagelog>${esc(busy.log.at(-1))}</span></p></div>` : ""}
        ${doneNow ? `<div class="st-donebar"><strong>Looks like this stage is done.</strong> ${esc(last.r.done.evidence || "")}
          ${last.r.handoff ? `<div class="small muted" style="margin-top:6px">Handing on: ${esc(last.r.handoff)}</div>` : ""}
          <div class="row"><span class="small">${nx ? `Next: <strong>${esc(nx.title)}</strong>${nx.owner === "agent" ? " (your agent does it)" : ""}` : "That's the last stage."}</span><div><button type="button" class="secondary" data-notyet>Not yet</button><button type="button" data-stage-done>${nx ? `Yes, go to stage ${stageIdx(nx.id) + 1}` : "Yes, finish"}</button></div></div></div>` : ""}
        ${S.status === "done" ? `<div class="st-donebar"><strong>Stage done.</strong> ${nx ? `<button type="button" data-stage="${esc(nx.id)}">Go to “${esc(nx.title)}”</button>` : ""}</div>` : ""}
      </div>
      ${busy ? "" : `<div class="chips">${["Done", "My screen looks different", "I got an error"].map((c) => `<button type="button" class="chip" data-st-chip="${esc(c)}">${esc(c)}</button>`).join("")}</div>`}
      <div class="st-compose">
        <textarea id="st-input" rows="2" placeholder="Tell me what you see, paste an error or your agent's reply, or drop a screenshot" ${busy ? "disabled" : ""}></textarea>
        <button type="button" class="secondary" data-st-shot ${busy ? "disabled" : ""} title="Send a screenshot">📷</button><button type="button" data-st-send ${busy ? "disabled" : ""}>Send</button>
      </div>
    </div>`;
  };
  const bindStage = () => {
    const st = STAGES.find((x) => x.id === cur);
    if (!st) return;
    const on = (sel, fn) => el.querySelectorAll(sel).forEach((b) => (b.onclick = fn));
    const send = () => { const t = el.querySelector("#st-input"); const v = t.value.trim(); if (!v) return t.focus(); stageTurn(st, { message: v }); };
    on("[data-st-send]", send);
    const input = el.querySelector("#st-input");
    if (input) input.onkeydown = (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); };
    on("[data-st-chip]", (e) => {
      const c = e.currentTarget.dataset.stChip;
      if (c === "Done") return stageTurn(st, { message: "Done." });
      const t = el.querySelector("#st-input"); t.value = c === "I got an error" ? "I got this error: " : "My screen looks different: "; t.focus();
    });
    on("[data-st-shot]", () => {
      const f = document.createElement("input");
      f.type = "file"; f.accept = "image/*";
      f.onchange = async () => { if (!f.files[0]) return; try { stageTurn(st, { message: el.querySelector("#st-input")?.value.trim() || "", image: await readImage(f.files[0]) }); } catch (e) { alert(e.message); } };
      f.click();
    });
    on("[data-st-retry]", () => { const S = stState(st.id); S.chat.pop(); const u = S.chat.at(-1)?.role === "user" ? S.chat.pop() : null; stageTurn(st, { message: u?.text || "" }); });
    on("[data-copy-st-prompt]", async (e) => { const pre = el.querySelector(`[data-prompt="${e.currentTarget.dataset.copyStPrompt}"]`); await navigator.clipboard.writeText(pre.textContent).catch(() => {}); e.currentTarget.textContent = "Copied"; });
    on("[data-notyet]", () => { const t = el.querySelector("#st-input"); t.value = "Not yet: "; t.focus(); });
    on("[data-stage-done]", () => {
      const S = stState(st.id), r = S.chat.at(-1).r;
      S.status = "done";
      if (r.handoff) plan.handoffs.push(`${st.title}: ${r.handoff}`);
      savePlan(rec, plan);
      const nx = nextStage();
      if (nx) openStage(nx.id); else renderFinished();
    });
    on("[data-goback]", (e) => {
      const id = e.currentTarget.dataset.goback, reason = e.currentTarget.dataset.reason;
      const back = STAGES.find((x) => x.id === id);
      stState(id).status = "open";
      savePlan(rec, plan);
      cur = id; render();
      stageTurn(back, { message: `I came back from "${st.title}": ${reason}`, backFrom: reason });
    });
    // Paste or drop a screenshot straight into the stage chat.
    window.onpaste = (e) => {
      if (!document.body.classList.contains("focus") || cur !== st.id) return;
      const file = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
      if (file) { e.preventDefault(); readImage(file).then((image) => stageTurn(st, { message: el.querySelector("#st-input")?.value.trim() || "", image })).catch((err) => alert(err.message)); }
    };
    if (!stState(st.id).chat.length && !stageBusy[st.id] && stState(st.id).status !== "done") stageTurn(st);
  };

  const render = () => {
    const s = plan.steps[i];
    const doneCount = plan.steps.filter((t) => plan.done[t.uid]).length;
    const isDone = plan.done[s.uid];
    el.innerHTML = `
    <div class="walk">
      <div class="walk-top">
        <button class="secondary" data-exit>← Back to guide</button>
        <span class="muted small">${esc(rec.guide.app)} · ${useStages ? `${STAGES.filter((x) => plan.stages[x.id]?.status === "done").length} of ${STAGES.length} stages done` : `${doneCount} of ${plan.steps.length} done`}</span>
      </div>
      <div class="walk-grid">
      <ol class="plan-list" aria-label="Your plan">${(useStages ? plan.steps.filter(inPre) : plan.steps).map((t, k) => `${inPre(t) && k === 0 ? `<li class="plan-group">Prerequisites</li>` : ""}${!inPre(t) && k > 0 && inPre(plan.steps[k - 1]) ? `<li class="plan-group">Setup${prereqsOpen(plan) ? " (locked)" : ""}</li>` : ""}<li><button class="plan-item ${k === i ? "current" : ""} ${plan.done[t.uid] ? "done" : ""} ${t.external ? "external" : ""} ${t.fix ? "fixitem" : ""} ${isLocked(plan, t) ? "locked" : ""}" data-go="${k}" ${isLocked(plan, t) ? `disabled title="Confirm the prerequisites first"` : ""}><span class="plan-num">${plan.done[t.uid] ? "✓" : isLocked(plan, t) ? icon("lock") : k + 1}</span><span class="plan-title">${esc(t.title)}${t.fix ? `<span class="plan-tag">added fix</span>` : ""}${deepable(t) && !plan.done[t.uid] && !isLocked(plan, t) ? `<span class="plan-sub">${t.owner === "agent" ? "Your agent" : "You"} · ${writing[t.uid] ? "being written…" : plan.details[t.uid] ? "written for you" : "written when you get here"}</span>` : ""}</span></button></li>`).join("")}${useStages ? stageListHtml() : ""}</ol>
      <div class="walk-main">

      ${cur ? renderStage() : inPre(s) ? renderGetReady() : deepCard(s) || `<div class="walk-card ${s.external ? "external" : ""} ${s.fix ? "fix" : ""}">
        ${stepErr[s.uid] ? `<div class="sx-diff"><strong>Couldn't write the detailed version of this step</strong> (${esc(stepErr[s.uid])}). Here's the short version. <button type="button" class="linkbtn" data-retry-step>Try again</button></div>` : ""}
        <div class="walk-kicker">
          <span class="road-icon">${icon(s.kind)}</span>
          ${isPrereq(s) ? `<span>Prerequisite ${s.prereq + 1} of ${plan.steps.filter(isPrereq).length}</span>` : `<span>Step ${i + 1} of ${plan.steps.length}</span>
          <span class="road-time">${esc(s.time || fmtRange(s.min, s.max))}</span>`}
          ${s.fix ? `<span class="pill fix">Fix for: ${esc(s.fix)}</span>` : ""}
          <span class="who ${isPrereq(s) ? "you" : s.external ? "wait" : s.owner === "agent" ? "agent" : "you"}">${isPrereq(s) ? "YOU CONFIRM" : s.external ? `WAITING ON ${esc((s.waiting_on || "THE PROVIDER").toUpperCase())}` : s.owner === "agent" ? "YOUR AGENT DOES THIS" : "YOU DO THIS"}</span>
          ${badge(s.evidence)}
        </div>
        <h2>${isPrereq(s) ? `Do you have this? ${explain(s.title, rec.guide)}` : esc(s.title)}</h2>
        ${isPrereq(s) ? `<div class="prereq-note">${icon("lock")}<div>${plan.done[s.uid] ? "Confirmed." : `Setup unlocks once you confirm ${prereqsOpen(plan) === 1 ? "this one" : `these ${prereqsOpen(plan)}`}.`} Don't have it? Press <strong>I'm stuck</strong> and we'll find how to get it${s.blocks_route ? "" : ", or a way around it"}.</div></div>` : ""}
        ${s.external ? `<div class="wait-note">${icon("wait")}<div><strong>You're waiting on ${esc(s.waiting_on || "the provider")}.</strong> Come back when you hear from them.</div></div>` : ""}
        ${(s.actions || []).length ? `<ol class="todo">${s.actions.map((a) => `<li>${explainMd(a, rec.guide)}</li>`).join("")}</ol>` : `<p class="walk-detail">${explain(s.detail, rec.guide)}</p>`}
        ${safeUrl(s.url) ? `<div class="copybox"><span>Open the page for this step${s.link_status === "ok" ? ` <span class="link-ok">✓ link tested</span>` : ""}</span>${link(s.url, "Open")}</div>` : ""}
        ${agentBox(rec.guide, s)}
        ${(s.actions || []).length ? stepContext(rec.guide, s, i, "watch") : stepContext(rec.guide, s, i)}
        ${s.done_when ? `<p class="done-when"><strong>Done when:</strong> ${explain(s.done_when, rec.guide)}</p>` : ""}
        ${(s.actions || []).length && (s.detail || stepContext(rec.guide, s, i, "background")) ? `<details class="more"><summary>Why this step?</summary>${s.detail ? `<p class="walk-detail">${explain(s.detail, rec.guide)}</p>` : ""}${stepContext(rec.guide, s, i, "background")}</details>` : ""}
                <div class="walk-who">${isPrereq(s) ? "<strong>You</strong> confirm this one." : s.external ? "The provider or an admin does this." : s.owner === "agent" ? "<strong>Your agent</strong> can do this. Copy the prompt into Cursor, Claude Code or similar, then check the result." : "<strong>You</strong> do this one. It needs your login or a decision."}</div>
        ${s.external ? "" : `<div class="seebar"><span>Not sure what to do on the screen in front of you?</span><button type="button" class="secondary" data-screen>📷 Show me your screen</button></div><p class="small muted" style="margin:6px 0 0">Or paste a screenshot with ⌘V, or drop it here.</p>`}
      </div>`}

      ${cur || (inPre(s) && !s.fix && plan.have[s.uid] === "need" && !plan.done[s.uid]) ? "" : chatOpen ? renderChat(s) : ""}

      ${cur || inPre(s) || writing[s.uid] ? "" : `<div class="walk-actions">
        <button class="secondary" data-prev ${i === 0 ? "disabled" : ""}>Previous</button>
        <button class="secondary stuck-btn" data-stuck>${icon("scopes")} I'm stuck</button>
        ${deepable(s) && plan.details[s.uid] ? "" : `<button data-done>${isDone ? "Next step" : isPrereq(s) ? "Yes, I have this" : s.external ? "Approved, continue" : "Mark done & continue"}</button>`}
      </div>`}
      ${!cur && plan.notes.length ? `<div class="notes card"><h4>Blockers you've hit</h4><ul>${plan.notes.map((n) => `<li><strong>${esc(n.step)}:</strong> ${esc(n.problem)}<br><span class="muted small">${esc(n.diagnosis)}</span></li>`).join("")}</ul></div>` : ""}
      </div>
      </div>
    </div>`;

    const on = (sel, fn) => el.querySelectorAll(sel).forEach((b) => (b.onclick = fn));
    on("[data-exit]", () => showGuide(rec.id));
    on("[data-copy-prompt]", async (e) => {
      await navigator.clipboard.writeText(el.querySelector(".agent-prompt").textContent).catch(() => {});
      e.currentTarget.textContent = "Copied";
    });
    on("[data-prev]", () => { i--; chatOpen = false; differOpen = false; render(); });
    on("[data-go]", (e) => {
      const k = Number(e.currentTarget.dataset.go);
      if (isLocked(plan, plan.steps[k])) return;
      i = k; cur = null; chatOpen = false; differOpen = false; render();
    });
    on("[data-stuck]", () => { chatOpen = !chatOpen; render(); scrollChat(); el.querySelector("#problem")?.focus(); });
    on("[data-dismiss]", () => { chatOpen = false; render(); });
    on("[data-chip]", (e) => {
      const c = e.currentTarget.dataset.chip;
      if (c === "That worked") { chatOpen = false; return render(); }
      if (c === "Still stuck") return el.querySelector("#problem").focus();
      if (c === "Explain that more simply") return sendChat(c);
      const t = el.querySelector("#problem"); t.value = c; t.focus();
    });
    const ask = () => { const t = el.querySelector("#problem"); const v = t.value.trim(); if (!v) return t.focus(); sendChat(v); };
    on("[data-ask]", ask);
    const box = el.querySelector("#problem");
    if (box) box.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } };
    on("[data-chat-shot]", pickScreen);
    on("[data-apply]", (e) => {
      const m = msgsFor(s)[+e.currentTarget.dataset.apply];
      const help = m.help;
      const label = plan.notes.at(-1)?.problem || "blocker";
      const fixes = normaliseSteps({ steps: help.fix_steps }).map((f, k) => ({ ...f, uid: `f${Date.now()}${k}`, orig: s.orig, fix: label, forPrereq: inPre(s), forUid: isPrereq(s) ? s.uid : s.forUid }));
      // retry: redo the current step after the fix, so un-mark it.
      if (help.plan_change === "retry") delete plan.done[s.uid];
      m.applied = true;
      // The conversation stays with the step it was about, which moves down one place per fix.
      plan.steps.splice(i, 0, ...fixes);
      savePlan(rec, plan);
      chatOpen = false;
      render();
    });
    // Get ready
    const go = (k) => { i = k; chatOpen = false; };
    on("[data-have]", (e) => { const t = plan.steps[+e.currentTarget.dataset.have]; plan.done[t.uid] = true; plan.have[t.uid] = "have"; savePlan(rec, plan); nextPre(); });
    on("[data-need]", (e) => { const k = +e.currentTarget.dataset.need; plan.have[plan.steps[k].uid] = "need"; savePlan(rec, plan); go(k); render(); el.querySelector(`#pq-${k}`)?.scrollIntoView({ block: "nearest" }); });
    on("[data-gotit]", (e) => { const t = plan.steps[+e.currentTarget.dataset.gotit]; plan.done[t.uid] = true; savePlan(rec, plan); nextPre(); });
    on("[data-fixdone]", (e) => { const t = plan.steps[+e.currentTarget.dataset.fixdone]; plan.done[t.uid] = true; savePlan(rec, plan); render(); });
    on("[data-pq-undo]", (e) => { e.preventDefault(); const k = +e.currentTarget.dataset.pqUndo; delete plan.done[plan.steps[k].uid]; savePlan(rec, plan); go(k); render(); });
    on("[data-pq-stuck]", (e) => { go(+e.currentTarget.dataset.pqStuck); chatOpen = true; render(); scrollChat(); el.querySelector("#problem")?.focus(); });
    on("[data-pq-screen]", (e) => { go(+e.currentTarget.dataset.pqScreen); pickScreen(); });
    on("[data-continue]", () => { if (useStages) { const nx = nextStage(); if (nx) return openStage(nx.id); return renderFinished(); } const k = plan.steps.findIndex((t) => !inPre(t) && !plan.done[t.uid]); go(k >= 0 ? k : plan.steps.length - 1); render(); });
    on("[data-stage]", (e) => { if (prereqsOpen(plan)) return; openStage(e.currentTarget.dataset.stage); });
    el.querySelectorAll("[data-needchk]").forEach((c) => (c.onchange = () => { plan.needs[c.dataset.needchk] = c.checked; savePlan(rec, plan); }));
    // Show me your screen
    on("[data-screen]", pickScreen);
    const card = el.querySelector(".walk-main");
    if (card) {
      card.ondragover = (e) => { e.preventDefault(); card.classList.add("dropping"); };
      card.ondragleave = () => card.classList.remove("dropping");
      card.ondrop = (e) => { e.preventDefault(); card.classList.remove("dropping"); const f = e.dataTransfer.files[0]; if (f) sendScreen(f); };
    }

    on("[data-differs]", () => { differOpen = true; render(); el.querySelector("#seen")?.focus(); el.querySelector(".sx-differ")?.scrollIntoView({ block: "nearest" }); });
    on("[data-differ-cancel]", () => { differOpen = false; render(); });
    on("[data-rewrite]", () => { const v = el.querySelector("#seen").value.trim(); if (!v) return el.querySelector("#seen").focus(); writeStep(s, { seen: v }); });
    on("[data-differ-shot]", () => {
      const f = document.createElement("input");
      f.type = "file"; f.accept = "image/*";
      f.onchange = async () => {
        if (!f.files[0]) return;
        try { writeStep(s, { image: await readImage(f.files[0]), seen: el.querySelector("#seen")?.value.trim() || "" }); }
        catch (e) { alert(e.message); }
      };
      f.click();
    });
    on("[data-retry-step]", () => writeStep(s));
    on("[data-copyval]", async (e) => { await navigator.clipboard.writeText(e.currentTarget.dataset.copyval).catch(() => {}); e.currentTarget.textContent = "Copied"; });
    on("[data-done]", () => {
      plan.done[s.uid] = true;
      differOpen = false;
      savePlan(rec, plan);
      chatOpen = false;
      const next = plan.steps.findIndex((t, k) => k > i && !plan.done[t.uid] && !isLocked(plan, t));
      if (next >= 0) { i = next; render(); }
      else if (plan.steps.every((t) => plan.done[t.uid])) renderFinished();
      else { i = Math.min(i + 1, plan.steps.length - 1); render(); }
    });
    if (cur) { bindStage(); return; }
    window.scrollTo(0, 0);
    if (deepable(s) && !plan.details[s.uid] && !writing[s.uid] && !stepErr[s.uid] && !plan.done[s.uid] && !isLocked(plan, s)) writeStep(s);
  };

  const renderFinished = () => {
    const fixes = plan.steps.filter((t) => t.fix).length;
    el.innerHTML = `<div class="walk"><div class="walk-card finished"><h2>All ${plan.steps.length} steps done</h2><p>Your agent is now connected to your ${esc(rec.guide.app)} account.${fixes ? ` You worked through ${plan.notes.length} blocker${plan.notes.length === 1 ? "" : "s"} along the way.` : ""}</p>${(rec.guide.open_questions || []).length ? `<div class="ctx" style="text-align:left"><span class="label">Still worth confirming</span>${list(rec.guide.open_questions)}</div>` : ""}<div class="walk-actions"><button class="secondary" data-reset>Start over</button><button data-exit>Back to guide</button></div></div></div>`;
    el.querySelector("[data-exit]").onclick = () => showGuide(rec.id);
    el.querySelector("[data-reset]").onclick = () => { try { localStorage.removeItem(`plan:${rec.id}`); } catch {} startWalkthrough(rec, 0); };
  };

  if (useStages && !prereqsOpen(plan) && !plan.steps.some((t) => inPre(t) && t.fix && !plan.done[t.uid])) { const nx = nextStage(); if (nx) cur = nx.id; }
  render();
}

const ROUTE_LABEL = { composio_managed: "Composio managed sign-in", own_oauth_app: "Your own OAuth app", api_key: "API key", alternative_app: "A different app", not_possible: "Not possible for this job" };

// The first answer on the page: which route, why, and what it takes in time and money.
// The four facts a developer needs first: how hard, their time, the wait, and what's most likely to block them.
function renderStrip(rec) {
  const g = rec.guide, v = g.verdict || {}, r = g.route || {};
  const d = diffKey(v.difficulty);
  const rank = { high: 0, medium: 1, low: 2 };
  const top = (g.blockers || []).filter((b) => b.blocker).sort((a, b) => (rank[a.impact] ?? 3) - (rank[b.impact] ?? 3))[0];
  return `
  <div class="strip diff-${esc(d)}">
    <div><span class="k">Difficulty</span><span class="v d-${esc(d)}">${esc(DIFF_LABEL[d] || "Unknown")}</span></div>
    <div><span class="k">Your time</span><span class="v">${esc(r.hands_on_time || v.hands_on_time || "unknown")}</span></div>
    <div><span class="k">Waiting on ${esc(g.app)}</span><span class="v">${esc(r.wait || v.approval_wait || "unknown")}</span></div>
    <div><span class="k">Biggest blocker</span><span class="v sm">${top ? explain(top.blocker, g) : "None found"}</span></div>
  </div>
  ${v.difficulty_reason ? `<p class="small muted strip-why">Why ${esc((DIFF_LABEL[d] || "").toLowerCase() || "this rating")}: ${explain(v.difficulty_reason, g)}${rec.library?.tested ? ` · <a href="/evidence#${esc(rec.id)}">What we tested</a>` : ""}</p>` : ""}`;
}

function renderRouteCard(g) {
  const r = g.route;
  const recPath = (g.paths || []).find((p) => p.recommended);
  if (!r && !recPath) return "";
  const v = g.verdict || {};
  const costs = (g.costs || []).filter((x) => x.item);
  const answers = Object.entries(g.fit?.answers || {}).map(([id, val]) => {
    const q = (g.fit.decisions || g.fit.questions || []).find((x) => x.id === id);
    return q ? `${esc(q.title || q.question)} <strong>${esc((q.options || []).find((o) => o.value === val)?.label || val)}</strong>` : "";
  }).filter(Boolean);
  return `
  <section class="route card">
    <span class="label">Your route</span>
    <h2>${esc(r?.name || recPath.name)} ${r?.choice ? `<span class="pill agent">${r.choice === "composio_managed" ? CMP + " " : ""}${esc(ROUTE_LABEL[r.choice] || r.choice)}</span>` : ""}</h2>
    <p>${explain(r?.reason || recPath.when_to_choose, g)}</p>
    <div class="route-facts">
      <div><span class="label">Cost</span><strong>${esc(r?.cost || "see below")}</strong></div>
    </div>
    ${costs.length ? `<details class="costs"><summary>Every cost on this route (${costs.length})</summary><table><thead><tr><th>Cost</th><th>Amount</th><th>When</th><th>Required</th><th></th></tr></thead><tbody>${costs.map((x) => `<tr><td>${explain(x.item, g)}</td><td><strong>${esc(x.amount || "unknown")}</strong></td><td class="small">${esc(x.when || "")}</td><td class="small">${esc(x.required || "")}</td><td>${badge(x.evidence)}</td></tr>`).join("")}</tbody></table></details>` : ""}
    ${answers.length ? `<p class="small muted">Based on your decisions: ${answers.join(" · ")}</p>` : ""}
  </section>`;
}

// A version of the guide for a coding agent: it does the agent steps and stops at the human ones.
function toAgentMarkdown(rec) {
  const g = rec.guide;
  const steps = loadPlan(rec).steps;
  const L = [];
  L.push(`# Task: connect ${g.app} to my agent`, "", `Goal: ${g.job}`, "");
  if (g.route) L.push(`Route: ${g.route.name}. ${g.route.reason || ""}`, "");
  L.push("## How to work through this", "- Do the steps marked [AGENT] yourself.", "- Start with the [CHECK] steps: ask me to confirm each prerequisite. If I don't have one, help me get it before going further.", "- At each step marked [YOU] or [WAIT], stop, tell me exactly what to do (with the link), and wait until I confirm it's done.", "- Never ask me to paste a client secret into chat. Tell me where to put it (for example an .env file or the Composio dashboard).", "- If something fails, show me the exact error before trying a fix.", "");
  L.push("## Steps");
  steps.forEach((s, i) => {
    const tag = isPrereq(s) ? "CHECK" : s.external ? "WAIT" : s.owner === "agent" ? "AGENT" : "YOU";
    L.push(`${i + 1}. [${tag}] **${s.title}**: ${s.detail}${safeUrl(s.url) ? ` (${s.url})` : ""}`);
    if (tag === "AGENT") L.push(`   - Instruction: ${s.agent_prompt || `${s.title}. ${s.detail}`}`);
    if (s.done_when) L.push(`   - Done when: ${s.done_when}`);
  });
  const scopes = (g.scopes || []).filter((x) => x.scope);
  if (scopes.length) L.push("", "## Scopes to request (no more than these)", ...scopes.map((x) => `- \`${x.scope}\`: ${x.why}`));
  L.push("", `_Researched by an agent on ${new Date(rec.created_at).toDateString()}, not tested against a live account. Claims are labelled in the full guide: ${location.origin}/g/${rec.id}_`);
  return L.join("\n");
}

function renderGuide(rec) {
  const g = rec.guide;
  const v = g.verdict || {};
  const c = g.composio || {};
  const ap = g.approval || {};
  const lc = g.link_check;
  const recPath = (g.paths || []).find((p) => p.recommended);
  const link = (u, label) => (safeUrl(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(label || u)}</a>` : "");

  // The first screen answers three questions only: how hard, do I need my own OAuth app, what's the path.
  // Everything else is shown inside the walkthrough at the step where it matters.
  return `
  <div class="guide-head">
    <div>
      <h1>${esc(g.app)}</h1>
      <p class="job"><strong>Job${g.job_assumed ? " (assumed)" : ""}:</strong> ${esc(g.job)}</p>
    </div>
    <div class="actions">
      <button id="copy-agent" class="secondary" title="A version of this guide written for Cursor, Claude Code or another coding agent">Copy for my agent</button>
      <button id="copy-link" class="secondary">Copy share link</button>
      <button id="download-md" class="secondary">Download Markdown</button>
    </div>
  </div>

  ${renderStrip(rec)}

  ${renderRouteCard(g)}

  ${renderRoadmap(rec)}

  <details class="research">
    <summary>About ${esc(g.app)}: difficulty, Composio and research notes</summary>
  <div class="headline">
    <div class="stat big difficulty-card diff-${esc((v.difficulty || "unknown").split(/[ |]/)[0].toLowerCase())}">
      <span class="label">Difficulty</span>
      <span class="value">${esc(v.difficulty || "unknown")}</span>
      <span class="small">${explain(v.difficulty_reason, g)}</span>
    </div>
    <div class="stat big managed-card managed-${esc((c.managed_oauth || "unknown").toLowerCase())}">
      <span class="label">Composio</span>
      <span class="value">${String(c.toolkit_available || "").toLowerCase() === "no" ? "No toolkit yet" : c.managed_oauth === "yes" ? "Managed sign-in available" : c.managed_oauth === "no" ? "Toolkit needs your own OAuth app" : "Unconfirmed"}</span>
      <span class="small">${explain(c.note || "", g)}</span>
      ${badge(c.api_checked ? "verified with Composio API" : c.evidence)}
      ${String(c.toolkit_available || "").toLowerCase() === "no" ? `<button type="button" class="secondary" data-request-toolkit>Request a ${esc(g.app)} toolkit</button><span class="small muted" id="req-note"></span>` : ""}
    </div>
  </div>

    ${(g.friction_checks || []).length ? `<h3>Friction checks, stage by stage</h3><p class="small muted">Every guide answers the same checks for the moments builders usually get stuck.</p><table><tbody>${g.friction_checks.map((f) => `<tr><td class="small muted">${esc(f.stage)}</td><td><strong>${esc(f.check)}</strong><br><span class="small">${explain(f.answer || "", g)}</span>${f.handled_in ? `<br><span class="small muted">Handled in: ${esc(f.handled_in)}</span>` : ""}</td><td>${badge(f.evidence)}</td></tr>`).join("")}</tbody></table>` : ""}
    <h3>Integration paths</h3>
    <ul>${(g.paths || []).map((p) => `<li><strong>${esc(p.name)}</strong>${p.recommended ? " (recommended)" : ""}: ${esc(p.when_to_choose)} <span class="muted">Trade-offs: ${esc(p.tradeoffs)}</span></li>`).join("")}</ul>
    <h3>Blockers</h3>
    <ul>${(g.blockers || []).map((b) => `<li>${badge(b.impact, "impact")} <strong>${esc(b.blocker)}</strong>: ${esc(b.mitigation)} ${badge(b.evidence)}</li>`).join("") || "<li class='muted'>None found.</li>"}</ul>
    <h3>Approval ${badge(ap.evidence)}</h3>
    <p>Required: ${esc(ap.required || "unknown")}. Wait: ${esc(ap.wait || "unknown")}. ${esc(ap.process)}</p>
    ${(g.alternatives || []).length ? `<h3>Alternatives</h3>${list(g.alternatives)}` : ""}
    <h3>Open questions</h3>${list(g.open_questions)}
    <h3>Sources</h3>
    <ul class="sources">${(g.sources || []).map((s) => `<li>${link(s.url, s.title || s.url)} <span class="muted small">${esc(s.used_for)}</span></li>`).join("")}</ul>
    ${(g.searched_urls || []).length ? `<p class="muted small">The agent also saw ${g.searched_urls.length} other pages while researching.</p>` : ""}
  </details>

  <p class="muted small footer">${lc ? `Links tested before publishing: ${lc.ok} working${lc.fixed ? `, ${lc.fixed} replaced` : ""}${lc.removed ? `, ${lc.removed} dead link${lc.removed === 1 ? "" : "s"} removed` : ""}${lc.unverified ? `, ${lc.unverified} behind a login or bot check` : ""}. ` : `Links in this guide were not tested yet. <button class="linkbtn" data-check-links>Test links now</button> `}Generated ${new Date(rec.created_at).toLocaleString()} by ${esc(rec.model)}${rec.model === "demo" ? " (canned demo data)" : " from live web research"}. ${rec.library ? `Approval claims checked by hand: <a href="/evidence#${esc(rec.id)}">What we tested</a>.` : "Nothing here was tested against a live account."}</p>`;
}

function toMarkdown(rec) {
  const g = rec.guide, v = g.verdict || {}, ap = g.approval || {};
  const L = [];
  L.push(`# ${g.app}: OAuth readiness guide`, "", `**Job${g.job_assumed ? " (assumed)" : ""}:** ${g.job}`, "", g.summary, "");
  L.push(`| Difficulty | Hands-on time | Approval wait | Composio managed OAuth |`, `|---|---|---|---|`, `| ${v.difficulty} | ${v.hands_on_time} | ${v.approval_wait} | ${g.composio?.managed_oauth ?? "unknown"} |`, "");
  if (g.route) L.push(`**Route:** ${g.route.name}. ${g.route.reason || ""} Your time: ${g.route.hands_on_time || "?"}. Waiting: ${g.route.wait || "?"}. Cost: ${g.route.cost || "?"}.`, "");
  if ((g.costs || []).length) L.push("## Costs", ...g.costs.map((x) => `- ${x.item}: **${x.amount}** (${x.when || ""}; required: ${x.required || "?"}; ${x.evidence})`), "");
  L.push(`**Do this next:** ${g.next_action}`, "", "## Integration paths");
  (g.paths || []).forEach((p) => L.push(`- **${p.name}**${p.recommended ? " (recommended)" : ""}: ${p.when_to_choose} Trade-offs: ${p.tradeoffs}`));
  L.push("", "## Blockers");
  (g.blockers || []).forEach((b) => L.push(`- **${b.blocker}** (${b.impact}, ${b.evidence}): ${b.mitigation}`));
  L.push("", "## Prerequisites");
  (g.prerequisites || []).forEach((p) => L.push(`- [ ] ${p.item} _(${p.evidence})_${p.how_to_get ? ` If you don't have it: ${p.how_to_get}` : ""}`));
  L.push("", "## Steps");
  (g.steps || []).forEach((s, i) => {
    L.push(`${i + 1}. **${s.title}** _(${s.owner === "agent" ? "your agent" : s.owner}, ${s.evidence}${s.time ? ", " + s.time : ""})_: ${s.detail}${s.url ? ` [link](${s.url})` : ""}`);
    if (s.owner === "agent" && s.agent_prompt) L.push(`   - Prompt for your agent: ${s.agent_prompt}`);
  });
  L.push("", `## Approval (${ap.evidence})`, `Required: ${ap.required}. Wait: ${ap.wait}.`, "", ap.process || "");
  L.push("", "## Open questions");
  (g.open_questions || []).forEach((q) => L.push(`- ${q}`));
  L.push("", "## Sources");
  (g.sources || []).forEach((s) => L.push(`- [${s.title}](${s.url}): ${s.used_for}`));
  L.push("", `_Generated ${rec.created_at} by ${rec.model}. Researched, not tested against a live account._`);
  return L.join("\n");
}

route();
