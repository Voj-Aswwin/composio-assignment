# Agent Connect Guides

Before an AI agent can act in someone's Gmail, HubSpot or Notion, its developer usually needs an OAuth app registered with that provider, and sometimes approved. This prototype tells a developer how hard that will be for a given app, how long it takes, what could block approval, and walks them through it, with the steps split between them and their coding agent.

- **Library:** ready-made guides for six apps with different setup challenges (GitHub, Notion, HubSpot, Slack, Xero, Gmail), each with a difficulty rating, hands-on time, approval wait and biggest blocker.
- **Live generation:** type any app and what the agent should do. A research agent investigates it live (1-3 minutes) and writes a shareable guide.
- **Evidence:** `/evidence` shows what was tried hands-on, which claims were checked against official docs, what the agent got wrong and how that was fixed, and what is still uncertain.

Hosted demo: _link added after deploy_ (live generation is capped per day; the library always works).

## Run it locally

Requires Node 22+.

```bash
npm install
cp .env.example .env   # add PARALLEL_API_KEY (enough on its own) and optionally GEMINI_API_KEY
npm start              # http://localhost:3000
```

With no key it runs in demo mode with a canned guide, so you can click through the UI. `npm run check` sends one tiny request to every configured model and shows which work today. `npm run library` regenerates the six library guides into `library/`.

## How it works

1. **Fit check** (`POST /api/fit`). The agent turns the job into concrete actions, checks whether Composio has a toolkit and managed auth for the app, and classifies it on 11 setup dimensions (who can register, review, user caps, admin consent, tokens, scopes, and so on), for both the developer's own account and their users.
2. **Decisions.** A few fixed questions, each with plain trade-offs and one recommendation: who will connect (my users or just me), how the agent connects (through Composio or its own OAuth app), whose name users see at sign-in, and only when they matter, a different app or a narrower permission set.
3. **Guide** (`POST /api/generate`). Live research of the provider's official docs, written for that route and audience: a difficulty strip, prerequisites, steps marked **You**, **Your agent** or **Waiting on the provider** with times, ready-to-paste prompts for the coding agent, costs, blockers and paths. Every claim is labelled verified, inferred or unknown, and every link is checked before the guide is saved.
4. **Stage chats** (`POST /api/stage-turn`). Pressing Start runs the setup as one chat per stage (register, callback and permissions, keys, add sign-in to the agent, connect, do the job, approval). Each chat sees the developer's questions, errors and screenshots, keeps a ledger of non-secret facts for later stages (redirect URI, key names), and moves on only when its definition of done is met. An error that belongs to an earlier stage offers to go back.
5. **When stuck** (`POST /api/unblock`). Paste an error and get a diagnosis plus fix steps; the lesson is saved per app and given to the research agent next time.

Models: Parallel's Chat API does the web research; Parallel Chat Completions (JSON mode) writes the guide. Gemini reads screenshots and is a fallback, then Gemma with Parallel Search results, Groq and OpenRouter. Claude is used instead when `ANTHROPIC_API_KEY` is set.

## Key decisions

- **Default to "my users".** The hard part of the problem is approval before other people can sign in, so that is the default audience. "Just me" exists for trying an idea first and skips review steps the app doesn't need for one account.
- **Difficulty rates the provider, not the code.** OAuth code is the same for every app and a coding agent writes it quickly. Easy, Medium and Hard reflect what the developer can't speed up: reviews, certification, user caps and admin consent.
- **Approval is conditional, and the guide says when.** GitHub org restrictions, HubSpot's 25-install cap for unlisted apps and Xero's connection tiers all apply only in some cases. Optional listings go under paths, not as wait steps.
- **Composio's managed app is shown as an approval shortcut.** With managed auth, users sign in through an app the provider already approved. The trade-off (Composio's name on the sign-in screen) is asked only when other people will sign in.
- **You versus your agent.** Console clicks behind the developer's login are theirs; anything doable in code, a CLI or an API is the coding agent's, with a prompt. The agent never handles secret values: the ledger records where a secret is saved, never the secret.
- **A chat per stage instead of one long document.** Testers got stuck mid-flow on screens no research saw (which app type, which secret, the page picker). A stage chat can see their screen and only advances when its checklist is met.
- **Evidence over confidence.** Claims are labelled, links are tested, and the library's approval claims were checked by hand. The first library pass, written by a fallback model, contained invented reviews; the fixes are on the Evidence page.

## Limitations

- The research agent reads docs; it does not log in to provider consoles. Hands-on testing so far: a full Notion sign-in with a test agent that then read a real page (`test-agent-notion/`), and the setup chats against a GitHub test agent (`test-agent-github/`). Both used the developer's own account, so approval for other people's accounts was checked against docs, not tried.
- Wait times come from sources and are often unknown; providers rarely publish review times.
- Guides are JSON files on disk with no accounts. Generated guides on the hosted copy vanish when it restarts; the library is in the repo.
- Screenshots need a Gemini key. Without one, describe the screen in words.
- The Composio catalog check (`COMPOSIO_API_KEY`) follows Composio's docs but was not run against a real key.
- A live guide takes 1-3 minutes and a few cents of model credit.

## Repo layout

- `server.js`: the HTTP server, prompts, model routing, link checking and stage chats.
- `public/`: the single-page UI (no build step).
- `library/`: the ready-made guides. `evidence.json`: what was checked.
- `scripts/build-library.mjs`: regenerates the library.
- `test-agent-notion/`, `test-agent-github/`: minimal agents used to test the stage chats and a real sign-in.
