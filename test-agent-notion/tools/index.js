// Tools the agent can use, e.g. { app: "notion", name: "...", description: "...", run: async (input) => ... }
// Notion tools read and update existing pages only: nothing here creates a page.
import { getToken } from "../notion-auth.js";

const NOTION_VERSION = "2026-03-11";

async function notion(method, pathname, body) {
  const token = getToken();
  if (!token) throw new Error("Not signed in to Notion yet. Open /login.");
  const res = await fetch(`https://api.notion.com/v1${pathname}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${data.code || res.status}: ${data.message || "Notion request failed"}`);
  return data;
}

// Accepts a page ID or a Notion page URL.
const pageId = (s) => String(s || "").match(/[0-9a-f]{32}|[0-9a-f-]{36}/i)?.[0] || String(s || "").trim();
const titleOf = (p) => Object.values(p.properties || {}).find((v) => v.type === "title")?.title?.map((t) => t.plain_text).join("") || "(untitled)";
const textOf = (b) => (b[b.type]?.rich_text || []).map((t) => t.plain_text).join("");

export default [
  {
    app: "notion",
    name: "notion_search_pages",
    description: "Find pages the agent can see, by title. An empty query lists all pages it can see.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Words in the page title; empty for all pages" } } },
    summary: ({ query }) => (query ? `Searched Notion for "${query}"` : "Listed the pages it can see"),
    run: async ({ query }) => {
      const d = await notion("POST", "/search", { query: query || "", filter: { property: "object", value: "page" }, page_size: 10 });
      return d.results.map((p) => ({ id: p.id, title: titleOf(p), url: p.url }));
    },
  },
  {
    app: "notion",
    name: "notion_read_page",
    description: "Read an existing page's title and text.",
    parameters: { type: "object", properties: { page: { type: "string", description: "Page ID or Notion page URL (from a search)" } }, required: ["page"] },
    summary: () => "Read a page",
    run: async ({ page }) => {
      const id = pageId(page);
      const p = await notion("GET", `/pages/${id}`);
      const blocks = await notion("GET", `/blocks/${id}/children?page_size=100`);
      return { id, title: titleOf(p), url: p.url, text: blocks.results.map(textOf).filter(Boolean).join("\n") };
    },
  },
  {
    app: "notion",
    name: "notion_update_page",
    description: "Update an existing page: rename it and/or add a paragraph to the end. Never creates pages.",
    parameters: { type: "object", properties: { page: { type: "string", description: "Page ID or Notion page URL" }, title: { type: "string", description: "New title (optional)" }, append: { type: "string", description: "Text to add as a new paragraph at the end (optional)" } }, required: ["page"] },
    summary: ({ title, append }) => [title && `Renamed a page to "${title}"`, append && "Added text to a page"].filter(Boolean).join(" and ") || "Updated a page",
    run: async ({ page, title, append }) => {
      const id = pageId(page);
      if (title) {
        const p = await notion("GET", `/pages/${id}`);
        const key = Object.entries(p.properties).find(([, v]) => v.type === "title")?.[0];
        await notion("PATCH", `/pages/${id}`, { properties: { [key]: { title: [{ text: { content: title } }] } } });
      }
      if (append) await notion("PATCH", `/blocks/${id}/children`, { children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: append } }] } }] });
      return { id, updated: { title: !!title, appended: !!append } };
    },
  },
];
