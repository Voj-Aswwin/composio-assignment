// What "connected" means for this agent. Read-only checks; the guide's stages make them pass.
import fs from "node:fs/promises";
import path from "node:path";
import tools from "./tools/index.js";

const ROOT = path.dirname(new URL(import.meta.url).pathname);

export async function githubStatus() {
  const token = await fs.readFile(path.join(ROOT, ".github-token.json"), "utf8").then(() => true).catch(() => false);
  const checks = [
    { item: "A create_github_issue tool exists (tools/index.js)", ok: tools.some((t) => t.app === "github" && t.name === "create_github_issue") },
    { item: "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are in .env", ok: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) },
    { item: "You signed in once (.github-token.json exists)", ok: token },
    { item: "GITHUB_REPO is set in .env", ok: !!process.env.GITHUB_REPO },
  ];
  return { connected: checks.every((c) => c.ok), checks };
}
