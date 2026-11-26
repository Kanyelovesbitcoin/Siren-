"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Eraser, Lock, Radio, RefreshCw, ShieldCheck, TriangleAlert, Info } from "lucide-react";
import TargetPanel from "./TargetPanel";
import ProviderPanel from "./ProviderPanel";
import SuitePanel from "./SuitePanel";
import AttackerBar from "./AttackerBar";
import ResultCard, { type LiveTest } from "./ResultCard";
import { Button, Card, cx } from "./ui";
import { checkTargetUrl } from "@/lib/safety";
import { validateTemplate } from "@/lib/template";
import { PROVIDER_PRESETS } from "@/lib/providers";
import type { AttackConfig, AuditEvent, Playbook, PlaybookLoadError, ProviderConfig, TargetConfig, TestResult } from "@/lib/types";

const STORAGE_KEY = "siren.config.v1";

const DEFAULT_TARGET: TargetConfig = {
  url: "http://localhost:3000/api/chat",
  method: "POST",
  headers: [],
  bodyTemplate: '{\n  "messages": [{ "role": "user", "content": "{{prompt}}" }]\n}',
  responsePath: "data.reply",
  appContext: "",
  canaries: [],
};

const DEMO_PORT = 3001;

/** The bundled demo bot (examples/vulnerable-bot.js). `npm run try` starts it for you. */
function demoTarget(port: number = DEMO_PORT): TargetConfig {
  return {
    url: `http://localhost:${port}/api/chat`,
    method: "POST",
    headers: [],
    bodyTemplate: '{\n  "messages": {{messages}}\n}',
    responsePath: "data.reply",
    appContext: "A customer support assistant for Acme Widgets. It should only help with orders, shipping and returns.",
    canaries: ["ACME-INTERNAL-7f3"],
  };
}

/** `npm run try` opens the dashboard at /?demo=1 (plus &demoPort=N for a custom port). */
function demoPortFromUrl(): number | null {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("demo")) return null;
  const port = Number(params.get("demoPort"));
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEMO_PORT;
}

const DEFAULT_JUDGE: ProviderConfig = {
  provider: "ollama",
  baseUrl: PROVIDER_PRESETS.ollama.baseUrl,
  model: "",
  mode: "judge",
};

const DEFAULT_ATTACK: AttackConfig = { enabled: false, maxTurns: 8 };

interface LogLine {
  level: "info" | "warn" | "error";
  message: string;
}

function loadSaved(): { target: TargetConfig; judge: ProviderConfig; selected?: string[]; attack?: AttackConfig } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function toMarkdown(results: TestResult[], target: TargetConfig, startedAt: string | null): string {
  const counts = { pass: 0, warn: 0, fail: 0, error: 0 };
  results.forEach((r) => counts[r.verdict]++);
  const lines = [
    `# Siren audit report`,
    ``,
    `- Target: \`${target.method} ${target.url}\``,
    `- Run: ${startedAt ? new Date(startedAt).toLocaleString() : "n/a"}`,
    `- Results: ${counts.pass} pass · ${counts.warn} warn · ${counts.fail} fail · ${counts.error} error`,
    ``,
  ];
  for (const r of results) {
    lines.push(`## [${r.verdict.toUpperCase()}] ${r.testName}`, ``, `${r.owasp} · ${r.playbookTitle} · severity ${r.severity} · decided by ${r.decidedBy}`, ``);
    lines.push(`**Verdict:** ${r.reason}`, ``);
    for (const t of r.turns) {
      lines.push(`> **Siren:** ${t.displayPrompt.replace(/\n/g, "\n> ")}`, `>`, `> **App (${t.status ?? "n/a"}, ${t.latencyMs} ms):** ${(t.response || t.error || "").slice(0, 1500).replace(/\n/g, "\n> ")}`, ``);
    }
    if (r.fixPrompt) {
      lines.push(`**Weakness:** ${r.weakness ?? ""}`, ``, `<details><summary>Fix prompt</summary>`, ``, "```text", r.fixPrompt, "```", ``, `</details>`, ``);
    }
  }
  return lines.join("\n");
}

export default function Dashboard() {
  const [hydrated, setHydrated] = useState(false);
  const [target, setTarget] = useState<TargetConfig>(DEFAULT_TARGET);
  const [judge, setJudge] = useState<ProviderConfig>(DEFAULT_JUDGE);
  const [attack, setAttack] = useState<AttackConfig>(DEFAULT_ATTACK);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loadErrors, setLoadErrors] = useState<PlaybookLoadError[]>([]);
  const [dir, setDir] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState<LiveTest[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const playbooksRef = useRef<Playbook[]>([]);
  const rerunRef = useRef(false);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const restoredRef = useRef(false);

  // Restore saved config (API keys are never persisted).
  useEffect(() => {
    if (restoredRef.current) return; // run once, even when React re-runs effects in development
    restoredRef.current = true;
    const saved = loadSaved();
    if (saved?.target) setTarget({ ...DEFAULT_TARGET, ...saved.target });
    if (saved?.judge) setJudge({ ...DEFAULT_JUDGE, ...saved.judge, apiKey: "" });
    if (saved?.attack) setAttack({ ...DEFAULT_ATTACK, ...saved.attack });
    if (saved?.selected) setSelected(new Set(saved.selected));

    // Launched with `npm run try`: the demo bot is already running, so pre-select it with
    // rules-only grading and every test ticked. "Run audit" then works on the first click.
    const demoPort = demoPortFromUrl();
    if (demoPort !== null) {
      setTarget(demoTarget(demoPort));
      setJudge((j) => ({ ...j, mode: "heuristic" }));
      setAttack((a) => ({ ...a, enabled: false }));
      setSelected(new Set()); // empty → everything gets selected once the playbooks load
      window.history.replaceState(null, "", window.location.pathname);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const { apiKey: _drop, ...judgeSafe } = judge;
      void _drop;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ target, judge: judgeSafe, attack, selected: [...selected] }));
    } catch {
      /* storage unavailable */
    }
  }, [hydrated, target, judge, attack, selected]);

  const refreshPlaybooks = useCallback(async () => {
    try {
      const res = await fetch("/api/playbooks", { cache: "no-store" });
      const data = (await res.json()) as { playbooks: Playbook[]; errors: PlaybookLoadError[]; dir: string };
      setPlaybooks(data.playbooks);
      playbooksRef.current = data.playbooks;
      setLoadErrors(data.errors);
      setDir(data.dir);
      return data.playbooks;
    } catch (e) {
      setLoadErrors([{ file: "/api/playbooks", error: (e as Error).message }]);
      return [];
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    refreshPlaybooks().then((pbs) => {
      const ids = new Set(pbs.flatMap((p) => p.tests.map((t) => t.id)));
      setSelected((prev) => {
        const kept = new Set([...prev].filter((id) => ids.has(id)));
        // First run: select everything so "Run audit" works immediately.
        return kept.size ? kept : ids;
      });
    });
  }, [hydrated, refreshPlaybooks]);

  const targetCheck = useMemo(() => checkTargetUrl(target.url), [target.url]);
  const templateError = useMemo(() => validateTemplate(target.bodyTemplate), [target.bodyTemplate]);
  const hasModel = judge.mode === "judge" && !!judge.model.trim();
  const blockReason = targetCheck.external
    ? "External target blocked by the localhost lock."
    : !targetCheck.ok
      ? targetCheck.reason
      : templateError
        ? "Fix the body template first."
        : selected.size === 0
          ? "Select at least one test."
          : attack.enabled && !hasModel
            ? "Attacker mode needs a connected model — it generates the attacks."
            : undefined;

  const results = live.map((l) => l.result).filter((r): r is TestResult => !!r);
  const counts = useMemo(() => {
    const c = { pass: 0, warn: 0, fail: 0, error: 0 };
    results.forEach((r) => c[r.verdict]++);
    return c;
  }, [results]);
  const failedIds = live.filter((l) => l.result && (l.result.verdict === "fail" || l.result.verdict === "warn" || l.result.verdict === "error")).map((l) => l.testId);
  const compared = live.filter((l) => l.result && l.previousVerdict);
  const rank = { pass: 3, warn: 2, fail: 1, error: 0 } as const;
  const fixedCount = compared.filter((l) => rank[l.result!.verdict] > rank[l.previousVerdict!]).length;
  const stillCount = compared.filter((l) => l.result!.verdict !== "pass" && rank[l.result!.verdict] <= rank[l.previousVerdict!]).length;
  const graded = counts.pass + counts.warn + counts.fail;
  const score = graded ? Math.round((100 * (counts.pass + counts.warn * 0.5)) / graded) : null;

  function handleEvent(e: AuditEvent) {
    switch (e.type) {
      case "start":
        // During a re-attack the total is set up front (it may span two requests).
        if (!rerunRef.current) setProgress({ done: 0, total: e.total });
        setStartedAt(e.startedAt);
        break;
      case "test-start": {
        const pb = playbooksRef.current.find((p) => p.id === e.playbookId);
        const fresh: LiveTest = { testId: e.testId, testName: e.testName, playbookTitle: pb?.title ?? "", owasp: pb?.owasp ?? "", turns: [] };
        setLive((prev) => {
          const i = prev.findIndex((l) => l.testId === e.testId);
          if (i < 0) return [...prev, fresh];
          // Re-attack: replace in place and remember the old verdict for the before → after chip.
          const next = [...prev];
          next[i] = { ...fresh, previousVerdict: prev[i].result?.verdict ?? prev[i].previousVerdict };
          return next;
        });
        if (!rerunRef.current) requestAnimationFrame(() => feedEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
        break;
      }
      case "turn":
        setLive((prev) => prev.map((l) => (l.testId === e.testId ? { ...l, turns: [...l.turns, e.turn] } : l)));
        break;
      case "result":
        setLive((prev) => prev.map((l) => (l.testId === e.result.testId ? { ...l, turns: e.result.turns, result: e.result } : l)));
        setProgress((p) => ({ ...p, done: p.done + 1 }));
        break;
      case "log":
        setLogs((prev) => [...prev, { level: e.level, message: e.message }]);
        break;
      case "done":
        if (e.aborted) setLogs((prev) => [...prev, { level: "warn", message: "Audit stopped." }]);
        break;
    }
  }

  /** POST one audit request and feed its NDJSON events into the dashboard. */
  async function streamAudit(testIds: string[], attackCfg: AttackConfig, signal: AbortSignal) {
    const res = await fetch("/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: { ...target, canaries: (target.canaries ?? []).filter(Boolean) }, judge, testIds, attack: attackCfg }),
      signal,
    });
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `Audit failed with HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) handleEvent(JSON.parse(line) as AuditEvent);
      }
    }
  }

  async function runAudit() {
    if (blockReason) return;
    // Pick up any playbook edits made since the page loaded.
    const pbs = await refreshPlaybooks();
    const ordered = pbs.flatMap((p) => p.tests.map((t) => t.id)).filter((id) => selected.has(id));
    rerunRef.current = false;
    setLive([]);
    setLogs([]);
    setRunError(null);
    setProgress({ done: 0, total: ordered.length });
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamAudit(ordered, attack, controller.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setRunError((e as Error).message);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  /**
   * Harden & re-attack: re-run only the given results (e.g. everything that failed after
   * you applied a fix). Results are replaced in place and show a before → after chip.
   */
  async function reattack(ids: string[]) {
    if (!ids.length || running) return;
    if (!targetCheck.ok || templateError) {
      setRunError(targetCheck.reason ?? templateError ?? "Fix the target settings first.");
      return;
    }
    const pbs = await refreshPlaybooks();
    const campaignPbs = new Set(ids.filter((id) => id.startsWith("attack:")).map((id) => id.slice("attack:".length)));
    const plainIds = ids.filter((id) => !id.startsWith("attack:"));
    if (campaignPbs.size && !hasModel) {
      setRunError("Re-attacking an adaptive campaign needs a connected model.");
      return;
    }
    rerunRef.current = true;
    setLogs([]);
    setRunError(null);
    setProgress({ done: 0, total: ids.length });
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (plainIds.length) await streamAudit(plainIds, { ...attack, enabled: false }, controller.signal);
      if (campaignPbs.size && !controller.signal.aborted) {
        const campaignTestIds = pbs.filter((p) => campaignPbs.has(p.id)).flatMap((p) => p.tests.map((t) => t.id));
        await streamAudit(campaignTestIds, { ...attack, enabled: true }, controller.signal);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setRunError((e as Error).message);
    } finally {
      setRunning(false);
      abortRef.current = null;
      rerunRef.current = false;
    }
  }

  function exportReport() {
    const md = toMarkdown(results, target, startedAt);
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `siren-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-obsidian/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/siren.svg" alt="" className="size-8 rounded-lg" />
            <div className="leading-tight">
              <p className="text-[17px] font-semibold tracking-tight">
                <span className="gold-text">Siren</span>
              </p>
              <p className="text-[11px] text-muted">Local-first AI security bench · OWASP LLM Top 10</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2 text-[11px]">
            <span
              className={cx(
                "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 sm:inline-flex",
                targetCheck.external ? "border-fail/40 text-fail" : "border-line-strong text-ink-dim",
              )}
            >
              <Lock className="size-3" />
              {targetCheck.external ? "External target blocked" : "Localhost only"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1 text-ink-dim">
              <span className={cx("size-1.5 rounded-full", judge.mode === "judge" && judge.model ? "bg-pass" : "bg-muted")} />
              {judge.mode === "judge" && judge.model ? judge.model : "Rules-only grading"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1440px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[400px_minmax(0,1fr)]">
        <aside className="space-y-6 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-96px)] lg:overflow-y-auto lg:pr-1 scroll-quiet">
          <TargetPanel value={target} onChange={setTarget} disabled={running} />
          <ProviderPanel value={judge} onChange={setJudge} disabled={running} />
        </aside>

        <div className="min-w-0 space-y-6">
          <AttackerBar value={attack} onChange={setAttack} modelName={hasModel ? judge.model : null} disabled={running} />

          <SuitePanel
            playbooks={playbooks}
            errors={loadErrors}
            dir={dir}
            selected={selected}
            onSelectedChange={setSelected}
            running={running}
            attackerMode={attack.enabled}
            canRun={!blockReason && !running}
            blockReason={blockReason}
            progress={progress}
            onRun={runAudit}
            onStop={() => abortRef.current?.abort()}
          />

          <Card
            title="Live transcript"
            icon={<Radio className="size-4" />}
            action={
              live.length > 0 && (
                <div className="flex items-center gap-1">
                  {failedIds.length > 0 && (
                    <Button
                      variant="outline"
                      className="px-2.5 py-1 text-xs"
                      icon={<RefreshCw className="size-3.5" />}
                      onClick={() => reattack(failedIds)}
                      disabled={running}
                    >
                      Re-attack failed ({failedIds.length})
                    </Button>
                  )}
                  <Button variant="ghost" className="px-2 py-1 text-xs" icon={<Download className="size-3.5" />} onClick={exportReport} disabled={!results.length || running}>
                    Export .md
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    icon={<Eraser className="size-3.5" />}
                    onClick={() => {
                      setLive([]);
                      setLogs([]);
                      setProgress({ done: 0, total: 0 });
                    }}
                    disabled={running}
                  >
                    Clear
                  </Button>
                </div>
              )
            }
          >
            {(results.length > 0 || running) && (
              <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[
                  { label: "Hardening score", value: score === null ? "—" : `${score}`, cls: "text-gold" },
                  { label: "Pass", value: counts.pass, cls: "text-pass" },
                  { label: "Warn", value: counts.warn, cls: "text-warn" },
                  { label: "Fail", value: counts.fail, cls: "text-fail" },
                  { label: "Error", value: counts.error, cls: "text-err" },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-line bg-obsidian/60 px-4 py-3">
                    <p className="text-[11px] tracking-wide text-muted uppercase">{s.label}</p>
                    <p className={cx("mt-0.5 font-mono text-2xl font-semibold tabular-nums", s.cls)}>{s.value}</p>
                  </div>
                ))}
              </div>
            )}

            {compared.length > 0 && !running && (
              <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-gold/30 bg-gold/[0.05] px-4 py-3 text-[13px]">
                <span className="font-semibold text-gold">Re-attack results</span>
                <span className="text-pass">{fixedCount} fixed</span>
                <span className={stillCount ? "text-fail" : "text-muted"}>{stillCount} still failing</span>
                {stillCount === 0 && fixedCount > 0 && <span className="text-ink-dim">Every re-attacked weakness now holds. Nice work.</span>}
              </div>
            )}

            {failedIds.length > 0 && compared.length === 0 && !running && (
              <div className="mb-4 rounded-xl border border-line bg-charcoal-2/60 px-4 py-3 text-[12.5px] leading-relaxed text-ink-dim">
                <span className="font-semibold text-ink">Harden &amp; re-attack:</span> copy a fix prompt below, apply it in your IDE,
                restart your app, then hit <span className="text-gold">Re-attack failed</span> to see what you fixed. Using the demo bot? Stop it
                and run <span className="font-mono text-ink">npm run demo:hardened</span>.
              </div>
            )}

            {runError && (
              <div role="alert" className="mb-4 flex gap-2 rounded-xl border border-fail/40 bg-fail/10 p-3 text-[13px] text-fail">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                {runError}
              </div>
            )}

            {logs.length > 0 && (
              <ul className="mb-4 space-y-1.5">
                {logs.map((l, i) => (
                  <li
                    key={i}
                    className={cx(
                      "flex gap-2 rounded-lg px-3 py-2 text-xs leading-relaxed",
                      l.level === "error" ? "bg-fail/10 text-fail" : l.level === "warn" ? "bg-warn/10 text-warn" : "bg-charcoal-2 text-ink-dim",
                    )}
                  >
                    <Info className="mt-px size-3.5 shrink-0" />
                    {l.message}
                  </li>
                ))}
              </ul>
            )}

            {live.length === 0 ? (
              <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
                <ShieldCheck className="mb-3 size-8 text-gold/70" />
                <p className="text-sm font-medium text-ink">No audit yet</p>
                <p className="mt-1 max-w-md text-[13px] leading-relaxed text-muted">
                  Point Siren at your local AI endpoint, pick a judge model, then hit <span className="text-gold">Run audit</span>. Each test
                  shows up here side-by-side with your app&apos;s reply.
                </p>
                <button
                  className="mt-4 text-xs text-gold/90 underline-offset-4 hover:underline"
                  onClick={() => setTarget(demoTarget())}
                  disabled={running}
                >
                  No app handy? Use the bundled demo bot (start it with: npm run try)
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {live.map((l) => (
                  <ResultCard key={l.testId} live={l} running={running} onRerun={() => reattack([l.testId])} />
                ))}
                <div ref={feedEndRef} />
              </div>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
