#!/usr/bin/env node
/**
 * One-time interactive login for the deployed, authenticated tests.
 *
 * Opens a real browser window at the deployed approuter. **You** type your
 * credentials into your own identity provider's page - they are never passed
 * through this script, never read by it, and never stored anywhere. What is
 * saved is the resulting browser session (cookies), written to
 * .auth/deployed.json, which the authenticated tests then reuse.
 *
 * That file is as sensitive as a token: it is gitignored, and it stops working
 * when your IdP session expires. Re-run this when the tests fail on auth.
 *
 *   npm run login -- https://<router>.cfapps.<region>.hana.ondemand.com
 *
 * The URL can also come from SAMPLE_DEPLOYED_URL, or - after the first
 * successful login - from .auth/target.json, which this script writes.
 */

import { chromium } from "@playwright/test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const authDir = join(root, ".auth")
const storageState = join(authDir, "deployed.json")
const targetFile = join(authDir, "target.json")

const url = resolveUrl()
if (!url) {
  console.error("\n[login] no deployment URL. Pass it as an argument:\n")
  console.error("  npm run login -- https://<router>.cfapps.<region>.hana.ondemand.com\n")
  process.exit(1)
}

const target = `${url}/chat/index.html`

console.log("\n[login] opening a browser window - log in there, with your own identity provider.")
console.log("[login] your credentials are not read, forwarded or stored by this script.")
console.log(`[login] target: ${target}\n`)

const browser = await chromium.launch({ headless: false })
const context = await browser.newContext()
const page = await context.newPage()

await page.goto(target)

console.log("[login] waiting for the chat UI to appear (up to 5 minutes)...")

try {
  // The chat input only renders once the app is served to an authenticated
  // session, so it is a reliable "login finished" signal - and it stays correct
  // through MFA prompts, consent screens and redirect chains.
  await page.getByPlaceholder("Ask the agent").waitFor({ timeout: 300_000 })
} catch {
  console.error("\n[login] the chat UI never appeared. Nothing was saved.")
  console.error("[login] if you reached the app but not the chat, check that your user has the")
  console.error("[login] CapAgentSampleSupportUser role collection assigned in the BTP cockpit.\n")
  await browser.close()
  process.exit(1)
}

mkdirSync(authDir, { recursive: true })
await context.storageState({ path: storageState })
writeFileSync(targetFile, `${JSON.stringify({ url }, null, 2)}\n`)
await browser.close()

console.log("\n[login] session saved to .auth/ (gitignored)")
console.log("[login] now run:  npm run test:deployed:auth\n")

function resolveUrl() {
  const raw =
    process.argv[2]?.trim() ||
    process.env.SAMPLE_DEPLOYED_URL?.trim() ||
    (existsSync(targetFile) ? readTargetFile() : undefined)
  return raw ? raw.replace(/\/$/, "") : undefined
}

function readTargetFile() {
  try {
    return JSON.parse(readFileSync(targetFile, "utf8")).url
  } catch {
    return undefined
  }
}
