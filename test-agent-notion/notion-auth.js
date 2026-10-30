// Notion OAuth sign-in: build the authorize URL, exchange the code, keep the token in .tokens.json.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
export const TOKEN_FILE = path.join(ROOT, ".tokens.json");
export const PORT = Number(process.env.PORT) || 4200;
export const REDIRECT_URI = process.env.NOTION_REDIRECT_URI || `http://localhost:${PORT}/callback`;

export const newState = () => crypto.randomBytes(16).toString("hex");

export function authorizeUrl(state) {
  const q = new URLSearchParams({ client_id: process.env.NOTION_CLIENT_ID, response_type: "code", owner: "user", redirect_uri: REDIRECT_URI, state });
  // No scope: Notion's authorize URL doesn't take one. Access comes from the connection's capabilities and the pages picked at sign-in.
  return `https://api.notion.com/v1/oauth/authorize?${q}`;
}

export async function exchangeCode(code) {
  const basic = Buffer.from(`${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token exchange failed: ${data.error || res.status} ${data.error_description || ""}`.trim());
  const saved = { access_token: data.access_token, refresh_token: data.refresh_token, workspace_id: data.workspace_id, workspace_name: data.workspace_name, bot_id: data.bot_id, saved_at: new Date().toISOString() };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(saved, null, 2), { mode: 0o600 });
  token = saved;
  return saved;
}

// Loaded once on startup; replaced after a sign-in.
let token = loadToken();
export function loadToken() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8")); } catch { return null; }
}
export const getToken = () => token?.access_token || null;
