# cap-agent-ui5-webui-sample

A small CAP application that uses the
[`cap-agent-ui5-webui`](https://www.npmjs.com/package/cap-agent-ui5-webui) plugin, showing
the three ways you would actually run it: **locally**, **hybrid** against a real LLM on SAP
AI Core, and **deployed** to SAP BTP Cloud Foundry.

The domain is a tiny support desk — customers and tickets, with an `escalate` action gated
behind human approval. Swap it for your own; nothing about the plugin changes.

## What the plugin gives you

```bash
npm add cap-agent-ui5-webui
```

> **Note:** the HTML5 Application Repository mode below needs plugin **0.2.0**. Until that
> version is on npm, `npm install` in this repo will not resolve — pin `^0.1.0` and drop the
> `serveUi` setting to run everything else.

That is the whole integration. CAP auto-loads it via the `cds-plugin.js` convention, and it
serves a SAPUI5 chat client at **`/chat/index.html`**, same-origin from your CDS server,
talking to whichever of your services carry `@agent`. No UI build step, no HTML5 Application
Repository — the plugin ships its own prebuilt assets.

Deployed, this sample does use the repository — see
[HTML5 Application Repository](#html5-application-repository) for what that buys and what it
costs. It is optional; the plugin serves the UI itself by default.

## The service

```cds
@agent
@protocol: ['odata', 'agent']
service SupportService { ... }
```

**Both annotations are required**, and this is the most common way to get it wrong:

- `@agent` alone → the agent works, but OData is no longer served.
- `@protocol` alone → the A2A endpoint mounts and even serves a valid agent card, but no
  handlers are registered, so every message fails at runtime with
  `buildGraph handler ... undefined`.

Fetching the agent card is therefore **not** enough to prove an agent works. Send a message.

`escalate` is annotated `@agent.hitl`, so the agent pauses at A2A state `input-required`
instead of executing it. The user approves or rejects by replying in the same task.

---

## 1. Locally

```bash
npm install
npm run dev
```

Open **<http://localhost:4004/chat/index.html>** and ask *"list the open tickets"*.

The LLM that ships with `@cap-js/agents` in development is a mock: it **ignores your prompt**
and only ever calls the read tool on the first entity. Good enough to see the agent answer
questions — but it can never invoke an action, so you cannot reach the approval flow this way.

For that, use the scripted stand-in:

```bash
npm run dev:scripted
```

Then try *"escalate ticket 2"*. The agent pauses, the chat shows **Approve / Reject**, and the
ticket's priority only changes after you approve. The intents live in
`scripts/agent-script.mjs` — regex to tool-call, deliberately dumb, because determinism is the
point. Anything needing real reasoning needs hybrid.

## 2. Hybrid — against a real LLM

Runs locally, but the agent is a real model on SAP AI Core.

```bash
cf login
cds bind -2 <instance>:<service-key>     # e.g. cds bind -2 aicore:aicore-key
npm run hybrid
```

**Hybrid needs [`@sap/cds-dk`](https://www.npmjs.com/package/@sap/cds-dk) installed**
(`npm i -g @sap/cds-dk`); the other local modes do not. `cds bind` records only a *reference*
to the CF instance and key, and resolving that into the `VCAP_SERVICES` the SAP AI SDK reads
happens at startup in `cds watch`. Started any other way — including `cds serve --profile
hybrid` — the SDK logs `Could not find service binding of type 'aicore'` and every call then
fails as *"content safety check is temporarily unavailable"*, which points at entirely the
wrong thing.

`cds bind` writes `.cdsrc-private.json`. **That file holds live credentials and is gitignored.**

Now the agent actually reasons. Asked to summarise the open tickets and say which looks most
urgent, it answered:

> There are **3 open tickets**: a barrier sensor offline (Acme Logistics), a timetable import
> failure (Northwind Rail), and a mobile login loop (Contoso Freight) — all currently rated
> normal or low priority. The most urgent is likely **Ticket #1 (Barrier sensor offline)**, as
> a physical sensor outage suggests an operational, potentially safety-critical issue.

No regex produces that.

## 3. Deployed to BTP

```bash
npm run build      # mbt build
npm run deploy     # cf deploy mta_archives/...mtar
```

`npm run build` first regenerates `app/chat-ui/dist` from the installed plugin, then runs
`mbt build`. Always run `npm run verify:deploy` afterwards — see
[the login bug](#the-login-bug-and-why-it-took-two-rounds) for why a green deploy is not
proof.

`mta.yaml` deploys five modules:

| Module | What it is |
|---|---|
| `sample-srv` | the CAP service, and `/chat/agents.json` — but **not** the UI |
| `sample-db-deployer` | deploys the CDS model into a HANA HDI container |
| `capagentuichat` | the chat UI, packaged for the HTML5 Application Repository |
| `sample-app-content` | uploads that package into the repository |
| `sample-router` | the approuter — login, and serving the UI from the repository |

and binds a HANA HDI container, an XSUAA instance, two `html5-apps-repo` instances
(`app-host` to hold the content, `app-runtime` bound to the router to serve it), and an
**existing** AI Core instance (named `aicore` — change it in `mta.yaml` if yours differs).
Deploying does not provision AI resources.

Open the **router** URL, not the srv URL, at **`/capagentuichat/index.html`** (the app id
from the UI's manifest with the dots removed). `/` redirects there. Assign the
`CapAgentSampleSupportUser` role collection to yourself in the BTP cockpit first.

### Why the approuter

XSUAA-protected endpoints need an OAuth flow a browser can follow, and CAP's own auth
middleware can only reject with 401 — it cannot redirect a user to log in. Binding the
`app-runtime` instance additionally lets it serve the UI out of the repository.

### What is and is not protected

Verified on the running deployment:

- unauthenticated `POST /a2a/support` → **401**
- unauthenticated `GET /odata/...` via the router → the approuter's login page, **no data**
- `/chat/agents.json` on the **srv** URL is readable without a session — the plugin mounts it
  ahead of CAP's auth middleware. It enumerates your agents' names and paths; the agent
  itself is not reachable. If that matters, do not expose the srv route publicly.

## HTML5 Application Repository

The plugin serves the chat UI itself by default, and for most projects that is the right
answer: the UI is ~20 KB, SAPUI5 comes from the CDN, and there is nothing to build. This
sample uses the repository anyway, because that is the setup people ask about — it is what
**SAP Build Work Zone** requires, and it keeps the UI off the srv route entirely.

Two settings switch it on. `npm run build:ui` generates the deployable artifact:

```bash
npx cap-agent-ui5-webui html5 app/chat-ui/dist
```

and the production profile stops the CDS server serving the UI as well:

```jsonc
{ "cds": { "[production]": { "cap-agent-ui5-webui": { "serveUi": false } } } }
```

Scoped to `[production]`, so `npm run dev` is untouched — locally there is no repository, and
the UI is still at <http://localhost:4004/chat/index.html>.

**`/chat/agents.json` stays on the CAP service either way.** It is generated at runtime from
the services carrying `@agent`, so the repository — which stores static files — cannot produce
it. The UI fetches it relative to its own page, which deployed means
`/capagentuichat/agents.json`, so that one path is routed back to `srv-api` in both
`app/router/xs-app.json` and the generated `app/chat-ui/dist/xs-app.json`.

### Three ways this fails silently

All three cost a deploy cycle here:

1. **`build-result` on the `html5` module must name the folder holding the archive.** Left at
   its default, mbt looks in the module root, finds no zip, copies nothing, and the repository
   rejects the upload with *"Could not find applications in the request"*.

2. **mbt only copies an archive — it never creates one.** Fiori projects get theirs from
   `ui5-task-zipper`; this project has no `ui5 build`, so `cap-agent-ui5-webui html5` writes
   the `.zip` itself.

3. **The service name is `html5-apps-repo-rt`, not `html5-apps-repo`.** The shorter name
   appears in most examples and works under the *managed* approuter, which skips validation. A
   standalone approuter validates its own `xs-app.json` at boot and the app's fetched
   `xs-app.json` on every request, and answers

   ```
   A route requires access to html5-apps-repo service but the service is not bound.
   ```

   as a crash loop or a request-time 500 — while `cf services` shows the binding present and
   healthy.

---

## Tests

```bash
npm test                     # local sample, scripted stand-in LLM
npm run test:deployed        # anonymous smoke tests against a deployment
npm run login -- <url>       # log in once, interactively
npm run test:deployed:auth   # authenticated tests against that deployment
```

The **local** tests never assert on the agent's wording. They assert that the reply contains a
ticket title fetched independently from OData — which the agent could only know by calling a
tool — and that escalating pauses with the ticket **unchanged**, changes it only after
Approve, and leaves it untouched after Reject.

### Deployed, anonymous

These assert what is checkable without a session: that the approuter emits a well-formed
`/oauth/authorize` request which XSUAA accepts, that the agent returns 401 without a session,
and that no ticket data leaks.

They cannot check whether the redirect URI is whitelisted — XSUAA validates that only *after*
authenticating the user, so an anonymous request gets the same 302 either way. That is why
the login bug below survived a green anonymous suite.

```bash
npm run test:deployed
```

They skip cleanly when no deployment URL is known.

### Deployed, authenticated

Automating a corporate IdP login is brittle and would mean putting real credentials in a
config file. So don't automate it — do it once, by hand, and keep the session:

```bash
npm run login -- https://<router>.cfapps.<region>.hana.ondemand.com
```

A browser window opens on the deployed app. **You** log in there, in your own identity
provider, through whatever MFA it asks for. The script never sees, forwards or stores your
credentials; it waits for the chat input to appear — which only happens for an authenticated
session — then saves the resulting cookies to `.auth/deployed.json` and the URL to
`.auth/target.json`.

```bash
npm run test:deployed:auth
```

Three tests reuse that session: the chat UI loads authenticated, the agent answers with a
ticket title fetched independently from OData (so it demonstrably called a tool against HANA
through a real model on AI Core), and escalation pauses for approval with the ticket
unchanged.

That last one **rejects rather than approves**. Locally the database is in-memory and resets
on restart; HANA does not, and a test suite should not quietly rewrite the sample's data every
time someone runs it.

**`.auth/` is gitignored and must stay that way** — a saved session is as good as a token
until your IdP expires it. When these tests start failing on auth, that is what happened:
re-run `npm run login`. Both deployed suites also accept `SAMPLE_DEPLOYED_URL`, which
overrides the saved URL.

Neither deployed suite starts a local CAP server (`PW_TARGET=deployed`, set by
`scripts/deployed-tests.mjs`) — they talk only to the remote host, and a local server would
add a minute and a second way for the run to fail.

### The login bug, and why it took two rounds

The first deployment failed at login with:

> OpenID provider cannot process the request due to configuration issues.
> Please contact your system administrator.

That reads like a broken identity-provider trust. It is not — it is a rejected `redirect_uri`.
`xs-security.json` had no `oauth2-configuration.redirect-uris`, so XSUAA refused the
`https://<router>/login/callback` the approuter sends.

The fix is the `oauth2-configuration` block. What made it take two attempts is worth copying
down, because both traps are silent:

1. **XSUAA parses `xs-security.json` strictly and rejects unknown keys.** A `"//"` comment
   array — the convention CAP tolerates elsewhere — fails the whole update with
   `Unrecognized field "//"`. The deploy still reports success; the instance quietly keeps
   its *previous* configuration. Keep that file free of comments, and run
   `npm run verify:deploy` after every deploy — it reads each instance's `last_operation`
   and fails loudly when one is stuck in `failed`.

2. **XSUAA validates `redirect_uri` only after authentication.** An anonymous request reaches
   the login page identically whether the URI is whitelisted or not (verified by sending a
   deliberately bogus one and getting the same 302). So no anonymous check can confirm this
   fix, and the failure only ever shows up to a user who has already typed their password.

Between them: a config change that never applied, and a smoke test that could not tell. The
things that *do* confirm it are `npm run verify:deploy` and `npm run test:deployed:auth`.

If you change `xs-security.json` and apply it outside the MTA, note that `mta.yaml` overrides
`xsappname` per org and space, so a bare `cf update-service sample-auth -c xs-security.json`
fails with `Cannot change AppId`. Either redeploy, or merge the deployed `xsappname` into the
config you pass.

## Verified

Everything above was run, not assumed:

- **local + scripted** — `escalate ticket 2` paused at `input-required` with priority still
  `normal`, and only after approving did it become `high` / `in-progress`
- **hybrid** — real model, quoted above
- **deployed** — HANA returned the 3 seeded tickets, and the deployed agent answered from that
  data through AI Core
- **deployed via the HTML5 Application Repository** — the content upload is validated by the
  repository (an empty archive is rejected outright), and the approuter fetched the app's own
  `xs-app.json` back out of it, which is how the wrong service name surfaced

## Layout

```
db/schema.cds              customers + tickets
db/data/*.csv              seed data
srv/support-service.cds    @agent + @protocol, escalate action with @agent.hitl
srv/support-service.js     the escalate handler, and the scripted-LLM opt-in
srv/support-agent/         markdown agent: AGENTS.md + skills/ticket-triage/SKILL.md
scripts/agent-script.mjs   intents for the scripted stand-in
scripts/deployed-login.mjs interactive login, saves the session to .auth/
scripts/verify-deploy.mjs  post-deploy check that no service update silently failed
mta.yaml, xs-security.json deployment
app/router/                approuter: login, and serving the UI from the repository
app/chat-ui/               GENERATED by `npm run build:ui` — gitignored
```
