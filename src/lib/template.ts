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

/**
 * Where apps commonly put the reply text. Tried in this order when the configured response
 * path isn't in the JSON, so a wrong or missing path doesn't mean grading raw JSON.
 */
export const COMMON_REPLY_PATHS = [
  "reply",
  "message",
  "answer",
  "text",
  "content",
  "response",
  "output",
  "data.reply",
  "data.message",
  "data.answer",
  "message.content",
  "choices[0].message.content",
];

/**
 * If a JSON body carries a top-level `error` (e.g. {"error": "Failed to get AI response"}),
 * return it as text. That body is an API failure, not a reply to grade. `"error": null` or
 * `false` on a successful response is ignored.
 */
export function bodyError(rawBody: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const err = (parsed as Record<string, unknown>).error;
  if (err === undefined || err === null || err === false || err === "") return null;
  if (typeof err === "string") return err.slice(0, 300);
  if (typeof err === "object") {
    const message = (err as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message.slice(0, 300);
  }
  return JSON.stringify(err).slice(0, 300);
}

/**
 * Turn a raw HTTP body into the reply text using the configured path. When that path isn't
 * found, look under the common keys and report which one worked as `detectedPath`.
 */
export function extractReply(rawBody: string, path: string): { text: string; resolved: boolean; detectedPath?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    // Plain-text or streamed responses: use the body as-is.
    return { text: rawBody, resolved: !path.trim() };
  }
  const configured = path.trim();
  const value = configured ? extractPath(parsed, configured) : undefined;
  if (value !== undefined) {
    return { text: typeof value === "string" ? value : JSON.stringify(value, null, 2), resolved: true };
  }
  if (typeof parsed === "string") return { text: parsed, resolved: !configured };

  // An error body has no reply in it; don't mistake its "message" for one.
  if (bodyError(rawBody) === null) {
    for (const candidate of COMMON_REPLY_PATHS) {
      if (candidate === configured) continue;
      const found = extractPath(parsed, candidate);
      if (typeof found === "string" && found.trim()) return { text: found, resolved: true, detectedPath: candidate };
    }
  }
  // No path configured and nothing recognisable: the whole body is the reply.
  if (!configured) return { text: JSON.stringify(parsed, null, 2), resolved: true };
  return { text: rawBody, resolved: false };
}
