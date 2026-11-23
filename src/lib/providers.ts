// Judge-model providers: Ollama, LM Studio, and any OpenAI-compatible API (OpenRouter, OpenAI, vLLM...).

import type { ProviderConfig, ProviderId } from "./types";
import type { ChatMessage } from "./template";

export const PROVIDER_PRESETS: Record<
  ProviderId,
  { label: string; baseUrl: string; needsKey: boolean; local: boolean; hint: string }
> = {
  ollama: {
    label: "Ollama",
    baseUrl: "http://localhost:11434",
    needsKey: false,
    local: true,
    hint: "Run `ollama serve` and pull a model, e.g. `ollama pull llama3.1`.",
  },
  lmstudio: {
    label: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    needsKey: false,
    local: true,
    hint: "In LM Studio, open the Developer tab and start the local server.",
  },
  openai: {
    label: "OpenRouter / OpenAI-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
    local: false,
    hint: "Bring your own key. Responses from your app are sent to this provider for judging.",
  },
};

function trimSlash(u: string) {
  return u.replace(/\/+$/, "");
}

function authHeaders(cfg: Pick<ProviderConfig, "provider" | "apiKey">): Record<string, string> {
  const key = cfg.apiKey?.trim() || process.env.SIREN_JUDGE_API_KEY?.trim();
  const h: Record<string, string> = { "content-type": "application/json" };
  if (key) h.authorization = `Bearer ${key}`;
  if (cfg.provider === "openai") {
    // OpenRouter attribution headers; harmless for other OpenAI-compatible servers.
    h["x-title"] = "Siren";
  }
  return h;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ""}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Provider returned non-JSON: ${text.slice(0, 200)}`);
  }
}

export async function listModels(cfg: Pick<ProviderConfig, "provider" | "baseUrl" | "apiKey">): Promise<string[]> {
  const base = trimSlash(cfg.baseUrl || PROVIDER_PRESETS[cfg.provider].baseUrl);
  if (cfg.provider === "ollama") {
    const data = (await fetchJson(`${base}/api/tags`, { headers: authHeaders(cfg) }, 8000)) as {
      models?: { name: string }[];
    };
    return (data.models ?? []).map((m) => m.name).sort();
  }
  const data = (await fetchJson(`${base}/models`, { headers: authHeaders(cfg) }, 10000)) as {
    data?: { id: string }[];
  };
  return (data.data ?? []).map((m) => m.id).sort();
}

export async function chat(
  cfg: ProviderConfig,
  messages: ChatMessage[],
  opts: { json?: boolean; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const base = trimSlash(cfg.baseUrl || PROVIDER_PRESETS[cfg.provider].baseUrl);
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);

  if (cfg.provider === "ollama") {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: authHeaders(cfg),
      signal,
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: false,
        options: { temperature: 0 },
        ...(opts.json ? { format: "json" } : {}),
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text) as { message?: { content?: string } };
    return data.message?.content ?? "";
  }

  const body: Record<string, unknown> = { model: cfg.model, messages, temperature: 0 };
  // LM Studio rejects {type:"json_object"}; the judge prompt asks for JSON anyway.
  if (opts.json && cfg.provider === "openai") body.response_format = { type: "json_object" };
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: authHeaders(cfg),
    signal,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // Some OpenAI-compatible servers don't support response_format — retry once without it.
    if (body.response_format && res.status === 400) {
      return chat({ ...cfg, provider: "lmstudio" }, messages, { ...opts, json: false });
    }
    throw new Error(`Provider ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}
