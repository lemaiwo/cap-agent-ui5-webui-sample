#!/usr/bin/env node
/**
 * Checks that every service instance this MTA manages is actually in the state
 * the deploy claimed.
 *
 * This exists because a service update can fail while the deploy still looks
 * fine, and the instance then quietly keeps its previous configuration. That
 * happened here: a "//" comment array in xs-security.json - which XSUAA's
 * parser rejects as an unknown field - failed the update, so
 * oauth2-configuration.redirect-uris never reached the instance. Login then
 * broke *after* the password was accepted, with "OpenID provider cannot process
 * the request due to configuration issues", which points at the IdP rather than
 * at the deploy that silently did nothing.
 *
 * Run it after every `npm run deploy`.
 */

import { execFileSync } from "node:child_process"

const INSTANCES = ["sample-auth", "sample-db"]

let failed = false

for (const name of INSTANCES) {
  let resource
  try {
    const out = execFileSync("cf", ["curl", `/v3/service_instances?names=${name}`], {
      encoding: "utf8",
      shell: process.platform === "win32",
    })
    resource = JSON.parse(out).resources?.[0]
  } catch (err) {
    console.error(`[verify] could not query ${name}: ${err.message}`)
    console.error("[verify] are you logged in and targeting the right space? (cf target)")
    process.exit(1)
  }

  if (!resource) {
    console.error(`FAIL  ${name} - not found in the targeted space`)
    failed = true
    continue
  }

  const { type, state, description } = resource.last_operation
  if (state === "succeeded") {
    console.log(`ok    ${name} (${type} succeeded)`)
  } else {
    console.error(`FAIL  ${name} (${type} ${state})`)
    if (description) console.error(`      ${description}`)
    failed = true
  }
}

if (failed) {
  console.error("\n[verify] a service instance is not in the state the deploy implied.")
  console.error("[verify] its configuration is whatever it was BEFORE the deploy.")
  process.exit(1)
}

console.log("\n[verify] all managed service instances are in their expected state")
