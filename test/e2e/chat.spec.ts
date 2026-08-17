import { test, expect } from "@playwright/test"
import type { APIRequestContext } from "@playwright/test"

/**
 * Local tests for the sample, driven through the chat UI the plugin serves.
 *
 * These run against the scripted stand-in LLM (see playwright.config.ts), so
 * they are deterministic. Nothing here asserts on the agent's wording - only on
 * things that stay true regardless of phrasing: rendered data that came from the
 * database, and side effects on the ticket itself.
 */

const APP = "/chat/index.html"

interface Ticket {
  ID: number
  title: string
  status: string
  priority: string
}

/** Read tickets straight from OData, independently of the chat. */
async function tickets(request: APIRequestContext): Promise<Ticket[]> {
  const res = await request.get("/odata/v4/support/Tickets?$orderby=ID")
  expect(res.ok(), `ticket lookup failed: ${res.status()}`).toBeTruthy()
  const body = (await res.json()) as { value: Ticket[] }
  expect(body.value.length).toBeGreaterThan(0)
  return body.value
}

async function ticketById(request: APIRequestContext, id: number): Promise<Ticket> {
  const res = await request.get(`/odata/v4/support/Tickets(${id})`)
  // Fails loudly on purpose: without this, a 404 would make `priority` undefined
  // and every "unchanged" assertion below would pass vacuously.
  expect(res.ok(), `ticket ${id} lookup failed: ${res.status()}`).toBeTruthy()
  return (await res.json()) as Ticket
}

test("the chat UI is served by the plugin and lists the agent", async ({ page, request }) => {
  const res = await request.get("/chat/agents.json")
  expect(res.ok()).toBeTruthy()
  const agents = (await res.json()) as { name: string; path: string }[]
  expect(agents.map((a) => a.name)).toContain("SupportService")

  await page.goto(APP)
  await expect(page.getByPlaceholder("Ask the agent")).toBeVisible()
})

test("the agent answers from the database", async ({ page, request }) => {
  const [first] = await tickets(request)

  await page.goto(APP)
  const input = page.getByPlaceholder("Ask the agent")
  await input.fill("list the open tickets")
  await page.getByRole("button", { name: "Send" }).click()

  // Asserts the reply contains a title OData returned independently - the agent
  // could only know it by actually calling a tool.
  await expect(page.getByText(first.title)).toBeVisible()
  await expect(input).toBeEnabled()
})

test("escalating pauses for approval and only then changes the ticket", async ({
  page,
  request,
}) => {
  const all = await tickets(request)
  const target = all[1] // disjoint from the reject test below
  const before = await ticketById(request, target.ID)

  await page.goto(APP)
  const input = page.getByPlaceholder("Ask the agent")
  await input.fill(`escalate ticket ${target.ID}`)
  await page.getByRole("button", { name: "Send" }).click()

  const approve = page.getByRole("button", { name: "Approve" })
  await expect(approve).toBeVisible()

  // The assertion that proves the gate is real rather than decorative: nothing
  // may change while the approval is still pending.
  const during = await ticketById(request, target.ID)
  expect(during.priority).toBe(before.priority)
  expect(during.status).toBe(before.status)

  await approve.click()
  await expect(approve).toBeHidden()
  await expect(input).toBeEnabled()

  await expect
    .poll(async () => (await ticketById(request, target.ID)).priority)
    .toBe("high")
})

test("rejecting leaves the ticket untouched", async ({ page, request }) => {
  const all = await tickets(request)
  const target = all[2] // disjoint from the approve test above
  const before = await ticketById(request, target.ID)

  await page.goto(APP)
  const input = page.getByPlaceholder("Ask the agent")
  await input.fill(`escalate ticket ${target.ID}`)
  await page.getByRole("button", { name: "Send" }).click()

  const reject = page.getByRole("button", { name: "Reject" })
  await expect(reject).toBeVisible()
  await reject.click()
  await expect(reject).toBeHidden()

  // The buttons hide synchronously inside the click handler, so waiting for the
  // input to re-enable is what proves the rejection actually reached the server
  // before we read the ticket back.
  await expect(input).toBeEnabled()

  const after = await ticketById(request, target.ID)
  expect(after.priority).toBe(before.priority)
  expect(after.status).toBe(before.status)
})
