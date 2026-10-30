// The model behind the chat: Gemini with tool calling, over plain fetch.
// The Gemini key is read from the parent folder's .env (the one already set up), unless this folder's .env sets one.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname);

function fromParentEnv(name) {
  try {
    const line = fs.readFileSync(path.join(ROOT, "..", ".env"), "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : undefined;
  } catch { return undefined; }
}

const KEY = process.env.GEMINI_API_KEY || fromParentEnv("GEMINI_API_KEY");
const MODELS = (process.env.AGENT_MODELS || "gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite").split(",").map((m) => m.trim()).filter(Boolean);
export let currentModel = MODELS[0];
export const modelReady = !!KEY;

async function generate(body) {
  let last;
  for (const m of [currentModel, ...MODELS.filter((x) => x !== currentModel)]) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": KEY }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.candidates?.[0]?.content) { currentModel = m; return data.candidates[0].content; }
    last = data.error?.message || `HTTP ${res.status}`;
  }
  throw new Error(`The model didn't answer: ${last}`);
}

// Runs one user turn. history is Gemini "contents" kept per chat session; onTool(line) reports each tool call.
export async function chatTurn(history, text, { system, tools, onTool }) {
  if (!KEY) throw new Error("No GEMINI_API_KEY found in .env or ../.env");
  history.push({ role: "user", parts: [{ text }] });
  const decls = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  for (let i = 0; i < 6; i++) {
    const content = await generate({ systemInstruction: { parts: [{ text: system }] }, contents: history, ...(decls.length ? { tools: [{ functionDeclarations: decls }] } : {}) });
    history.push({ role: "model", parts: content.parts || [] });
    const calls = (content.parts || []).filter((p) => p.functionCall);
    if (!calls.length) return (content.parts || []).map((p) => p.text || "").join("").trim() || "(no answer)";
    const results = [];
    for (const { functionCall: c } of calls) {
      const t = tools.find((x) => x.name === c.name);
      let response;
      try { response = { result: await t.run(c.args || {}) }; onTool(t.summary ? t.summary(c.args || {}) : `Used ${c.name}`); }
      catch (err) { response = { error: err.message }; onTool(`${t?.summary ? t.summary(c.args || {}) : c.name}: failed (${err.message})`); }
      results.push({ functionResponse: { name: c.name, id: c.id, response } });
    }
    history.push({ role: "user", parts: results });
  }
  return "I stopped after several tool calls without a final answer. Try asking more specifically.";
}
