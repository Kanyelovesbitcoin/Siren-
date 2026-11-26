"use client";

import { useMemo, useState } from "react";
import { Bot, Crosshair, Lock, Plus, Send, ShieldAlert, Trash2, Eye, EyeOff } from "lucide-react";
import ConnectHelper from "./ConnectHelper";
import { Button, Card, Chip, Input, Label, Select, TextArea, cx } from "./ui";
import { checkTargetUrl } from "@/lib/safety";
import { targetLabel } from "@/lib/target-config";
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
  /** The configured response path wasn't found; the reply was under this common key instead. */
  detectedPath?: string;
  raw?: string;
  error?: string;
}

const detailsCls = "group rounded-xl border border-line bg-charcoal-2/50";
const summaryCls = "cursor-pointer list-none px-3 py-2.5 text-xs font-medium text-ink-dim select-none hover:text-ink";

/**
 * The technical connection fields: endpoint URL + HTTP method, headers, JSON body template and
 * response path. Most people never touch these (the setup prompt fills them in), so they live
 * inside "Advanced / Manual Setup".
 */
export function ManualSetupFields({
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
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const set = <K extends keyof TargetConfig>(k: K, v: TargetConfig[K]) => onChange({ ...value, [k]: v });

  return (
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
            aria-describedby={!check.ok && value.url ? "target-url-error" : undefined}
            placeholder="http://localhost:3000/api/chat"
            onChange={(e) => set("url", e.target.value)}
            disabled={disabled}
          />
        </div>
        {!check.ok && value.url && (
          // An external address is explained in the banner above; keep the reason available to screen readers here.
          <p id="target-url-error" className={cx("mt-1.5 text-xs text-fail", check.external && "sr-only")}>
            {check.reason}
          </p>
        )}
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
                  aria-label={`Header ${i + 1} name`}
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
                    aria-label={`Header ${i + 1} value`}
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
        <Label htmlFor="body-template" hint={<span className="font-mono">{"{{prompt}}"} · {"{{messages}}"}</span>}>
          JSON body template
        </Label>
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
          id="body-template"
          rows={5}
          aria-describedby="body-template-help"
          value={value.bodyTemplate}
          invalid={!!templateError}
          onChange={(e) => set("bodyTemplate", e.target.value)}
          disabled={disabled}
        />
        {templateError ? (
          <p id="body-template-help" className="mt-1.5 text-xs text-fail">
            {templateError}
          </p>
        ) : (
          <p id="body-template-help" className="mt-1.5 text-[11px] leading-relaxed text-muted">
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
    </div>
  );
}

/** Collapsed by default; opens by itself when a field inside needs fixing, so an error is never hidden. */
export function ManualSetupDetails({
  value,
  onChange,
  disabled,
  children,
}: {
  value: TargetConfig;
  onChange: (next: TargetConfig) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const invalid = (!checkTargetUrl(value.url).ok && !!value.url) || !!validateTemplate(value.bodyTemplate);
  return (
    <details className={detailsCls} open={open || invalid} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={summaryCls}>
        <span className="mr-1 inline-block transition group-open:rotate-90">›</span> Advanced / Manual Setup
      </summary>
      <div className="space-y-4 px-3 pb-3">
        <p className="text-[11.5px] leading-relaxed text-muted">
          For developers: set the endpoint, request body and response path by hand.
        </p>
        <ManualSetupFields value={value} onChange={onChange} disabled={disabled} />
        {children}
      </div>
    </details>
  );
}

export default function TargetPanel({
  value,
  onChange,
  onApplyConfig,
  autoRun,
  onAutoRunChange,
  isDemo,
  disabled,
}: {
  value: TargetConfig;
  onChange: (next: TargetConfig) => void;
  /** A setup arrived from the Copy Setup Prompt flow (pasted, or picked up from the saved file). */
  onApplyConfig: (next: TargetConfig) => void;
  /** Start the audit as soon as the app connects. */
  autoRun: boolean;
  onAutoRunChange: (next: boolean) => void;
  /** True while the bundled demo bot is the app under test. */
  isDemo?: boolean;
  disabled?: boolean;
}) {
  const check = useMemo(() => checkTargetUrl(value.url), [value.url]);
  const templateError = useMemo(() => validateTemplate(value.bodyTemplate), [value.bodyTemplate]);
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<TestResponse | null>(null);
  const [showRaw, setShowRaw] = useState(false);

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
      const data = (await res.json()) as TestResponse;
      setTestRes(data);
      // Save the key Siren found, so the audit reads replies from the right place.
      if (data.ok && data.detectedPath) onChange({ ...value, responsePath: data.detectedPath });
    } catch (e) {
      setTestRes({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card
      title="App to test"
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
        <div className="flex items-center gap-3 rounded-xl border border-line bg-obsidian/60 p-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold/10 text-gold">
            {isDemo ? <Bot className="size-5" /> : <Crosshair className="size-5" />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{isDemo ? "Demo Bot" : "Your app"}</p>
            <p className="truncate font-mono text-[11.5px] text-muted" title={value.url}>
              {check.ok ? targetLabel(value.url) : "Not connected yet"}
            </p>
          </div>
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
            <span
              className={cx("text-xs", testRes.ok ? "text-pass" : "text-fail")}
              title={testRes.status ? `HTTP ${testRes.status}${testRes.latencyMs != null ? ` · ${testRes.latencyMs} ms` : ""}` : undefined}
            >
              {testRes.ok ? "Got a reply" : testRes.status ? `Your app returned an error (${testRes.status})` : "No reply"}
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
                  {testRes.detectedPath ? (
                    <Chip className="border-pass/30 text-pass">found under &quot;{testRes.detectedPath}&quot; · saved</Chip>
                  ) : testRes.resolved ? (
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

        <details className={detailsCls}>
          <summary className={summaryCls}>
            <span className="mr-1 inline-block transition group-open:rotate-90">›</span>{" "}
            {isDemo ? "Connect my own app" : "Connect with Claude Code / Cursor"}
          </summary>
          <div className="px-3 pb-3">
            <ConnectHelper current={value} onApply={onApplyConfig} autoRun={autoRun} onAutoRunChange={onAutoRunChange} disabled={disabled} />
          </div>
        </details>

        <ManualSetupDetails value={value} onChange={onChange} disabled={disabled} />

        <details className={detailsCls}>
          <summary className={summaryCls}>
            <span className="mr-1 inline-block transition group-open:rotate-90">›</span> Sharper results (optional)
          </summary>
          <div className="space-y-4 px-3 pb-3">
            <div>
              <Label htmlFor="app-context" hint="used for grading & fix prompts">
                What is your app for?
              </Label>
              <TextArea
                id="app-context"
                rows={3}
                className="font-sans text-[13px]"
                placeholder="A support assistant for Acme's widget store. It should only answer product, order and shipping questions and never discuss pricing changes."
                value={value.appContext ?? ""}
                onChange={(e) => set("appContext", e.target.value)}
                disabled={disabled}
              />
            </div>
            <div>
              <Label htmlFor="canary-phrases" hint="comma-separated">
                Canary phrases
              </Label>
              <Input
                className="font-mono text-xs"
                id="canary-phrases"
                aria-describedby="canary-phrases-help"
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
              <p id="canary-phrases-help" className="mt-1.5 text-[11px] leading-relaxed text-muted">
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
