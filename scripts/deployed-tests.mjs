#!/usr/bin/env node
/**
 * Runs Playwright against a deployment instead of localhost.
 *
 * Sets PW_TARGET=deployed, which tells playwright.config.ts not to start a
 * local CAP server: these tests never touch localhost, and booting one costs a
 * minute and can fail the run for reasons that have nothing to do with the
 * deployment under test.
 *
 * Set here rather than in the npm script because `PW_TARGET=deployed playwright`
 * is POSIX syntax that fails on Windows PowerShell.
 *
 *   node scripts/deployed-tests.mjs deployed.spec       # anonymous smoke tests
 *   node scripts/deployed-tests.mjs deployed-auth.spec  # authenticated tests
 */

import { spawn } from "node:child_process"

const isWindows = process.platform === "win32"
const args = process.argv.slice(2)

const run = spawn("npx", ["playwright", "test", ...args], {
  stdio: "inherit",
  shell: isWindows,
  env: { ...process.env, PW_TARGET: "deployed" },
})

run.on("error", (err) => {
  console.error(`[deployed-tests] could not start Playwright: ${err.message}`)
  process.exit(1)
})

run.on("close", (code) => process.exit(code ?? 0))
