#!/usr/bin/env node
/**
 * Runs the sample with a deterministic stand-in for an LLM, so the
 * human-in-the-loop approval flow can be tried without any cloud binding.
 *
 * Why this exists: the mock LLM that ships with @cap-js/agents ignores the
 * prompt and only ever calls the read tool on the first entity. It can never
 * invoke an action, so plain `npm run dev` can show you the agent answering
 * questions but never the approval gate.
 *
 * AGENT_LLM is set here rather than in the npm script because
 * `AGENT_LLM=scripted cds-serve` is POSIX syntax that fails on Windows
 * PowerShell.
 */

import { spawn } from "node:child_process"

const isWindows = process.platform === "win32"

console.log("[sample] starting with the scripted stand-in LLM (AGENT_LLM=scripted)")
console.log("[sample] open  http://localhost:4004/chat/index.html")
console.log('[sample] try   "list the open tickets", then "escalate ticket 2"\n')

const server = spawn("npx", ["cds-serve", "--in-memory"], {
  stdio: "inherit",
  shell: isWindows,
  env: { ...process.env, AGENT_LLM: "scripted" },
})

server.on("error", (err) => {
  console.error(`[sample] could not start: ${err.message}`)
  process.exit(1)
})

server.on("close", (code) => process.exit(code ?? 0))

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!server.killed) server.kill()
    process.exit(0)
  })
}
