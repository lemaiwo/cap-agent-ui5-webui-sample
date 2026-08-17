import { test, expect } from "@playwright/test"
import { CHAT_PATH, STORAGE_STATE, hasSavedSession, resolveDeployedUrl } from "./deployed-target"

/**
 * Authenticated tests against a DEPLOYED instance.
 *
 * These reuse the browser session saved by `npm run login` - an interactive
 * login you perform yourself. No credentials live in this repo or pass through
 * any script here; .auth/deployed.json holds session cookies and is gitignored.
 *
 * Unlike the local suite these run against a real model on SAP AI Core and a
 * real HANA database, so:
 *
 *   - nothing asserts on the agent's wording, which differs on every run
 *   - nothing mutates deployed data. The approval test rejects rather than
 *     approves: a local run resets its in-memory database on restart, HANA does
 *     not, and a test suite should not quietly rewrite the sample's data every
 *     time someone runs it.
 */

const DEPLOYED = resolveDeployedUrl()

test.describe("deployed (authenticated)", () => {
  test.skip(!DEPLOYED, "no deployment URL - run `npm run login -- <url>` or set SAMPLE_DEPLOYED_URL")
  test.skip(
    !hasSavedSession(),
    "no saved session - run `npm run login` first (it opens a browser for you to log in)",
  )

  test.use({ storageState: STORAGE_STATE, baseURL: DEPLOYED })

  // A real model on a cold container takes its time; the local suite's 30s is
  // not enough here.
  test.setTimeout(240_000)

  test("the chat UI loads for a logged-in user", async ({ page }) => {
    await page.goto(CHAT_PATH)

    // Both of these are absent on a login page, so this fails loudly rather
    // than vacuously if the saved session has expired.
    await expect(page.getByPlaceholder("Ask the agent")).toBeVisible()
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible()
  })

  test("the deployed agent answers from HANA through a real model", async ({ page, request }) => {
    // Read the data independently, so the assertion below cross-checks two
    // surfaces instead of checking the chat against itself.
    const res = await request.get("/odata/v4/support/Tickets?$top=1&$orderby=ID")
    expect(res.ok(), `OData lookup failed with ${res.status()} - session expired?`).toBeTruthy()
    const first = ((await res.json()) as { value: { title: string }[] }).value[0]

    await page.goto(CHAT_PATH)
    const input = page.getByPlaceholder("Ask the agent")
    await input.fill("List every ticket with its status.")
    await page.getByRole("button", { name: "Send" }).click()

    // A real model phrases this however it likes. What it cannot do is invent a
    // title that happens to match the one HANA just returned - to produce that,
    // it had to call the read tool.
    await expect(page.getByText(first.title)).toBeVisible({ timeout: 180_000 })
    await expect(input).toBeEnabled({ timeout: 180_000 })
  })

  test("escalation still asks for approval, and rejecting changes nothing", async ({
    page,
    request,
  }) => {
    const res = await request.get("/odata/v4/support/Tickets?$top=1&$orderby=ID")
    expect(res.ok()).toBeTruthy()
    const before = ((await res.json()) as { value: { ID: number; priority: string }[] }).value[0]

    await page.goto(CHAT_PATH)
    const input = page.getByPlaceholder("Ask the agent")
    await input.fill(`Escalate ticket ${before.ID}.`)
    await page.getByRole("button", { name: "Send" }).click()

    const reject = page.getByRole("button", { name: "Reject" })
    await expect(reject).toBeVisible({ timeout: 180_000 })

    // The gate is real: @agent.hitl held the action, nothing has run yet.
    const during = await (await request.get(`/odata/v4/support/Tickets(${before.ID})`)).json()
    expect(during.priority).toBe(before.priority)

    await reject.click()
    await expect(reject).toBeHidden()
    await expect(input).toBeEnabled({ timeout: 180_000 })

    const after = await (await request.get(`/odata/v4/support/Tickets(${before.ID})`)).json()
    expect(after.priority).toBe(before.priority)
  })
})
