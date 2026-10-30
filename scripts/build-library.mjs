// Builds the ready-made library: runs the same fit check and guide research a developer gets in the UI,
// for each app below, then copies each new guide into library/. It starts its own copy of the server
// (with your .env) unless GUIDE_URL points at one already running. Usage: npm run library  (all apps)
//                             npm run library -- Gmail   (one app)
// Each app costs one fit check and one guide, about 1-3 minutes and a few cents of your model credits.
import fs from "node:fs/promises";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let BASE = process.env.GUIDE_URL || "";

// Each app shows a different setup challenge. All are for "my users" (a launch) on the developer's own OAuth app,
// so the approval path is in the guide; Composio's managed route is still listed under the guide's paths.
const APPS = [
  { app: "GitHub", job: "Open an issue in the user's repository when they report a bug to the agent", challenge: "Self-serve OAuth app with no review." },
  { app: "Notion", job: "Read and update pages in the user's Notion workspace", challenge: "Public connection, page picker at sign-in, keys sent with HTTP Basic." },
  { app: "HubSpot", job: "Add new leads from the user's inbox as HubSpot contacts", challenge: "Developer account and test accounts; marketplace listing only to be listed publicly." },
  { app: "Slack", job: "Post a weekly summary to a channel in the user's Slack workspace", challenge: "Distributing to other workspaces; admins can restrict apps." },
  { app: "Xero", job: "Create draft invoices in the user's Xero organisation", challenge: "Connection cap until the app is certified." },
  { app: "Gmail", job: "Read the user's new emails and draft replies for them to approve", challenge: "Restricted scopes: Google verification and a security assessment." },
];

// Plain node:http with no timeouts: a guide can research for several minutes between events.
function post(url, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(BASE + url, { method: "POST", headers: { "content-type": "application/json" } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
      res.on("end", () => (res.statusCode === 200 ? resolve(text) : reject(new Error(`${url}: ${res.statusCode} ${text.slice(0, 200)}`))));
    });
    req.on("error", (err) => reject(new Error(`${url}: ${err.code || err.message} (is the guide server running at ${BASE}?)`)));
    req.end(JSON.stringify(body));
  });
}

async function up() {
  return new Promise((resolve) => http.get(BASE + "/api/guides", (res) => { res.resume(); resolve(res.statusCode === 200); }).on("error", () => resolve(false)));
}

let child = null;
if (!BASE) {
  const port = 3000 + Math.floor(Math.random() * 900) + 100;
  BASE = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["--env-file-if-exists=.env", "server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "inherit", "inherit"] });
  for (let k = 0; k < 40 && !(await up()); k++) await new Promise((r) => setTimeout(r, 250));
}
if (!(await up())) {
  console.error(`Can't reach the guide server at ${BASE}.`);
  child?.kill();
  process.exit(1);
}

async function sse(url, body, onEvent) {
  const text = await post(url, body);
  let out = null;
  for (const block of text.split("\n\n")) {
    const ev = block.match(/^event: (.+)$/m)?.[1];
    const data = block.match(/^data: (.+)$/m)?.[1];
    if (!ev || !data) continue;
    const d = JSON.parse(data);
    if (ev === "error") throw new Error(d.message);
    if (ev === "done") out = d;
    else onEvent?.(ev, d);
  }
  if (!out) throw new Error(`${url}: no result`);
  return out;
}

const only = process.argv.slice(2).map((x) => x.toLowerCase());
await fs.mkdir(path.join(ROOT, "library"), { recursive: true });
for (const [order, a] of APPS.entries()) {
  if (only.length && !only.includes(a.app.toLowerCase())) continue;
  const t0 = Date.now();
  try {
    console.log(`\n${a.app}: fit check…`);
    const brief = await sse("/api/fit", { app: a.app, job: a.job });
    const answers = {};
    for (const d of brief.decisions || []) {
      if (d.show_if && !Object.entries(d.show_if).every(([k, v]) => answers[k] === v)) continue;
      const pick = d.id === "users" ? "my_users" : d.id === "connect_via" && d.options.some((o) => o.value === "direct") ? "direct" : (d.options.find((o) => o.recommended) || d.options[0]).value;
      answers[d.id] = pick;
    }
    const route = brief.decisions?.find((d) => d.id === "connect_via")?.options?.find((o) => o.value === answers.connect_via)?.label || null;
    console.log(`${a.app}: writing the guide (${Object.entries(answers).map(([k, v]) => `${k}=${v}`).join(", ")})…`);
    const { id } = await sse("/api/generate", { app: a.app, job: a.job, brief, answers, route }, (ev, d) => ev === "progress" && console.log(`  ${d.kind === "search" ? "search" : "note"}: ${d.text}`));
    const rec = JSON.parse(await fs.readFile(path.join(ROOT, "guides", `${id}.json`), "utf8"));
    console.log(`${a.app}: written by ${rec.model}`);
    const libId = `lib-${a.app.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    rec.id = libId;
    rec.library = { order, challenge: a.challenge, tested: "Sources checked", built_from: id };
    await fs.writeFile(path.join(ROOT, "library", `${libId}.json`), JSON.stringify(rec, null, 2));
    console.log(`${a.app}: saved library/${libId}.json in ${Math.round((Date.now() - t0) / 1000)}s (difficulty: ${rec.guide.verdict?.difficulty})`);
  } catch (err) {
    console.error(`${a.app}: FAILED: ${err.message}`);
  }
}
child?.kill();
