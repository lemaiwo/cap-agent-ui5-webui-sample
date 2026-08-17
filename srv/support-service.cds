using sample from '../db/schema';

/**
 * Both annotations are required, and this is the single most common way to get
 * this wrong:
 *
 *   @agent alone  -> the agent works, but OData is no longer served
 *   @protocol alone -> the A2A endpoint mounts and even serves a valid agent
 *                      card, but no handlers are registered, so every message
 *                      fails at runtime with "buildGraph handler ... undefined"
 *
 * Fetching the agent card is therefore NOT enough to prove an agent works.
 */
@agent
@protocol: ['odata', 'agent']
service SupportService {
  // Tickets first on purpose: the mock LLM that ships with @cap-js/agents only
  // ever queries the first entity, with LIMIT 3.
  entity Tickets   as projection on sample.Tickets;
  entity Customers as projection on sample.Customers;

  /** Escalating is gated on human approval - see @agent.hitl below. */
  action escalate(ticket : Tickets:ID, reason : String) returns {
    status   : String;
    priority : String;
  };
}

// Pauses the agent at A2A state `input-required` instead of executing. The user
// approves or rejects by replying in the same task.
annotate SupportService.escalate with @agent.hitl;
