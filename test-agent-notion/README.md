# Notion agent

An agent that connects to Notion to read and edit its contents. It can search pages, read a page, and update an existing page (rename it or add text to the end). It never creates pages.

## Set up

1. In Notion's developer portal, create a **public** connection (OAuth) with the capabilities Read content and Update content, and add this redirect URI, exactly: `http://localhost:4200/callback` (or `http://localhost:<PORT>/callback` if you change `PORT`).
2. Put the connection's OAuth client ID and secret in `.env`:
   ```
   NOTION_CLIENT_ID=...
   NOTION_CLIENT_SECRET=...
   PORT=4200
   ```
3. `npm start`, then open http://localhost:4200/login once and sign in. On Notion's screen, **pick the pages** the agent may use: it can only see those.

The token is saved to `.tokens.json` (git-ignored) and loaded on startup.

## Self-check

On startup the agent prints whether the keys are loaded and whether `.tokens.json` exists. Missing keys stop it. A missing token only means nobody has signed in yet: then just `/login` and `/callback` work.

## Use it

Open http://localhost:4200 and chat in plain language: "What pages can you see?", "Summarise my Meeting notes page", "Add a line 'Follow up with Sam' to my To-do page". Tool calls show as small lines in the chat. The chat is kept in memory until the agent restarts.

The chat uses Gemini (gemini-3.6-flash, falling back to 3.5-flash and 3.5-flash-lite). The key is read from `GEMINI_API_KEY` in this folder's `.env`, or else from `../.env`. Set `AGENT_MODELS` to change the model list.

## Files

- `server.js`: the agent, its page, `/login` and `/callback`.
- `notion-auth.js`: builds the sign-in link, swaps the code for a token (HTTP Basic), saves and loads `.tokens.json`.
- `tools/index.js`: Notion tools (`notion_search_pages`, `notion_read_page`, `notion_update_page`).
- `llm.js`: the chat model (Gemini with tool calling, plain fetch).
- `connections.js`: checks whether any Notion tool exists.
