"use client";

import { useState } from "react";
import { Cloud, Gavel, Info, Plug } from "lucide-react";
import ModelPicker, { isCloudModel, preferredModel } from "./ModelPicker";
import { Button, Card, Input, Label, Select, cx } from "./ui";
import { PROVIDER_PRESETS } from "@/lib/providers";
import type { ProviderConfig, ProviderId } from "@/lib/types";

const ORDER: ProviderId[] = ["ollama", "lmstudio", "openai"];
const SHORT: Record<ProviderId, string> = { ollama: "Ollama", lmstudio: "LM Studio", openai: "OpenRouter / API" };

export default function ProviderPanel({
  value,
  onChange,
  disabled,
}: {
  value: ProviderConfig;
  onChange: (next: ProviderConfig) => void;
  disabled?: boolean;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const preset = PROVIDER_PRESETS[value.provider];

  function pickProvider(p: ProviderId) {
    setModels([]);
    setStatus(null);
    onChange({ ...value, provider: p, baseUrl: PROVIDER_PRESETS[p].baseUrl, model: "" });
  }

  async function testConnection() {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch("/api/provider/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: value.provider, baseUrl: value.baseUrl, apiKey: value.apiKey }),
      });
      const data = (await res.json()) as { ok: boolean; models?: string[]; error?: string };
      if (!data.ok) {
        setModels([]);
        setStatus({ ok: false, message: data.error ?? "Connection failed." });
        return;
      }
      const list = data.models ?? [];
      setModels(list);
      setStatus({
        ok: list.length > 0,
        message: list.length ? `Connected · ${list.length} model${list.length === 1 ? "" : "s"} available` : "Connected, but no models are installed.",
      });
      if (list.length && !list.includes(value.model)) onChange({ ...value, model: preferredModel(list) ?? list[0], mode: "judge" });
    } catch (e) {
      setStatus({ ok: false, message: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  const modelOptions = models.length ? models : value.model ? [value.model] : [];
  const rulesOnly = value.mode === "heuristic";

  const choice = (selected: boolean) =>
    cx(
      "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition disabled:opacity-50",
      selected ? "border-gold/50 bg-gold/[0.07]" : "border-line bg-obsidian/60 hover:border-line-strong",
    );
  const dot = (selected: boolean) =>
    cx("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", selected ? "border-gold" : "border-line-strong");

  return (
    <Card title="AI Grader (Optional)" icon={<Gavel className="size-4" />}>
      <div className="space-y-4">
        <div role="radiogroup" aria-label="How results are graded" className="space-y-2">
          <button
            type="button"
            role="radio"
            aria-checked={rulesOnly}
            disabled={disabled}
            onClick={() => onChange({ ...value, mode: "heuristic" })}
            className={choice(rulesOnly)}
          >
            <span className={dot(rulesOnly)}>{rulesOnly && <span className="size-2 rounded-full bg-gold" />}</span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                Rules only
                <span className="rounded-md border border-gold/30 bg-gold/10 px-1.5 py-px text-[10px] font-medium tracking-wide text-gold/90 uppercase">
                  Default
                </span>
              </span>
              <span className="mt-0.5 block text-[13px] font-medium text-pass">No extra setup needed.</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted">
                Siren checks every reply against its built-in rules. Fast, and nothing to install.
              </span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!rulesOnly}
            disabled={disabled}
            onClick={() => onChange({ ...value, mode: "judge" })}
            className={choice(!rulesOnly)}
          >
            <span className={dot(!rulesOnly)}>{!rulesOnly && <span className="size-2 rounded-full bg-gold" />}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">Use an AI grader</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted">
                A second AI model reads each reply for a more nuanced verdict. Needs Ollama, LM Studio or an API key. Also unlocks
                attacker mode.
              </span>
            </span>
          </button>
        </div>

        {!rulesOnly && (
          <div className="space-y-4 border-t border-line pt-4">
            <div role="tablist" aria-label="Model provider" className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-obsidian p-1">
              {ORDER.map((p) => (
                <button
                  key={p}
                  role="tab"
                  aria-selected={value.provider === p}
                  disabled={disabled}
                  onClick={() => pickProvider(p)}
                  className={cx(
                    "rounded-lg px-2 py-1.5 text-xs font-medium transition",
                    value.provider === p ? "bg-charcoal-3 text-gold shadow-[inset_0_0_0_1px_rgb(212_175_55/0.35)]" : "text-muted hover:text-ink",
                  )}
                >
                  {SHORT[p]}
                </button>
              ))}
            </div>

            <div>
              <Label htmlFor="provider-url">Base URL</Label>
              <Input
                id="provider-url"
                className="font-mono text-[13px]"
                value={value.baseUrl}
                onChange={(e) => onChange({ ...value, baseUrl: e.target.value })}
                disabled={disabled}
              />
            </div>

            {preset.needsKey && (
              <div>
                <Label htmlFor="provider-key" hint="or set SIREN_JUDGE_API_KEY">
                  API key
                </Label>
                <Input
                  id="provider-key"
                  type="password"
                  autoComplete="off"
                  className="font-mono text-[13px]"
                  placeholder="sk-or-..."
                  value={value.apiKey ?? ""}
                  onChange={(e) => onChange({ ...value, apiKey: e.target.value })}
                  disabled={disabled}
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button onClick={testConnection} loading={loading} icon={<Plug className="size-4" />} disabled={loading || disabled}>
                Test connection
              </Button>
              {status && <span className={cx("text-xs", status.ok ? "text-pass" : "text-fail")}>{status.ok ? status.message : "Not connected"}</span>}
            </div>
            {status && !status.ok && <p className="-mt-2 text-xs leading-relaxed text-fail/90">{status.message}</p>}

            <div>
              <Label htmlFor="provider-model">Model</Label>
              <Select
                id="provider-model"
                value={value.model}
                disabled={disabled || modelOptions.length === 0}
                onChange={(e) => onChange({ ...value, model: e.target.value, mode: "judge" })}
                className="w-full font-mono text-[13px]"
              >
                {modelOptions.length === 0 && <option value="">Test connection to load models</option>}
                {modelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
              {!value.model.trim() && (
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
                  Until you pick a model, Siren keeps grading with its built-in rules.
                </p>
              )}
              {isCloudModel(value.model) && (
                <p className="mt-1.5 flex gap-1.5 text-[11.5px] leading-relaxed text-warn">
                  <Cloud className="mt-px size-3.5 shrink-0" />
                  This is an Ollama cloud model: your app&apos;s replies are sent to Ollama&apos;s servers for attacking and grading.
                </p>
              )}
            </div>

            <ModelPicker installed={models} current={value.model} onUse={(m) => onChange({ ...value, model: m, mode: "judge" })} />

            <p className="flex gap-2 rounded-lg bg-charcoal-2 p-2.5 text-[11.5px] leading-relaxed text-muted">
              <Info className="mt-px size-3.5 shrink-0 text-gold/80" />
              {preset.local ? (
                <span>{preset.hint} Everything stays on your machine.</span>
              ) : (
                <span>{preset.hint} Use Ollama or LM Studio to keep audits fully offline.</span>
              )}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
