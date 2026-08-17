import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./test/e2e",

  // The sample's in-memory database is seeded once per server start and shared
  // across the whole run, so tests that change a ticket must not run in
  // parallel with each other.
  fullyParallel: false,
  workers: 1,

  timeout: 60_000,

  // 30s, not the usual 15s: the plugin bootstraps SAPUI5 from ui5.sap.com, so
  // the first browser run on a cold machine downloads the whole core before the
  // app can render anything. That genuinely failed the first assertion here once
  // - and a CI runner is cold every time. This buys room for a real, known
  // network cost; it does not weaken what is asserted.
  expect: { timeout: 30_000 },

  use: {
    baseURL: "http://localhost:4004",
    trace: "on-first-retry",
  },

  // The deployed suites (npm run test:deployed, test:deployed:auth) talk only to
  // a remote approuter, so booting a local CAP server for them costs a minute
  // and can fail the run for reasons unrelated to the deployment under test.
  webServer:
    process.env.PW_TARGET === "deployed"
      ? undefined
      : {
          // dev:scripted, not dev: the mock LLM that ships with @cap-js/agents
          // ignores the prompt and can only ever call the read tool, so the
          // approval flow - the most interesting thing to test - is unreachable
          // without the scripted stand-in.
          command: "npm run dev:scripted",
          url: "http://localhost:4004/a2a/support/.well-known/agent-card.json",
          // false, not !process.env.CI: reusing a server started some other way
          // means reusing one without AGENT_LLM=scripted, and the HITL tests
          // then fail with "Approve never appeared" for no visible reason.
          reuseExistingServer: false,
          timeout: 180_000,
        },
})
