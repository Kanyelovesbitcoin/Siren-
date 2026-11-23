// Request templating + response extraction.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** JSON-escape a string without the surrounding quotes. */
function escapeForJsonString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/**
 * Render the user's body template.
 *  - {{prompt}}   → the current user turn (JSON-escaped, so it is safe inside "...")
 *  - {{messages}} → the full conversation as a JSON array (place it unquoted)
 * Throws if the rendered body is not valid JSON, so the user gets a clear error.
 */
export function renderBody(template: string, prompt: string, history: ChatMessage[]): string {
  const messages = [...history, { role: "user", content: prompt }];
  const messagesJson = JSON.stringify(messages);
  const promptJson = escapeForJsonString(prompt);
  // Function replacers so "$&" etc. inside prompts are never treated as patterns.
  const rendered = template
    .replace(/"\{\{\s*messages\s*\}\}"/g, () => messagesJson)
    .replace(/\{\{\s*messages\s*\}\}/g, () => messagesJson)
    .replace(/\{\{\s*prompt\s*\}\}/g, () => promptJson);
  JSON.parse(rendered); // validate
  return rendered;
}

export function templateUsesHistory(template: string): boolean {
  return /\{\{\s*messages\s*\}\}/.test(template);
}

export function validateTemplate(template: string): string | null {
  if (!/\{\{\s*(prompt|messages)\s*\}\}/.test(template)) {
    return "Body template must include {{prompt}} or {{messages}}.";
  }
  try {
    renderBody(template, "test", []);
    return null;
  } catch (e) {
    return `Body template is not valid JSON once rendered: ${(e as Error).message}`;
  }
}

/**
 * Extract a value with a dotted path: `data.reply`, `choices[0].message.content`,
 * `output[-1].text`. Returns undefined when the path doesn't resolve.
 */
export function extractPath(obj: unknown, path: string): unknown {
  const trimmed = path.trim().replace(/^\$\.?/, "");
  if (!trimmed) return obj;
  const tokens: (string | number)[] = [];
  for (const part of trimmed.split(".")) {
    const re = /([^[\]]+)|\[(-?\d+)\]|\["([^"]+)"\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(part))) {
      if (m[1] !== undefined) tokens.push(m[1]);
      else if (m[2] !== undefined) tokens.push(Number(m[2]));
      else if (m[3] !== undefined) tokens.push(m[3]);
    }
  }
  let cur: unknown = obj;
  for (const t of tokens) {
    if (cur == null) return undefined;
    if (typeof t === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[t < 0 ? cur.length + t : t];
    } else {
      cur = (cur as Record<string, unknown>)[t];
    }
  }
  return cur;
}

/** Turn a raw HTTP body into the reply text using the configured path. */
export function extractReply(rawBody: string, path: string): { text: string; resolved: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    // Plain-text or streamed responses: use the body as-is.
    return { text: rawBody, resolved: !path.trim() };
  }
  const value = extractPath(parsed, path);
  if (value === undefined) return { text: rawBody, resolved: false };
  return { text: typeof value === "string" ? value : JSON.stringify(value, null, 2), resolved: true };
}
