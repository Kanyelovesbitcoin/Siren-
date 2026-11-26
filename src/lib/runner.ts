// The audit runner: executes playbook tests sequentially against the localhost target
// and emits AuditEvents as it goes (streamed to the dashboard as NDJSON).

import { checkTargetUrl } from "./safety";
import { bodyError, extractReply, renderBody, templateUsesHistory, type ChatMessage } from "./template";
import { deterministicChecks, heuristicEvaluate, judgeEvaluate, type Evaluation } from "./judge";
import { buildFixPrompt } from "./remediation";
import { runAttackCampaign, syntheticTest } from "./attacker";
import type {
  AttackConfig,
  AuditEvent,
  Playbook,
  PlaybookTest,
  ProviderConfig,
  TargetConfig,
  TestResult,
  TurnRecord,
} from "./types";

const MAX_ATTACK_TURNS = 12;

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
  /** Set when the configured response path wasn't found and a common key was used instead. */
  detectedPath?: string;
  latencyMs: number;
  error?: string;
}

const is2xx = (status: number | null) => status !== null && status >= 200 && status < 300;

/**
 * Did the app fail to answer at all? Returns a plain-English reason when the call errored,
 * came back with a non-2xx status, or returned a JSON error body such as
 * {"error": "Failed to get AI response"}. A failed call is never graded Pass or Warn.
 */
export function targetFailure(call: TargetCall): string | null {
  if (call.error) return call.error;
  if (call.status === null) return "Your app didn't respond.";
  const apiError = bodyError(call.raw);
  if (call.status === 429) {
    return "Your app rate-limited this request (HTTP 429), so the test couldn't run. Re-run it on its own.";
  }
  if (!is2xx(call.status)) {
    return `Your app returned an error (HTTP ${call.status})${apiError ? `: ${apiError}` : "."}`;
  }
  if (apiError) return `Your app replied with an error instead of an answer: ${apiError}`;
  return null;
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
    const { text, resolved, detectedPath } = extractReply(raw, target.responsePath);
    return { status: res.status, raw, text, resolved, detectedPath, latencyMs };
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
    // An API error (non-2xx, or a JSON {"error": ...} body) is not a reply. Record it and stop.
    const failure = targetFailure(call);
    if (failure && !call.error) call.error = failure;
    if (!failure) {
      if (call.detectedPath) {
        warnOnce(
          "autopath",
          target.responsePath.trim()
            ? `Response path "${target.responsePath}" wasn't in your app's reply, so Siren is reading the reply from "${call.detectedPath}" instead. Update the response path in your setup to make this permanent.`
            : `Siren is reading your app's reply from "${call.detectedPath}".`,
        );
      } else if (!call.resolved && target.responsePath.trim()) {
        warnOnce("path", `Response path "${target.responsePath}" didn't match the target's JSON — showing the raw body instead.`);
      }
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

  // A 2xx carrying {"error": ...} is a failed request, not a success.
  const errorReplies = calls.filter((c) => is2xx(c.status) && bodyError(c.raw) !== null).length;
  const ok = calls.filter((c) => is2xx(c.status)).length - errorReplies;
  const limited = calls.filter((c) => c.status === 429).length;
  const serverErr = calls.filter((c) => c.status !== null && c.status >= 500).length;
  const netErr = calls.filter((c) => c.status === null).length;
  // 401, 403, 404…: turned away for a reason that has nothing to do with load.
  const rejected = calls.filter((c) => c.status !== null && c.status >= 400 && c.status < 500 && c.status !== 429).length;
  const latencies = calls.map((c) => c.latencyMs).sort((a, b) => a - b);
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? 0;

  const stats = {
    requests: calls.length,
    concurrency,
    "HTTP 2xx": ok,
    "HTTP 429": limited,
    "HTTP 5xx": serverErr,
    "network errors": netErr,
    "p95 latency (ms)": p95,
    "wall time (ms)": wallMs,
    ...(rejected ? { "other 4xx": rejected } : {}),
    ...(errorReplies ? { "error replies": errorReplies } : {}),
  };

  let evaluation: Evaluation | null;
  let unmeasurable: string | undefined;
  if (ok === 0 && limited === 0) {
    // Not one request got a real answer and none was throttled: the app is failing for another
    // reason, so this says nothing about rate limiting. Error, not a grade.
    const sampleFailure = calls.map(targetFailure).find(Boolean);
    unmeasurable = `None of the ${calls.length} requests got an answer, so rate limiting couldn't be measured. ${sampleFailure ?? ""}`.trim();
    evaluation = null;
  } else if (serverErr + netErr > 0) {
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
      reason: `Rate limiting engaged: ${limited} of ${calls.length} requests were throttled with HTTP 429, and there were no server errors.`,
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
    error: unmeasurable,
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

  let evaluation: Evaluation | null;
  let unmeasurable: string | undefined;
  const graceful = /too (long|large)|exceed|maximum|limit|shorten|max(imum)? length/i.test(call.text);
  const apiError = bodyError(call.raw);
  if (call.status === 429) {
    // Throttled before the size limit could be observed: nothing to grade.
    unmeasurable = "Your app rate-limited this request (HTTP 429) before the size limit could be observed. Re-run this test on its own.";
    evaluation = null;
  } else if (call.status === null && /connection refused/i.test(call.error ?? "")) {
    unmeasurable = call.error;
    evaluation = null;
  } else if (call.status !== null && !graceful && [401, 403, 404, 405].includes(call.status)) {
    // Turned away for a reason unrelated to size (not signed in, wrong address).
    unmeasurable = targetFailure(call) ?? undefined;
    evaluation = null;
  } else if (is2xx(call.status) && apiError && !graceful) {
    unmeasurable = `Your app replied with an error instead of an answer: ${apiError}`;
    evaluation = null;
  } else if (call.status === null || (call.status >= 500 && !graceful)) {
    evaluation = {
      verdict: "fail",
      decidedBy: "rule",
      reason: call.error
        ? `Oversized input (${prompt.length.toLocaleString()} chars) caused: ${call.error}`
        : `Oversized input caused an HTTP ${call.status} server error instead of a clean rejection.`,
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
  if (unmeasurable) turn.error = unmeasurable;
  return { turns: [turn], evaluation, stats };
}

export async function runAudit(opts: {
  playbooks: Playbook[];
  testIds: string[];
  target: TargetConfig;
  judge: ProviderConfig;
  attack?: AttackConfig;
  emit: (e: AuditEvent) => void;
  signal: AbortSignal;
}) {
  const { playbooks, target, judge, emit, signal } = opts;
  const summary = { pass: 0, warn: 0, fail: 0, error: 0, durationMs: 0 };
  const started = Date.now();
  const warned = new Set<string>();
  const warnOnce = (key: string, message: string) => {
    if (warned.has(key)) return;
    warned.add(key);
    emit({ type: "log", level: "warn", message });
  };

  // ── Attacker mode: a model drives one adaptive campaign per selected category ──
  if (opts.attack?.enabled) {
    await runAttackerMode({ ...opts, summary, warnOnce });
    summary.durationMs = Date.now() - started;
    emit({ type: "done", summary, aborted: signal.aborted });
    return;
  }

  const wanted = new Set(opts.testIds);
  const queue: { pb: Playbook; test: PlaybookTest }[] = [];
  for (const pb of playbooks) for (const test of pb.tests) if (wanted.has(test.id)) queue.push({ pb, test });
  // Stress tests go last (oversized input, then the request burst at the very end), so tripping
  // the app's rate limit can't make later tests come back as HTTP 429. The sort is stable, so
  // everything else keeps its playbook order.
  const stressRank = (t: PlaybookTest) => (t.kind === "burst" ? 2 : t.kind === "oversize" ? 1 : 0);
  queue.sort((a, b) => stressRank(a.test) - stressRank(b.test));

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
        // If any request failed, the test didn't complete and must not be graded Pass or Warn.
        // The one exception: a leak caught in the turns that did succeed is still a real Fail.
        const errored = turns.length === 0 || turns.some((t) => t.error);
        if (errored) {
          const completed = turns.map((t, idx) => ({ t, raw: run.raws[idx] ?? "" })).filter((x) => !x.t.error);
          const caught = completed.length
            ? deterministicChecks(test, target, completed.map((x) => x.t), completed.map((x) => x.raw))
            : null;
          evaluation = caught?.verdict === "fail" ? caught : null;
        } else {
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

async function runAttackerMode(opts: {
  playbooks: Playbook[];
  testIds: string[];
  target: TargetConfig;
  judge: ProviderConfig;
  attack?: AttackConfig;
  emit: (e: AuditEvent) => void;
  signal: AbortSignal;
  summary: { pass: number; warn: number; fail: number; error: number; durationMs: number };
  warnOnce: (key: string, message: string) => void;
}) {
  const { playbooks, target, judge, emit, signal, summary, warnOnce } = opts;
  const maxTurns = Math.min(Math.max(2, opts.attack?.maxTurns ?? 8), MAX_ATTACK_TURNS);

  if (judge.mode !== "judge" || !judge.model?.trim()) {
    emit({ type: "log", level: "error", message: "Attacker mode needs a connected model — it generates the attacks. Pick a model or turn attacker mode off." });
    emit({ type: "start", total: 0, startedAt: new Date().toISOString() });
    return;
  }

  // One campaign per selected category that has an attacker objective.
  const wanted = new Set(opts.testIds);
  const campaigns: Playbook[] = [];
  for (const pb of playbooks) {
    if (!pb.tests.some((t) => wanted.has(t.id))) continue;
    if (!pb.objective?.trim()) {
      warnOnce(`noobj:${pb.id}`, `Skipping "${pb.title}" in attacker mode — it's a load/measurement test, not a conversation. Run it in standard mode.`);
      continue;
    }
    campaigns.push(pb);
  }

  emit({ type: "start", total: campaigns.length, startedAt: new Date().toISOString() });
  if (campaigns.length === 0) {
    emit({ type: "log", level: "warn", message: "No conversational categories selected for attacker mode." });
    return;
  }
  const host = checkTargetUrl(target.url).url?.host ?? "your localhost target";
  emit({
    type: "log",
    level: "info",
    message: `Attacker mode: ${judge.model} gets up to ${maxTurns} attempts per category, rotating through different tactics, and fires only at ${host}.`,
  });

  const stateless = !templateUsesHistory(target.bodyTemplate);
  if (stateless) {
    warnOnce("stateless-attack", "Your body template doesn't use {{messages}}, so the app sees each attack with no memory of earlier turns. Use {{messages}} for a true multi-turn attack.");
  }

  for (let i = 0; i < campaigns.length; i++) {
    if (signal.aborted) break;
    const pb = campaigns[i];
    const testId = `attack:${pb.id}`;
    emit({ type: "test-start", testId, playbookId: pb.id, testName: `${pb.shortTitle} — adaptive attack`, index: i });
    const t0 = Date.now();

    const campaign = await runAttackCampaign({
      model: judge,
      playbook: pb,
      target,
      maxTurns,
      signal,
      fire: async (prompt, history) => {
        const call = await callTarget(target, prompt, history, signal);
        // Same rule as standard mode: an API error is a failed request, not a reply to grade.
        return { text: call.text, status: call.status, latencyMs: call.latencyMs, error: targetFailure(call) ?? undefined };
      },
      onTurn: (turn) => emit({ type: "turn", testId, turn }),
    });

    if (signal.aborted && campaign.turns.length === 0) break;

    const synthetic = syntheticTest(pb, campaign.turns);
    const result: TestResult = {
      testId,
      playbookId: pb.id,
      playbookTitle: pb.title,
      owasp: pb.owasp,
      testName: `${pb.shortTitle} — adaptive attack`,
      severity: synthetic.severity,
      kind: "prompt",
      verdict: campaign.verdict,
      reason: campaign.reason,
      decidedBy: campaign.decidedBy,
      turns: campaign.turns,
      totalLatencyMs: Date.now() - t0,
      stats: {
        ...campaign.stats,
        ...(campaign.brokeThroughOn ? { "broke on attempt": campaign.brokeThroughOn } : {}),
      },
      weakness: campaign.weakness,
    };
    if (result.verdict === "fail" || result.verdict === "warn") {
      result.fixPrompt = buildFixPrompt(pb, synthetic, target, result);
    }
    summary[result.verdict]++;
    emit({ type: "result", result });
  }
}

