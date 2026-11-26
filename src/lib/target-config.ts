// Reads the "setup block" a coding agent produces from the Copy Setup Prompt flow and turns
// it into a TargetConfig. Shared by the paste box (browser) and the auto-detected config
// file (server), so both accept exactly the same thing.
//
// This only fills in the form. The localhost lock in safety.ts still runs on the server
// for every single request, whatever this file says.

import { checkTargetUrl } from "./safety";
import { validateTemplate } from "./template";
import type { HeaderPair, TargetConfig } from "./types";

export interface ParsedTargetConfig {
  ok: boolean;
  target?: TargetConfig;
  /** Plain-English reason the block couldn't be used. */
  error?: string;
}

const MAX_CHARS = 100_000;

/** Pull the JSON object out of whatever was pasted: a bare object, a ```json fence, or a whole chat reply. */
function findJsonObject(text: string): unknown {
  const candidates: string[] = [];
  for (const m of text.matchAll(/```[a-zA-Z]*\s*\n?([\s\S]*?)```/g)) candidates.push(m[1]);
  candidates.push(text);
  for (const c of candidates) {
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      const parsed: unknown = JSON.parse(c.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      /* try the next candidate */
    }
  }
  return undefined;
}

function readHeaders(raw: unknown): HeaderPair[] | null {
  if (raw == null) return [];
  // [{ "key": "Authorization", "value": "Bearer x" }]
  if (Array.isArray(raw)) {
    const out: HeaderPair[] = [];
    for (const h of raw) {
      if (!h || typeof h !== "object") return null;
      const { key, name, value } = h as Record<string, unknown>;
      const k = typeof key === "string" ? key : typeof name === "string" ? name : null;
      if (k === null || (typeof value !== "string" && typeof value !== "number")) return null;
      if (k.trim()) out.push({ key: k.trim(), value: String(value) });
    }
    return out;
  }
  // { "Authorization": "Bearer x" }
  if (typeof raw === "object") {
    const out: HeaderPair[] = [];
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v !== "string" && typeof v !== "number") return null;
      if (k.trim()) out.push({ key: k.trim(), value: String(v) });
    }
    return out;
  }
  return null;
}

/** `body` may be a real JSON object (easier for agents to get right) or a template string. */
function readBodyTemplate(cfg: Record<string, unknown>): string | null {
  const raw = cfg.bodyTemplate ?? cfg.body;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    // "{{messages}}" stands for a JSON array, so it goes in unquoted.
    return JSON.stringify(raw, null, 2).replace(/"\{\{\s*messages\s*\}\}"/g, "{{messages}}");
  }
  return null;
}

export function parseTargetConfig(text: string): ParsedTargetConfig {
  const input = (text ?? "").trim();
  if (!input) return { ok: false, error: "Paste the setup block your coding agent gave you first." };
  if (input.length > MAX_CHARS) return { ok: false, error: "That's too long to be a setup block. Paste only the block your coding agent printed." };

  const found = findJsonObject(input);
  if (!found) {
    return {
      ok: false,
      error: "Siren couldn't find the setup block in that text. Copy everything from the opening { to the closing } that your coding agent printed, then paste it here.",
    };
  }
  let cfg = found as Record<string, unknown>;
  // Tolerate a wrapper such as { "target": { ... } }.
  if (typeof cfg.url !== "string" && cfg.target && typeof cfg.target === "object") cfg = cfg.target as Record<string, unknown>;

  if (typeof cfg.url !== "string" || !cfg.url.trim()) {
    return { ok: false, error: 'The setup block is missing "url" (the address of your app\'s chat route). Ask your coding agent to try again.' };
  }
  const url = cfg.url.trim();
  const check = checkTargetUrl(url);
  if (!check.ok) return { ok: false, error: check.reason };

  const method = typeof cfg.method === "string" ? cfg.method.trim().toUpperCase() : "POST";
  if (method !== "POST" && method !== "PUT") {
    return { ok: false, error: `Siren can only send POST or PUT requests, but the setup block says "${method}".` };
  }

  const headers = readHeaders(cfg.headers);
  if (!headers) return { ok: false, error: 'The "headers" part of the setup block isn\'t in a shape Siren understands. Ask your coding agent to try again.' };

  const bodyTemplate = readBodyTemplate(cfg);
  if (bodyTemplate === null) {
    return { ok: false, error: 'The setup block is missing "body" (what your app expects to receive). Ask your coding agent to try again.' };
  }
  const templateError = validateTemplate(bodyTemplate);
  if (templateError) {
    return {
      ok: false,
      error: `The "body" in the setup block needs "{{messages}}" or "{{prompt}}" where the chat message goes. (${templateError})`,
    };
  }

  const responsePath = typeof cfg.responsePath === "string" ? cfg.responsePath.trim() : "";
  const appContext = typeof cfg.appContext === "string" ? cfg.appContext.trim().slice(0, 2000) : "";
  const canaries = Array.isArray(cfg.canaries)
    ? cfg.canaries.filter((c): c is string => typeof c === "string" && !!c.trim()).map((c) => c.trim()).slice(0, 20)
    : [];

  return { ok: true, target: { url, method, headers, bodyTemplate, responsePath, appContext, canaries } };
}

/** True when two setups would send the same requests to the same place. */
export function sameTarget(a: TargetConfig, b: TargetConfig): boolean {
  return (
    a.url.trim() === b.url.trim() &&
    a.method === b.method &&
    a.bodyTemplate.replace(/\s+/g, "") === b.bodyTemplate.replace(/\s+/g, "") &&
    a.responsePath.trim() === b.responsePath.trim() &&
    JSON.stringify(a.headers.filter((h) => h.key.trim())) === JSON.stringify(b.headers.filter((h) => h.key.trim()))
  );
}

/** "localhost:3000/api/chat": a short, readable name for a target. */
export function targetLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}
