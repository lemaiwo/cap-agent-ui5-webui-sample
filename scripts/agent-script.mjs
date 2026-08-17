/**
 * Intents for the scripted stand-in LLM used by `npm run dev:scripted`.
 *
 * The stand-in matches regexes and maps captures to tool arguments - it does not
 * infer intent, deliberately: determinism is the whole value. Anything that
 * needs real reasoning needs a real model, which is what hybrid is for.
 */
export default [
  {
    match: /escalate\s+ticket\s+(\d+)/i,
    tool: "escalate",
    args: (m) => ({ ticket: Number(m[1]), reason: "requested via chat" }),
  },
]
