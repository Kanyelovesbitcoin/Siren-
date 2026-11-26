// Prompts the user pastes into Claude Code or Cursor, inside their own app's folder:
//   - buildSetupPrompt:      work out how Siren should talk to the app, and get the app running
//   - buildConnectFixPrompt: the connection failed; find out why and get both sides working
//   - buildTestErrorPrompt:  one request failed mid-audit; find out why
// The agent answers the first two with one JSON block that parseTargetConfig() understands.

import { renderBody } from "./template";
import type { TargetConfig, TestResult } from "./types";

const HELLO = "Hello! In one sentence, what can you help me with?";

/** The shape of the setup block, shared by every prompt that asks for one. */
const BLOCK_SPEC = `\`\`\`json
{
  "url": "http://localhost:3000/api/chat",
  "method": "POST",
  "headers": [{ "key": "Authorization", "value": "Bearer PASTE-YOUR-DEV-TOKEN" }],
  "body": { "messages": "{{messages}}" },
  "responsePath": "choices[0].message.content",
  "appContext": "A support assistant for Acme's widget store. It should only answer order and shipping questions and never share internal notes."
}
\`\`\`

Rules for the block:
- "url" must use localhost or 127.0.0.1. Siren refuses anything else.
- "method" is "POST" or "PUT".
- "body" is the request body my route expects. Put the string "{{messages}}" where the route expects the whole conversation as a list of { "role", "content" } objects. If the route takes one message as plain text instead, put "{{prompt}}" there. Keep every other field the route requires (model name, ids, flags) and give each a value that works.
- "responsePath" is the path to the reply text, written with dots and [index], for example data.reply or choices[0].message.content. If the route sends back plain text or a stream instead of JSON, use "" and tell me.
- "headers" can be an empty list. If a header needs a secret, write PASTE-YOUR-DEV-TOKEN as its value and tell me where to find the real one. Never put a real secret in the block.
- "appContext" is one or two plain sentences.`;

function saveStep(configPath?: string | null): string {
  return configPath
    ? `
## Save it too, if you can
If you are able to write a file outside this project, also save that same JSON (just the JSON, no code fence) as siren.config.json at exactly this path:

${configPath}

Siren watches that file. As soon as it appears or changes, Siren connects to my app and starts the audit by itself. If you can't write there, skip this step; I'll paste the block in myself. Don't create siren.config.json inside this project.
`
    : "";
}

export function buildSetupPrompt(configPath?: string | null): string {
  return `I'm using Siren, a security testing tool that runs on my own computer, to check the AI chat feature in this project. Siren only ever sends test messages to localhost. I need you to work out how it should connect to my app, and make sure my app is running. Please read the code to find the answers; don't guess.

## What to find
1. The API route that receives a user's chat message and returns the AI's reply (for example app/api/chat/route.ts, pages/api/chat.ts, or an Express, FastAPI or Flask handler). If there is more than one, pick the one the main chat screen calls and tell me which others exist.
2. The full local address for that route, including the port my dev server uses (check the package.json scripts, .env files and the framework's default).
3. The exact JSON body the route expects to receive.
4. Where the AI's reply text sits in the JSON the route sends back.
5. Any headers the route needs before it will accept a request in local development (a login token, an API key, a cookie).
6. What the assistant is for and what it must never do, taken from its system prompt.

## Get it running and check it
1. If my app isn't already running on this computer, start its dev server (in the background if you can) and tell me the command you used.
2. Send one real test message to the route yourself (for example with curl) and confirm a chat reply comes back at the place you found in step 4. If it fails because something is missing (an environment variable, an API key, a sign-in), stop and tell me exactly what to do in plain steps. Never invent a key.

## What to give me
Once a test message gets a real reply, answer with exactly one \`\`\`json code block in this shape:

${BLOCK_SPEC}
${saveStep(configPath)}
## Then tell me
After the block, in one or two plain sentences: the command that starts this app on my computer, and whether it is running now.

Don't change any of my code.`;
}

/** The exact request Siren sent when it said hello, with header values hidden. */
function describeRequest(target: TargetConfig): string {
  let body = target.bodyTemplate;
  try {
    body = JSON.stringify(JSON.parse(renderBody(target.bodyTemplate, HELLO, [])), null, 2);
  } catch {
    /* show the raw template */
  }
  const headers = target.headers.filter((h) => h.key.trim()).map((h) => h.key.trim());
  return `- Request: ${target.method} ${target.url}
- Headers sent: ${headers.length ? `${headers.join(", ")} (values hidden)` : "none besides Content-Type: application/json"}
- Body:
${body}
- Where Siren looked for the reply text: ${target.responsePath.trim() ? `"${target.responsePath.trim()}"` : "(the whole response)"}`;
}

/**
 * The connection test failed. One prompt that has the coding agent start the app if needed,
 * reproduce the request, fix the cause, and hand back (or save) a setup that works.
 */
export function buildConnectFixPrompt(opts: { target: TargetConfig; error: string; answered: boolean; configPath?: string | null }): string {
  const { target, error, answered, configPath } = opts;
  return `I'm connecting Siren (a security testing tool that runs on my own computer and only ever talks to localhost) to the AI chat feature in this project, and the connection test failed. Please get it working end to end.

## What Siren tried
${describeRequest(target)}

## What happened
${answered ? "My app answered, but with an error instead of a chat reply:" : "Siren got no answer at all:"}
${error}

## What I need you to do
1. Check whether my app is running on this computer. If it isn't, start its dev server (in the background if you can) and tell me the command you used.
2. Send the same request yourself (for example with curl) and look at what comes back.
3. Find the cause and fix it:
   - If the address, port, route, request body or reply location is wrong, that's Siren's setup, not my code. Work out the right values from the code.
   - If the app itself is failing (a crash, a missing environment variable or API key, a sign-in requirement), show me the error from the app's own logs. Fix it if it is a small, safe change. If it needs a secret or a decision from me, stop and tell me exactly what to do in plain steps. Never invent a key.
4. Keep going until a test message gets a real chat reply.

## What to give me
Then answer with exactly one \`\`\`json code block in this shape, with the values that worked:

${BLOCK_SPEC}
${saveStep(configPath)}
## Then tell me
In two or three plain sentences: what was wrong, what you changed, and the command that starts this app. Siren checks again every few seconds, so once my app answers it will connect by itself.

Don't weaken or remove any feature of my app.`;
}

/** One request failed in the middle of an audit, so that test is an Error. */
export function buildTestErrorPrompt(result: Pick<TestResult, "testName" | "reason" | "turns">): string {
  const failed = result.turns.find((t) => t.error) ?? result.turns[result.turns.length - 1];
  const sent = (failed?.displayPrompt ?? "").trim();
  return `While Siren (a security testing tool running on my own computer) was testing the AI chat feature in this project, one request failed, so that test couldn't be graded.

## What happened
- Test: "${result.testName}"
- What came back: ${failed?.error ?? result.reason}${failed?.status ? ` (HTTP ${failed.status})` : ""}
- Message Siren sent:
${sent.length > 900 ? `${sent.slice(0, 900)}… [shortened]` : sent || "(not recorded)"}

## What I need you to do
1. Make sure my app is running, then send that message to my chat route yourself and look at the response and at the app's own logs.
2. Tell me in two or three plain sentences why my app failed on this request.
3. Fix it if it is a small, safe change. Common causes: the AI provider call failing or timing out, a missing or expired API key, a rate limit that is still in effect, or an input my route doesn't handle. If it needs a secret or a decision from me, stop and tell me exactly what to do in plain steps.

An app should answer a message it doesn't like with a polite refusal, not a server error. Don't weaken or remove any feature.`;
}
