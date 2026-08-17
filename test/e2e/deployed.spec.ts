import { test, expect, request as playwrightRequest } from "@playwright/test"
import { resolveDeployedUrl } from "./deployed-target"

/**
 * Smoke tests for a DEPLOYED instance, run against the approuter URL.
 *
 * These deliberately do not log in. Automating a corporate IdP login is brittle
 * and needs real credentials, so instead these assert the things that are
 * checkable without a session and that actually broke in practice:
 *
 *   - the approuter starts a well-formed OAuth flow that XSUAA accepts
 *   - the agent endpoint is not reachable without a session
 *   - no ticket data leaks to an anonymous caller
 *
 * What they deliberately do NOT claim to check is whether the approuter's
 * redirect_uri is whitelisted. XSUAA validates redirect_uri only AFTER
 * authenticating the user, so it answers an anonymous authorize request with
 * the same 302 whether the URI is registered or not - verified by sending a
 * deliberately bogus one. An earlier version of this file asserted that 302 as
 * a regression guard for exactly that bug, which made the test vacuous. Use
 * `npm run verify:deploy` (config was accepted) and the authenticated suite
 * (login completes end to end) instead.
 *
 * Enable by pointing at your deployment:
 *
 *   SAMPLE_DEPLOYED_URL=https://<router>.cfapps.<region>.hana.ondemand.com npx playwright test deployed
 */

const DEPLOYED = resolveDeployedUrl()

test.describe("deployed", () => {
  test.skip(
    !DEPLOYED,
    "no deployment URL - set SAMPLE_DEPLOYED_URL, or run `npm run login -- <url>` once",
  )

  // These talk to a remote host, so they must not inherit the local baseURL.
  let api: Awaited<ReturnType<typeof playwrightRequest.newContext>>

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: DEPLOYED, ignoreHTTPSErrors: false })
  })

  test.afterAll(async () => {
    await api.dispose()
  })

  test("an anonymous browser request starts a valid OAuth flow", async () => {
    const res = await api.get("/chat/index.html")
    expect(res.ok()).toBeTruthy()

    // The approuter answers a browser navigation with a small HTML shell that
    // redirects to XSUAA client-side, preserving the URL fragment.
    const body = await res.text()
    const authorize = /https:\/\/[^"']*\/oauth\/authorize\?[^"']*/.exec(body)?.[0]
    expect(authorize, "approuter did not emit an /oauth/authorize URL").toBeTruthy()

    const url = new URL(authorize!.replace(/&amp;/g, "&"))
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("client_id")).toBeTruthy()
    expect(url.searchParams.get("redirect_uri")).toContain("/login/callback")

    // XSUAA accepts the request shape - client_id is known, the app exists, the
    // OAuth endpoint is reachable. This does NOT prove redirect_uri is
    // whitelisted; see the note at the top of this file.
    const authRes = await api.get(url.toString(), { maxRedirects: 0 })
    expect(
      [301, 302, 303, 307, 308],
      `XSUAA did not accept the authorization request (status ${authRes.status()})`,
    ).toContain(authRes.status())
  })

  test("the agent is not reachable without a session", async () => {
    const res = await api.post("/a2a/support", {
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            kind: "message",
            role: "user",
            messageId: "anon",
            parts: [{ kind: "text", text: "hello" }],
          },
        },
      },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(401)
  })

  test("no ticket data is served to an anonymous caller", async () => {
    const res = await api.get("/odata/v4/support/Tickets", { failOnStatusCode: false })
    const body = await res.text()
    // The approuter may answer 200 with its login shell; what must never appear
    // is actual ticket content.
    expect(body).not.toContain("Barrier sensor offline")
  })
})
