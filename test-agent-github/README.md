# Bug reporter test agent (GitHub)

A tiny agent for testing the stage-by-stage guide on a real OAuth connection:

> When I report a bug, my agent opens an issue for it in my GitHub repo.

It starts with **nothing connected**. Connect GitHub by following the guide app's stage chats on the **"Connect it yourself"** route (your own GitHub OAuth App), exactly as a first-time builder would. Your coding agent does the code stages in this folder. Write down every friction in `FRICTIONS.md`.

## Run it

```
cd test-agent-github
npm start
```

Open http://localhost:4100. Run the guide app too (`npm start` one folder up, port 3000).

- **Report a bug** sends a bug to the agent. Until GitHub is connected, the agent says what's missing.
- **What the agent is doing** shows each step live.

## What "connected" means here

| Check | Where |
|---|---|
| A `create_github_issue` tool exists | `tools/index.js` |
| `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set | `.env` in this folder |
| You signed in once and a token is stored | `.github-token.json` in this folder (git-ignored) |
| `GITHUB_REPO` says which repo gets the issues, e.g. `you/sandbox` | `.env` in this folder |

The server listens on **port 4100**, so the OAuth callback the guide sets up should point here (for example `http://localhost:4100/oauth/callback`). The sign-in route itself is what your coding agent adds in stage "Add sign-in to the agent".

## Where the guide plugs in

- `tools/index.js`: each connected app adds its tools here (`{ app, name, description, run }`). Empty on purpose.
- `server.js`: add the OAuth routes (start sign-in, callback) here. Look for `// OAuth routes go here`.
- `connections.js`: how "connected" is checked. Leave it; it reads the files above.
