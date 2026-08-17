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

That is the whole integration. CAP auto-loads it via the `cds-plugin.js` convention, and it
serves a SAPUI5 chat client at **`/chat/index.html`**, same-origin from your CDS server,
talking to whichever of your services carry `@agent`.

There is no HTML5 Application Repository module and no UI build step in this project — the
plugin ships its own prebuilt assets.

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

`mta.yaml` deploys three modules:

| Module | What it is |
|---|---|
| `sample-srv` | the CAP service — **and the chat UI**, served by the plugin |
| `sample-db-deployer` | deploys the CDS model into a HANA HDI container |
| `sample-router` | the approuter |

and binds four resources: a HANA HDI container, an XSUAA instance, and an **existing** AI Core
instance (named `aicore` — change it in `mta.yaml` if yours differs). Deploying does not
provision AI resources.

### Why there is an approuter but no HTML5 repo

The approuter is here for **login, not for serving the UI**. The plugin serves `/chat` itself
from the CAP service, so no HTML5 Application Repository module is needed. But XSUAA-protected
endpoints need an OAuth flow a browser can follow, and CAP's own auth middleware can only
reject with 401 — it cannot redirect a user to log in. That is the approuter's job here.

Open the **router** URL, not the srv URL. Assign the `CapAgentSampleSupportUser` role
collection to yourself in the BTP cockpit first.

### What is and is not protected

Verified on the running deployment:

- unauthenticated `POST /a2a/support` → **401**
- unauthenticated `GET /odata/...` via the router → the approuter's login page, **no data**
- the chat UI shell and `/chat/agents.json` on the **srv** URL are readable without a session:
  the plugin's static assets are mounted ahead of CAP's auth middleware. The agent itself is
  not. If that matters to you, do not expose the srv route publicly.

---

## Tests

```bash
npm test                # Playwright against the local sample (scripted stand-in LLM)
npm run test:deployed   # smoke tests against a deployment
```

The **local** tests never assert on the agent's wording. They assert that the reply contains a
ticket title fetched independently from OData — which the agent could only know by calling a
tool — and that escalating pauses with the ticket **unchanged**, changes it only after
Approve, and leaves it untouched after Reject.

The **deployed** tests deliberately do not log in; automating a corporate IdP is brittle and
needs real credentials. They assert what is checkable anonymously, and what actually broke in
practice: that the approuter emits a valid `/oauth/authorize` request and that **XSUAA accepts
it** (see below), that the agent returns 401 without a session, and that no ticket data leaks.

```bash
SAMPLE_DEPLOYED_URL=https://<router>.cfapps.<region>.hana.ondemand.com npm run test:deployed
```

They skip cleanly when that variable is unset.

### The bug those deployed tests guard

The first deployment failed at login with:

> OpenID provider cannot process the request due to configuration issues.
> Authorization Request Error — the request for authorization was invalid.

That reads like an identity-provider problem, and it is not. `xs-security.json` had no
`oauth2-configuration.redirect-uris`, so XSUAA rejected the `redirect_uri` the approuter
sends (`https://<router>/login/callback`) as un-whitelisted, and the OAuth flow never
started. The fix is the `oauth2-configuration` block in `xs-security.json`; the deployed test
now fails loudly if it regresses.

## Verified

Everything above was run, not assumed:

- **local + scripted** — `escalate ticket 2` paused at `input-required` with priority still
  `normal`, and only after approving did it become `high` / `in-progress`
- **hybrid** — real model, quoted above
- **deployed** — HANA returned the 3 seeded tickets, and the deployed agent answered from that
  data through AI Core

## Layout

```
db/schema.cds              customers + tickets
db/data/*.csv              seed data
srv/support-service.cds    @agent + @protocol, escalate action with @agent.hitl
srv/support-service.js     the escalate handler, and the scripted-LLM opt-in
srv/support-agent/         markdown agent: AGENTS.md + skills/ticket-triage/SKILL.md
scripts/agent-script.mjs   intents for the scripted stand-in
mta.yaml, xs-security.json deployment
app/router/                approuter (login only)
```
