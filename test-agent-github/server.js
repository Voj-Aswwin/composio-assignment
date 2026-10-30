// Bug reporter test agent: report a bug, the agent opens a GitHub issue for it.
// No AI model needed: the point is to test the OAuth connection the guide sets up.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import tools from "./tools/index.js";
import { githubStatus } from "./connections.js";

const PORT = Number(process.env.PORT) || 4100;
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const log = []; // what the agent did, newest last

const say = (kind, text) => { log.push({ at: new Date().toISOString(), kind, text }); if (log.length > 200) log.shift(); };

async function handleBug({ title, body }) {
  say("received", `Bug reported: ${title}`);
  const status = await githubStatus();
  if (!status.connected) {
    const missing = status.checks.filter((c) => !c.ok).map((c) => c.item);
    say("blocked", `GitHub isn't connected yet. Missing: ${missing.join("; ")}`);
    return { ok: false, missing };
  }
  const tool = tools.find((t) => t.name === "create_github_issue");
  say("tool", `Calling create_github_issue on ${process.env.GITHUB_REPO}`);
  try {
    const out = await tool.run({ title, body });
    say("done", `Issue opened: ${out?.url || JSON.stringify(out)}`);
    return { ok: true, result: out };
  } catch (err) {
    say("error", `create_github_issue failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

const readBody = (req) => new Promise((resolve) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); } }); });
const json = (res, code, data) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    // OAuth routes go here (added in the guide's "Add sign-in to the agent" stage).

    if (req.method === "POST" && url.pathname === "/api/bug") {
      const { title, body } = await readBody(req);
      if (!title?.trim()) return json(res, 400, { error: "Give the bug a title" });
      return json(res, 200, await handleBug({ title: title.trim().slice(0, 200), body: String(body || "").slice(0, 4000) }));
    }
    if (url.pathname === "/api/status") return json(res, 200, { github: await githubStatus(), log });
    const html = await fs.readFile(path.join(ROOT, "public", "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`Bug reporter agent at http://localhost:${PORT}`));
