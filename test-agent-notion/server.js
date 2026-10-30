// Notion agent: chat in plain language, the agent reads or edits your Notion with its Notion tools.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import tools from "./tools/index.js";
import { notionConnected } from "./connections.js";
import { PORT, REDIRECT_URI, TOKEN_FILE, newState, authorizeUrl, exchangeCode, getToken } from "./notion-auth.js";
import { chatTurn, currentModel, modelReady } from "./llm.js";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const chats = new Map(); // chat session id -> { history (model format), messages (for the page) }

// Self-check: missing keys stop the agent; a missing token only means nobody has signed in yet.
const envOk = !!(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET);
console.log(`Self-check: NOTION_CLIENT_ID and NOTION_CLIENT_SECRET ${envOk ? "loaded" : "MISSING"} · token file ${getToken() ? "found" : "not found"} (${path.basename(TOKEN_FILE)})`);
if (!envOk) {
  console.error("Add NOTION_CLIENT_ID and NOTION_CLIENT_SECRET to .env (see .env.example), then start again.");
  process.exit(1);
}
console.log(`Redirect URI in use (must match Notion exactly): ${REDIRECT_URI}`);
if (!getToken()) console.log(`Not signed in yet: the chat works but can't reach Notion. Open http://localhost:${PORT}/login once.`);
console.log(`Chat model: ${modelReady ? currentModel : "none (no GEMINI_API_KEY in .env or ../.env)"}`);

const connected = () => notionConnected() && !!getToken();
const systemPrompt = () => `You are a Notion agent. You connect to the user's Notion to read and edit its contents: search pages, read a page, and update an existing page (rename it or add text at the end). You never create new pages; if asked to, say you can only edit existing pages.
${connected()
  ? "Notion is connected. You can only see the pages the user picked when signing in. Use the tools; search first to find a page's ID. Keep answers short and plain."
  : `Notion is NOT connected yet, so you have no Notion tools. If the user asks for anything in Notion, say you aren't connected to Notion yet and that they can sign in with the "Sign in to Notion" link (/login). You can still explain what you'll be able to do.`}`;

async function handleChat(id, text) {
  const chat = chats.get(id) || { history: [], messages: [] };
  chats.set(id, chat);
  chat.messages.push({ role: "user", text });
  const lines = [];
  try {
    const reply = await chatTurn(chat.history, text, { system: systemPrompt(), tools: connected() ? tools.filter((t) => t.app === "notion") : [], onTool: (l) => { lines.push(l); chat.messages.push({ role: "tool", text: l }); } });
    chat.messages.push({ role: "agent", text: reply });
  } catch (err) {
    chat.messages.push({ role: "error", text: err.message });
  }
  return chat.messages;
}

const readBody = (req) => new Promise((resolve) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); } }); });
const json = (res, code, data, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(data)); };
const cookie = (req, name) => (req.headers.cookie || "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.[1];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/login") {
      const state = newState();
      res.writeHead(302, { location: authorizeUrl(state), "set-cookie": `oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600` });
      return res.end();
    }
    if (url.pathname === "/callback") {
      const clear = "oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
      if (url.searchParams.get("error")) { console.log(`Notion sign-in: ${url.searchParams.get("error")}`); res.writeHead(302, { location: "/", "set-cookie": clear }); return res.end(); }
      const state = url.searchParams.get("state");
      if (!state || state !== cookie(req, "oauth_state")) return json(res, 400, { error: "Sign-in state didn't match. Start again at /login." });
      const t = await exchangeCode(url.searchParams.get("code"));
      console.log(`Signed in to Notion${t.workspace_name ? ` (${t.workspace_name})` : ""}`);
      res.writeHead(302, { location: "/", "set-cookie": clear });
      return res.end();
    }
    // One chat per browser, kept in memory until the agent restarts.
    let sid = cookie(req, "chat_id");
    const setSid = sid ? {} : { "set-cookie": `chat_id=${(sid = crypto.randomBytes(12).toString("hex"))}; HttpOnly; SameSite=Lax; Path=/` };
    if (req.method === "POST" && url.pathname === "/api/chat") {
      const { text } = await readBody(req);
      if (!text?.trim()) return json(res, 400, { error: "Type a message" }, setSid);
      return json(res, 200, { messages: await handleChat(sid, text.trim().slice(0, 4000)) }, setSid);
    }
    if (url.pathname === "/api/status") return json(res, 200, { notion: { connected: connected() }, model: modelReady ? currentModel : null, messages: chats.get(sid)?.messages || [] }, setSid);
    const html = await fs.readFile(path.join(ROOT, "public", "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...setSid });
    res.end(html);
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => console.log(`Notion agent at http://localhost:${PORT}`));
