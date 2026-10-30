// OAuth Readiness Guide prototype.
// One Node server: serves the UI, runs a Claude research agent with live web search,
// streams progress to the browser, and saves each guide so it has a shareable link.
import http from "node:http";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const GUIDES_DIR = path.join(ROOT, "guides");
// Curated, checked guides that ship with the repo. Same file format as guides/, looked up first.
const LIBRARY_DIR = path.join(ROOT, "library");
const guidePath = (id) => { const lib = path.join(LIBRARY_DIR, `${id}.json`); return existsSync(lib) ? lib : path.join(GUIDES_DIR, `${id}.json`); };
const PORT = Number(process.env.PORT || 3000);
// "free" means one or more free-tier keys (Gemini, Groq, OpenRouter), tried in that order as each hits its daily limit.
const PROVIDER = process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY || process.env.PARALLEL_API_KEY ? "free" : "demo";
const MODEL =
  PROVIDER === "anthropic" ? process.env.CLAUDE_MODEL || "claude-opus-5-5"
  : PROVIDER === "free" ? process.env.GEMINI_MODEL || "gemini-2.5-flash"
  : "demo";
const DEMO = PROVIDER === "demo";

const client = PROVIDER === "anthropic" ? new Anthropic() : null;

// Phase 1: before any guide, work out what the developer actually needs and whether
// Composio already covers it. Returns the few questions whose answers change the route.
const FIT_PROMPT = `You are an integration advisor for people who build AI agents, many of them first-time builders ("vibe coders") working with coding agents like Cursor or Claude Code.
They give you an app and what they want their agent to do with it. Before anyone writes an OAuth guide, you work out what they actually need.
AUDIENCE: the developer picks it right after you, from two options: "my users" (the default: other people sign in to the developer's agent with their own accounts, i.e. a launch) and "just me" (a prototype on the developer's own account). Research BOTH: what one personal account needs, and what letting other people connect needs (app review or verification, marketplace listing, user caps before approval, admin consent, partner programs, and how long each wait takes). Put both in the dimensions notes, e.g. review: "None for your own account; Google verification (2-6 weeks) before others can sign in".

Do this, researching LIVE on the web (around 4-8 searches/fetches):
1. Pin down the exact app and product/API (e.g. "Microsoft" could mean Outlook, Teams or SharePoint via Microsoft Graph). Turn the use case into concrete agent actions (e.g. "read new emails", "create a contact"). Mark an action as needing a trigger ONLY when an event inside the app must start the agent (e.g. "when a new email arrives"). Actions the agent performs on its own or on a user's request (create, send, update, read) never need a trigger.
2. Check Composio: if the request includes a "Composio toolkit catalog" line, that is checked fact from Composio's API: use it and don't search for it. Otherwise check docs.composio.dev and composio.dev/toolkits: is there a toolkit for this app, does it have actions covering the use case, and does it offer Composio-managed auth? Give the toolkit slug (lowercase, e.g. "gmail", "hubspot") if one exists. The toolkit must be for THIS EXACT app. Never say another product's toolkit works for it because the APIs look "similar" or "the same" (e.g. SavvyCal is not Cal.com): that is a different app, so put it in alternatives as a "composio_toolkit" switch and set toolkit_available "no".
3. If there is no toolkit, or it doesn't cover the use case, find alternatives in this order: other apps that Composio DOES have toolkits for and that do the same job; lighter routes the job allows (API key, webhook, export/import, an MCP server); building their own OAuth app. Never hide the own-OAuth route.
4. Quick facts that apply to every app: auth type (OAuth 2.0, OAuth 1.0a, API key, other), who can register an app (self-serve, paid developer account, partner program/application), the minimum scopes for the actions, token behaviour, and what Composio needs for a custom auth config.
5. Classify the 11 setup dimensions below as "yes", "no" or "depends" for THIS app and use case, with a short note: auth_type, registration, review, distribution_limits, per_customer_instance, admin_consent, tokens, scopes_vs_actions, sandbox_vs_production, triggers, composio_layer.
6. Lay out the DECISIONS the developer must make before a guide can be written, with honest trade-offs. Many of them don't know what Composio is, so never assume they use it. Use ONLY these decision ids, in this order, and skip any that don't apply (the audience question is added for you; don't write it):
   - "connect_via" (ALWAYS include): how the agent connects to the app. Options: "composio" (Composio hosts the sign-in and Connect link; Composio stores and refreshes the access and gives ready-made actions; with managed auth nothing to register) and "direct" (their agent's code connects by itself through OAuth: they register their own OAuth app with the provider, handle the sign-in and store the access; this is the point of the guide, so a personal access token or API key is NOT this option, mention it only as a shortcut in why_it_matters). Give trade-offs specific to THIS app for letting their users connect: setup time, approval wait, ongoing work, cost. With Composio managed auth, users sign in through Composio's own app, which the provider has already approved, so there is usually no review for the developer; with their own app, the provider's review applies to them. If there is no toolkit, still include it but recommend "direct" and say Composio has no toolkit yet.
   - "app_choice": ONLY if Composio has no toolkit or it doesn't cover the use case AND an alternative app or lighter route exists. Options: stay on this app, or each alternative from "alternatives" (value = its name).
   - "permissions": ONLY if this app's permission level is a real fork for this job (e.g. Gmail send-only vs reading the inbox, which changes review). Options: the narrower and the broader permission set, with what each allows and triggers.
   For each option give: label, what_it_means, pros and cons, time (hands-on), wait (waiting on others, e.g. "None" or "2-6 weeks review"), cost, and set "recommended": true on exactly ONE option per decision with "recommended_reason". Base trade-offs on what you found; label evidence.

WRITING RULES (the reader is NOT a developer; they should be able to decide in a few seconds):
- title: a plain question, at most 10 words. why_it_matters: at most 12 words.
- label: 2-4 words (e.g. "Use Composio", "Use your own key").
- what_it_means: ONE sentence, at most 15 words.
- pros and cons: at most 3 each, at most 6 words each (e.g. "Working in minutes", "You fix it when it breaks").
- time, wait, cost: at most 4 words each (e.g. "Minutes", "Days to weeks", "Free to start").
- recommended_reason: at most 20 words.
- Everyday words only. Avoid jargon (OAuth flow, token exchange, scopes, rate limits, SDK, API versioning); say what it means for them instead ("sign-in", "permissions", "how often your agent can use HubSpot").
- Real costs only (fees, plans, assessments). Never estimate developer salaries, hourly rates or project budgets.
- No citation markers like [1] or [cite:...] anywhere in the text.

Evidence rules: label claims "verified" (stated in a source you saw), "inferred" or "unknown". Never invent URLs; only cite pages you actually saw.

Reply with ONLY one JSON object in a \`\`\`json code fence:
{
  "app": "Official app name",
  "product": "Which product/API this means, e.g. Gmail API",
  "website": "https://...",
  "use_case": "The use case restated in one plain sentence",
  "actions": [ { "action": "plain verb phrase", "needs_trigger": false } ],
  "composio": { "toolkit_available": "yes | no | unknown", "toolkit_slug": "gmail or null", "covers_use_case": "yes | partly | no | unknown", "matching_actions": [ "Composio action names, if found" ], "managed_auth": "yes | no | unknown", "note": "one plain sentence", "evidence": "verified | inferred | unknown" },
  "alternatives": [ { "type": "composio_toolkit | lighter_route | own_oauth", "name": "...", "toolkit_slug": "slug or null", "why": "why this solves the same need", "tradeoffs": "..." } ],
  "basics": { "auth_type": "...", "registration": "self-serve | paid account | partner program | unknown", "registration_note": "...", "min_scopes": [ "..." ], "token_note": "...", "evidence": "verified | inferred | unknown" },
  "dimensions": [ { "key": "auth_type", "applies": "yes | no | depends", "note": "..." } ],
  "decisions": [ { "id": "connect_via", "title": "How will your agent connect to this app?", "why_it_matters": "plain words", "show_if": null, "options": [ { "value": "composio", "label": "Through Composio", "what_it_means": "...", "pros": [ "..." ], "cons": [ "..." ], "time": "...", "cost": "...", "recommended": true, "recommended_reason": "..." } ], "evidence": "verified | inferred | unknown" } ],
  "sources": [ { "title": "...", "url": "https://..." } ]
}
Leave "alternatives" empty when the Composio toolkit fully covers the use case.`;

// Every OAuth setup has the same stages. Each stage lists the friction points builders actually hit
// in the middle of a flow (sign-up forms, toggles, verification), which web docs rarely spell out.
// The research agent must answer every check for the app, so middle steps are caught for any app.
const STAGES = [
  { id: "signup", name: "Create the accounts", checks: [
    "What does each sign-up form ask for (company name, company website, work email, phone, card)? Does anything you already own work, or is a placeholder accepted?",
    "Is there an email or phone verification, or a wait before the account is usable?",
    "Does sign-up drop you into a product onboarding (e.g. a CRM setup) before the developer area? How do you get past it?" ] },
  { id: "dev_space", name: "Open the developer area", checks: [
    "Is the developer area a separate account, workspace, project or organisation you must create first?",
    "Is there a toggle or menu that must be enabled (developer mode, 'Development' menu, API access) and where exactly is it?",
    "Does it need admin or owner rights on the account?" ] },
  { id: "register", name: "Register your app", checks: [
    "Which app type to pick (public vs private/internal, OAuth app vs personal integration): name the ONE type that gives a client ID, a client secret and a sign-in screen, and say why the other type dead-ends this route.",
    "Which fields can't be changed after creation (e.g. installation scope, workspace, app type), and which value fits a just-me prototype?",
    "Is the authorization (sign-in) URL shown in the console, only after review, or built by hand from client_id, redirect_uri, response_type=code and any provider-only parameters?",
    "Which fields does the form require (app name, logo, description, support email, website, privacy policy URL, terms URL)?" ] },
  { id: "redirect", name: "Set the return address", checks: [
    "The exact redirect URL for this route, and any format rules (https only, no localhost, exact match, trailing slash)." ] },
  { id: "scopes", name: "Pick permissions", checks: [
    "The minimum scopes for the job, and which of them are marked sensitive or restricted (which triggers a review)." ] },
  { id: "keys", name: "Copy your keys", checks: [
    "Where the OAuth client ID and client secret are shown (exact tab and labels), how they differ from any internal/personal token on the same page, and whether the secret is shown only once.",
    "How the token exchange sends the client ID and secret (HTTP Basic header or form body), any required API version header, and whether a refresh token is returned." ] },
  { id: "connect", name: "Connect a test user", checks: [
    "Are there test-user limits, an allow-list of test users, or a 'testing' mode that expires tokens?",
    "What warning screens will the first user see (e.g. 'unverified app') and how do they get past it?",
    "Does the sign-in screen ask the user to pick what to share (pages, repos, channels, calendars, workspaces)? What must they pick for this job, and what error appears if they skip it?" ] },
  { id: "approval", name: "Get approval to go live", checks: [
    "Is a review, verification, marketplace listing or admin approval needed for this audience? How long, and what must be submitted?" ] },
];
const STAGE_TEXT = STAGES.map((st) => `- ${st.id} (${st.name}):\n${st.checks.map((c) => `    * ${c}`).join("\n")}`).join("\n");

const SYSTEM_PROMPT = `You are an integration research agent for people building AI agents, many of them first-time builders working with coding agents.
A developer names an app and the job they want their agent to do with it. You may also get a fit-check brief (what Composio covers, the 11 setup dimensions) and their answers to a few questions, and the route they picked.
Your job: research LIVE on the web and produce an honest, actionable setup guide for THAT route, scoped to THAT job and THOSE users. Skip anything that doesn't apply to them.
AUDIENCE: the request says who will connect. Rules that follow from it:
- The guide sets up a real OAuth connection: Composio's Connect button, or on the "direct" route their own OAuth app registered with the provider (sign-in, callback URL, client ID and secret, token storage and refresh). Never replace OAuth with a personal access token or API key; mention one only in "paths" as a shortcut that skips OAuth.
- "My users" (other people connect their own accounts): this is a launch. Keep every approval the app needs before other people can sign in: app review or verification, security assessment, marketplace or directory listing, partner certification, user caps before approval, admin consent at companies. Each wait is its own step with kind "wait", owner "provider" and a realistic range; what they must submit (privacy policy, demo video, scope justification) is its own step, and drafting text for it is "agent". Before the wait, show how to test with their own account and any test users the app allows, and say what blocks approval most often. Name the end state: other people can sign in without warnings.
- "My users" on the Composio route with managed auth: users sign in through Composio's own app, which the provider already approved, so the developer usually skips registration and review. Say so plainly as the reason. If they chose their own app in Composio (their brand on the sign-in screen), the provider's review applies to THEIR app: include it.
- "Just me" (a prototype on their own account): skip review, verification for public use, marketplace listing, user caps and admin consent unless the app requires them even for one personal account (if it does, keep that step and say why). On the Composio route with managed auth, don't have them register their own app. Call out limits that bite prototypes, e.g. "testing mode" sign-ins that expire after a few days. In open_questions, add one line on what changes when other people connect.
- Never suggest switching to an app type the route already uses.
- Copying the client ID and secret into a .env file is owner "you": a person must copy the secret from the console.

How to research:
1. Start from the job. Work out which API capabilities and the minimum scopes that job needs. If no job was given, assume the most common agent use case for that app and say so. Use the developer's answers: "Use Composio" means Composio's Connect flow (managed auth when available, unless they chose their own app for their brand); "direct" means their own code with their own OAuth app registered with the provider.
2. Find the provider's OFFICIAL developer docs: OAuth/app registration, scopes/permissions, app review / verification / marketplace listing, rate limits or account-type restrictions. Fetch the key pages, don't rely on search snippets alone.
3. Check Composio: search docs.composio.dev (toolkits / managed auth) to see whether Composio offers a toolkit for THIS EXACT app (never another product's toolkit because its API looks similar; if the fit-check brief says there is none, there is none) and whether it provides managed OAuth or the developer must bring their own OAuth app. If you cannot confirm, say "unknown".
4. Look for blockers: sensitive/restricted scopes, security assessments, business verification, partner programs, paid plans, admin approval, personal vs business account limits. Then find mitigations and alternative paths.

Evidence rules (critical):
- Label every step, blocker and key claim with evidence: "verified" (stated in an official source you fetched or found), "inferred" (reasonable conclusion from sources, not stated directly), or "unknown" (could not confirm).
- Never claim you tested a login flow or completed a review. You only researched.
- Keep hands-on setup time separate from approval / review wait time. Give ranges, and say "unknown" if no source supports a wait estimate.
- Cite real URLs you actually saw. Do not invent URLs.

Link rules:
- Every URL must be a page you actually saw in search results or fetched in this session. Never construct or guess a URL path.
- Step "url" must be a human-readable page (a docs page or the console page where the step happens), never an API endpoint.
- Every link is checked automatically after you finish; dead links are removed.

Stage checklist: every OAuth setup goes through these stages. For the chosen route, answer EVERY check below in "friction_checks" (skip a stage only if the route skips it, e.g. Composio managed sign-in skips register/redirect/keys, and say so). Any check that creates work or a wait must become a step, an action inside a step, or a prerequisite. Most builders get stuck in these middle moments, not in the headline steps.
${STAGE_TEXT}

Steps rules:
- The reader is NOT a developer. Every step has: a title of at most 6 words; "actions": 1-3 short instructions of at most 12 words each, in everyday words, naming the exact button or field in **bold** markdown; "detail": at most 40 words of background on why the step matters (shown only if they ask).
- Avoid jargon; when a technical term is unavoidable, add it to "glossary". No citation markers like [1] or [cite:...].
- List every step from zero to "my agent did the job for a real user", in the order the developer does them, usually 6-10 steps. Signing in is not the finish line: the guide must end with agent steps that (1) add the connection to their code, e.g. installing the Composio SDK and creating a sign-in link for a user, or the OAuth flow when going direct, (2) make the agent call the action for the job, and (3) test it end to end with a real account.
- Any review, verification, marketplace approval or admin approval that is REQUIRED for this audience is its own step with kind "wait" and owner "provider", with realistic minutes_min/minutes_max (1 day = 1440, 1 week = 10080). If the wait is unknown, give your best range and mark evidence "unknown". Optional ones (a marketplace or directory listing for discovery, admin approval only at some companies) are NOT steps: put them in paths or blockers, saying when they apply.
- verdict.difficulty rates the provider side for this audience, not the coding (every app needs the same OAuth code): "easy" = self-serve app, no review, anyone can sign in; "moderate" = extra accounts or setup (developer account, test accounts, per-workspace install) or approval only in some cases; "hard" = a required review, verification, security assessment, certification, or a cap on users until approved; "blocked" = partner program or paid plan you can't get self-serve. difficulty_reason names the provider fact behind the rating, with its source.
- Steps are for the chosen/recommended route only. Don't mix in another route's steps ("if using your own app..."); mention other routes in "paths" instead.
- owner: "you" for anything needing the developer's login, decision, payment, recording or submission; "agent" for work their coding agent (Cursor, Claude Code) can do from a prompt: writing code, config, test scripts, drafting text such as a privacy policy or scope justifications; "provider" for waits.
- With Composio, the coding agent can do most of the setup with the Composio CLI or SDK: enabling the toolkit, creating the auth config, creating a sign-in link for a user, and calling the tools. Mark those "agent" with a prompt. Only the developer's own sign-up and the consent click on the sign-in screen are "you".
- Dashboard clicks behind the developer's login that have no CLI or SDK route (e.g. registering an app in the provider's developer portal) are "you". Anything that can be done in code, a CLI or an API, including creating a Composio auth config with the SDK, is "agent". A step with an agent_prompt must have owner "agent".
- Fixed fact (Composio docs, https://docs.composio.dev/docs/white-labeling-authentication): when the developer plugs their own OAuth app into Composio, the redirect URI to register with the provider is exactly https://backend.composio.dev/api/v3/toolkits/auth/callback and the same value goes in the auth config's oauth_redirect_uri. Never write any other Composio callback URL. Auth configs can also be created in code ("Programmatic auth configs" in the Composio docs).
- For every "agent" step, write "agent_prompt": a ready-to-paste instruction for their coding agent, specific to this app, job and route.
Agent prompts must survive a real project (these failed in live tests):
- Never assume a language or framework. Say "in this project's language, following how its existing tools are defined" instead of writing Python or JS calls.
- Keys: name ONE file for each key ("the .env next to the code that runs the agent"), tell the agent to check no other .env in the project sets the same key (an old copy silently wins), and to prove the key works with one harmless call (e.g. list Composio auth configs) before going on.
- Composio route: include a step that fixes ONE user id for the developer (e.g. "me"), creates the sign-in link for that user id, and checks the connected account is ACTIVE. Every later prompt uses that same user id.
- Composio sessions (sessions.create, Tool Router, an MCP URL) are only for agents that hand Composio's general toolset to the model. A prototype with fixed tools calls tools.execute(tool slug, { userId }) and needs NO session: don't add a session step. If the job truly needs the general toolset, say where the session id is stored (e.g. .env) and which code reads it.
- Every value a prompt creates (user id, auth config id, session id) must say where it is saved and which later step or code reads it.
- The test step's prompt must first check the code step really happened (the tool exists and is registered with the agent, the SDK is installed) and stop with what's missing if not, before running the job once with the developer's own account. It must also print which auth config (managed or their own app) and which user id it used, and stop if they don't match the route this guide set up.

Costs: list EVERY cost the developer could hit on this route, with amounts where a source states them: developer account or program fees, business verification, security assessments, paid API tiers, Composio plan if relevant. Use "free" when a source says so. Never guess an amount; say "unknown" and mark the evidence.

Prerequisites: everything they must already have before step 1 (accounts, admin rights, a domain, a privacy policy URL on that domain, a business entity...). For each, say how to get it if they don't, and whether missing it blocks the route.
Each prerequisite's own requirements go in its "needs" (at most 4; never nest deeper: anything below that is a plain sentence in ok_if). Include what each sign-up form on this route asks for (the provider's developer account, Composio): company name and website, work email, phone number, credit card. For each, say in "how_to_get" whether anything they own works (a personal site, their app's URL), whether a placeholder is accepted, and when a real one becomes required (e.g. publishing a public app).

Glossary: 3-8 technical terms used in this guide (e.g. redirect URI, scope, consent screen, client secret), each explained in ONE plain sentence a first-time builder understands.

Be efficient: around 5-10 searches/fetches is enough.

When done, reply with ONLY a single JSON object inside a \`\`\`json code fence, matching this shape:
{
  "app": "Official app/provider name",
  "website": "https://...",
  "job": "The user-facing job you assumed or were given",
  "job_assumed": true,
  "summary": "2-3 sentence plain-English bottom line for the developer",
  "verdict": {
    "difficulty": "easy | moderate | hard | blocked",
    "difficulty_reason": "why",
    "hands_on_time": "e.g. 30-60 min",
    "approval_wait": "e.g. none for testing; 2-6 weeks for public launch | unknown",
    "oauth_supported": "yes | no | partial | unknown"
  },
  "composio": { "managed_oauth": "yes | no | unknown", "toolkit_available": "yes | no | unknown", "note": "what this means for the developer", "evidence": "verified | inferred | unknown" },
  "route": { "choice": "composio_managed | own_oauth_app | api_key | alternative_app | not_possible", "name": "e.g. Use Composio managed auth", "reason": "one plain sentence: why this route for this job and these users", "hands_on_time": "e.g. 10-20 min", "wait": "e.g. none | 2-6 weeks", "cost": "e.g. Free | $15k-75k security assessment | unknown" },
  "costs": [ { "item": "...", "amount": "e.g. free | $99/year | unknown", "when": "when you pay it", "required": "yes | no | depends", "evidence": "verified | inferred | unknown" } ],
  "paths": [ { "name": "e.g. Use Composio managed OAuth", "when_to_choose": "...", "tradeoffs": "...", "recommended": true } ],
  "prerequisites": [ { "item": "short name, e.g. A HubSpot developer account", "how_to_get": "one plain sentence on getting it", "needs": [ { "item": "what getting it asks for, e.g. A company website", "ok_if": "what works if you don't have the real thing, or what's accepted", "later": "when a real one becomes required, or null" } ], "actions": [ "1-3 short steps to get it, exact buttons in **bold**" ], "url": "sign-up page you actually saw, or null", "time": "e.g. 10 min", "done_when": "how they know they have it", "blocks_route": true, "evidence": "verified | inferred | unknown" } ],
  "friction_checks": [ { "stage": "signup | dev_space | register | redirect | scopes | keys | connect | approval", "check": "the question, shortened", "answer": "what is true for this app and route, or 'skipped on this route'", "handled_in": "step title or prerequisite it became, or null", "evidence": "verified | inferred | unknown" } ],
  "steps": [ { "title": "at most 6 words, starts with a verb", "stage": "which stage id this step belongs to", "actions": [ "Open **Settings** and click **Integrations**" ], "detail": "why this step matters, at most 40 words", "url": "https://... or null", "kind": "account | register | configure | scopes | credentials | code | test | submit | wait", "owner": "you | agent | provider", "agent_prompt": "for agent steps: a ready-to-paste prompt for their coding agent, else null", "time": "e.g. 10 min or 2-4 weeks", "minutes_min": 10, "minutes_max": 20, "waiting_on": "who you wait on, for wait steps only (e.g. Google Trust & Safety), else null", "done_when": "how the developer knows this step is complete", "evidence": "verified | inferred | unknown" } ],
  "glossary": [ { "term": "redirect URI", "plain": "one plain sentence" } ],
  "scopes": [ { "scope": "...", "why": "which part of the job needs it", "sensitivity": "basic | sensitive | restricted | unknown" } ],
  "approval": { "required": "yes | no | depends | unknown", "process": "what review/verification involves and when it is triggered", "wait": "...", "evidence": "verified | inferred | unknown" },
  "blockers": [ { "blocker": "...", "impact": "high | medium | low", "mitigation": "...", "step": "0-based index of the step where this bites, or null", "evidence": "verified | inferred | unknown" } ],
  "alternatives": [ "..." ],
  "agent_can_do": [ "..." ],
  "you_must_do": [ "..." ],
  "next_action": "The single most useful thing to do right now",
  "open_questions": [ "What you could not confirm" ],
  "sources": [ { "title": "...", "url": "https://...", "used_for": "..." } ]
}`;

const UNBLOCK_PROMPT = `You are an integration support agent helping a developer who is stuck partway through setting up an OAuth app.
You get: their integration guide (JSON), the step they are on, the steps already done, and what went wrong (an error message or a description).
This is a CHAT: you may also get the conversation so far on this step. Read it, build on what was already tried, and never repeat a fix they said didn't work. Answer their latest message.

Your job:
1. Diagnose the most likely cause. Use the guide's own values (callback URL, scopes, app type, path) to spot mismatches. Search the provider's official docs and developer forums for this exact error or situation; do a few targeted searches, not many.
2. Give the shortest set of fix steps that gets them moving again (at most 4). Be concrete: which page, which field, what value.
   fix_steps are ONLY the extra actions to insert before the current step. They are added to the existing plan, which stays in place, so never repeat or rewrite steps already in the guide.
   If the answer is just a decision or clarification (e.g. "which option do I pick?"), put it in the diagnosis, use plan_change "retry" and at most one fix step.
3. Decide how the plan changes:
   - "retry": fix and redo the current step.
   - "insert_steps": add your fix steps before continuing.
   - "switch_path": this route is blocked or not worth it; recommend another path (e.g. Composio managed OAuth, a narrower scope set, a different API, an alternative product flow) and say why.
   - "wait": nothing to fix; they must wait on the provider or an admin. Say how long and what to do meanwhile.
4. Be honest about certainty. If you could not confirm the cause, say what to check to tell the possibilities apart.
5. The developer is not technical. Write in plain words; each fix step has 1-3 short "actions".
6. If you can't tell the cause apart without one fact from them (which page they're on, the exact error text, a setting), ask ONE short question in "ask" and keep fix_steps empty. Otherwise ask nothing.
7. Workarounds (placeholder data, skipping a field, a test account): only suggest one if it is safe. Say in the diagnosis what it is fine for ("fine for testing") and what it breaks later ("a public app needs a real website and privacy policy"). Then add the lasting option as its own fix step or as alternative_path. Never suggest entering details the provider verifies (legal entity, tax ID, domain ownership) that aren't true, and never suggest using someone else's domain.

Reply with ONLY one JSON object in a \`\`\`json code fence:
{
  "reply": "what you say back to them in the chat: 1-3 friendly plain sentences, answering their latest message",
  "ask": "one short question back to them, or null",
  "diagnosis": "one or two plain sentences: what is going on",
  "likely_causes": [ { "cause": "...", "how_to_check": "...", "likelihood": "high | medium | low" } ],
  "plan_change": "retry | insert_steps | switch_path | wait",
  "fix_steps": [ { "title": "starts with a verb, at most 8 words", "actions": [ "short instruction with the exact button or field in **bold**" ], "detail": "why, at most 30 words", "url": "https://... or null", "kind": "account | register | configure | scopes | credentials | code | test | submit | wait", "owner": "you | agent | provider", "time": "e.g. 5 min", "minutes_min": 5, "minutes_max": 5, "done_when": "...", "evidence": "verified | inferred | unknown" } ],
  "alternative_path": { "name": "...", "why": "...", "tradeoffs": "..." } or null,
  "meanwhile": "what they can do while waiting, or null",
  "prevent_next_time": "one line the guide should have said up front",
  "evidence": "verified | inferred | unknown",
  "sources": [ { "title": "...", "url": "https://..." } ]
}`;

// ---------- research agent ----------

function guideRequest({ app, job, brief, answers, route }) {
  const lines = [
    `App: ${app}`,
    job ? `What the developer wants their agent to do: ${job}` : "No job given: assume the most common AI-agent use case and say so.",
  ];
  if (brief) {
    const { questions, decisions, sources, ...rest } = brief;
    lines.push("Fit-check brief from an earlier research pass (re-check anything that matters):", "```json", JSON.stringify(rest, null, 1), "```");
  }
  const qa = Object.entries(answers || {}).map(([id, value]) => {
    const d = (brief?.decisions || brief?.questions || []).find((x) => x.id === id);
    const opt = d?.options?.find((o) => o.value === value);
    return `- ${d?.title || d?.question || id} → ${opt?.label || value}${opt?.what_it_means ? ` (${opt.what_it_means})` : ""}`;
  });
  if (qa.length) lines.push("The developer's decisions, made after seeing the trade-offs. Write the guide for exactly these:", ...qa);
  lines.push(answers?.users === "just_me"
    ? "Audience: just me. Only the developer's own account, for a prototype. No other users."
    : "Audience: my users. Other people will connect their own accounts to the developer's agent, so this is a launch: include every approval the app needs before they can sign in.");
  if (brief?.composio?.catalog_checked) lines.push(brief.composio.toolkit_available === "yes"
    ? `Composio's toolkit catalog (checked through its API): toolkit "${brief.composio.toolkit_slug}" for ${app}, managed sign-in: ${brief.composio.managed_auth}. Use this; don't search for it.`
    : `Composio's toolkit catalog (checked through its API) has NO toolkit for ${app}. Do not use another app's toolkit for it.`);
  else if (brief?.composio?.toolkit_available === "no") lines.push(`Composio has NO toolkit for ${app} (checked). Do not use another app's toolkit for it.`);
  if (answers?.connect_via !== "direct" && answers?.branding === "own_app") lines.push("They want their own brand on the sign-in screen: register their own OAuth app with the provider and plug it into a Composio auth config. The provider's review applies to their app.");
  else if (answers?.connect_via !== "direct" && String(brief?.composio?.managed_auth).toLowerCase() === "yes") lines.push("Composio has managed auth for this app: use the managed auth config. No developer account, own app, redirect URI or client secret in the steps. Users sign in through Composio's already-approved app.");
  if (answers?.connect_via === "direct") lines.push("They chose NOT to use Composio: write a complete guide for their own code. Use OAuth, not a personal access token or API key: register their own OAuth app with the provider (callback URL on localhost is fine for a prototype), handle the sign-in, store and refresh the access securely, call the API. A personal token may appear only in paths, as a shortcut that skips OAuth. Mention Composio at most once, in paths, as an alternative.");
  if (route) lines.push(`Route the developer picked: ${route}. Write the guide for this route.`);
  return lines.join("\n");
}

function fitRequest({ app, job }, catalog) {
  return [`App: ${app}`, `What the developer wants their agent to do: ${job}`, catalogText(app, catalog)].filter(Boolean).join("\n");
}

// What Composio's own toolkit catalog says, in words the research model must use instead of searching the web.
function catalogText(app, catalog) {
  if (!catalog) return "";
  const m = catalog.match;
  return m
    ? `Composio toolkit catalog (checked live through Composio's API; use this, don't search the web for it): ${app} → toolkit "${m.slug}" (${m.name}), ${m.tools_count ?? "?"} actions, ${m.triggers_count ?? "?"} triggers, Composio-managed auth: ${m.managed ? "yes" : "no"}${m.no_auth ? ", no sign-in needed" : ""}.`
    : `Composio toolkit catalog (checked live through Composio's API; use this, don't search the web for it): there is NO toolkit for ${app}.${catalog.nearby.length ? ` Toolkits with similar names, which are DIFFERENT apps: ${catalog.nearby.join(", ")}.` : ""}`;
}

// Each provider takes a system prompt + user message, runs it with live web search,
// and returns { text, sources }. Callers parse the JSON they asked for.
async function askClaude(system, userMsg, emit, { searches = 8, fetches = 6 } = {}) {
  const messages = [{ role: "user", content: userMsg }];
  const tools = [
    { type: "web_search_20260209", name: "web_search", max_uses: searches },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: fetches },
  ];
  const seenSources = new Map();

  for (let turn = 0; turn < 6; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      system,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      tools,
      messages,
    });

    stream.on("contentBlock", (block) => {
      if (block.type === "server_tool_use") {
        if (block.name === "web_search") emit("progress", { kind: "search", text: block.input?.query });
        else if (block.name === "web_fetch") emit("progress", { kind: "fetch", text: block.input?.url });
      } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) if (r.url) seenSources.set(r.url, r.title || r.url);
        emit("progress", { kind: "results", text: `${block.content.length} results` });
      } else if (block.type === "web_fetch_tool_result" && block.content?.url) {
        seenSources.set(block.content.url, block.content.document?.title || block.content.url);
      }
    });

    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("The model declined this request.");
    if (msg.stop_reason === "pause_turn") {
      // Server-side tool loop hit its limit: send the turn back so it resumes.
      messages.push({ role: "assistant", content: msg.content });
      emit("progress", { kind: "note", text: "Continuing research..." });
      continue;
    }

    const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return { text, sources: [...seenSources].map(([url, title]) => ({ url, title })) };
  }
  throw new Error("Research did not finish within the turn limit.");
}

// Free-tier quotas are per model and per day, so when one model is used up we move to the next.
// Order: models that search the web first (Gemini, then Groq), then free models without search.
const NO_SEARCH_NOTE = `\n\nNo web search is available right now: answer from what you know and mark claims "inferred" or "unknown".`;

function apiError(label, res, data) {
  const err = new Error(`${label} error: ${data.error?.message || res.statusText}`);
  err.status = res.status;
  const retry = (data.error?.details || []).find((d) => d.retryDelay)?.retryDelay || res.headers.get("retry-after");
  err.retryMs = retry ? parseFloat(retry) * 1000 : 60 * 60 * 1000;
  return err;
}

async function gemini(model, system, userMsg, { image, search }) {
  const gemma = /^gemma/.test(model); // no system instruction, no tools
  const parts = [...(image ? [{ inline_data: { mime_type: image.mime, data: image.b64 } }] : []), { text: gemma ? `${system}${search ? NO_SEARCH_NOTE : ""}\n\n${userMsg}` : userMsg }];
  const body = gemma ? { contents: [{ role: "user", parts }] }
    : { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts }], ...(search ? { tools: [{ google_search: {} }, ...(/2\.0/.test(model) ? [] : [{ url_context: {} }])] } : {}) };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError(`Gemini (${model})`, res, data);
  const cand = data.candidates?.[0];
  const meta = cand?.groundingMetadata || {};
  return {
    text: (cand?.content?.parts || []).map((p) => p.text || "").join(""),
    queries: meta.webSearchQueries || [],
    sources: (meta.groundingChunks || []).filter((c) => c.web?.uri).map((c) => ({ url: c.web.uri, title: c.web.title || c.web.uri })),
    finish: cand?.finishReason,
  };
}

// Groq and OpenRouter both speak the OpenAI chat format.
async function openaiStyle(url, key, label, model, system, userMsg, { image, search, webTool }) {
  const content = image ? [{ type: "image_url", image_url: { url: `data:${image.mime};base64,${image.b64}` } }, { type: "text", text: userMsg }] : userMsg;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system + (search && !webTool ? NO_SEARCH_NOTE : "") }, { role: "user", content }], ...(webTool ? { tools: [{ type: "browser_search" }], tool_choice: "required", reasoning_effort: "low" } : {}), max_completion_tokens: 8000 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError(`${label} (${model})`, res, data);
  const msg = data.choices?.[0]?.message || {};
  const text = msg.content || "";
  // Groq's browser search cites inline; keep the pages it opened as sources.
  const urls = [...new Set((`${text} ${JSON.stringify(msg.executed_tools || [])}`.match(/https?:\/\/[^\s"'<>)\]】\\]+/g) || []))].slice(0, 15);
  return { text, queries: [], sources: webTool ? urls.map((u) => ({ url: u, title: u })) : [], finish: data.choices?.[0]?.finish_reason };
}

// Parallel caps instructions + input at 20,000 characters. Keep the start (the task) and the end (notes, the
// newest message), and cut from the middle.
const fitParallel = (t, n) => (t.length <= n ? t : n < 2000 ? t.slice(0, Math.max(n, 0)) : `${t.slice(0, Math.floor(n * 0.4))}\n[…cut to fit…]\n${t.slice(t.length - Math.floor(n * 0.6) + 20)}`);

// Parallel's Chat API: web search and the answer in one call ($5 per 1,000 at low effort, from the monthly free credit).
async function parallelChat(system, userMsg) {
  const res = await fetch("https://api.parallel.ai/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.PARALLEL_API_KEY}` },
    body: JSON.stringify({ model: "parallel", reasoning: { effort: process.env.PARALLEL_EFFORT || "low" }, input: [{ role: "system", content: system }, { role: "user", content: fitParallel(String(userMsg), 19500 - system.length - 100) }] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError("Parallel chat", res, data);
  const parts = (data.output || []).flatMap((o) => o.content || []);
  const text = data.output_text || parts.map((c) => c.text || "").join("");
  const sources = parts.flatMap((c) => c.annotations || []).filter((a) => a.url).map((a) => ({ url: a.url, title: a.title || a.url }));
  return { text, queries: (data.output || []).filter((o) => o.type === "web_search_call").map((o) => o.action?.query).filter(Boolean), sources, finish: data.status };
}

// Parallel's Chat Completions endpoint can answer in JSON (structured outputs), so it can also write the guide
// from its own research notes. It tries JSON mode, then a plain "JSON only" request, then the Responses API,
// and keeps the first reply that parses. (An open json_schema returned a server error in testing, so it isn't used.)
// Parallel caps a whole request (instructions + input) at 20,000 characters, and the full research prompt alone
// is ~18,000. The writer doesn't research, so it gets the rules that shape the guide plus the JSON shape.
const WRITER_RULES = `You turn research notes into an OAuth setup and approval guide for a developer building an AI agent. The notes are your only sources: cite their URLs, never invent one, and mark anything they don't cover "inferred" or "unknown".
Audience (given in the request): "my users" = other people connect their own accounts, a launch: include every approval REQUIRED before they can sign in (review, verification, security assessment, certification, user caps, admin consent), each wait its own step with kind "wait", owner "provider" and minutes_min/minutes_max (1 day = 1440, 1 week = 10080). Optional listings or approvals that apply only in some cases are NOT steps: put them in blockers or paths and say when they apply. "Just me" = the developer's own account: skip review steps unless required even for one account.
Route: a real OAuth connection, never a personal token or API key (mention one only in paths). Composio with managed auth: users sign in through Composio's already-approved app, so no app registration, redirect URI or client secret steps; their own app in Composio means the provider's review applies to them.
verdict.difficulty rates the provider side, not the code: easy = self-serve, no review; moderate = extra accounts/setup or approval only in some cases; hard = a required review, verification, assessment, certification or user cap; blocked = partner program or plan they can't get. difficulty_reason names that provider fact.
Steps: 6-10, in order, from zero to the agent doing the job for a real user, ending with agent steps that add the sign-in to their code, call the action for the job, and test it end to end. Each step: title at most 6 words; 1-3 actions of at most 12 words with exact buttons in **bold**; detail at most 40 words. owner "you" for console clicks behind their login, decisions, payments, copying secrets into .env; "agent" for anything doable in code, a CLI or an API, with a ready-to-paste agent_prompt specific to this app and job (never secret values); "provider" for waits. Plain words; put unavoidable terms in glossary.
Prerequisites: accounts and access needed before step 1, each with its own needs (at most 4) and what is accepted instead.
Evidence: label each step, blocker and key claim "verified" (in a source), "inferred" or "unknown". Keep hands-on time separate from waiting time. No citation markers like [1].`;
const WRITER_SHAPE = (() => { const k = SYSTEM_PROMPT.lastIndexOf("\n{\n"); return k > 0 ? SYSTEM_PROMPT.slice(k + 1) : ""; })();

async function parallelJSON(system, userMsg) {
  const key = process.env.PARALLEL_API_KEY;
  // As a fallback backend the research prompt can arrive with a note appended (e.g. about web results), so match its start.
  if (system.startsWith(SYSTEM_PROMPT) && WRITER_SHAPE) system = `${WRITER_RULES}\n\nThe JSON shape:\n${WRITER_SHAPE}${system.slice(SYSTEM_PROMPT.length)}`;
  const sys = `${system}\n\nReply with ONLY one valid JSON object. No prose before or after it, no code fence.`;
  // Instructions + input together must stay under the cap. Keep the start (the task) and the end (the research
  // notes and sources) of the input, and cut from the middle.
  const LIMIT = Number(process.env.PARALLEL_JSON_CHARS) || 19500;
  const fit = fitParallel;
  const room = LIMIT - sys.length - 100;
  if (room < 3000) throw Object.assign(new Error(`Parallel JSON: instructions too long (${sys.length} chars)`), { status: 502 });
  const msg = fit(String(userMsg), room);
  const model = process.env.PARALLEL_JSON_MODEL || "speed";
  const chat = (extra) => ["https://api.parallel.ai/chat/completions", { model, stream: false, messages: [{ role: "system", content: sys }, { role: "user", content: msg }], ...extra },
    (d) => d.choices?.[0]?.message?.content || ""];
  const tries = [
    chat({ response_format: { type: "json_object" } }),
    chat({}),
    ["https://api.parallel.ai/v1/responses", { model: "parallel", reasoning: { effort: "low" }, input: [{ role: "system", content: sys }, { role: "user", content: msg }] },
      (d) => d.output_text || (d.output || []).flatMap((o) => o.content || []).map((c) => c.text || "").join("")],
  ];
  const errors = [];
  for (const [url, body, read] of tries) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw apiError(`Parallel JSON (${url.includes("responses") ? "responses" : body.response_format?.type || "plain"})`, res, data);
      const text = read(data);
      if (parseJsonLoose(text)) return { text, queries: [], sources: [], finish: "stop" };
      await fs.writeFile(path.join(ROOT, "last-bad-reply.txt"), `Parallel JSON (${model}) reply, ${String(text).length} chars, finish: ${data.choices?.[0]?.finish_reason || data.status || "?"}\n\n${text}`).catch(() => {});
      throw new Error(`Parallel JSON replied but not as JSON (${String(text).length} chars, saved to last-bad-reply.txt): ${String(text).slice(0, 80)}`);
    } catch (err) {
      errors.push(err.message);
      console.error(err.message);
    }
  }
  throw Object.assign(new Error(errors.join(" | ").slice(0, 600)), { status: 502 });
}

// Google keeps adding and retiring model ids (Gemini 3 Flash, Gemma 4...), so the list is read from the API at startup.
let geminiModels = (process.env.GEMINI_FALLBACKS || "gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash,gemini-flash-lite-latest").split(",").map((m) => m.trim()).filter(Boolean);
let gemmaModels = ["gemma-3-27b-it"];
const version = (m) => parseFloat(m.match(/-(\d+(?:\.\d+)?)/)?.[1] || 0);
async function discoverGeminiModels() {
  if (!process.env.GEMINI_API_KEY) return;
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY } });
    const data = await res.json();
    const ids = (data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => m.name.replace(/^models\//, ""));
    const flash = ids.filter((m) => /^gemini-[\d.]+-flash(-lite)?(-preview)?(-\d{2}-\d{4})?$/.test(m))
      .sort((a, b) => /lite/.test(a) - /lite/.test(b) || version(b) - version(a) || /preview/.test(a) - /preview/.test(b));
    const gemma = ids.filter((m) => /^gemma-\d/.test(m) && /-it$/.test(m) && !/-e\d+b|-1b|-270m/.test(m))
      .sort((a, b) => version(b) - version(a) || parseFloat(b.match(/(\d+)b-/)?.[1] || 0) - parseFloat(a.match(/(\d+)b-/)?.[1] || 0));
    if (!process.env.GEMINI_FALLBACKS && flash.length) geminiModels = flash.slice(0, 5);
    if (gemma.length) gemmaModels = gemma.slice(0, 2);
    BACKENDS = buildBackends();
  } catch (err) {
    console.error("Couldn't list Gemini models, using the built-in list:", err.message);
  }
}

// Order: Parallel's chat first (search built in, cheapest effort), then Gemini models that search,
// then Gemma (given Parallel search results), then Groq and OpenRouter if their keys are set.
function buildBackends() {
  const g = process.env.GEMINI_API_KEY;
  return [
    ...(process.env.PARALLEL_API_KEY && process.env.PARALLEL_CHAT !== "off" ? [{ name: "parallel chat", search: true, vision: false, searchOnly: true, call: (sy, u) => parallelChat(sy, u) }] : []),
    ...(g ? [...new Set([...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []), ...geminiModels])].map((m) => ({ name: m, search: true, vision: true, call: (sy, u, o) => gemini(m, sy, u, o) })) : []),
    // Parallel writes the JSON itself when the Gemini Flash models are used up, before the slower Gemma models.
    ...(process.env.PARALLEL_API_KEY && process.env.PARALLEL_JSON !== "off" ? [{ name: "parallel json", search: false, vision: false, call: (sy, u) => parallelJSON(sy, u) }] : []),
    ...(g ? gemmaModels.map((m) => ({ name: m, search: false, vision: true, call: (sy, u, o) => gemini(m, sy, u, o) })) : []),
    ...(process.env.GROQ_API_KEY ? [{ name: "groq gpt-oss-120b", search: true, vision: false,
      call: (sy, u, o) => openaiStyle("https://api.groq.com/openai/v1/chat/completions", process.env.GROQ_API_KEY, "Groq", process.env.GROQ_MODEL || "openai/gpt-oss-120b", sy, u, { ...o, webTool: o.search }) }] : []),
    ...(process.env.OPENROUTER_API_KEY ? [{ name: "openrouter free", search: false, vision: true,
      call: (sy, u, o) => openaiStyle("https://openrouter.ai/api/v1/chat/completions", process.env.OPENROUTER_API_KEY, "OpenRouter", process.env.OPENROUTER_MODEL || "openrouter/free", sy, u, o) }] : []),
  ];
}
let BACKENDS = buildBackends();
const usedUp = new Map(); // backend -> time its limit resets

// Parallel's Search API gives the models without built-in search (OpenRouter, Gemma) real web results.
// Cost-tuned: turbo mode ($1 per 1,000 calls, ~200ms), one call per answer with a few queries, short excerpts.
async function parallelSearch(userMsg, emit) {
  if (!process.env.PARALLEL_API_KEY) return null;
  const app = (userMsg.match(/^(?:App|Guide for):?\s*([^\n(:]+)/m)?.[1] || "").trim();
  const problem = (userMsg.match(/^(?:What went wrong|Their latest message):\s*(.+)$/m)?.[1] || "").slice(0, 150);
  const queries = [...new Set([
    problem && `${app} ${problem}`,
    `${app} developer API authentication setup`,
    `${app} OAuth scopes permissions`,
    `Composio ${app} toolkit`,
  ].filter(Boolean))].slice(0, 4);
  for (const mode of [process.env.PARALLEL_MODE || "turbo", "fast"]) {
    try {
      const res = await fetch("https://api.parallel.ai/v1/search", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": process.env.PARALLEL_API_KEY },
        body: JSON.stringify({ mode, objective: `Official docs and forum answers to help a developer connect ${app || "an app"} to their AI agent. ${problem}`.slice(0, 900), search_queries: queries, max_chars_total: 9000, advanced_settings: { max_results: 8, excerpt_settings: { max_chars_per_result: 1200 } } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error?.message || data.detail || res.statusText);
      for (const q of queries) emit("progress", { kind: "search", text: q });
      const results = (data.results || []).filter((r) => r.url).slice(0, 8);
      return {
        sources: results.map((r) => ({ url: r.url, title: r.title || r.url })),
        text: results.map((r, k) => `[${k + 1}] ${r.title || ""} (${r.url})\n${(r.excerpts || []).join(" … ").slice(0, 1200)}`).join("\n\n"),
      };
    } catch (err) {
      console.error(`Parallel search (${mode}) failed:`, err.message);
    }
  }
  return null;
}

// Try each backend in order; skip ones used up today, missing, or unable to take this request.
async function askFree(system, userMsg, emit = () => {}, { image = null, search = true } = {}) {
  const errors = [];
  let webResults; // fetched at most once per answer, only if a model without search is reached
  for (const b of BACKENDS) {
    if ((usedUp.get(b.name) || 0) > Date.now() || (image && !b.vision) || (!search && b.searchOnly)) continue;
    try {
      // No built-in search: fetch results from Parallel once and hand them to the model.
      if (search && !b.search && webResults === undefined) webResults = await parallelSearch(userMsg, emit);
      const web = search && !b.search ? webResults : null;
      const out = await b.call(system + (web ? `\n\nWeb search results (from Parallel) are included below the request. Use them as your sources and cite their URLs; anything they don't cover, mark "inferred" or "unknown".` : ""),
        web ? `${userMsg}\n\nWeb search results:\n${web.text}` : userMsg, { image, search: search && !web });
      if (web) out.sources = web.sources;
      if (!out.text) throw Object.assign(new Error(`${b.name} returned no text (${out.finish || "unknown"})`), { status: 502 });
      if (search) emit("progress", { kind: "note", text: b.search ? `Researched with ${b.name} + web search` : web ? `Researched with ${b.name} + Parallel web search` : `Answered with ${b.name} without web search (the free search models are used up for today)` });
      for (const q of out.queries) emit("progress", { kind: "search", text: q });
      return { text: out.text, sources: out.sources, model: b.name };
    } catch (err) {
      errors.push(err.message);
      console.error(`${b.name} failed (${err.status || "no status"}): ${String(err.message).slice(0, 200)}`);
      if (err.status === 429) usedUp.set(b.name, Date.now() + Math.min(err.retryMs, 24 * 3600e3));
      if (![429, 404, 400, 403, 402, 413, 500, 502, 503, 504].includes(err.status)) throw err;
      emit("progress", { kind: "note", text: err.status === 429 ? `Free limit reached on ${b.name}, switching model…` : `${b.name} couldn't take this, trying another model…` });
    }
  }
  if (!BACKENDS.length) throw new Error("No model key set. Add GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY to .env.");
  throw new Error(errors.some((e) => /quota|exceeded|rate limit|429/i.test(e))
    ? "Every free model has hit its daily limit. Add another free key to .env (GROQ_API_KEY from console.groq.com, OPENROUTER_API_KEY from openrouter.ai), or try again tomorrow."
    : `Every model failed: ${errors.at(-1) || "unknown error"}`);
}

const ask = (system, userMsg, emit, opts) =>
  PROVIDER === "anthropic" ? askClaude(system, userMsg, emit, opts) : askFree(system, userMsg, emit, { search: opts?.search ?? true });

async function runResearch(input, emit) {
  const { json: guide, sources, written_by } = await askJSON(SYSTEM_PROMPT, await withLessons(guideRequest(input), input.app), emit);
  guide.searched_urls = sources;
  guide.written_by = written_by || MODEL;
  if (input.brief) {
    // Keep the fit check with the guide: the dimensions and the developer's answers explain why it looks the way it does.
    guide.fit = { actions: input.brief.actions, dimensions: input.brief.dimensions, composio: input.brief.composio, answers: input.answers || {}, decisions: input.brief.decisions || [] };
    if (input.brief.composio?.api_checked || input.brief.composio?.mismatch_fixed || input.brief.composio?.catalog_checked) guide.composio = { ...guide.composio, ...pickComposioCheck(input.brief.composio) };
  }
  ensureAgentSteps(guide, input);
  return verifyLinks(guide, emit);
}

// A guide that stops at "signed in" leaves the builder without the part their coding agent can do.
// If the model left out the code or test step, add it, owned by the agent.
function ensureAgentSteps(guide, input) {
  const steps = guide.steps || (guide.steps = []);
  const hasCode = steps.some((s) => s.owner === "agent" && s.kind === "code");
  const hasTest = steps.some((s) => s.owner === "agent" && s.kind === "test");
  if (hasCode && hasTest) return;
  const app = guide.app || input.app;
  const viaComposio = input.answers?.connect_via !== "direct";
  const how = viaComposio ? `using the Composio SDK and my ${app} auth config` : `with ${app}'s OAuth flow, storing and refreshing tokens safely`;
  const add = [
    !hasCode && { title: `Connect ${app} in your code`, actions: ["Copy the prompt below into your coding agent.", `Check it reports your ${app} account as connected.`], detail: "Your agent writes the code that connects your own account and gives the agent a tool for the job.", url: null, kind: "code", owner: "agent", time: "15-30 min", minutes_min: 15, minutes_max: 30, done_when: `Your ${app} account shows as connected and the agent has a tool for the job.`, evidence: "inferred",
      agent_prompt: viaComposio
        ? `In this project's language, following how its existing tools are defined: connect my own ${app} account to my agent using the Composio SDK and my ${app} auth config. 1) Put COMPOSIO_API_KEY in the .env next to the code that runs the agent, check no other .env in the project sets it, and prove it works by listing my Composio auth configs. 2) Use one fixed user id for me, "me". Create a sign-in link for that user id, print it so I can open it, and wait until the connected account is ACTIVE. 3) Add a tool to my agent for this job: ${input.job}. Register it with the agent.`
        : `In this project's language, following how its existing tools are defined: connect my own ${app} account to my agent ${how}. Put the key or secret in the .env next to the code that runs the agent, check no other .env in the project sets it, and prove it works with one harmless read call. Then add a tool to my agent for this job: ${input.job}, and register it with the agent.` },
    !hasTest && { title: "Make your agent do the job", actions: ["Copy the prompt below into your coding agent.", "Run it once with your own account."], detail: "This is the point of the prototype: your agent using the connection.", url: null, kind: "test", owner: "agent", time: "15-30 min", minutes_min: 15, minutes_max: 30, done_when: `Your agent completed the job in ${app} for your own account.`, evidence: "inferred",
      agent_prompt: `First check the connect step really happened: the ${app} tool exists and is registered with my agent${viaComposio ? ', the Composio SDK is installed, and the connected account for user id "me" is ACTIVE' : ""}. ${viaComposio ? ' Print which Composio auth config (managed or my own app) and which user id the run uses; if they differ from what we set up, stop and tell me.' : ""} If anything is missing, stop and tell me what. Otherwise run my agent once on this job with my own account: ${input.job}. Show me what changed in ${app}.` },
  ].filter(Boolean);
  // Code and test come after setup but before any provider review wait at the end.
  let at = steps.length;
  while (at > 0 && steps[at - 1].owner === "provider") at--;
  steps.splice(at, 0, ...add);
}

async function runFit(input, emit) {
  const catalog = await composioCatalog(input.app);
  if (catalog) emit("progress", { kind: "note", text: catalog.match ? `Composio catalog: ${catalog.match.name} toolkit found${catalog.match.managed ? ", managed sign-in available" : ""}` : `Composio catalog: no toolkit for ${input.app}` });
  const { json: brief, sources } = await askJSON(FIT_PROMPT, await withLessons(fitRequest(input, catalog), input.app), emit, { searches: 6, fetches: 4 });
  brief.searched_urls = sources;
  if (catalog) applyCatalog(brief, input, catalog);
  else { guardToolkitMatch(brief, input); await confirmComposio(brief, emit); }
  // The API can only confirm a slug exists, not that it is this app: check the name it returns too.
  if (brief.composio?.api_name && !sameApp(input.app, brief.composio.api_name) && !sameApp(brief.app, brief.composio.api_name)) {
    brief.composio.toolkit_slug = brief.composio.api_name; guardToolkitMatch(brief, input);
  }
  brief.decisions = cleanDecisions(brief);
  const view = { sources: brief.sources || [] };
  await verifyLinks(view, emit, { repair: false });
  brief.sources = view.sources;
  delete brief.searched_urls;
  return brief;
}

// ---------- decisions ----------
// The model may only use these decision ids, so it can't invent questions the developer can't answer.
// "users" and "branding" are fixed questions the server adds, so their wording never drifts.
const DECISION_IDS = ["users", "connect_via", "branding", "app_choice", "permissions"];

// Who connects decides whether approval is in the guide at all; "my users" is the default because that's a launch.
function usersDecision(brief) {
  const review = (brief.dimensions || []).find((d) => d.key === "review")?.note || "";
  return {
    id: "users", title: "Who will connect their account?", why_it_matters: "Other people signing in can mean an approval wait.", show_if: null, evidence: review ? "inferred" : "unknown",
    options: [
      { value: "my_users", label: "My users", what_it_means: "Other people connect their own accounts to your agent.", pros: ["Ready to launch"], cons: ["May need the app's approval"], time: "Hours", wait: "Varies by app", cost: "Usually free", recommended: true, recommended_reason: "You're building for other people, so the guide covers what it takes to launch." },
      { value: "just_me", label: "Just me", what_it_means: "Only your own account, to try the idea first.", pros: ["Fastest start", "Usually no approval"], cons: ["Others can't connect yet"], time: "Under an hour", wait: "Usually none", cost: "Usually free", recommended: false },
    ],
  };
}

// With managed auth and real users, the sign-in screen's name is a real trade-off: Composio's approved app or your own.
function brandingDecision(brief) {
  return {
    id: "branding", title: "Whose name should users see at sign-in?", why_it_matters: "Your own name means your own approval.", show_if: { connect_via: "composio", users: "my_users" }, evidence: "inferred",
    options: [
      { value: "composio_name", label: "Composio's name", what_it_means: `Users sign in through Composio's ${brief.app} app, already approved.`, pros: ["No app to register", "No review for you"], cons: ["Composio's name on screen"], time: "Minutes", wait: "None", cost: "Free to start", recommended: true, recommended_reason: "It skips registering and reviewing your own app. You can switch to your own later." },
      { value: "own_app", label: "Your own app", what_it_means: `Register your own ${brief.app} app and plug it into Composio.`, pros: ["Your name on screen", "Your own limits"], cons: ["You go through review"], time: "Hours", wait: "Depends on the app", cost: "Usually free", recommended: false },
    ],
  };
}

// Used when the model leaves out the one decision every guide needs.
function defaultConnectVia(brief) {
  const c = brief.composio || {};
  const has = String(c.toolkit_available).toLowerCase() === "yes";
  const managed = String(c.managed_auth).toLowerCase() === "yes";
  return {
    id: "connect_via",
    title: `How should your agent connect to ${brief.app}?`,
    why_it_matters: "This decides how much you build yourself.",
    show_if: null,
    evidence: "inferred",
    options: [
      {
        value: "composio", label: "Use Composio",
        what_it_means: has ? `Click Connect in Composio and sign in to your ${brief.app}.` : `Composio doesn't support ${brief.app} yet.`,
        pros: has ? ["No sign-in code to write", ...(managed ? ["Working in minutes"] : [])] : [],
        cons: has ? ["One more account to create"] : ["Not available for this app"],
        time: has ? (managed ? "Minutes" : "Under an hour") : "n/a", wait: "None", cost: has ? "Free to start" : "n/a",
        recommended: has, recommended_reason: has ? "It's the fastest way to a working agent. You can switch later." : "",
      },
      {
        value: "direct", label: "Connect it yourself",
        what_it_means: `You register your own ${brief.app} OAuth app and your agent's code handles the sign-in.`,
        pros: ["No extra service", "Full control"],
        cons: ["More setup steps", "You fix it when it breaks"],
        time: "An hour or more", wait: "Usually none", cost: "Free, but your time",
        recommended: !has, recommended_reason: has ? "" : `Composio doesn't support ${brief.app} yet, so this is the way in.`,
      },
    ],
  };
}

function cleanDecisions(brief) {
  let ds = (brief.decisions || []).filter((d) => DECISION_IDS.includes(d.id) && (d.options || []).length >= 2);
  ds = ds.filter((d, k) => ds.findIndex((x) => x.id === d.id) === k);
  // No toolkit for this app: the model can't recommend going through Composio, so use the fixed wording.
  const none = String(brief.composio?.toolkit_available).toLowerCase() === "no";
  if (none) ds = ds.filter((d) => d.id !== "connect_via");
  if (!ds.some((d) => d.id === "connect_via")) ds.unshift(defaultConnectVia(brief));
  ds = ds.filter((d) => !["users", "branding"].includes(d.id));
  ds.unshift(usersDecision(brief));
  if (!none && String(brief.composio?.managed_auth).toLowerCase() === "yes") ds.push(brandingDecision(brief));
  // A supported look-alike app is a real choice: offer it, but staying is the default.
  const swaps = (brief.alternatives || []).filter((a) => a.type === "composio_toolkit");
  if (none && swaps.length && !ds.some((d) => d.id === "app_choice")) ds.push({
    id: "app_choice", title: "Could you use a different app?", why_it_matters: "Composio supports these, not this one.", show_if: null, evidence: "verified",
    options: [
      { value: "stay", label: `Stay on ${brief.app}`, what_it_means: `You connect ${brief.app} yourself.`, pros: ["Your data stays put"], cons: ["More setup work"], time: "An hour or more", wait: "Usually none", cost: "Usually free", recommended: true, recommended_reason: `Your data is in ${brief.app}, so this is usually what you want.` },
      ...swaps.slice(0, 2).map((a) => ({ value: a.name, label: `Switch to ${a.name}`, what_it_means: a.why, pros: ["Composio handles sign-in"], cons: [a.tradeoffs || "A different app"], time: "Minutes", wait: "None", cost: "Free to start", recommended: false })),
    ],
  });
  for (const d of ds) {
    const recs = d.options.filter((o) => o.recommended);
    if (recs.length !== 1) d.options.forEach((o, k) => (o.recommended = recs.length ? o === recs[0] : k === 0));
  }
  return ds.sort((a, b) => DECISION_IDS.indexOf(a.id) - DECISION_IDS.indexOf(b.id));
}

// ---------- Composio check ----------
// With a COMPOSIO_API_KEY, the toolkit and its managed auth are confirmed against Composio's API
// instead of trusting what the research agent read on the web.

const COMPOSIO_API = "https://backend.composio.dev/api/v3.1/toolkits";

async function composioToolkit(slug) {
  if (!process.env.COMPOSIO_API_KEY || !/^[a-z0-9_-]+$/i.test(slug || "")) return null;
  try {
    const res = await fetch(`${COMPOSIO_API}/${encodeURIComponent(slug.toLowerCase())}`, {
      headers: { "x-api-key": process.env.COMPOSIO_API_KEY },
      signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
    });
    if (res.status === 404) return { exists: false };
    if (!res.ok) return null;
    const t = await res.json();
    const managed = t.composio_managed_auth_schemes;
    return {
      exists: true,
      name: t.name || slug,
      managed: Array.isArray(managed) ? managed.length > 0 : null,
      tools_count: t.meta?.tools_count ?? null,
      triggers_count: t.meta?.triggers_count ?? null,
    };
  } catch {
    return null;
  }
}

function pickComposioCheck(c) {
  const { api_checked, toolkit_available, managed_auth, evidence, tools_count } = c;
  return { api_checked, toolkit_available, managed_oauth: managed_auth, evidence, tools_count };
}

// Composio's toolkit catalog (the data behind composio.dev/toolkits), searched by app name.
async function composioCatalog(app) {
  if (!process.env.COMPOSIO_API_KEY || !app) return null;
  for (const base of ["https://backend.composio.dev/api/v3.1", "https://backend.composio.dev/api/v3"]) {
    try {
      const res = await fetch(`${base}/toolkits?search=${encodeURIComponent(app)}&limit=25`, { headers: { "x-api-key": process.env.COMPOSIO_API_KEY }, signal: AbortSignal.timeout(LINK_TIMEOUT_MS) });
      if (!res.ok) continue;
      const items = (await res.json()).items || [];
      const hit = items.find((t) => sameApp(app, t.name) || sameApp(app, t.slug));
      return {
        match: hit ? { slug: hit.slug, name: hit.name, managed: (hit.composio_managed_auth_schemes || []).length > 0, no_auth: !!hit.no_auth, tools_count: hit.meta?.tools_count ?? null, triggers_count: hit.meta?.triggers_count ?? null } : null,
        nearby: items.filter((t) => t !== hit).slice(0, 5).map((t) => t.name || t.slug),
      };
    } catch {}
  }
  return null;
}

// The catalog is the source of truth for whether this app has a toolkit; the model's own claim is overruled.
function applyCatalog(brief, input, catalog) {
  if (!catalog) return;
  const c = (brief.composio ||= {});
  const m = catalog.match;
  if (m) Object.assign(c, { toolkit_available: "yes", toolkit_slug: m.slug, managed_auth: m.managed || m.no_auth ? "yes" : "no", tools_count: m.tools_count, evidence: "verified", catalog_checked: true, api_checked: true,
    note: `Composio has a ${m.name} toolkit${m.tools_count ? ` with ${m.tools_count} actions` : ""}${m.managed ? "; Composio can handle the sign-in for you" : ""}.` });
  else {
    if (c.toolkit_slug && !sameApp(input.app, c.toolkit_slug)) guardToolkitMatch(brief, input);
    Object.assign(c, { toolkit_available: "no", toolkit_slug: null, covers_use_case: "no", managed_auth: "no", matching_actions: [], evidence: "verified", catalog_checked: true, api_checked: true,
      note: `Composio's toolkit catalog has no toolkit for ${input.app}.` });
  }
  brief.alternatives = (brief.alternatives || []).filter((a) => a.type !== "composio_toolkit" || !sameApp(input.app, a.name));
}

// Models sometimes "find" a toolkit for a look-alike app (Cal.com for SavvyCal). The toolkit's name
// must match the app; if it doesn't, it becomes an alternative to switch to, never this app's toolkit.
const normName = (x) => String(x || "").toLowerCase().replace(/\.(com|io|ai|app|co)\b/g, "").replace(/[^a-z0-9]/g, "");
const firstWord = (x) => normName(String(x || "").split(/[\s_-]+/)[0]);
const sameApp = (a, b) => { const x = normName(a), y = normName(b); return !!x && !!y && (x === y || firstWord(a) === y || firstWord(b) === x
  || ((x.startsWith(y) || y.startsWith(x)) && Math.min(x.length, y.length) >= 0.6 * Math.max(x.length, y.length))); };
function guardToolkitMatch(brief, input) {
  const c = (brief.composio ||= {});
  const slug = c.toolkit_slug;
  if (!slug || [input.app, brief.app, brief.product].some((n) => sameApp(n, slug))) return;
  const label = /^[a-z]{1,4}$/.test(slug) && brief.composio?.api_name ? brief.composio.api_name : slug.charAt(0).toUpperCase() + slug.slice(1);
  brief.alternatives = [...(brief.alternatives || []), { type: "composio_toolkit", name: label, toolkit_slug: slug, why: `Composio has a toolkit for ${slug}, a different app from ${input.app}. Only an option if you can switch apps.`, tradeoffs: `It does not connect to your ${input.app} account.` }];
  Object.assign(c, { toolkit_available: "no", toolkit_slug: null, covers_use_case: "no", matching_actions: [], managed_auth: "no", evidence: "verified", mismatch_fixed: true,
    note: `Composio has no toolkit for ${input.app}. The "${slug}" toolkit is for a different app.` });
}

async function confirmComposio(brief, emit) {
  const c = (brief.composio ||= {});
  if (!process.env.COMPOSIO_API_KEY) return;
  emit("progress", { kind: "note", text: "Checking Composio's toolkit list" });
  const own = await composioToolkit(c.toolkit_slug || slugify(brief.app || "").replace(/-/g, ""));
  if (own) {
    c.api_checked = true;
    c.toolkit_available = own.exists ? "yes" : "no";
    if (own.exists) c.api_name = own.name;
    if (own.exists && own.managed !== null) c.managed_auth = own.managed ? "yes" : "no";
    if (own.tools_count != null) c.tools_count = own.tools_count;
    c.evidence = "verified";
  }
  // Alternatives that claim a Composio toolkit must actually have one.
  for (const alt of brief.alternatives || []) {
    if (alt.type !== "composio_toolkit") continue;
    const t = await composioToolkit(alt.toolkit_slug || slugify(alt.name).replace(/-/g, ""));
    if (t) alt.api_checked = t.exists;
  }
  brief.alternatives = (brief.alternatives || []).filter((a) => a.type !== "composio_toolkit" || a.api_checked !== false);
  emit("progress", { kind: "note", text: `Composio: ${c.toolkit_available === "yes" ? `toolkit found${c.managed_auth === "yes" ? ", managed auth available" : ""}` : "no toolkit for this app"}` });
}

// Models wrap JSON in prose, leave trailing commas or comments, or get cut off. Try the cheap fixes first.
function parseJsonLoose(text) {
  const t = String(text || "");
  const fenced = [...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const braces = t.indexOf("{") >= 0 ? [t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)] : [];
  for (const raw of [...fenced, ...braces]) {
    for (const fix of [(x) => x,
      (x) => x.replace(/\/\/[^\n"]*$/gm, "").replace(/,\s*([}\]])/g, "$1"),
      (x) => x.replace(/[\u0000-\u0019]+/g, " ").replace(/,\s*([}\]])/g, "$1")]) {
      try { const v = JSON.parse(fix(raw)); if (v && typeof v === "object") return v; } catch {}
    }
  }
  return null;
}

function parseGuide(text) {
  const v = parseJsonLoose(text);
  if (!v) throw Object.assign(new Error("Could not parse the JSON the model returned."), { badText: text });
  return stripCitations(v);
}

// Ask, and if the reply isn't valid JSON, hand it on. Parallel's chat researches well but answers in prose,
// so its answer and sources become research notes for a model that writes the JSON (Gemini, then Gemma).
async function askJSON(system, userMsg, emit, opts) {
  const first = await ask(system, userMsg, emit, opts);
  try { return { ...first, written_by: first.model, json: parseGuide(first.text) }; }
  catch {
    await fs.writeFile(path.join(ROOT, "last-bad-reply.txt"), String(first.text || "")).catch(() => {});
    if (PROVIDER === "anthropic") {
      const fixed = await ask("Return ONLY valid JSON. No prose, no code fence.", `Turn this into one valid JSON object with the same content:\n\n${String(first.text).slice(0, 60000)}`, emit);
      return { ...first, written_by: first.model, json: parseGuide(fixed.text) };
    }
    emit("progress", { kind: "note", text: "Turning the research into your guide…" });
    const notes = `${userMsg}\n\nResearch notes from a live web search (use them as your sources and cite their URLs; mark anything they don't cover "inferred" or "unknown"):\n${String(first.text).slice(0, 30000)}${(first.sources || []).length ? `\nSources found:\n${first.sources.slice(0, 20).map((x) => `- ${x.title || ""} ${x.url}`).join("\n")}` : ""}`;
    // Parallel writes the JSON itself first (structured outputs); Gemini and Gemma are the backup.
    if (process.env.PARALLEL_API_KEY && first.model === "parallel chat" && process.env.PARALLEL_JSON !== "off") {
      try {
        const out = await parallelJSON(system, notes);
        return { text: out.text, sources: first.sources || [], written_by: `${first.model} research + parallel json`, json: parseGuide(out.text) };
      } catch (err) {
        console.error("Parallel JSON failed, handing the notes to Gemini/Gemma:", err.message);
      }
    }
    const second = await askFree(system, notes, emit, { search: false });
    try { return { text: second.text, sources: first.sources || [], written_by: `${first.model} research + ${second.model}`, json: parseGuide(second.text) }; }
    catch {
      await fs.writeFile(path.join(ROOT, "last-bad-reply.txt"), String(second.text || "")).catch(() => {});
      const fixed = await askFree("Return ONLY valid JSON. No prose, no code fence.", `Fix only the JSON syntax of this, keeping every field and value:\n\n${String(second.text).slice(0, 60000)}`, emit, { search: false });
      return { text: fixed.text, sources: first.sources || [], written_by: `${first.model} research + ${fixed.model || "fix-up"}`, json: parseGuide(fixed.text) };
    }
  }
}

// Search-grounded models leave markers like "[cite:1 (search result 3)]" or "[2, 5]" in their text.
const CITATION = /\s*【[^】]*】|\s*\[(?:cite[^\]]*|\d+(?:\s*,\s*\d+)*)\]|\s*\((?:search result|source)\s*\d+[^)]*\)/gi;
function stripCitations(v) {
  if (typeof v === "string") return v.replace(CITATION, "").trim();
  if (Array.isArray(v)) return v.map(stripCitations);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "url" ? x : stripCitations(x)]));
  return v;
}

// ---------- "Show me your screen" ----------
// The builder sends a screenshot of where they are; the model says where that is and the next clicks.
// This covers the middle screens no research can see (logged-in dashboards, onboarding flows).

const SCREEN_PROMPT = `You help a first-time builder who is following a step-by-step guide to connect an app to their AI agent. They sent a screenshot of their screen.
Say where they are and exactly what to do next on THIS screen to finish the current step. Plain words, no jargon.
If the screen asks for something they may not have (a website, a phone number, a company name), say what works instead and whether that's fine (e.g. "fine for testing; a public app later needs a real one"). Never suggest false details the provider verifies, or someone else's domain.
If the screenshot shows the step is already done, say so. You may get the chat so far on this step; build on it and don't repeat what didn't work. If they are on the wrong page, say how to get to the right one.
Reply with ONLY one JSON object in a \`\`\`json code fence:
{ "reply": "one or two plain sentences answering them", "where": "short name of this screen, e.g. HubSpot sign-up → Company website", "actions": [ "1-3 short instructions, exact buttons or fields in **bold**" ], "note": "one sentence of context or caution, or null", "step_done": false, "off_track": false, "evidence": "verified | inferred | unknown" }`;

async function askVision(system, text, image) {
  const m = String(image || "").match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
  if (!m) throw new Error("Send a PNG, JPEG, WebP or GIF screenshot.");
  const [, mime, b64] = m;
  if (PROVIDER === "anthropic") {
    const r = await client.messages.create({ model: MODEL, max_tokens: 1500, system, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mime, data: b64 } }, { type: "text", text }] }] });
    return r.content.map((b) => b.text || "").join("");
  }
  return (await askFree(system, text, undefined, { image: { mime, b64 }, search: false })).text;
}

// The help chat sends earlier turns on this step so each answer builds on what was already tried.
function chatText(history) {
  const turns = (Array.isArray(history) ? history : []).slice(-12)
    .map((h) => `${h.role === "user" ? "Developer" : "You"}: ${String(h.text || "").slice(0, 800)}`).filter((t) => t.length > 12);
  return turns.length ? `Chat so far on this step:\n${turns.join("\n")}` : "";
}

// ---------- Stage chats ----------
// The guide's steps are grouped into the stages every OAuth setup goes through. Each stage is one chat:
// it opens with instructions for the builder's screen, answers questions, errors and screenshots in the
// same window, checks the stage's Definition of done on every turn, and hands off to the next stage
// once the builder confirms. Chats, the ledger and handoffs live in the browser's saved plan.

const STAGE_TEMPLATE = [
  { id: "register", look_up: ["the current developer console page and button names for creating an OAuth app", "which app type gives a client ID, client secret and sign-in screen (public/OAuth), versus internal/personal types", "fields that can't be changed after creation"], title: "Register the app", owner: "you", goal: (g) => `An OAuth app for your agent exists in ${g.app}'s developer area.`,
    dod: (g) => [`The app shows in ${g.app}'s developer settings`], match: (s) => ["signup", "dev_space", "register"].includes(s.stage) || ["account", "register"].includes(s.kind) },
  { id: "callback", look_up: ["where the redirect URI is entered and its format rules (localhost, http, exact match)", "the minimum scopes or capabilities for the job", "whether the sign-in screen has a picker for what to share"], title: "Callback and permissions", owner: "you", goal: () => "The app sends you back to your agent and asks only for what the job needs.",
    dod: () => ["The redirect URI is saved exactly as your agent's code will use it", "The job's permissions (scopes) are set"], match: (s) => ["redirect", "scopes"].includes(s.stage) || ["scopes", "configure"].includes(s.kind) },
  { id: "keys", look_up: ["the exact tab and labels for the OAuth client ID and client secret", "any internal or personal token on the same page that must NOT be used"], title: "Get the keys", owner: "you", goal: () => "Your client ID and secret are saved where your agent's code reads them.",
    dod: () => ["Client ID saved in your agent's .env", "Client secret saved in the same .env"], match: (s) => s.stage === "keys" || s.kind === "credentials" },
  { id: "composio", title: "Connect in Composio", owner: "you", composio: true, goal: (g) => `Your own ${g.app} account is connected in Composio.`,
    dod: () => ["Your Composio API key works", "Your account shows ACTIVE in Composio for user id me"], match: () => false },
  { id: "code", look_up: ["the authorize URL and its required parameters", "the token endpoint and how it authenticates the client (HTTP Basic or form body)", "the current API version header", "refresh token behaviour", "the API call for the job in the current API version"], title: "Add sign-in to the agent", owner: "agent", goal: () => "Your agent's code can run the sign-in and keep the access it gets.",
    dod: () => ["Your coding agent reports the sign-in and token storage are added", "Its check passes (the tool is registered, keys are read from .env)"], match: (s) => s.kind === "code" },
  { id: "connect", look_up: ["what the sign-in screen shows, including any picker for what to share", "the error when the agent calls something the user didn't share"], title: "Connect your account", owner: "you", goal: (g) => `You sign in once with your own ${g.app} account.`,
    dod: (g) => [`You finished ${g.app}'s sign-in screen`, "A test call returns your own account"], match: (s) => s.stage === "connect" || (s.kind === "test" && s.owner !== "agent") },
  { id: "job", title: "Do the job", owner: "agent", goal: (g) => `Your agent does the job once: ${g.job}`,
    dod: (g) => [`The job's result is visible in ${g.app}`], match: (s) => s.kind === "test" && s.owner === "agent" },
  { id: "approval", title: "Wait for approval", owner: "provider", goal: () => "The provider approves what this route needs.",
    dod: () => ["The provider approved it"], match: (s) => ["wait", "submit"].includes(s.kind) || s.stage === "approval" },
];

function audienceLine(g) {
  return g.fit?.answers?.users !== "my_users" ? "Audience: just the builder's own account, for a prototype." : "Audience: the builder's users will connect their own accounts (a launch), so approval steps matter. The builder tests with their own account first.";
}

function buildStages(g) {
  const composio = /composio/.test(String(g.route?.choice || "")) || /composio/i.test(String(g.route?.name || ""));
  const tpl = STAGE_TEMPLATE.filter((t) => (composio ? !["register", "callback", "keys"].includes(t.id) : t.id !== "composio"));
  const byId = Object.fromEntries(tpl.map((t) => [t.id, []]));
  let last = tpl[0].id;
  (g.steps || []).forEach((s, k) => {
    let hit = tpl.find((t) => t.match(s));
    if (composio && !hit && ["signup", "dev_space", "register", "redirect", "keys", "connect"].includes(s.stage)) hit = tpl.find((t) => t.id === "composio");
    if (composio && hit && ["register", "callback", "keys"].includes(hit.id)) hit = tpl.find((t) => t.id === "composio");
    const id = hit ? hit.id : last;
    byId[id].push(k);
    last = id;
  });
  // Every OAuth route signs in once and does the job, even when the outline folded those into other steps.
  return tpl.filter((t) => byId[t.id].length || ["code", "job"].includes(t.id) || (composio ? t.id === "composio" : t.id === "connect"))
    .map((t) => ({ id: t.id, title: t.title, owner: t.owner, goal: t.goal(g), dod: t.dod(g), look_up: t.look_up || [], steps: byId[t.id] }));
}

const STAGE_CHAT_PROMPT = `You are the guide for ONE stage of connecting an app to a first-time builder's AI agent through OAuth. You stay in this stage's chat until its Definition of done is met. The builder is not a developer.
You get: the app, the job, the route, the stage contract (goal, Definition of done, who does it, the outline's short steps and ready-made prompts for it), every stage with its status, the ledger (facts saved in earlier stages), handoff notes, research notes for this stage, the chat so far, and their newest message (it may describe a screenshot or contain an error or their coding agent's output).
How to answer:
- At the START of the stage (no chat yet): give the first instructions. Where they should be (breadcrumb + an official URL you saw), then the clicks in order. Build on the ledger: reuse names and values already chosen. Also write "research_notes": 3-6 short lines of facts from the official docs that later turns will need (current menu and button names, exact formats, known errors and fixes).
- On every later turn: answer THEIR message for THEIR screen, in a few sentences, then the next 1-4 actions. If they hit an error, say plainly what it means and the fix. Never repeat instructions they already finished.
- Who does it matters. "you": clicks in a website, every button and field in **bold**, exact values in "value". "agent": the builder pastes a prompt into their coding agent (Cursor, Claude Code); give it in "agent_prompt" (start from the outline's ready-made prompt, fill in ledger values such as key names and the redirect URI, never secret values), and the actions are what to check in the agent's result. Never ask the builder to write code.
- Definition of done: on every turn, mark each item met or not from what they told you or showed you in THIS chat. Never mark an item met on a guess, from your own instructions, or because a step 'should' be done; if they report a check still failing, its item is not met. "done.met" is true only when every item is met; then write "handoff": 2-4 lines for the next stage (what exists now, names and where values are saved, anything to watch for).
- "record": facts to keep for later stages, as short key/value pairs (redirect_uri, agent_port, signin_route, callback_route, token_file, scopes, app_name, env_file, client_id_env_name, app_type). NEVER record a secret, token or password value: record where it is saved instead.
- If the problem belongs to an earlier stage (e.g. redirect_uri_mismatch while connecting means the callback stage is wrong), set "go_back" to that stage id with the reason. Don't fix it here.
- If you lack facts for their screen or error and the research notes don't cover it, set "research" to a short search query and give your best answer marked as a guess.
- Stay on this stage's goal. Something for a later stage → one line saying it comes later, EXCEPT the warnings below, which must come early.
OAuth traps (they apply to every app; check the official docs for this app's names):
- App type: if the provider offers more than one kind of app or integration (public vs internal/private, OAuth app vs personal token), say plainly which ONE to pick: the kind that gives a client ID, a client secret and a sign-in screen. Say in one line why the other kind won't work for this route.
- One-time choices: if a field can't be changed after creation (installation scope, workspace, app type), say so and recommend the value for a just-me prototype (usually the narrowest: their own workspace or account only).
- Keys: the client ID and client secret for OAuth are the ones the provider labels as OAuth / client credentials. An internal integration secret, personal access token or API key on the same page is a DIFFERENT credential and fails the sign-in. Use the provider's exact tab and label names. Remind them never to paste the secret into this chat.
- Two different addresses: the redirect URI (also called callback URL) is YOUR agent's address that the provider sends the builder back to, e.g. http://localhost:4200/callback. The authorization URL is the PROVIDER's sign-in page your agent opens. Never mix them up. If the console doesn't show an authorization URL, say the coding agent will build it from client_id, redirect_uri, response_type=code and any provider-only parameters from the docs.
- Redirect URI: don't ask the builder which URL their code uses (they can't know yet). Propose http://localhost:<their agent's port>/callback; if the ledger has no agent_port, ask only for the port their agent runs on. Record redirect_uri. Later stages reuse the ledger's routes and port exactly; never invent a different path.
- Share picker: if the provider's sign-in screen lets the user choose what to share (pages, repos, channels, calendars, workspaces), warn about it in the callback stage AND at the start of the connect stage: what to pick for this job, and the error they'll see if they skip it.
- Code stage agent_prompt must be complete, not one sentence: the files and routes to add (from the ledger, or ask the coding agent to find the server file), port and redirect URI, env variable names, the authorize URL with its required parameters plus a random state value, the token exchange exactly as the official docs say (endpoint, how the client ID and secret are sent: HTTP Basic header or form body), the current API version header from the docs, saving the whole token response (access and refresh token) to a local file the agent's own check reads (never .env, never browser storage), refreshing when it expires, and the call that does the job. Add the official doc links. If a detail isn't in the research notes, tell the coding agent to read that doc page instead of guessing.
- Names: never invent an app name, file, route or value. Use the ledger, or ask.
- Current docs win: if the outline's console path differs from the official docs you see now, follow the docs and say the screen may have been renamed.
- The request says who will connect (just the builder, or their users). Plain words, no jargon without a one-line explanation.
Reply with ONLY one JSON object:
{ "reply": "your answer, 1-4 short sentences, **bold** for buttons",
  "where": { "path": ["Google Cloud console", "Google Auth Platform", "Clients"], "url": "https://... or null" } or null,
  "actions": [ { "do": "Click **+ Create client**", "value": null } ],
  "agent_prompt": null,
  "dod": [ { "item": "copy each Definition of done item exactly", "met": false } ],
  "done": { "met": false, "evidence": null, "missing": "what is still missing, or null" },
  "record": { },
  "handoff": null,
  "go_back": null,
  "research": null,
  "ask": "one short question back to them, or null",
  "research_notes": null,
  "evidence": "verified | inferred | unknown",
  "sources": [ { "url": "https://...", "title": "..." } ] }`;

const SCREEN_DESCRIBE_PROMPT = `Describe this screenshot for someone guiding a first-time builder through an app's developer settings.
In 3-6 short lines: the page or dialog name, its main headings, the buttons and fields you can see, any error or warning text word for word, and anything that looks done or filled in.
Never copy a secret, token or password: write [hidden] instead. Plain text only.`;

async function describeScreen(image) {
  const m = String(image || "").match(/^data:(image\/(?:png|jpeg|webp|gif));base64,/);
  if (!m) throw new Error("Send a PNG, JPEG, WebP or GIF screenshot.");
  try {
    return String(await askVision(SCREEN_DESCRIBE_PROMPT, "Describe this screen.", image)).slice(0, 1500);
  } catch (err) {
    throw new Error(`Couldn't read the screenshot (${String(err.message).slice(0, 120)}). Describe what you see in words instead.`);
  }
}

function stageRequest(g, stages, st, b, screen) {
  const steps = st.steps.map((k) => g.steps[k]).filter(Boolean);
  const str = (x, n) => String(x ?? "").slice(0, n);
  const history = (Array.isArray(b.history) ? b.history : []).slice(-12).map((h) => `${h.role === "user" ? "Builder" : "You"}: ${str(h.text, 900)}`);
  const ledger = Object.entries(b.ledger && typeof b.ledger === "object" ? b.ledger : {}).slice(0, 30).map(([k, v]) => `- ${str(k, 40)}: ${str(v, 200)}`);
  const status = b.status && typeof b.status === "object" ? b.status : {};
  return [
    `App: ${g.app}`,
    `Job: ${g.job}`,
    `Route: ${g.route?.name || "see outline"}. ${audienceLine(g)}`,
    `Stages:\n${stages.map((x, k) => `${k + 1}. ${x.id} · ${x.title} (${x.owner})${x.id === st.id ? "  <- THIS STAGE" : status[x.id] === "done" ? "  [done]" : ""}`).join("\n")}`,
    `This stage: ${st.title}\nWho: ${st.owner === "agent" ? "YOUR CODING AGENT does this (the builder pastes a prompt)" : st.owner === "provider" ? "the provider (a wait)" : "YOU (clicks in a website or console)"}\nGoal: ${st.goal}\nDefinition of done:\n${st.dod.map((d) => `- ${d}`).join("\n")}`,
    `The outline's steps for this stage:\n${steps.map((s) => `- ${s.title}: ${(s.actions || []).join(" / ") || s.detail || ""}${s.url ? ` (page: ${s.url})` : ""}${s.agent_prompt ? `\n  Ready-made prompt: ${str(s.agent_prompt, 1500)}` : ""}`).join("\n") || "- none: work from the goal"}`,
    (g.scopes || []).length ? `Scopes for the job: ${g.scopes.map((x) => x.scope).join(", ")}` : "",
    `Ledger (saved in earlier stages):\n${ledger.join("\n") || "- nothing yet"}`,
    (Array.isArray(b.handoffs) && b.handoffs.length) ? `Handoff notes:\n${b.handoffs.slice(-4).map((h) => `- ${str(h, 500)}`).join("\n")}` : "",
    b.notes ? `Research notes for this stage:\n${str(b.notes, 2500)}` : "",
    history.length ? `Chat so far in this stage:\n${history.join("\n")}` : "This is the START of the stage: no chat yet.",
    b.back_from ? `They came back to this stage from a later one because: ${str(b.back_from, 300)}` : "",
    b.message || screen ? `Their newest message: ${str(b.message, 2000)}${screen ? `\nTheir screenshot shows:\n${screen}` : ""}` : "",
    b.research_query ? `Search for this before answering: ${str(b.research_query, 200)}` : "",
    !history.length && (st.look_up || []).length ? `Look up in ${g.app}'s official docs before answering, and put the answers in research_notes:\n${st.look_up.map((x) => `- ${x}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

function cleanStageReply(d, st, g, fresh = false) {
  const str = (x, n) => (typeof x === "string" && x.trim() ? x.trim().slice(0, n) : null);
  const where = d.where && typeof d.where === "object" ? d.where : null;
  const official = officialHosts(g, null);
  const dod = st.dod.map((item, k) => {
    const hit = (Array.isArray(d.dod) ? d.dod : []).find((x) => x && (x.item === item)) || (Array.isArray(d.dod) ? d.dod[k] : null);
    return { item, met: !fresh && !!hit?.met }; // nothing is done before the builder has said anything
  });
  const met = dod.every((x) => x.met) && !!d.done?.met;
  const record = {};
  for (const [k, v] of Object.entries(d.record && typeof d.record === "object" ? d.record : {}).slice(0, 10)) {
    if (typeof v !== "string" && typeof v !== "number") continue;
    if (/secret|token|password|api[_-]?key/i.test(k) && !/(env|name|where|file|location)/i.test(k)) continue; // never keep secret values
    record[String(k).slice(0, 40)] = String(v).slice(0, 200);
  }
  return {
    reply: str(d.reply, 1500) || "",
    where: where && ((Array.isArray(where.path) && where.path.length) || where.url) ? { path: (Array.isArray(where.path) ? where.path : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 6), url: isOfficial(where.url, official) ? where.url : null } : null,
    actions: (Array.isArray(d.actions) ? d.actions : []).map((a) => (typeof a === "string" ? { do: a } : a || {})).filter((a) => str(a.do, 300)).slice(0, 8).map((a) => ({ do: str(a.do, 300), value: str(a.value, 300) })),
    agent_prompt: st.owner === "agent" || d.agent_prompt ? str(d.agent_prompt, 4000) : null,
    dod, done: { met, evidence: str(d.done?.evidence, 300), missing: met ? null : str(d.done?.missing, 300) },
    record, handoff: met ? str(d.handoff, 600) : null,
    go_back: d.go_back && typeof d.go_back === "object" && str(d.go_back.stage, 40) ? { stage: str(d.go_back.stage, 40), reason: str(d.go_back.reason, 300) } : null,
    research: str(d.research, 200),
    ask: str(d.ask, 300),
    research_notes: str(d.research_notes, 2500),
    evidence: ["verified", "inferred", "unknown"].includes(d.evidence) ? d.evidence : "unknown",
    sources: (Array.isArray(d.sources) ? d.sources : []).filter((x) => safeHttp(x?.url)).slice(0, 6).map((x) => ({ url: x.url, title: str(x.title, 120) || x.url, official: isOfficial(x.url, official) })),
  };
}

async function runStageTurn(record, b, emit) {
  const g = record.guide;
  const stages = buildStages(g);
  const st = stages.find((x) => x.id === b.stage);
  if (!st) throw new Error("That stage isn't in this guide.");
  const screen = b.image ? (emit("progress", { kind: "note", text: "Looking at your screen…" }), await describeScreen(b.image)) : "";
  const start = !(Array.isArray(b.history) && b.history.length);
  const search = start || !!b.research_query;
  emit("progress", { kind: "note", text: start ? `Checking ${g.app}'s current screens for this stage…` : "Thinking about your answer…" });
  let { json, sources } = await askJSON(STAGE_CHAT_PROMPT, stageRequest(g, stages, st, b, screen), emit, { search });
  const fresh = start && !b.message && !b.image;
  let reply = cleanStageReply(json, st, g, fresh);
  // The agent asked for a search it didn't have: run the turn once more with one.
  if (reply.research && !search) {
    emit("progress", { kind: "search", text: reply.research });
    ({ json, sources } = await askJSON(STAGE_CHAT_PROMPT, stageRequest(g, stages, st, { ...b, research_query: reply.research }, screen), emit, { search: true }));
    reply = cleanStageReply(json, st, g, fresh);
    reply.research = null;
  }
  if (reply.go_back && !stages.some((x) => x.id === reply.go_back.stage && x.id !== st.id)) reply.go_back = null;
  if (!reply.sources.length && (sources || []).length) reply.sources = sources.filter((x) => safeHttp(x.url)).slice(0, 5).map((x) => ({ ...x, official: isOfficial(x.url, officialHosts(g, null)) }));
  if (!reply.reply && !reply.actions.length) throw new Error("The answer came back empty. Try again.");
  if (screen) reply.screen = screen;
  return reply;
}

function runStageTurnDemo(record, b) {
  const g = record.guide;
  const st = buildStages(g).find((x) => x.id === b.stage);
  if (!st) throw new Error("That stage isn't in this guide.");
  const said = String(b.message || "").toLowerCase();
  const done = /done|did it|finished|saved/.test(said);
  return { demo: true, reply: done ? "Demo answer: great, that's this stage done." : `Demo answer: in live mode this explains "${st.title}" for your screen.`,
    where: null, actions: done ? [] : st.steps.map((k) => g.steps[k]).flatMap((s) => s.actions || []).slice(0, 4).map((a) => ({ do: a, value: null })),
    agent_prompt: st.owner === "agent" ? st.steps.map((k) => g.steps[k]?.agent_prompt).find(Boolean) || null : null,
    dod: st.dod.map((item) => ({ item, met: done })), done: { met: done, evidence: done ? "You said so (demo)." : null, missing: done ? null : "Everything (demo)." },
    record: {}, handoff: done ? `Demo: ${st.title} finished.` : null, go_back: null, research: null, ask: done ? null : "Tell me when it's done, or what you see.", research_notes: null, evidence: "unknown", sources: [] };
}

// ---------- Step by step ----------
// The guide is the outline. Each setup step is written in depth only when the builder opens it,
// with a fresh search for that exact screen and what they did in earlier steps, so it matches what they see.

const STEP_PROMPT = `You write ONE step of a setup guide for a first-time builder connecting an app to their AI agent. They are on this step now.
You get the app, the agent's job, the route, the whole outline (so you know what came before and what comes next), what they did and saved in earlier steps, and the outline's short version of this step.
Research LIVE: search the provider's current official docs for THIS screen. Consoles get renamed often (e.g. Google's "OAuth consent screen" is now "Google Auth Platform" with Branding, Audience, Data access and Clients pages). Describe the screen as it is today, not as it used to be.
Rules:
- Plain words. Name every button, menu, tab and field exactly as it appears, in **bold**.
- "where": the breadcrumb of pages from the app's home or console to this screen, a URL you actually saw for it, and one sentence on how to get there.
- "you_will_see": what the page looks like when they arrive (page title, the main button), so they can tell they're in the right place.
- "actions": every click and field in order, 3-8 of them, one action each. When they must type or paste something, put the exact text in "value" (e.g. a name, a redirect URI that matches what later steps and code use). "why" is one short sentence only when it isn't obvious, else null.
- Build on earlier steps: reuse names and values they already created; never ask them to redo a finished step.
- "save": anything this step creates that a later step needs (an id, a key, a secret): what it is, exactly where to save it (e.g. the .env next to the agent's code, as GOOGLE_CLIENT_ID), and which later step uses it. Empty if nothing.
- "if_different": 1-3 likely mismatches (an older menu, a missing button, a prompt that appears first) and what to do in each case.
- Stay inside this step: don't do the next step's work. The request says who will connect.
- If they told you what their screen shows, or a screenshot was described, rewrite the step from THAT screen and say in "screen_note" how it differs from what was expected; else screen_note is null.
- Who does this step is given ("YOU do this" or "YOUR CODING AGENT does this"). Respect it:
  - YOU: the builder clicks through a website or console. Write the clicks as above.
  - YOUR CODING AGENT: the builder only pastes the ready-made prompt into their coding agent (Cursor, Claude Code) in their project. Do NOT write clicks, terminal commands or code for them. "where" is {"path": ["Your project", "Your coding agent's chat"], "url": null, "how": "Open your project in your coding agent"}. "you_will_see" is what the agent should report back when it's done. "actions" are 2-4 things the builder checks AFTER the agent finishes (e.g. "Check **.env** now has **GITHUB_CLIENT_ID**"), each in plain words. "if_different" covers what to tell the agent when it gets stuck. Don't write a new prompt; if earlier steps saved values the prompt needs, put one line in "prompt_context" for the builder to paste with it, else null.
- Evidence: "verified" only if an official page you saw states it. Cite only URLs you actually saw.
Reply with ONLY one JSON object:
{ "so_far": "one sentence: what they have from earlier steps that this step builds on, or null for the first step",
  "where": { "path": ["Google Cloud console", "Google Auth Platform", "Clients"], "url": "https://... or null", "how": "one sentence" },
  "you_will_see": "one or two sentences",
  "actions": [ { "do": "Click **+ Create client**", "value": null, "why": null } ],
  "save": [ { "what": "Client ID", "where": "the .env next to your agent's code, as GOOGLE_CLIENT_ID", "used_by": "step 6" } ],
  "if_different": [ { "if": "You see **APIs & Services › Credentials** instead", "then": "Click **+ Create credentials › OAuth client ID**: the older menu for the same thing" } ],
  "done_when": "how they can tell this step worked",
  "screen_note": null,
  "prompt_context": null,
  "time": "e.g. 5-10 min",
  "evidence": "verified | inferred | unknown",
  "sources": [ { "url": "https://...", "title": "..." } ] }`;

function stepDetailRequest(g, stepIndex, progress, seen) {
  const steps = g.steps || [];
  const s = steps[stepIndex] || {};
  const done = (Array.isArray(progress) ? progress : []).slice(0, 20).map((p) => `- ${String(p.title || "").slice(0, 120)}${(p.saved || []).length ? ` (saved: ${p.saved.slice(0, 6).map((x) => String(x).slice(0, 120)).join("; ")})` : ""}`);
  return [
    `App: ${g.app}`,
    `Their agent's job: ${g.job}`,
    `Route: ${g.route?.name || (g.paths || []).find((p) => p.recommended)?.name || "see outline"}. ${audienceLine(g)}`,
    `Outline:\n${steps.map((t, k) => `${k + 1}. ${t.title} (${t.owner || "you"})${k === stepIndex ? "  <- THIS STEP" : ""}`).join("\n")}`,
    `Done so far:\n${done.join("\n") || "- nothing yet"}`,
    `Who does this step: ${s.owner === "agent" ? "YOUR CODING AGENT does this (the builder pastes the prompt)" : s.owner === "provider" ? "the provider (a wait)" : "YOU do this (clicks in a website or console)"}`,
    `This step (short version): ${s.title}. ${(s.actions || []).join(" / ") || s.detail || ""}${s.url ? ` Page: ${s.url}` : ""}${s.done_when ? ` Done when: ${s.done_when}` : ""}`,
    (g.scopes || []).length ? `Scopes: ${g.scopes.map((x) => x.scope).join(", ")}` : "",
    s.agent_prompt ? `Its ready-made prompt for their coding agent (keep as is): ${String(s.agent_prompt).slice(0, 1500)}` : "",
    seen ? `What their screen shows right now: ${seen}` : "",
  ].filter(Boolean).join("\n\n");
}

function cleanStepDetail(d) {
  const str = (x, n) => (typeof x === "string" && x.trim() ? x.trim().slice(0, n) : null);
  const where = d.where && typeof d.where === "object" ? d.where : {};
  return {
    so_far: str(d.so_far, 300),
    where: { path: (Array.isArray(where.path) ? where.path : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 6), url: str(where.url, 500), how: str(where.how, 300) },
    you_will_see: str(d.you_will_see, 400),
    actions: (Array.isArray(d.actions) ? d.actions : []).map((a) => (typeof a === "string" ? { do: a } : a || {})).filter((a) => str(a.do, 300))
      .slice(0, 10).map((a) => ({ do: str(a.do, 300), value: str(a.value, 300), why: str(a.why, 200) })),
    save: (Array.isArray(d.save) ? d.save : []).filter((x) => x && str(x.what, 80)).slice(0, 5).map((x) => ({ what: str(x.what, 80), where: str(x.where, 200), used_by: str(x.used_by, 80) })),
    if_different: (Array.isArray(d.if_different) ? d.if_different : []).filter((x) => x && str(x.if, 200)).slice(0, 4).map((x) => ({ if: str(x.if, 200), then: str(x.then, 300) })),
    done_when: str(d.done_when, 300),
    screen_note: str(d.screen_note, 400),
    prompt_context: str(d.prompt_context, 400),
    time: str(d.time, 40),
    evidence: ["verified", "inferred", "unknown"].includes(d.evidence) ? d.evidence : "unknown",
    sources: (Array.isArray(d.sources) ? d.sources : []).filter((x) => x?.url).slice(0, 8),
  };
}

async function runStepDetail(record, stepIndex, progress, seen, image, emit) {
  const g = record.guide;
  if (!(g.steps || [])[stepIndex]) throw new Error("That step isn't in this guide.");
  let screen = String(seen || "").slice(0, 800);
  // A screenshot is described by a model that reads images (Gemini), then the step is rewritten from that description.
  if (image) {
    emit("progress", { kind: "note", text: "Looking at your screen…" });
    const look = await screenToText(record, stepIndex, image);
    screen = [look, screen].filter(Boolean).join(". They add: ");
  }
  emit("progress", { kind: "note", text: screen ? "Rewriting this step for your screen…" : `Checking ${g.app}'s current screens for this step…` });
  const { json, sources } = await askJSON(STEP_PROMPT, stepDetailRequest(g, stepIndex, progress, screen), emit);
  const detail = cleanStepDetail(json);
  // "Open this page" must be the provider's own site (or Composio's): a blog or mirror is dropped and the outline's link is used.
  const s0 = g.steps[stepIndex];
  const official = officialHosts(g, s0);
  if (detail.where.url && !isOfficial(detail.where.url, official)) detail.where.url = null;
  if (!detail.where.url && s0.owner !== "agent" && isOfficial(s0.url, official)) detail.where.url = s0.url;
  detail.sources = detail.sources.filter((x) => safeHttp(x.url)).sort((a, b) => isOfficial(b.url, official) - isOfficial(a.url, official))
    .map((x) => ({ ...x, official: isOfficial(x.url, official) }));
  const view = { steps: [], sources: [...detail.sources, ...(detail.where.url ? [{ url: detail.where.url, title: "where" }] : [])] };
  await verifyLinks(view, emit, { repair: false }).catch(() => {});
  const ok = new Set(view.sources.map((x) => x.url));
  if (detail.where.url && !ok.has(detail.where.url)) detail.where.url = null;
  detail.sources = view.sources.filter((x) => x.title !== "where");
  if (!detail.sources.length) detail.sources = (sources || []).filter((x) => safeHttp(x.url)).slice(0, 5).map((x) => ({ ...x, official: isOfficial(x.url, official) }));
  detail.written_at = new Date().toISOString();
  if (!detail.actions.length) throw new Error("The step came back empty. Try again.");
  return detail;
}

const safeHttp = (u) => typeof u === "string" && /^https?:\/\//.test(u);
const baseDomain = (h) => h.replace(/^www\./, "").split(".").slice(-2).join(".");
function officialHosts(g, step) {
  const hosts = new Set(["composio.dev"]);
  // The app's own website decides what's official; the outline's links are used only if it has none.
  for (const u of safeHttp(g.website) ? [g.website] : [step?.url, ...(g.steps || []).map((t) => t.url)]) {
    try { if (safeHttp(u)) hosts.add(baseDomain(new URL(u).hostname)); } catch {}
  }
  // Google's consoles and docs live on several domains.
  if ([...hosts].some((h) => /google/.test(h))) ["google.com", "googleapis.com", "cloud.google.com"].forEach((h) => hosts.add(h));
  return hosts;
}
function isOfficial(u, hosts) {
  try { return safeHttp(u) && hosts.has(baseDomain(new URL(u).hostname)); } catch { return false; }
}

async function screenToText(record, stepIndex, image) {
  try {
    const a = await runScreen(record, stepIndex, null, image, "", []);
    return [a.where && `They are on: ${a.where}`, a.reply].filter(Boolean).join(". ");
  } catch (err) {
    throw new Error(`Couldn't read the screenshot (${err.message.slice(0, 120)}). Describe what you see in words instead.`);
  }
}

function runStepDetailDemo(record, stepIndex, seen) {
  const s = (record.guide.steps || [])[stepIndex] || {};
  return {
    demo: true, so_far: stepIndex ? "Demo answer: you finished the steps before this one." : null,
    where: { path: [record.guide.app, "Settings"], url: s.url || null, how: "Demo answer: in live mode this names the exact page." },
    you_will_see: "Demo answer: in live mode this describes the page so you know you're in the right place.",
    actions: (s.actions || ["Follow the step"]).map((a) => ({ do: a, value: null, why: null })),
    save: [], if_different: [{ if: "The page looks different", then: "Press **No, it looks different** and describe it." }],
    done_when: s.done_when || null, screen_note: seen ? "Demo answer: rewritten for your screen in live mode." : null,
    time: s.time || null, evidence: "unknown", sources: [], written_at: new Date().toISOString(),
  };
}

async function runScreen(record, stepIndex, prereqIndex, image, note, history) {
  const g = record.guide;
  const pre = prereqIndex != null ? (g.prerequisites || [])[prereqIndex] : null;
  const step = pre ? { title: `Get: ${pre.item}`, actions: pre.actions, done_when: pre.done_when, needs: pre.needs } : (g.steps || [])[stepIndex] || {};
  const text = [
    `App: ${g.app}. Their agent's job: ${g.job}. Route: ${g.route?.name || "see guide"}.`,
    `Current step: ${step.title || "unknown"}`,
    step.actions?.length ? `The guide's actions for it: ${step.actions.join(" / ")}` : step.detail ? `The guide says: ${step.detail}` : "",
    step.needs?.length ? `What it asks for: ${step.needs.map((n) => `${n.item} (${n.ok_if || ""})`).join("; ")}` : "",
    step.done_when ? `Done when: ${step.done_when}` : "",
    chatText(history),
    note ? `They add: ${note}` : "",
  ].filter(Boolean).join("\n");
  const answer = stripCitations(JSON.parse((await askVision(SCREEN_PROMPT, text, image)).match(/\{[\s\S]*\}/)?.[0] || "{}"));
  if (!answer.where && !(answer.actions || []).length) throw new Error("Couldn't read the screenshot. Try a clearer or larger one.");
  return answer;
}

function runScreenDemo(record, stepIndex, prereqIndex) {
  const g = record.guide;
  const pre = prereqIndex != null ? (g.prerequisites || [])[prereqIndex] : null;
  const title = pre ? pre.item : (g.steps || [])[stepIndex]?.title || "this step";
  return { demo: true, reply: "Demo answer: here's where you are and what to click next.", where: `Demo answer: a ${g.app} page for "${title}"`, actions: ["In live mode the agent reads your screenshot.", "It tells you exactly which **button** or **field** to use next."], note: "Add a GEMINI_API_KEY to .env to try it for real.", step_done: false, off_track: false, evidence: "unknown" };
}

async function runUnblock(record, stepIndex, problem, emit, prereqIndex = null, history = []) {
  const g = record.guide;
  const steps = g.steps || [];
  const pre = prereqIndex != null ? (g.prerequisites || [])[prereqIndex] : null;
  // Prerequisites are the first steps of the plan: being stuck there means "I don't have this yet".
  const current = pre ? { title: `Prerequisite: ${pre.item}` } : steps[stepIndex];
  const userMsg = [
    `Guide for ${g.app} (job: ${g.job}):`,
    "```json",
    JSON.stringify({ paths: g.paths, prerequisites: g.prerequisites, steps, scopes: g.scopes, approval: g.approval, blockers: g.blockers, composio: g.composio }, null, 1),
    "```",
    pre
      ? `The developer is still checking prerequisites, before step 1. They may not have this one yet. Work out how they can get it (exact steps, time, cost), whether they really need it for their route, or a route that avoids it. Fix steps should be the steps to get it.`
      : `Steps already done: ${steps.slice(0, stepIndex).map((s, i) => `${i + 1}. ${s.title}`).join("; ") || "none"}`,
    pre ? `Current prerequisite: ${pre.item}${pre.how_to_get ? ` (guide says: ${pre.how_to_get})` : ""}` : `Current step: ${stepIndex + 1}. ${current?.title || "unknown"}`,
    chatText(history),
    `${chatText(history) ? "Their latest message" : "What went wrong"}: ${problem}`,
  ].filter(Boolean).join("\n");
  const { json: help, sources } = await askJSON(UNBLOCK_PROMPT, userMsg, emit, { searches: 4, fetches: 3 });
  help.searched_urls = sources;
  // Fix steps and sources get the same check, without the slower repair pass.
  const view = { steps: help.fix_steps || [], sources: help.sources || [] };
  await verifyLinks(view, emit, { repair: false });
  help.fix_steps = view.steps;
  help.sources = view.sources;
  return help;
}

async function runUnblockDemo(record, stepIndex, problem, emit, prereqIndex = null, history = []) {
  emit("progress", { kind: "search", text: `${record.guide.app} ${problem.slice(0, 60)}` });
  await new Promise((r) => setTimeout(r, 900));
  if ((history || []).length) return {
    demo: true,
    reply: "Demo answer: thanks, that narrows it down. In live mode I'd use what you just told me and what we tried above to find the next fix.",
    ask: "What does the page say right after you press Save?",
    diagnosis: "Demo answer: follow-up on the same problem.",
    likely_causes: [], plan_change: "retry", fix_steps: [], alternative_path: null, meanwhile: null, prevent_next_time: "", evidence: "unknown", sources: [],
  };
  const pre = prereqIndex != null ? (record.guide.prerequisites || [])[prereqIndex] : null;
  if (pre) return {
    demo: true,
    reply: `Demo answer: no problem, you can get "${pre.item}" yourself in a few minutes.`,
    ask: null,
    diagnosis: `Demo answer: you don't have "${pre.item}" yet. You can get it yourself in a few minutes; nothing else in the plan changes.`,
    likely_causes: [{ cause: "You haven't created it yet", how_to_check: "Look for it in the dashboard named in the guide.", likelihood: "high" }],
    plan_change: "insert_steps",
    fix_steps: [
      { title: "Get it now", detail: pre.how_to_get || "Follow the provider's sign-up page.", url: null, kind: "account", owner: "you", time: "5 min", minutes_min: 5, minutes_max: 5, done_when: "You can see it in the dashboard.", evidence: "inferred" },
    ],
    alternative_path: { name: "Use Composio managed auth", why: "If this prerequisite is hard to get, managed auth may not need it.", tradeoffs: "The sign-in screen shows Composio's name." },
    meanwhile: null,
    prevent_next_time: "Check prerequisites before starting.",
    evidence: "inferred",
    sources: [],
  };
  return {
    demo: true,
    reply: "Demo answer: this is almost always a callback URL that doesn't match exactly. Two quick fixes below.",
    ask: null,
    diagnosis: "Demo answer: the callback URL in your OAuth app doesn't exactly match the one your platform sends. GitHub compares them character by character.",
    likely_causes: [
      { cause: "Trailing slash or http vs https differs", how_to_check: "Compare the URL in GitHub's app settings with the redirect_uri in the failing request.", likelihood: "high" },
      { cause: "You edited the wrong OAuth app", how_to_check: "Check the Client ID in your config matches the app you edited.", likelihood: "medium" },
    ],
    plan_change: "insert_steps",
    fix_steps: [
      { title: "Copy the exact callback URL from your platform", detail: "Open your Composio auth config (or your own code) and copy the redirect URL exactly.", url: null, kind: "configure", owner: "you", time: "2 min", minutes_min: 2, minutes_max: 2, done_when: "You have the URL on your clipboard.", evidence: "inferred" },
      { title: "Paste it into the OAuth app's callback field", detail: "GitHub → Developer settings → OAuth Apps → your app → Authorization callback URL. Save.", url: "https://github.com/settings/developers", kind: "register", owner: "you", time: "2 min", minutes_min: 2, minutes_max: 2, done_when: "The saved value matches character for character.", evidence: "verified" },
    ],
    alternative_path: null,
    meanwhile: null,
    prevent_next_time: "Copy the callback URL from the platform instead of typing it.",
    evidence: "inferred",
    sources: [{ title: "Troubleshooting authorization request errors - GitHub Docs", url: "https://docs.github.com/en/apps/oauth-apps/maintaining-oauth-apps/troubleshooting-authorization-request-errors" }],
  };
}

// ---------- link checking ----------
// Models confidently cite doc paths that moved or never existed. Before a guide is saved,
// every link is requested; dead ones are sent back to the model for a replacement once,
// and anything still dead is removed so the guide never shows a 404.

const LINK_TIMEOUT_MS = 10000;
const SOFT_404 = /<title>[^<]*(404|not found|page not found|doesn.t exist)[^<]*<\/title>/i;

async function checkUrl(url) {
  if (!/^https?:\/\//.test(url || "")) return { status: "broken", code: "invalid" };
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36", accept: "text/html,*/*" },
    });
    const finalUrl = res.url || url;
    if (res.status === 404 || res.status === 410) return { status: "broken", code: res.status, finalUrl };
    if (res.status >= 400) return { status: "unverified", code: res.status, finalUrl }; // login walls, bot checks, rate limits
    // Some doc sites answer 200 with a "Page not found" page.
    const body = (await res.text().catch(() => "")).slice(0, 30000);
    if (SOFT_404.test(body) || /\/404(\/|$|\?)/.test(new URL(finalUrl).pathname)) return { status: "broken", code: "soft-404", finalUrl };
    return { status: "ok", code: res.status, finalUrl };
  } catch (err) {
    return { status: "unverified", code: err.name === "TimeoutError" ? "timeout" : err.cause?.code || "error" };
  }
}

// Gemini grounding links are short-lived redirects; store where they actually point.
async function resolveRedirect(url) {
  if (!url.includes("vertexaisearch.cloud.google.com/grounding-api-redirect")) return url;
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(LINK_TIMEOUT_MS) });
    return res.headers.get("location") || null;
  } catch {
    return null;
  }
}

// Every place a guide holds a link, with enough context for the model to find a replacement.
function linkRefs(g) {
  const refs = [];
  if (g.website) refs.push({ get: () => g.website, set: (u) => (g.website = u), context: `${g.app} homepage` });
  (g.steps || []).forEach((st) => st.url && refs.push({ get: () => st.url, set: (u) => (st.url = u), context: `Step "${st.title}"`, step: st }));
  (g.sources || []).forEach((src) => src.url && refs.push({ get: () => src.url, set: (u) => (src.url = u), context: `Source "${src.title}"`, source: src }));
  return refs;
}

async function checkAll(urls, emit) {
  const unique = [...new Set(urls)];
  const results = new Map();
  let done = 0;
  // Small batches keep this quick without hammering one docs site.
  for (let k = 0; k < unique.length; k += 6) {
    await Promise.all(unique.slice(k, k + 6).map(async (u) => results.set(u, await checkUrl(u))));
    done = Math.min(unique.length, k + 6);
    emit("progress", { kind: "note", text: `Checked ${done} of ${unique.length} links` });
  }
  return results;
}

const REPAIR_PROMPT = `Some links in an OAuth setup guide are dead (404). For each one, search for the CURRENT official page that covers the same thing, and return it only if you actually found it in search results. If there is no good replacement, return null.
Reply with ONLY a JSON object in a \`\`\`json code fence: { "replacements": [ { "old": "dead url", "new": "https://... or null" } ] }`;

async function verifyLinks(g, emit, { repair = true } = {}) {
  // Resolve and check the grounding links shown under "pages the agent saw".
  if (g.searched_urls?.length) {
    const resolved = await Promise.all(g.searched_urls.map(async (s) => ({ ...s, url: await resolveRedirect(s.url) })));
    g.searched_urls = resolved.filter((s) => s.url);
  }

  const refs = linkRefs(g);
  emit("progress", { kind: "note", text: `Testing ${refs.length} links in the guide…` });
  let results = await checkAll(refs.map((r) => r.get()), emit);
  let broken = refs.filter((r) => results.get(r.get())?.status === "broken");
  let fixed = 0;

  if (broken.length && repair && !DEMO) {
    emit("progress", { kind: "note", text: `${broken.length} dead link${broken.length === 1 ? "" : "s"} found, looking for replacements…` });
    const list = broken.map((r) => `- ${r.context}: ${r.get()}`).join("\n");
    try {
      const { text } = await ask(REPAIR_PROMPT, `App: ${g.app}\nDead links:\n${list}`, emit, { searches: 5, fetches: 3 });
      const map = new Map((parseGuide(text).replacements || []).filter((x) => x.new).map((x) => [x.old, x.new]));
      const candidates = [...new Set(broken.map((r) => map.get(r.get())).filter(Boolean))];
      const checked = await checkAll(candidates, () => {});
      for (const r of broken) {
        const next = map.get(r.get());
        if (next && checked.get(next)?.status === "ok") {
          results.set(next, checked.get(next));
          r.set(next);
          fixed++;
        }
      }
    } catch (err) {
      emit("progress", { kind: "note", text: `Could not repair links: ${err.message}` });
    }
    broken = refs.filter((r) => results.get(r.get())?.status === "broken");
  }

  // Remove whatever is still dead.
  for (const r of broken) r.set(null);
  if (g.sources) g.sources = g.sources.filter((src) => src.url);
  for (const r of refs) {
    const res = results.get(r.get());
    if (r.step) r.step.link_status = r.get() ? res?.status || "unverified" : undefined;
  }

  const statuses = refs.map((r) => (r.get() ? results.get(r.get())?.status : "removed"));
  g.link_check = {
    at: new Date().toISOString(),
    total: refs.length,
    ok: statuses.filter((x) => x === "ok").length,
    unverified: statuses.filter((x) => x === "unverified").length,
    fixed,
    removed: broken.length,
  };
  emit("progress", { kind: "note", text: `Links: ${g.link_check.ok} working, ${fixed} replaced, ${broken.length} removed, ${g.link_check.unverified} couldn't be checked` });
  return g;
}

// ---------- storage ----------

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "app";
}

// Model ratings drift toward "hard" because OAuth code looks like work. Difficulty rates the provider
// side, so a guide whose approval applies only in some cases, with no required provider wait, is moderate.
// Also gives any step without an owner one, so the You / Your agent labels never go blank.
function normalizeVerdict(g) {
  if (!g || typeof g !== "object") return g;
  for (const s of g.steps || []) if (!["you", "agent", "provider"].includes(s.owner)) s.owner = s.agent_prompt ? "agent" : "you";
  const v = g.verdict || {}, a = v.approval || g.approval || {};
  const req = String(a.required || "").toLowerCase(), diff = String(v.difficulty || "").toLowerCase();
  const waits = (g.steps || []).some((s) => s.owner === "provider");
  if (diff.startsWith("hard") && !waits && (req === "no" || req === "depends")) {
    v.difficulty = "moderate";
    v.difficulty_reason = req === "depends" && a.process ? `Approval only applies in some cases: ${a.process}` : "No provider review is required; the remaining work is setup on your side.";
    v.difficulty_adjusted = "Rated hard by the research agent; lowered because no review or wait is required for this audience.";
    g.verdict = v;
  }
  // An optional listing's review time isn't a wait the developer has to sit through.
  if (!waits && (req === "no" || req === "depends")) {
    for (const o of [g.route, v]) for (const k of ["wait", "approval_wait"]) if (o && /\d/.test(o[k] || "")) o[k] = "None required";
  }
  return g;
}

async function saveGuide(guide, input) {
  normalizeVerdict(guide);
  const id = `${slugify(guide.app || input.app)}-${Date.now().toString(36)}`;
  const record = { id, created_at: new Date().toISOString(), model: guide.written_by || MODEL, input, guide };
  await fs.writeFile(path.join(GUIDES_DIR, `${id}.json`), JSON.stringify(record, null, 2));
  return record;
}

async function listGuides() {
  const files = (await fs.readdir(GUIDES_DIR)).filter((f) => f.endsWith(".json"));
  const out = [];
  for (const f of files) {
    try {
      const r = JSON.parse(await fs.readFile(path.join(GUIDES_DIR, f), "utf8"));
      out.push({ id: r.id, app: r.guide.app, job: r.guide.job, difficulty: r.guide.verdict?.difficulty, created_at: r.created_at, model: r.model });
    } catch {}
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// The library cards: the few facts a developer scans for before opening a guide.
const DIFF_ORDER = ["easy", "moderate", "hard", "blocked"];
async function listLibrary() {
  const files = existsSync(LIBRARY_DIR) ? (await fs.readdir(LIBRARY_DIR)).filter((f) => f.endsWith(".json")) : [];
  const out = [];
  for (const f of files) {
    try {
      const r = JSON.parse(await fs.readFile(path.join(LIBRARY_DIR, f), "utf8"));
      const g = normalizeVerdict(r.guide), v = g.verdict || {}, lib = r.library || {};
      out.push({ id: r.id, app: g.app, job: g.job, difficulty: String(v.difficulty || "unknown").split(/[ |]/)[0].toLowerCase(),
        time: g.route?.hands_on_time || v.hands_on_time || null, wait: lib.wait || g.route?.wait || v.approval_wait || null,
        challenge: lib.challenge || v.difficulty_reason || null, tested: lib.tested || null, order: lib.order ?? 99 });
    } catch {}
  }
  return out.sort((a, b) => a.order - b.order || DIFF_ORDER.indexOf(a.difficulty) - DIFF_ORDER.indexOf(b.difficulty));
}

// ---------- demo mode ----------

async function runDemo(input, emit) {
  const { app } = input;
  const steps = [
    ["search", `${app} OAuth app registration developer docs`],
    ["results", "10 results"],
    ["fetch", "https://example.com/official-oauth-docs"],
    ["search", `composio ${app} toolkit managed auth`],
    ["search", `${app} app review verification requirements`],
  ];
  for (const [kind, text] of steps) {
    emit("progress", { kind, text });
    await new Promise((r) => setTimeout(r, 600));
  }
  const sample = JSON.parse(await fs.readFile(path.join(ROOT, "sample-guide.json"), "utf8"));
  sample.demo = true;
  if (input.brief) sample.fit = { actions: input.brief.actions, dimensions: input.brief.dimensions, composio: input.brief.composio, answers: input.answers || {}, decisions: input.brief.decisions || [] };
  return verifyLinks(sample, emit);
}

// Demo fit check: a few apps "have" a toolkit so both branches can be clicked through without a key.
const DEMO_TOOLKITS = ["github", "gmail", "slack", "notion", "hubspot", "googlesheets", "linear", "jira", "outlook", "salesforce"];

async function runFitDemo({ app, job }, emit) {
  for (const text of [`${app} developer API OAuth`, `composio ${app} toolkit`]) {
    emit("progress", { kind: "search", text });
    await new Promise((r) => setTimeout(r, 500));
  }
  const slug = slugify(app).replace(/-/g, "");
  const has = DEMO_TOOLKITS.includes(slug);
  const D = (key, applies, note) => ({ key, applies, note });
  const brief = {
    demo: true,
    app,
    product: `${app} API`,
    website: null,
    use_case: job,
    actions: [{ action: "read the data your agent needs", needs_trigger: false }, { action: "react when something new arrives", needs_trigger: true }],
    composio: has
      ? { toolkit_available: "yes", toolkit_slug: slug, covers_use_case: "yes", matching_actions: [], managed_auth: "yes", note: "Demo data: in live mode the agent checks Composio's docs (and its API if you add a COMPOSIO_API_KEY).", evidence: "inferred" }
      : { toolkit_available: "no", toolkit_slug: null, covers_use_case: "no", matching_actions: [], managed_auth: "no", note: "Demo data: pretending Composio has no toolkit for this app so you can see the alternatives.", evidence: "inferred" },
    alternatives: has
      ? []
      : [
          { type: "composio_toolkit", name: "Notion", toolkit_slug: "notion", why: "Demo: a similar app Composio already supports, if you can switch.", tradeoffs: "You would move your data to this app." },
          { type: "lighter_route", name: "API key instead of OAuth", toolkit_slug: null, why: "Demo: a personal API key from your account settings skips app registration.", tradeoffs: "Works for your own account only, which is all a prototype needs." },
          { type: "own_oauth", name: `Build your own ${app} OAuth app`, toolkit_slug: null, why: "Always possible if the app supports OAuth.", tradeoffs: "You register, configure and maybe get reviewed yourself." },
        ],
    basics: { auth_type: "OAuth 2.0", registration: "self-serve", registration_note: "Demo data.", min_scopes: ["read"], token_note: "Demo data.", evidence: "unknown" },
    dimensions: [
      D("auth_type", "yes", "OAuth 2.0"), D("registration", "yes", "Self-serve"), D("review", "no", "Not for your own account"),
      D("distribution_limits", "no", "Only your own account"), D("per_customer_instance", "no", ""), D("admin_consent", "no", "Your own account"),
      D("tokens", "yes", "Refresh tokens"), D("scopes_vs_actions", "yes", "Read scope only"), D("sandbox_vs_production", "no", ""),
      D("triggers", "yes", "Needs an event subscription"), D("composio_layer", "yes", has ? "Managed auth available" : "No toolkit yet"),
    ],
    decisions: [
      ...(has ? [] : [{ id: "app_choice", title: "Could you use a different app?", why_it_matters: "A supported app gets you there fastest.", show_if: null, evidence: "inferred", options: [
            { value: "stay", label: `Stay on ${app}`, what_it_means: "Your data is in this app, so you connect it directly.", pros: ["Your data stays put"], cons: ["More setup work"], time: "An hour or more", wait: "Usually none", cost: "Usually free", recommended: true, recommended_reason: "Demo: your data already lives in this app." },
            { value: "Notion", label: "Switch to Notion", what_it_means: "Demo: a similar app Composio already supports.", pros: ["Ready in minutes"], cons: ["Move your data over"], time: "Minutes", wait: "None", cost: "Free to start", recommended: false },
          ] }]),
    ],
    sources: [],
  };
  brief.decisions = cleanDecisions(brief);
  return brief;
}

// Local log of "request this toolkit" clicks: a demand signal for which toolkits to build next.
const REQUESTS_FILE = path.join(ROOT, "toolkit-requests.json");
// Lessons from blockers: what one builder hit with an app is told to the research agent next time,
// so the plan catches it up front instead of at the blocker.
const LESSONS_FILE = path.join(ROOT, "lessons.json");
async function readLessons(app) {
  const all = JSON.parse(await fs.readFile(LESSONS_FILE, "utf8").catch(() => "{}"));
  return all[String(app || "").toLowerCase().trim()] || [];
}
async function addLesson(app, lesson) {
  if (!app || !lesson) return;
  const all = JSON.parse(await fs.readFile(LESSONS_FILE, "utf8").catch(() => "{}"));
  const key = String(app).toLowerCase().trim();
  all[key] = [...new Set([...(all[key] || []), String(lesson).trim()])].slice(-20);
  await fs.writeFile(LESSONS_FILE, JSON.stringify(all, null, 2));
}
async function withLessons(msg, app) {
  const lessons = await readLessons(app);
  const checked = await checkedFacts(app);
  return [
    checked.length ? `${msg}\nFacts about ${app} checked by hand against official docs (trust these over search results, and cite their sources):\n${checked.join("\n")}` : msg,
    lessons.length ? `Blockers other builders hit with ${app}. Cover each one in the prerequisites or steps:\n${lessons.map((l) => `- ${l}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

// What evidence.json records for this app: confirmed claims, and corrections in place of what the agent first got wrong.
async function checkedFacts(app) {
  try {
    const ev = JSON.parse(await fs.readFile(path.join(ROOT, "evidence.json"), "utf8"));
    const a = (ev.apps || []).find((x) => String(x.app).toLowerCase() === String(app || "").trim().toLowerCase());
    return (a?.checked || []).filter((c) => c.verdict === "confirmed" || c.verdict === "corrected")
      .map((c) => `- ${c.verdict === "corrected" ? c.note : `${c.claim}${c.note ? ` ${c.note}` : ""}`} (source: ${c.source})`).slice(0, 8);
  } catch { return []; }
}

async function logToolkitRequest(entry) {
  const all = JSON.parse(await fs.readFile(REQUESTS_FILE, "utf8").catch(() => "[]"));
  all.push({ ...entry, at: new Date().toISOString() });
  await fs.writeFile(REQUESTS_FILE, JSON.stringify(all, null, 2));
  return all.filter((r) => r.app.toLowerCase() === entry.app.toLowerCase()).length;
}

// ---------- http ----------

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

async function readBody(req, limit = 1e6) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > limit) throw new Error("Request too large.");
  }
  return JSON.parse(data || "{}");
}

// On a hosted copy, a daily cap keeps someone else's clicks from spending the key owner's credits.
// DAILY_GUIDE_LIMIT counts new guides (fit checks); DAILY_CALL_LIMIT counts every model call. 0 or unset = no cap.
const usage = { day: "", guides: 0, calls: 0 };
const MODEL_ROUTES = ["/api/fit", "/api/generate", "/api/screen", "/api/stage-turn", "/api/step-detail", "/api/unblock"];
function overLimit(pathname) {
  const today = new Date().toISOString().slice(0, 10);
  if (usage.day !== today) Object.assign(usage, { day: today, guides: 0, calls: 0 });
  const gl = Number(process.env.DAILY_GUIDE_LIMIT) || 0, cl = Number(process.env.DAILY_CALL_LIMIT) || 0;
  if (pathname === "/api/fit" && gl && usage.guides >= gl) return `This demo has made its ${gl} live guides for today. Open a ready-made guide, or run it yourself from the README.`;
  if (cl && usage.calls >= cl) return "This demo has used its research budget for today. Ready-made guides still work, or run it yourself from the README.";
  if (pathname === "/api/fit") usage.guides++;
  usage.calls++;
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "POST" && MODEL_ROUTES.includes(url.pathname) && !DEMO) {
      const why = overLimit(url.pathname);
      if (why) {
        res.writeHead(429, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: why }));
      }
    }
    if (url.pathname === "/api/evidence") {
      const data = await fs.readFile(path.join(ROOT, "evidence.json"), "utf8").catch(() => "{}");
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(data);
    }
    if (req.method === "POST" && url.pathname === "/api/fit") {
      const { app, job } = await readBody(req);
      if (!app?.trim() || !job?.trim()) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: !app?.trim() ? "App name is required" : "Say what you want your agent to do" }));
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      try {
        const input = { app: app.trim(), job: job.trim() };
        emit("done", await (DEMO ? runFitDemo(input, emit) : runFit(input, emit)));
      } catch (err) {
        console.error(err);
        emit("error", { message: err.message || String(err) });
      }
      return res.end();
    }

    if (req.method === "POST" && url.pathname === "/api/toolkit-request") {
      const { app, job } = await readBody(req);
      if (!app?.trim()) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "App name is required" }));
      }
      const count = await logToolkitRequest({ app: app.trim().slice(0, 100), job: String(job || "").trim().slice(0, 500) });
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, count }));
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const { app, job, brief, answers, route } = await readBody(req);
      if (!app || !app.trim()) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "App name is required" }));
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const input = { app: app.trim(), job: (job || "").trim(), brief: brief || null, answers: answers || {}, route: typeof route === "string" ? route.slice(0, 200) : null };
      try {
        const guide = await (DEMO ? runDemo(input, emit) : runResearch(input, emit));
        const { brief: _brief, ...saved } = input;
        const record = await saveGuide(guide, saved);
        emit("done", { id: record.id });
      } catch (err) {
        console.error(err);
        emit("error", { message: err.message || String(err) });
      }
      return res.end();
    }

    if (req.method === "POST" && url.pathname === "/api/screen") {
      const { id, step, prereq, image, note, history } = await readBody(req, 12e6);
      const raw = /^[a-z0-9-]+$/.test(id || "") ? await fs.readFile(guidePath(id), "utf8").catch(() => null) : null;
      res.writeHead(raw && image ? 200 : 400, { "content-type": "application/json" });
      if (!raw || !image) return res.end(JSON.stringify({ error: raw ? "Add a screenshot" : "Guide not found" }));
      const record = JSON.parse(raw);
      const stepIndex = Number(step) || 0;
      const prereqIndex = Number.isInteger(prereq) ? prereq : null;
      try {
        return res.end(JSON.stringify(DEMO ? runScreenDemo(record, stepIndex, prereqIndex) : await runScreen(record, stepIndex, prereqIndex, image, String(note || "").slice(0, 500), history)));
      } catch (err) {
        console.error(err);
        return res.end(JSON.stringify({ error: err.message || String(err) }));
      }
    }

    if (req.method === "POST" && url.pathname === "/api/stage-turn") {
      const body = await readBody(req, 12e6);
      const raw = /^[a-z0-9-]+$/.test(body.id || "") ? await fs.readFile(guidePath(body.id), "utf8").catch(() => null) : null;
      if (!raw) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Guide not found" }));
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      try {
        const record = JSON.parse(raw);
        emit("done", DEMO ? runStageTurnDemo(record, body) : await runStageTurn(record, body, emit));
      } catch (err) {
        console.error(err);
        emit("error", { message: err.message || String(err) });
      }
      return res.end();
    }

    if (req.method === "POST" && url.pathname === "/api/step-detail") {
      const { id, step, progress, seen, image } = await readBody(req, 12e6);
      const raw = /^[a-z0-9-]+$/.test(id || "") ? await fs.readFile(guidePath(id), "utf8").catch(() => null) : null;
      if (!raw) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Guide not found" }));
      }
      const record = JSON.parse(raw); // read only: step details live in the browser's saved plan, not the guide file
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      try {
        const stepIndex = Number(step) || 0;
        emit("done", DEMO ? runStepDetailDemo(record, stepIndex, seen) : await runStepDetail(record, stepIndex, progress, seen, typeof image === "string" ? image : null, emit));
      } catch (err) {
        console.error(err);
        emit("error", { message: err.message || String(err) });
      }
      return res.end();
    }

    if (req.method === "POST" && url.pathname === "/api/unblock") {
      const { id, step, prereq, problem, history } = await readBody(req);
      const raw = /^[a-z0-9-]+$/.test(id || "") ? await fs.readFile(guidePath(id), "utf8").catch(() => null) : null;
      if (!raw || !problem || !problem.trim()) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: raw ? "Describe what went wrong" : "Guide not found" }));
      }
      const record = JSON.parse(raw);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      try {
        const stepIndex = Number(step) || 0;
        const prereqIndex = Number.isInteger(prereq) ? prereq : null;
        const help = await (DEMO ? runUnblockDemo : runUnblock)(record, stepIndex, problem.trim(), emit, prereqIndex, history);
        // Keep a log of blockers on the guide: useful later to improve the guide itself.
        record.unblocks = [...(record.unblocks || []), { at: new Date().toISOString(), step: stepIndex, prereq: prereqIndex, problem: problem.trim(), plan_change: help.plan_change, diagnosis: help.diagnosis, fix_steps: (help.fix_steps || []).map((f) => f.title) }];
        await fs.writeFile(guidePath(record.id), JSON.stringify(record, null, 2));
        if (!DEMO) await addLesson(record.guide?.app || record.input?.app, help.prevent_next_time);
        emit("done", help);
      } catch (err) {
        console.error(err);
        emit("error", { message: err.message || String(err) });
      }
      return res.end();
    }

    const ck = url.pathname.match(/^\/api\/guides\/([a-z0-9-]+)\/check-links$/);
    if (req.method === "POST" && ck) {
      const file = guidePath(ck[1]);
      const raw = await fs.readFile(file, "utf8").catch(() => null);
      if (!raw) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Guide not found" }));
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      try {
        const record = JSON.parse(raw);
        await verifyLinks(record.guide, emit);
        await fs.writeFile(file, JSON.stringify(record, null, 2));
        emit("done", record.guide.link_check);
      } catch (err) {
        emit("error", { message: err.message || String(err) });
      }
      return res.end();
    }

    if (url.pathname === "/api/library") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ guides: await listLibrary() }));
    }
    if (url.pathname === "/api/guides") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ demo: DEMO, guides: await listGuides() }));
    }

    const m = url.pathname.match(/^\/api\/guides\/([a-z0-9-]+)$/);
    if (m) {
      const data = await fs.readFile(guidePath(m[1]), "utf8").catch(() => null);
      res.writeHead(data ? 200 : 404, { "content-type": "application/json" });
      if (!data) return res.end(JSON.stringify({ error: "Not found" }));
      // Stages are worked out from the guide's steps each time (the guide file itself isn't changed).
      const rec = JSON.parse(data);
      normalizeVerdict(rec.guide);
      try { rec.stages = buildStages(rec.guide || {}); } catch {}
      return res.end(JSON.stringify(rec));
    }

    // Shareable guide pages and the home page both load the single-page app.
    let file = url.pathname === "/" || url.pathname === "/evidence" || url.pathname.startsWith("/g/") ? "/index.html" : url.pathname;
    const full = path.join(PUBLIC_DIR, path.normalize(file));
    if (!full.startsWith(PUBLIC_DIR)) throw new Error("bad path");
    const body = await fs.readFile(full);
    res.writeHead(200, { "content-type": MIME[path.extname(full)] || "application/octet-stream" });
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end();
  }
});

await fs.mkdir(GUIDES_DIR, { recursive: true });
// `npm run composio -- Fillout Zcal "tawk.to"`: ask Composio's catalog about several apps at once.
if (process.argv.includes("--composio")) {
  if (!process.env.COMPOSIO_API_KEY) { console.log("Add COMPOSIO_API_KEY to .env first."); process.exit(1); }
  for (const app of process.argv.slice(process.argv.indexOf("--composio") + 1)) {
    const c = await composioCatalog(app);
    console.log(!c ? `? ${app}: couldn't reach Composio` : c.match ? `✓ ${app}: in Composio as "${c.match.slug}"${c.match.managed ? " (managed sign-in)" : ""}` : `✗ ${app}: not in Composio${c.nearby.length ? ` (similar names: ${c.nearby.join(", ")})` : ""}`);
  }
  process.exit(0);
}

// `npm run check`: one tiny request to every model the app could use, to see which work today.
if (process.argv.includes("--check")) {
  await discoverGeminiModels();
  // `npm run check -- --parallel` checks only Parallel (quick, and spares the Gemini quota).
  const toCheck = process.argv.includes("--parallel") ? BACKENDS.filter((b) => b.name.startsWith("parallel")) : BACKENDS;
  console.log(`Checking ${toCheck.length} model(s)…`);
  for (const b of toCheck) {
    const t = Date.now();
    try {
      const out = await b.call("Reply with exactly one word.", "Say OK.", { search: false });
      console.log(`✓ ${b.name}: works (${Date.now() - t} ms)${b.search ? ", searches the web" : ""}${b.vision ? ", reads screenshots" : ""}: ${String(out.text).trim().slice(0, 30)}`);
    } catch (err) {
      console.log(`✗ ${b.name}: ${err.status === 429 ? "free limit used up for now" : err.message.slice(0, 160)}`);
    }
  }
  if (process.env.PARALLEL_API_KEY) {
    const r = await parallelSearch("App: GitHub", () => {});
    console.log(r ? `✓ Parallel search: ${r.sources.length} results` : "✗ Parallel search failed (see error above)");
    try {
      const j = await parallelJSON('Reply with ONLY this JSON: {"ok": true}', "Check.");
      console.log(`✓ Parallel JSON: writes guides as JSON: ${String(j.text).slice(0, 40)}`);
    } catch (err) {
      console.log(`✗ Parallel JSON: ${err.message.slice(0, 160)}`);
    }
  }
  process.exit(0);
}

await discoverGeminiModels();
server.listen(PORT, () => {
  console.log(`OAuth guide prototype running at http://localhost:${PORT}`);
  console.log(DEMO ? "No model key set (ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY): running in DEMO mode with a canned sample guide." : PROVIDER === "free" ? `Free models, in order: ${BACKENDS.map((b) => b.name).join(" → ")}` : `Provider: ${PROVIDER} (${MODEL})`);
});
