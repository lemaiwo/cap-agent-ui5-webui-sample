---
name: ticket-triage
description: Escalate a customer ticket to high priority on the user's behalf.
---

# Ticket Triage

## When to use

The user asks to escalate, prioritise, or raise the urgency of a ticket.

## Workflow

1. Identify the ticket. If the user gave a description rather than an ID, query
   the tickets to resolve it. If more than one matches, ask which they mean.
2. Check its current status. A ticket that is already `resolved` cannot be
   escalated - say so and stop.
3. Call `escalate` with the ticket ID and a short reason. This action requires
   human approval, so expect the request to pause before it runs.
4. Report the resulting status and priority returned by the action.

## Examples

- "Escalate ticket 2" -> escalate ticket ID 2.
- "The barrier sensor issue is urgent" -> resolve that to a ticket ID, then escalate.
- "Bump everything to high" -> ask which tickets; do not escalate in bulk unprompted.
