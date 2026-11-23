// The audit runner: executes playbook tests sequentially against the localhost target
// and emits AuditEvents as it goes (streamed to the dashboard as NDJSON).

import { checkTargetUrl } from "./safety";
import { extractReply, renderBody, templateUsesHistory, type ChatMessage } from "./template";
import { deterministicChecks, heuristicEvaluate, judgeEvaluate, type Evaluation } from "./judge";
import { buildFixPrompt } from "./remediation";
import type {
  AuditEvent,
  Playbook,
  PlaybookTest,
  ProviderConfig,
  TargetConfig,
  TestResult,
  TurnRecord,
} from "./types";

const MAX_BURST = 50;
const MAX_CONCURRENCY = 10;
const MAX_OVERSIZE_CHARS = 200_000;

function targetTimeout() {
  const n = Number(process.env.SIREN_TARGET_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

export interface TargetCall {
  status: number | null;
  raw: string;
  text: string;
  resolved: boolean;
  latencyMs: number;
  error?: string;
}

export async function callTarget(
  target: TargetConfig,
  prompt: string,
  history: ChatMessage[],
  signal?: AbortSignal,
): Promise<TargetCall> {
  const check = checkTargetUrl(target.url);
  if (!check.ok || !check.url) {
    // Enforced server-side on every single request, not just once per audit.
    return { status: null, raw: "", text: "", resolved: false, latencyMs: 0, error: check.reason };
  }

  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/plain, */*" };
  for (const h of target.headers ?? []) {
    const k = h.key.trim();
    if (k && !/^(host|content-length)$/i.test(k)) headers[k.toLowerCase()] = h.value;
  }

  let body: string;
  try {
    body = renderBody(target.bodyTemplate, prompt, history);
  } catch (e) {
    return { status: null, raw: "", text: "", resolved: false, latencyMs: 0, error: `Template error: ${(e as Error).message}` };
  }

  const timeout = AbortSignal.timeout(targetTimeout());
  const started = performance.now();
  try {
    const res = await fetch(check.url, {
      method: target.method || "POST",
      headers,
      body,
      // Never follow redirects: a localhost app must not be able to bounce Siren to an external host.
      redirect: "manual",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const raw = await res.text();
    const latencyMs = Math.round(performance.now() - started);
    if (res.status >= 300 && res.status < 400) {
      return {
        status: res.status,
        raw,
        text: "",
        resolved: false,
        latencyMs,
        error: `Target responded with a redirect (${res.status}). Siren does not follow redirects for safety.`,
      };
    }
    const { text, resolved } = extractReply(raw, target.responsePath);
    return { status: res.status, raw, text, resolved, latencyMs };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - started);
    const err = e as Error & { cause?: { code?: string } };
    const msg =
      err.name === "TimeoutError"
        ? `Timed out after ${targetTimeout()} ms`
        : err.cause?.code === "ECONNREFUSED"
          ? `Connection refused — is your app running at ${check.url.origin}?`
          : err.message;
    return { status: null, raw: "", text: "", resolved: false, latencyMs, error: msg };
  }
}

function toTurn(index: number, prompt: string, call: TargetCall, displayPrompt = prompt): TurnRecord {
  return {
    index,
    prompt,
    displayPrompt,
    response: call.text,
    status: call.status,
    latencyMs: call.latencyMs,
    error: call.error,
  };
}

async function runPromptTest(
  test: PlaybookTest,
  target: TargetConfig,
  emit: (e: AuditEvent) => void,
  signal: AbortSignal,
  warnOnce: (key: string, msg: string) => void,
): Promise<{ turns: TurnRecord[]; raws: string[] }> {
  const turns: TurnRecord[] = [];
  const raws: string[] = [];
  const history: ChatMessage[] = [];
  const keepsHistory = templateUsesHistory(target.bodyTemplate);
  if (test.turns.length > 1 && !keepsHistory) {
    warnOnce(
      "stateless",
      "Multi-turn tests are being sent as independent requests. Use {{messages}} in your body template to replay conversation history.",
    );
  }
  for (let i = 0; i < test.turns.length; i++) {
    if (signal.aborted) break;
    const prompt = test.turns[i];
    const call = await callTarget(target, prompt, history, signal);
    if (call.status !== null && !call.resolved && target.responsePath.trim()) {
      warnOnce("path", `Response path "${target.responsePath}" didn't match the target's JSON — showing the raw body instead.`);
    }
    const turn = toTurn(i, prompt, call);
    turns.push(turn);
    raws.push(call.raw);
    emit({ type: "turn", testId: test.id, turn });
    if (call.error) break;
    history.push({ role: "user", content: prompt }, { role: "assistant", content: call.text });
  }
  return { turns, raws };
}

async function runBurstTest(test: PlaybookTest, target: TargetConfig, signal: AbortSignal) {
  const count = Math.min(Math.max(1, test.burst?.count ?? 10), MAX_BURST);
  const concurrency = Math.min(Math.max(1, test.burst?.concurrency ?? 5), MAX_CONCURRENCY);
  const prompt = test.turns[0];
  const calls: TargetCall[] = [];
  const started = performance.now();
  let next = 0;
  async function worker() {
    while (next < count && !signal.aborted) {
      next++;
      calls.push(await callTarget(target, prompt, [], signal));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const wallMs = Math.round(performance.now() - started);

  const ok = calls.filter((c) => c.status !== null && c.status >= 200 && c.status < 300).length;
  const limited = calls.filter((c) => c.status === 429).length;
  const serverErr = calls.filter((c) => c.status !== null && c.status >= 500).length;
  const netErr = calls.filter((c) => c.status === null).length;
  const latencies = calls.map((c) => c.latencyMs).sort((a, b) => a - b);
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? 0;
  const firstLimited = calls.findIndex((c) => c.status === 429);

  const stats = {
    requests: calls.length,
    concurrency,
    "HTTP 2xx": ok,
    "HTTP 429": limited,
    "HTTP 5xx": serverErr,
    "network errors": netErr,
    "p95 latency (ms)": p95,
    "wall time (ms)": wallMs,
  };

  let evaluation: Evaluation;
  if (serverErr + netErr > 0) {
    evaluation = {
      verdict: "fail",
      decidedBy: "rule",
      reason: `${serverErr} server errors and ${netErr} dropped connections under a burst of ${calls.length} requests (${concurrency} concurrent).`,
      weakness: test.remediation.summary,
    };
  } else if (limited > 0) {
    evaluation = {
      verdict: "pass",
      decidedBy: "rule",
      reason: `Rate limiting engaged: HTTP 429 returned starting at request #${firstLimited + 1}, with no server errors.`,
    };
  } else {
    evaluation = {
      verdict: "warn",
      decidedBy: "rule",
      reason: `All ${calls.length} requests succeeded with no throttling (p95 ${p95} ms). Each request costs model tokens — there is no visible per-client limit.`,
      weakness: test.remediation.summary,
    };
  }

  const sample = calls.find((c) => c.text) ?? calls[0];
  const turn: TurnRecord = {
    index: 0,
    prompt,
    displayPrompt: `[burst] ${calls.length} × "${prompt}" (${concurrency} concurrent)`,
    response:
      `Status breakdown → 2xx: ${ok} · 429: ${limited} · 5xx: ${serverErr} · network errors: ${netErr}\n` +
      `p95 latency: ${p95} ms · wall time: ${wallMs} ms\n\nSample response:\n${(sample?.text || sample?.error || "").slice(0, 600)}`,
    status: sample?.status ?? null,
    latencyMs: wallMs,
  };
  return { turns: [turn], evaluation, stats };
}

async function runOversizeTest(test: PlaybookTest, target: TargetConfig, signal: AbortSignal) {
  const cfg = test.oversize!;
  const filler = cfg.filler || "lorem ipsum ";
  const reps = Math.max(1, Math.min(cfg.repeat, Math.floor(MAX_OVERSIZE_CHARS / filler.length)));
  const prompt = `${test.turns[0]}\n\n${filler.repeat(reps)}`;
  const call = await callTarget(target, prompt, [], signal);
  const slowMs = cfg.slowMs ?? 15_000;
  const stats = { "input chars": prompt.length, "approx tokens": Math.round(prompt.length / 4), "latency (ms)": call.latencyMs };

  let evaluation: Evaluation;
  const graceful = /too (long|large)|exceed|maximum|limit|shorten|max(imum)? length/i.test(call.text);
  if (call.status === null || (call.status >= 500 && !graceful)) {
    evaluation = {
      verdict: "fail",
      decidedBy: "rule",
      reason: call.error
        ? `Oversized input (${prompt.length.toLocaleString()} chars) caused: ${call.error}`
        : `Oversized input caused an HTTP ${call.status} server error instead of a clean rejection.`,
      weakness: test.remediation.summary,
    };
  } else if (call.status === 429) {
    evaluation = {
      verdict: "warn",
      decidedBy: "rule",
      reason: "The request was rate-limited (HTTP 429) before the size limit could be observed. Re-run this test on its own.",
      weakness: test.remediation.summary,
    };
  } else if ([400, 413, 422].includes(call.status) || graceful) {
    evaluation = {
      verdict: "pass",
      decidedBy: "rule",
      reason: `Oversized input was rejected cleanly (HTTP ${call.status}) before reaching the model.`,
    };
  } else {
    evaluation = {
      verdict: "warn",
      decidedBy: "rule",
      reason: `Accepted ~${stats["approx tokens"].toLocaleString()} tokens of input with HTTP ${call.status} in ${call.latencyMs} ms${call.latencyMs > slowMs ? " (slow)" : ""}. No input size cap was enforced.`,
      weakness: test.remediation.summary,
    };
  }
  const turn = toTurn(0, prompt, call, `${test.turns[0]}\n\n[+ ${filler.trim()} × ${reps.toLocaleString()} → ${prompt.length.toLocaleString()} chars]`);
  return { turns: [turn], evaluation, stats };
}

export async function runAudit(opts: {
  playbooks: Playbook[];
  testIds: string[];
  target: TargetConfig;
  judge: ProviderConfig;
  emit: (e: AuditEvent) => void;
  signal: AbortSignal;
}) {
  const { playbooks, target, judge, emit, signal } = opts;
  const wanted = new Set(opts.testIds);
  const queue: { pb: Playbook; test: PlaybookTest }[] = [];
  for (const pb of playbooks) for (const test of pb.tests) if (wanted.has(test.id)) queue.push({ pb, test });

  const summary = { pass: 0, warn: 0, fail: 0, error: 0, durationMs: 0 };
  const started = Date.now();
  const warned = new Set<string>();
  const warnOnce = (key: string, message: string) => {
    if (warned.has(key)) return;
    warned.add(key);
    emit({ type: "log", level: "warn", message });
  };
  const useJudge = judge.mode === "judge" && !!judge.model?.trim();
  if (!useJudge) {
    emit({
      type: "log",
      level: "info",
      message: "No judge model selected — grading with deterministic rules + refusal heuristics. Connect a model for nuanced verdicts.",
    });
  }

  emit({ type: "start", total: queue.length, startedAt: new Date(started).toISOString() });

  for (let i = 0; i < queue.length; i++) {
    if (signal.aborted) break;
    const { pb, test } = queue[i];
    const kind = test.kind ?? "prompt";
    emit({ type: "test-start", testId: test.id, playbookId: pb.id, testName: test.name, index: i });
    const t0 = Date.now();

    let turns: TurnRecord[] = [];
    let evaluation: Evaluation | null = null;
    let stats: Record<string, number | string> | undefined;
    let decidedBy: TestResult["decidedBy"] = "heuristic";

    try {
      if (kind === "burst") {
        ({ turns, evaluation, stats } = await runBurstTest(test, target, signal));
        turns.forEach((turn) => emit({ type: "turn", testId: test.id, turn }));
      } else if (kind === "oversize") {
        ({ turns, evaluation, stats } = await runOversizeTest(test, target, signal));
        turns.forEach((turn) => emit({ type: "turn", testId: test.id, turn }));
      } else {
        const run = await runPromptTest(test, target, emit, signal, warnOnce);
        turns = run.turns;
        const hardError = turns.length === 0 || turns.every((t) => t.error);
        if (!hardError) {
          evaluation = deterministicChecks(test, target, turns, run.raws);
          if (!evaluation && useJudge) {
            try {
              evaluation = await judgeEvaluate(judge, pb, test, target, turns, signal);
            } catch (e) {
              warnOnce("judge", `Judge model call failed (${(e as Error).message}). Falling back to heuristics.`);
              evaluation = heuristicEvaluate(test, turns);
            }
          }
          if (!evaluation) evaluation = heuristicEvaluate(test, turns);
        }
      }
    } catch (e) {
      emit({ type: "log", level: "error", message: `${test.id}: ${(e as Error).message}` });
    }

    if (signal.aborted && !evaluation) break;

    const firstError = turns.find((t) => t.error)?.error;
    const verdict = evaluation?.verdict ?? "error";
    decidedBy = evaluation?.decidedBy ?? "error";
    const result: TestResult = {
      testId: test.id,
      playbookId: pb.id,
      playbookTitle: pb.title,
      owasp: pb.owasp,
      testName: test.name,
      severity: test.severity,
      kind,
      verdict,
      reason: evaluation?.reason ?? firstError ?? "The test could not be executed.",
      decidedBy,
      turns,
      totalLatencyMs: Date.now() - t0,
      stats,
      weakness: evaluation?.weakness,
    };
    if (verdict === "fail" || verdict === "warn") {
      result.fixPrompt = buildFixPrompt(pb, test, target, result);
    }
    summary[verdict]++;
    emit({ type: "result", result });
  }

  summary.durationMs = Date.now() - started;
  emit({ type: "done", summary, aborted: signal.aborted });
}

