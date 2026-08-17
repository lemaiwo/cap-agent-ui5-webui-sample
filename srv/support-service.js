const cds = require("@sap/cds")

module.exports = class SupportService extends cds.ApplicationService {
  init() {
    const { Tickets } = this.entities
    const { SELECT, UPDATE } = cds.ql

    // Local-only: a deterministic stand-in for an LLM, so the approval flow can
    // be exercised without a cloud binding. The mock that ships with
    // @cap-js/agents ignores the prompt and only ever calls the read tool, so it
    // can never invoke an action - which makes HITL impossible to try offline.
    // Never active in hybrid or production: the guard is an explicit env var.
    if (process.env.AGENT_LLM === "scripted") {
      this.on("buildModel", async () => {
        const { default: ScriptedChatModel } = await import(
          "cap-agent-ui5-webui/test-support/scripted-llm"
        )
        const { default: script } = await import("../scripts/agent-script.mjs")
        return new ScriptedChatModel("scripted", { script, entity: "Tickets" })
      })
    }

    this.on("escalate", async (req) => {
      const { ticket, reason } = req.data

      const found = await SELECT.one
        .from(Tickets)
        .where({ ID: ticket })
        .columns("ID", "title", "status", "priority")

      if (!found) return req.error(404, `Ticket ${ticket} not found.`)
      if (found.status === "resolved") {
        return req.error(409, `Ticket ${ticket} is already resolved.`)
      }

      await UPDATE(Tickets, ticket).with({ priority: "high", status: "in-progress" })

      const after = await SELECT.one
        .from(Tickets)
        .where({ ID: ticket })
        .columns("status", "priority")

      cds.log("sample").info("ticket escalated", { ticket, reason })
      return after
    })

    return super.init()
  }
}
