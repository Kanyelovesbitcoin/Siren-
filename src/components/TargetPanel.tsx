"use client";

import { useMemo, useState } from "react";
import { Crosshair, Lock, Plus, Send, ShieldAlert, Trash2, Eye, EyeOff } from "lucide-react";
import { Button, Card, Chip, Input, Label, Select, TextArea, cx } from "./ui";
import { checkTargetUrl } from "@/lib/safety";
import { validateTemplate } from "@/lib/template";
import type { TargetConfig } from "@/lib/types";

const PRESETS: { name: string; body: string; path: string }[] = [
  {
    name: "Messages + history",
    body: '{\n  "messages": {{messages}}\n}',
    path: "data.reply",
  },
  {
    name: "Single prompt",
    body: '{\n  "messages": [{ "role": "user", "content": "{{prompt}}" }]\n}',
    path: "data.reply",
  },
  {
    name: "OpenAI-compatible",
    body: '{\n  "model": "my-model",\n  "messages": {{messages}}\n}',
    path: "choices[0].message.content",
  },
];

interface TestResponse {
  ok: boolean;
  status?: number | null;
  latencyMs?: number;
  reply?: string;
  resolved?: boolean;
  raw?: string;
  error?: string;
}

export default function TargetPanel({
  value,
  onChange,
  disabled,
}: {
  value: TargetConfig;
  onChange: (next: TargetConfig) => void;
  disabled?: boolean;
}) {
  const check = useMemo(() => checkTargetUrl(value.url), [value.url]);
  const templateError = useMemo(() => validateTemplate(value.bodyTemplate), [value.bodyTemplate]);
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<TestResponse | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});

  const set = <K extends keyof TargetConfig>(k: K, v: TargetConfig[K]) => onChange({ ...value, [k]: v });

  async function sendTest() {
    setTesting(true);
    setTestRes(null);
    try {
      const res = await fetch("/api/target/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: value }),
      });
      setTestRes((await res.json()) as TestResponse);
    } catch (e) {
      setTestRes({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card
      title="Target"
      icon={<Crosshair className="size-4" />}
      action={
        <span
          className={cx(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            check.external ? "border-fail/40 text-fail" : "border-gold/35 text-gold",
          )}
          title="Siren only sends traffic to localhost, 127.0.0.1 or 0.0.0.0"
        >
          {check.external ? <ShieldAlert className="size-3" /> : <Lock className="size-3" />}
          Localhost lock
        </span>
      }
    >
      {check.external && (
        <div role="alert" className="mb-4 flex gap-3 rounded-xl border border-fail/40 bg-fail/10 p-3 text-[13px] leading-relaxed text-fail">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">External target blocked</p>
            <p className="text-fail/85">
              <span className="font-mono">{check.hostname}</span> isn&apos;t on your machine. Siren only tests apps you run locally
              (localhost, 127.0.0.1, 0.0.0.0). Testing systems you don&apos;t own may be illegal.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <Label htmlFor="target-url">Endpoint URL</Label>
          <div className="flex gap-2">
            <Select
              aria-label="HTTP method"
              className="w-[86px] shrink-0 font-mono text-xs"
              value={value.method}
              onChange={(e) => set("method", e.target.value as TargetConfig["method"])}
              disabled={disabled}
            >
              <option>POST</option>
              <option>PUT</option>
            </Select>
            <Input
              id="target-url"
              className="font-mono text-[13px]"
              value={value.url}
              invalid={!check.ok && !!value.url}
              placeholder="http://localhost:3000/api/chat"
              onChange={(e) => set("url", e.target.value)}
              disabled={disabled}
            />
          </div>
          {!check.ok && !check.external && value.url && <p className="mt-1.5 text-xs text-fail">{check.reason}</p>}
        </div>

        <div>
          <Label hint={<span>headers sent with every request</span>}>Custom headers</Label>
          <div className="space-y-2">
            {value.headers.map((h, i) => {
              const secret = /auth|token|key|secret|cookie/i.test(h.key);
              return (
                <div key={i} className="flex gap-2">
                  <Input
                    className="w-[42%] font-mono text-xs"
                    placeholder="Authorization"
                    value={h.key}
                    onChange={(e) => {
                      const headers = [...value.headers];
                      headers[i] = { ...h, key: e.target.value };
                      set("headers", headers);
                    }}
                    disabled={disabled}
                  />
                  <div className="relative flex-1">
                    <Input
                      className="pr-8 font-mono text-xs"
                      type={secret && !revealed[i] ? "password" : "text"}
                      placeholder="Bearer dev-token"
                      value={h.value}
                      onChange={(e) => {
                        const headers = [...value.headers];
                        headers[i] = { ...h, value: e.target.value };
                        set("headers", headers);
                      }}
                      disabled={disabled}
                    />
                    {secret && (
                      <button
                        type="button"
                        aria-label={revealed[i] ? "Hide value" : "Show value"}
                        className="absolute top-1/2 right-2 -translate-y-1/2 text-muted hover:text-ink"
                        onClick={() => setRevealed((r) => ({ ...r, [i]: !r[i] }))}
                      >
                        {revealed[i] ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    className="px-2"
                    aria-label="Remove header"
                    onClick={() => set("headers", value.headers.filter((_, j) => j !== i))}
                    disabled={disabled}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
            <Button
              variant="ghost"
              className="px-2 py-1 text-xs"
              icon={<Plus className="size-3.5" />}
              onClick={() => set("headers", [...value.headers, { key: "", value: "" }])}
              disabled={disabled}
            >
              Add header
            </Button>
          </div>
        </div>

        <div>
          <Label hint={<span className="font-mono">{"{{prompt}}"} · {"{{messages}}"}</span>}>JSON body template</Label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...value, bodyTemplate: p.body, responsePath: p.path })}
                className="rounded-md border border-line-strong px-2 py-0.5 text-[11px] text-ink-dim transition hover:border-gold/50 hover:text-gold-bright"
              >
                {p.name}
              </button>
            ))}
          </div>
          <TextArea
            rows={5}
            value={value.bodyTemplate}
            invalid={!!templateError}
            onChange={(e) => set("bodyTemplate", e.target.value)}
            disabled={disabled}
          />
          {templateError ? (
            <p className="mt-1.5 text-xs text-fail">{templateError}</p>
          ) : (
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              <span className="font-mono text-ink-dim">{"{{messages}}"}</span> replays the full conversation so multi-turn tests behave
              like production.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="resp-path" hint="e.g. choices[0].message.content">
            Response path
          </Label>
          <Input
            id="resp-path"
            className="font-mono text-[13px]"
            value={value.responsePath}
            placeholder="data.reply"
            onChange={(e) => set("responsePath", e.target.value)}
            disabled={disabled}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={sendTest}
            loading={testing}
            icon={<Send className="size-4" />}
            disabled={!check.ok || !!templateError || testing || disabled}
          >
            Send test message
          </Button>
          {testRes && (
            <span className={cx("text-xs", testRes.ok ? "text-pass" : "text-fail")}>
              {testRes.ok ? `HTTP ${testRes.status} · ${testRes.latencyMs} ms` : testRes.status ? `HTTP ${testRes.status}` : "Failed"}
            </span>
          )}
        </div>
        {testRes && (
          <div className="rounded-xl border border-line bg-obsidian p-3 text-[12.5px]">
            {testRes.error ? (
              <p className="text-fail">{testRes.error}</p>
            ) : (
              <>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-[11px] font-medium tracking-wide text-muted uppercase">Extracted reply</span>
                  {testRes.resolved ? (
                    <Chip className="border-pass/30 text-pass">path ok</Chip>
                  ) : (
                    <Chip className="border-warn/30 text-warn">path not found · showing raw</Chip>
                  )}
                </div>
                <p className="max-h-40 overflow-auto whitespace-pre-wrap text-ink scroll-quiet">{testRes.reply || "(empty)"}</p>
              </>
            )}
            {testRes.raw && (
              <button className="mt-2 text-[11px] text-muted underline-offset-2 hover:text-gold hover:underline" onClick={() => setShowRaw((s) => !s)}>
                {showRaw ? "Hide" : "Show"} raw body
              </button>
            )}
            {showRaw && testRes.raw && (
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-charcoal-2 p-2 font-mono text-[11px] text-ink-dim scroll-quiet">{testRes.raw}</pre>
            )}
          </div>
        )}

        <details className="group rounded-xl border border-line bg-charcoal-2/50">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-medium text-ink-dim select-none hover:text-ink">
            <span className="mr-1 inline-block transition group-open:rotate-90">›</span> Sharper results (optional)
          </summary>
          <div className="space-y-4 px-3 pb-3">
            <div>
              <Label hint="given to the judge & fix prompts">What is your app for?</Label>
              <TextArea
                rows={3}
                className="font-sans text-[13px]"
                placeholder="A support assistant for Acme's widget store. It should only answer product, order and shipping questions and never discuss pricing changes."
                value={value.appContext ?? ""}
                onChange={(e) => set("appContext", e.target.value)}
                disabled={disabled}
              />
            </div>
            <div>
              <Label hint="comma-separated">Canary phrases</Label>
              <Input
                className="font-mono text-xs"
                placeholder="ACME-INTERNAL-42, never mention competitor"
                value={(value.canaries ?? []).join(", ")}
                onChange={(e) =>
                  set(
                    "canaries",
                    e.target.value.split(",").map((s) => s.trimStart()),
                  )
                }
                onBlur={() => set("canaries", (value.canaries ?? []).map((s) => s.trim()).filter(Boolean))}
                disabled={disabled}
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                Put a unique phrase in your real system prompt and list it here. If it ever shows up in a reply, that test fails
                automatically.
              </p>
            </div>
          </div>
        </details>
      </div>
    </Card>
  );
}
