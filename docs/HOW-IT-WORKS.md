# How it works

Technical notes behind the [README](../README.md).

## The flow

1. **Fit check** (`POST /api/fit`). The agent turns the job into concrete actions, checks whether Composio has a toolkit and managed auth for the app, and classifies it on 11 setup dimensions (who can register, review, user caps, admin consent, tokens, scopes, and so on), for both the developer's own account and their users.
2. **Decisions.** A few fixed questions, each with plain trade-offs and one recommendation: who will connect (my users or just me), how the agent connects (through Composio or its own OAuth app), whose name users see at sign-in, and only when they matter, a different app or a narrower permission set.
3. **Guide** (`POST /api/generate`). Live research of the provider's official docs, written for that route and audience: a difficulty strip, prerequisites, steps marked **You**, **Your agent** or **Waiting on the provider** with times, ready-to-paste prompts for the coding agent, costs, blockers and paths. Every claim is labelled verified, inferred or unknown, and every link is checked before the guide is saved.
4. **Stage chats** (`POST /api/stage-turn`). Pressing Start runs the setup as one chat per stage (register, callback and permissions, keys, add sign-in to the agent, connect, do the job, approval). Each chat sees the developer's questions, errors and screenshots, keeps a ledger of non-secret facts for later stages (redirect URI, key names), and moves on only when its definition of done is met. An error that belongs to an earlier stage offers to go back.
5. **When stuck** (`POST /api/unblock`). Paste an error and get a diagnosis plus fix steps; the lesson is saved per app and given to the research agent next time.

Models: Parallel's Chat API does the web research; Parallel Chat Completions (JSON mode) writes the guide. Gemini reads screenshots and is a fallback, then Gemma with Parallel Search results, Groq and OpenRouter. Claude is used instead when `ANTHROPIC_API_KEY` is set.

## Run it locally (details)

Requires Node 22+.

```bash
npm install
cp .env.example .env   # add PARALLEL_API_KEY (enough on its own) and optionally GEMINI_API_KEY
npm start              # http://localhost:3000
```

With no key it runs in demo mode with a canned guide, so you can click through the UI. `npm run check` sends one tiny request to every configured model and shows which work today. `npm run library` regenerates the six library guides into `library/`.

## Repo layout

- `server.js`: the HTTP server, prompts, model routing, link checking and stage chats.
- `public/`: the single-page UI (no build step).
- `library/`: the ready-made guides. `evidence.json`: what was checked.
- `scripts/build-library.mjs`: regenerates the library.
- `docs/`: this file and the README screenshots.
- `test-agent-notion/`, `test-agent-github/`: minimal agents used to test the stage chats and a real sign-in.

## Settings

Every setting is listed in `.env.example`. `PARALLEL_API_KEY` is enough on its own. `DAILY_GUIDE_LIMIT` and `DAILY_CALL_LIMIT` cap what a hosted copy can spend each day. `render.yaml` deploys it as a free Render web service.

## Checks before a guide is saved

- Every link in the guide is fetched. Dead links are replaced or removed.
- Difficulty is checked against the approval facts. A guide whose approval applies only in some cases, with no required wait, can't be rated Hard.
- Every step has an owner (You, Your agent, or the provider).
- Facts checked by hand (`evidence.json`) are given to the research agent for that app, ahead of search results.

