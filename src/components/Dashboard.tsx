"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, Download, Eraser, House, LoaderCircle, Lock, Play, Radio, RefreshCw, ShieldCheck, TriangleAlert, Info, X } from "lucide-react";
import { buildConnectFixPrompt } from "@/lib/setup-prompt";
import SampleReport from "./SampleReport";
import ScoreTiles from "./ScoreTiles";
import StartScreen, { type DemoStatus } from "./StartScreen";
import TargetPanel from "./TargetPanel";
import ProviderPanel from "./ProviderPanel";
import SuitePanel from "./SuitePanel";
import AttackerBar from "./AttackerBar";
import { type LiveTest } from "./ResultCard";
import ResultGroups from "./ResultGroups";
import { Button, Card, CopyButton, cx } from "./ui";
import { checkTargetUrl } from "@/lib/safety";
import { summarize } from "@/lib/summary";
import { sameTarget, targetLabel } from "@/lib/target-config";
import { validateTemplate } from "@/lib/template";
import { PROVIDER_PRESETS } from "@/lib/providers";
import type { AttackConfig, AuditEvent, Playbook, PlaybookLoadError, ProviderConfig, TargetConfig, TestResult } from "@/lib/types";

const STORAGE_KEY = "siren.config.v1";
/** Set once someone on a small screen chooses "use the full app anyway", so the sample isn't forced on them again. */
const SKIP_SAMPLE_KEY = "siren.skipSample.v1";
/** Below this width Siren shows the sample report first: a phone can't reach an app to test. */
const PHONE_QUERY = "(max-width: 639px)";

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

// Rules only by default: a first audit needs no AI model, no install and no API key.
const DEFAULT_JUDGE: ProviderConfig = {
  provider: "ollama",
  baseUrl: PROVIDER_PRESETS.ollama.baseUrl,
  model: "",
  mode: "heuristic",
};

const DEFAULT_ATTACK: AttackConfig = { enabled: false, maxTurns: 8 };

interface LogLine {
  level: "info" | "warn" | "error";
  message: string;
}

/** "start" = the two beginner cards · "workspace" = the full dashboard. */
type View = "start" | "workspace";

/** Result of saying hello to a freshly connected app. */
interface Connection {
  status: "checking" | "ok" | "fail";
  label: string;
  reply?: string;
  error?: string;
  /** Siren found the reply under this key and saved it as the response path. */
  fixedPath?: string;
  /** The app answered, but with an error (as opposed to not answering at all). */
  answeredWithError?: boolean;
}

interface Ping {
  ok: boolean;
  status?: number | null;
  reply?: string;
  error?: string;
  detectedPath?: string;
}

/** One friendly message to the app, through the same route as "Send test message". */
async function pingTarget(target: TargetConfig): Promise<Ping> {
  try {
    const res = await fetch("/api/target/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target }),
    });
    return (await res.json()) as Ping;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** After a failed connection Siren looks again this often, so the user never has to come back and press retry. */
const RETRY_MS = 5000;

function loadSaved(): {
  target: TargetConfig;
  judge: ProviderConfig;
  selected?: string[];
  attack?: AttackConfig;
  view?: View;
  autoRun?: boolean;
} | null {
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
  const order = { fail: 0, warn: 1, error: 2, pass: 3 } as const;
  for (const r of [...results].sort((a, b) => order[a.verdict] - order[b.verdict])) {
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
  const [view, setView] = useState<View>("start");
  const [demoStatus, setDemoStatus] = useState<DemoStatus>("idle");
  const [demoReady, setDemoReady] = useState(false);
  const [demoPort, setDemoPort] = useState(DEMO_PORT);
  const [conn, setConn] = useState<Connection | null>(null);
  /** Start the audit as soon as an app connects (the "paste one prompt and it's done" flow). */
  const [autoRun, setAutoRun] = useState(true);
  /** Where the coding agent is asked to save the setup; goes into the fix prompt. */
  const [configPath, setConfigPath] = useState<string | null>(null);
  const failedAt = useRef(0);
  /** The read-only sample report. Shown first on phone-sized screens, and on request from the start screen. */
  const [sample, setSample] = useState<"phone" | "requested" | null>(null);
  /** Spoken by screen readers through a polite live region: audit started, finished, stopped. */
  const [announcement, setAnnouncement] = useState("");
  const firstScreen = useRef(true);

  // When the screen changes (start ↔ dashboard ↔ sample), move keyboard focus to the new screen's
  // heading. Otherwise focus is left on a button that no longer exists and the user is lost.
  useEffect(() => {
    if (!hydrated) return;
    if (firstScreen.current) {
      firstScreen.current = false;
      return;
    }
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-screen-heading]")?.focus({ preventScroll: true }));
  }, [hydrated, view, sample]);
  const abortRef = useRef<AbortController | null>(null);
  const playbooksRef = useRef<Playbook[]>([]);
  const rerunRef = useRef(false);
  /** The engine stopped the run itself (app down or rate-limiting). Don't start another request for it. */
  const haltedRef = useRef(false);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const restoredRef = useRef(false);

  // Restore saved config (API keys are never persisted).
  useEffect(() => {
    if (restoredRef.current) return; // run once, even when React re-runs effects in development
    restoredRef.current = true;
    const saved = loadSaved();
    if (saved?.target) setTarget({ ...DEFAULT_TARGET, ...saved.target });
    if (saved?.judge) {
      const restored: ProviderConfig = { ...DEFAULT_JUDGE, ...saved.judge, apiKey: "" };
      // No model picked means rules-only grading in practice, so show it that way.
      if (!restored.model?.trim()) restored.mode = "heuristic";
      setJudge(restored);
    }
    if (saved?.attack) setAttack({ ...DEFAULT_ATTACK, ...saved.attack });
    if (saved?.selected) setSelected(new Set(saved.selected));
    if (typeof saved?.autoRun === "boolean") setAutoRun(saved.autoRun);
    // Settings saved before the start screen existed belong to someone who already knows the dashboard.
    if (saved) setView(saved.view === "start" ? "start" : "workspace");

    // Launched with `npm run try`: the demo bot is already running, so pre-select it with
    // rules-only grading and every test ticked, and show the start screen with the demo ready.
    const port = demoPortFromUrl();
    if (port !== null) {
      setDemoPort(port);
      setDemoReady(true);
      setTarget(demoTarget(port));
      setJudge((j) => ({ ...j, mode: "heuristic" }));
      setAttack((a) => ({ ...a, enabled: false }));
      setSelected(new Set()); // empty → everything gets selected once the playbooks load
      setView("start");
      window.history.replaceState(null, "", window.location.pathname);
    }

    // Phone-sized screen: lead with the sample report. Checked once on load, so resizing a
    // desktop window mid-audit never pulls anyone away from their results.
    let skipSample = false;
    try {
      skipSample = localStorage.getItem(SKIP_SAMPLE_KEY) === "1";
    } catch {
      /* storage unavailable */
    }
    if (!skipSample && window.matchMedia(PHONE_QUERY).matches) setSample("phone");
    setHydrated(true);
  }, []);

  function leaveSample() {
    if (sample === "phone") {
      try {
        localStorage.setItem(SKIP_SAMPLE_KEY, "1");
      } catch {
        /* storage unavailable */
      }
    }
    setSample(null);
    window.scrollTo(0, 0);
  }

  useEffect(() => {
    if (!hydrated) return;
    try {
      const { apiKey: _drop, ...judgeSafe } = judge;
      void _drop;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ target, judge: judgeSafe, attack, selected: [...selected], view, autoRun }));
    } catch {
      /* storage unavailable */
    }
  }, [hydrated, target, judge, attack, selected, view, autoRun]);

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
    // The sample report is self-contained: no requests until someone moves on to the real app.
    if (!hydrated || sample) return;
    refreshPlaybooks().then((pbs) => {
      const ids = new Set(pbs.flatMap((p) => p.tests.map((t) => t.id)));
      setSelected((prev) => {
        const kept = new Set([...prev].filter((id) => ids.has(id)));
        // First run: select everything so "Run audit" works immediately.
        return kept.size ? kept : ids;
      });
    });
  }, [hydrated, sample, refreshPlaybooks]);

  useEffect(() => {
    if (!hydrated || sample || configPath) return; // the sample report makes no requests
    fetch("/api/config", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { path?: string } | null) => data?.path && setConfigPath(data.path))
      .catch(() => {});
  }, [hydrated, sample, configPath]);

  // After a failed connection, keep looking. The user is off in their coding agent getting the
  // app running; when it answers (or the agent saves a corrected setup), connect without a click.
  const retryRef = useRef<() => Promise<void>>(async () => {});
  retryRef.current = async () => {
    const saved = (await fetch("/api/config", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)) as { found?: boolean; target?: TargetConfig; mtime?: number } | null;
    if (saved?.found && saved.target && (saved.mtime ?? 0) > failedAt.current - 1000 && !sameTarget(saved.target, target)) {
      await applyConfig(saved.target);
      return;
    }
    if ((await pingTarget(target)).ok) await connectAndRun(target, { quiet: true });
  };
  const waitingForApp = hydrated && !sample && view === "workspace" && conn?.status === "fail" && !running;
  useEffect(() => {
    if (!waitingForApp) return;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        await retryRef.current();
      } finally {
        busy = false;
      }
    }, RETRY_MS);
    return () => clearInterval(timer);
  }, [waitingForApp]);

  const targetCheck = useMemo(() => checkTargetUrl(target.url), [target.url]);
  const templateError = useMemo(() => validateTemplate(target.bodyTemplate), [target.bodyTemplate]);
  const hasModel = judge.mode === "judge" && !!judge.model.trim();
  const isDemo = sameTarget(target, demoTarget(demoPort));
  const blockReason = targetCheck.external
    ? "External target blocked by the localhost lock."
    : !targetCheck.ok
      ? targetCheck.reason
      : templateError
        ? "Fix the body template first."
        : selected.size === 0
          ? "Select at least one test."
          : attack.enabled && !hasModel
            ? "Attacker mode needs an AI model. Set one up under AI Grader, or turn attacker mode off."
            : undefined;

  const results = live.map((l) => l.result).filter((r): r is TestResult => !!r);
  // Counts and score live in lib/summary.ts (same formula as before) so the sample report shares them.
  const { counts, score } = summarize(results);
  const failedIds = live.filter((l) => l.result && (l.result.verdict === "fail" || l.result.verdict === "warn" || l.result.verdict === "error")).map((l) => l.testId);
  const compared = live.filter((l) => l.result && l.previousVerdict);
  const rank = { pass: 3, warn: 2, fail: 1, error: 0 } as const;
  const fixedCount = compared.filter((l) => rank[l.result!.verdict] > rank[l.previousVerdict!]).length;
  const stillCount = compared.filter((l) => l.result!.verdict !== "pass" && rank[l.result!.verdict] <= rank[l.previousVerdict!]).length;

  function handleEvent(e: AuditEvent) {
    switch (e.type) {
      case "start":
        // During a re-attack the total is set up front (it may span two requests).
        setAnnouncement(`Audit started. Running ${e.total} ${e.total === 1 ? "test" : "tests"}.`);
        if (!rerunRef.current) {
          setProgress({ done: 0, total: e.total });
          // Bring the results into view; the test in progress shows at the top of them.
          requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
        }
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
        if (e.halted) {
          // One plain-English reason, instead of the same error repeated on every remaining card.
          haltedRef.current = true;
          setRunError(e.halted);
        }
        setAnnouncement(
          e.halted
            ? `Audit stopped early. ${e.halted}`
            : e.aborted
            ? "Audit stopped."
            : `Audit finished. ${e.summary.fail} need action, ${e.summary.warn} need review, ${e.summary.error} could not run, ${e.summary.pass} passed.`,
        );
        break;
    }
  }

  /**
   * POST one audit request and feed its NDJSON events into the dashboard. `targetCfg` and
   * `judgeCfg` default to the current settings; the demo card passes its own so it can start
   * in the same click that changes them.
   */
  async function streamAudit(
    testIds: string[],
    attackCfg: AttackConfig,
    signal: AbortSignal,
    targetCfg: TargetConfig = target,
    judgeCfg: ProviderConfig = judge,
  ) {
    const res = await fetch("/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target: { ...targetCfg, canaries: (targetCfg.canaries ?? []).filter(Boolean) },
        judge: judgeCfg,
        testIds,
        attack: attackCfg,
      }),
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

  /**
   * Run the audit. With no argument it uses the current settings. `over` lets a caller start a
   * run in the same click that changes the settings (the demo card, or right after connecting),
   * before React has re-rendered with them.
   */
  async function runAudit(over?: { target?: TargetConfig; judge?: ProviderConfig; attack?: AttackConfig; all?: boolean }) {
    if (!over && blockReason) return;
    // Pick up any playbook edits made since the page loaded.
    const pbs = await refreshPlaybooks();
    const allIds = pbs.flatMap((p) => p.tests.map((t) => t.id));
    // The demo always runs every test; otherwise run what's ticked (or everything, if nothing is).
    const ticked = allIds.filter((id) => selected.has(id));
    const ordered = over?.all || (over && ticked.length === 0) ? allIds : ticked;
    if (ordered === allIds) setSelected(new Set(allIds));
    if (!ordered.length) {
      setRunError("Siren couldn't find any tests to run. Check the playbooks folder.");
      return;
    }
    rerunRef.current = false;
    haltedRef.current = false;
    setLive([]);
    setLogs([]);
    setRunError(null);
    setProgress({ done: 0, total: ordered.length });
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamAudit(ordered, over?.attack ?? attack, controller.signal, over?.target, over?.judge);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setRunError((e as Error).message);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  /** "Try the Demo Bot": one click from the start screen to a running audit. */
  async function runDemo() {
    if (running || demoStatus === "checking") return;
    const demo = demoTarget(demoPort);
    setDemoStatus("checking");
    const ping = await pingTarget(demo);
    if (!ping.ok) {
      setDemoStatus("missing");
      return;
    }
    setDemoStatus("idle");
    // Rules-only grading, so the demo never depends on an AI model being installed.
    const demoJudge: ProviderConfig = { ...judge, mode: "heuristic" };
    const demoAttack: AttackConfig = { ...attack, enabled: false };
    setTarget(demo);
    setJudge(demoJudge);
    setAttack(demoAttack);
    setConn(null);
    setView("workspace");
    await runAudit({ target: demo, judge: demoJudge, attack: demoAttack, all: true });
  }

  /**
   * Say hello to the app so the user knows the setup works before a full audit. Returns the
   * setup that worked (with the response key corrected if Siren had to find it), or null.
   * `quiet` skips the "saying hello…" state, for the background re-checks after a failure.
   */
  async function connect(t: TargetConfig, opts: { quiet?: boolean } = {}): Promise<TargetConfig | null> {
    const label = targetLabel(t.url);
    if (!opts.quiet) setConn({ status: "checking", label });
    const ping = await pingTarget(t);
    if (!ping.ok) {
      failedAt.current = Date.now();
      setConn({
        status: "fail",
        label,
        answeredWithError: !!ping.status,
        error: ping.error ?? (ping.status ? `Your app answered with an error (HTTP ${ping.status}).` : "No reply came back."),
      });
      return null;
    }
    // The reply wasn't where the setup said, but Siren found it under a common key: save that.
    const fixedPath = ping.detectedPath;
    if (fixedPath) setTarget((cur) => (cur.url === t.url ? { ...cur, responsePath: fixedPath } : cur));
    setConn({ status: "ok", label, reply: ping.reply, fixedPath });
    return fixedPath ? { ...t, responsePath: fixedPath } : t;
  }

  /** Connect, then start the audit straight away if the user left that option on. */
  async function connectAndRun(t: TargetConfig, opts: { quiet?: boolean } = {}) {
    const working = await connect(t, opts);
    if (!working || !autoRun || abortRef.current) return;
    // Attacker mode needs a model; without one, fall back to the built-in tests instead of failing.
    await runAudit({ target: working, attack: { ...attack, enabled: attack.enabled && hasModel } });
  }

  /** A setup arrived from the Copy Setup Prompt flow (pasted, or picked up from the saved file). */
  async function applyConfig(t: TargetConfig) {
    setTarget(t);
    setView("workspace");
    // Earlier results belong to a different app.
    setLive([]);
    setLogs([]);
    setRunError(null);
    setProgress({ done: 0, total: 0 });
    await connectAndRun(t);
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
      setRunError("Re-attacking an attacker-mode result needs an AI model. Set one up under AI Grader.");
      return;
    }
    rerunRef.current = true;
    haltedRef.current = false;
    setLogs([]);
    setRunError(null);
    setProgress({ done: 0, total: ids.length });
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (plainIds.length) await streamAudit(plainIds, { ...attack, enabled: false }, controller.signal);
      if (campaignPbs.size && !controller.signal.aborted && !haltedRef.current) {
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
      {hydrated && !sample && view === "workspace" && (
        <a
          href="#results"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-gold focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#1a1406]"
        >
          Skip to results
        </a>
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <header className="sticky top-0 z-20 border-b border-line bg-obsidian/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/siren.svg" alt="" className="size-8 rounded-lg" />
            <div className="leading-tight">
              <p className="text-[17px] font-semibold tracking-tight">
                <span className="gold-text">Siren</span>
              </p>
              <p className="hidden text-[11px] text-muted min-[420px]:block">Security testing for your AI app · runs on your computer</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2 text-[11px]">
            {hydrated && !sample && view === "workspace" && (
              <Button variant="ghost" className="px-2 py-1 text-xs" icon={<House className="size-3.5" />} onClick={() => setView("start")} disabled={running}>
                Start screen
              </Button>
            )}
            <span
              className={cx(
                "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 sm:inline-flex",
                targetCheck.external ? "border-fail/40 text-fail" : "border-line-strong text-ink-dim",
              )}
            >
              <Lock className="size-3" />
              {targetCheck.external ? "External target blocked" : "Localhost only"}
            </span>
            {sample ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/35 px-2.5 py-1 whitespace-nowrap text-gold">Sample report</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1 text-ink-dim">
                <span className={cx("size-1.5 rounded-full", judge.mode === "judge" && judge.model ? "bg-pass" : "bg-muted")} />
                {judge.mode === "judge" && judge.model ? judge.model : "Rules-only grading"}
              </span>
            )}
          </div>
        </div>
      </header>

      {hydrated && sample && <SampleReport onPhone={sample === "phone"} onLeave={leaveSample} />}

      {hydrated && !sample && view === "start" && (
        <StartScreen
          demoStatus={demoStatus}
          demoReady={demoReady}
          onTryDemo={runDemo}
          target={target}
          onTargetChange={setTarget}
          onApplyConfig={applyConfig}
          autoRun={autoRun}
          onAutoRunChange={setAutoRun}
          onManualContinue={() => {
            setView("workspace");
            void connectAndRun(target);
          }}
          manualReady={targetCheck.ok && !templateError}
          hasResults={live.length > 0}
          onBackToResults={() => setView("workspace")}
          onSeeSample={() => {
            setSample("requested");
            window.scrollTo(0, 0);
          }}
        />
      )}

      {hydrated && !sample && view === "workspace" && (
      <main className="mx-auto grid max-w-[1440px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[400px_minmax(0,1fr)]">
        <h1 data-screen-heading tabIndex={-1} className="sr-only">
          Siren dashboard
        </h1>
        <aside aria-label="Setup" className="space-y-6 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-96px)] lg:overflow-y-auto lg:pr-1 scroll-quiet">
          <TargetPanel
            value={target}
            onChange={(next) => {
              setTarget(next);
              setConn(null);
            }}
            onApplyConfig={applyConfig}
            autoRun={autoRun}
            onAutoRunChange={setAutoRun}
            isDemo={isDemo}
            disabled={running}
          />
          <ProviderPanel value={judge} onChange={setJudge} disabled={running} />
        </aside>

        <div className="min-w-0 space-y-6">
          {conn && (
            <div
              role="status"
              className={cx(
                "flex flex-wrap items-start gap-3 rounded-2xl border p-4 text-[13px] leading-relaxed",
                conn.status === "ok" ? "border-pass/35 bg-pass/[0.07]" : conn.status === "fail" ? "border-fail/40 bg-fail/10" : "border-line bg-charcoal",
              )}
            >
              {conn.status === "checking" && <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-gold" />}
              {conn.status === "ok" && <CircleCheck className="mt-0.5 size-4 shrink-0 text-pass" />}
              {conn.status === "fail" && <TriangleAlert className="mt-0.5 size-4 shrink-0 text-fail" />}
              <div className="min-w-0 flex-1">
                {conn.status === "checking" && (
                  <p className="text-ink-dim">
                    Saying hello to your app at <span className="font-mono text-[12px] text-ink">{conn.label}</span>…
                  </p>
                )}
                {conn.status === "ok" && (
                  <>
                    <p className="font-semibold text-ink">
                      Connected to <span className="font-mono text-[12px] font-normal">{conn.label}</span>
                    </p>
                    <p className="mt-1 text-ink-dim">
                      Siren said hello and your app replied:{" "}
                      <span className="text-ink">&ldquo;{(conn.reply || "(empty reply)").slice(0, 220)}{(conn.reply ?? "").length > 220 ? "…" : ""}&rdquo;</span>
                    </p>
                    {conn.fixedPath && (
                      <p className="mt-1 text-ink-dim">
                        Siren found the reply under <span className="font-mono text-[12px] text-ink">{conn.fixedPath}</span> and saved
                        that to your setup.
                      </p>
                    )}
                    <p className="mt-1 text-muted">If that looks like your chatbot talking, you&apos;re ready.</p>
                  </>
                )}
                {conn.status === "fail" && (
                  <>
                    <p className="font-semibold text-fail">
                      {conn.answeredWithError ? "Your app answered with an error at " : "Siren couldn\u2019t reach your app at "}
                      <span className="font-mono text-[12px] font-normal">{conn.label}</span>
                    </p>
                    <p className="mt-1 text-ink-dim">{conn.error}</p>
                    <p className="mt-1 text-muted">
                      {conn.answeredWithError
                        ? "Siren reached your app, but it sent back an error instead of a chat reply. Look at your app\u2019s own terminal window for the cause (a missing API key is the usual one), then try again."
                        : "Check that your app is running on this computer, then try again."}{" "}
                      Wrong address? Open <span className="text-ink-dim">Advanced / Manual Setup</span> on the left.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                      <CopyButton
                        variant="gold"
                        label="Copy Fix Prompt for Claude Code / Cursor"
                        text={buildConnectFixPrompt({ target, error: conn.error ?? "", answered: !!conn.answeredWithError, configPath })}
                      />
                      <span className="text-[12.5px] text-ink-dim">Paste it into your coding agent in your app&apos;s folder.</span>
                    </div>
                    <p className="mt-3 flex items-start gap-2 text-[12.5px] text-ink-dim">
                      <span aria-hidden className="siren-pulse mt-1.5 size-2 shrink-0 rounded-full bg-gold" />
                      Siren checks again every few seconds and connects by itself as soon as your app answers
                      {autoRun ? ", then starts the audit." : "."}
                    </p>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {conn.status === "ok" && !running && live.length === 0 && (
                  <Button variant="gold" icon={<Play className="size-4 fill-current" />} onClick={() => runAudit()} disabled={!!blockReason}>
                    Run audit
                  </Button>
                )}
                {conn.status === "fail" && <Button onClick={() => connectAndRun(target)}>Try again</Button>}
                {conn.status !== "checking" && (
                  <button aria-label="Dismiss" className="p-1 text-muted hover:text-ink" onClick={() => setConn(null)}>
                    <X className="size-4" />
                  </button>
                )}
              </div>
            </div>
          )}

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
            onRun={() => runAudit()}
            onStop={() => abortRef.current?.abort()}
          />

          <div ref={resultsRef} id="results" tabIndex={-1} className="scroll-mt-20 outline-none">
          <Card
            title="Results"
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
              <div className="mb-5">
                <ScoreTiles counts={counts} score={score} />
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
                <span className="font-semibold text-ink">Fix and re-test:</span> copy a fix prompt below, paste it into Claude Code or
                Cursor, restart your app, then hit <span className="text-gold">Re-attack failed</span> to see what you fixed.
                {isDemo && " (The demo bot is only for practice. The README shows how to run its fixed version.)"}
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
                <p className="text-sm font-medium text-ink">No results yet</p>
                <p className="mt-1 max-w-md text-[13px] leading-relaxed text-muted">
                  Hit <span className="text-gold">Run audit</span> above. Each test shows up here next to your app&apos;s reply, with a
                  plain-English explanation and a fix for anything that goes wrong.
                </p>
                <button className="mt-4 text-xs text-gold/90 underline-offset-4 hover:underline" onClick={() => setView("start")} disabled={running}>
                  Back to the start screen
                </button>
              </div>
            ) : (
              <ResultGroups items={live} running={running} onRerun={(id) => reattack([id])} />
            )}
          </Card>
          </div>
        </div>
      </main>
      )}
    </div>
  );
}
