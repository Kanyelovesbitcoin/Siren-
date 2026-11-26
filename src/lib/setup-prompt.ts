// Builds the "Copy Setup Prompt": the user pastes it into Claude Code or Cursor inside their
// own app's folder, and the coding agent works out how Siren should talk to the app. The
// agent answers with one JSON block that parseTargetConfig() (target-config.ts) understands.

export function buildSetupPrompt(configPath?: string | null): string {
  const save = configPath
    ? `
## Save it too, if you can
If you are able to write a file outside this project, also save that same JSON (just the JSON, no code fence) as siren.config.json at exactly this path:

${configPath}

Siren watches that file and loads it by itself. If you can't write there, skip this step; I'll paste the block in myself. Don't create siren.config.json inside this project.
`
    : "";

  return `I'm using Siren, a security testing tool that runs on my own computer, to check the AI chat feature in this project. Siren only ever sends test messages to localhost. I need you to work out how it should connect to my app. Please read the code to find the answers; don't guess.

## What to find
1. The API route that receives a user's chat message and returns the AI's reply (for example app/api/chat/route.ts, pages/api/chat.ts, or an Express, FastAPI or Flask handler). If there is more than one, pick the one the main chat screen calls and tell me which others exist.
2. The full local address for that route, including the port my dev server uses (check the package.json scripts, .env files and the framework's default).
3. The exact JSON body the route expects to receive.
4. Where the AI's reply text sits in the JSON the route sends back.
5. Any headers the route needs before it will accept a request in local development (a login token, an API key, a cookie).
6. What the assistant is for and what it must never do, taken from its system prompt.

## What to give me
Reply with exactly one \`\`\`json code block in this shape:

\`\`\`json
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
- "appContext" is one or two plain sentences.
${save}
## Then tell me
After the block, in one or two plain sentences: the command that starts this app on my computer, and anything I have to do first (for example set an environment variable or sign in).

Don't change any of my code.`;
}
