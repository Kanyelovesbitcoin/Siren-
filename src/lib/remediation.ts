// Builds the "Copy Fix Prompt": a structured, context-aware prompt the developer
// pastes into their IDE assistant (Claude Code, Cursor, Copilot...) to harden their app.
// Deterministic on purpose — no model call needed, so it works offline and instantly.

import type { Playbook, PlaybookTest, TargetConfig, TestResult } from "./types";

function clip(s: string, n: number) {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n)}… [truncated ${t.length - n} chars]` : t;
}

function routePath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return url;
  }
}

export function buildFixPrompt(
  playbook: Playbook,
  test: PlaybookTest,
  target: TargetConfig,
  result: Pick<TestResult, "verdict" | "reason" | "turns" | "weakness" | "stats">,
): string {
  const route = routePath(target.url);
  const transcript = result.turns
    .slice(0, 4)
    .map(
      (t, i) =>
        `Turn ${i + 1} — user:\n${clip(t.displayPrompt, 800)}\n\nTurn ${i + 1} — my app (HTTP ${t.status ?? "n/a"}, ${t.latencyMs} ms):\n${clip(t.response || t.error || "(empty)", 1200)}`,
    )
    .join("\n\n");

  const stats = result.stats
    ? `\nMeasurements:\n${Object.entries(result.stats)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n")}\n`
    : "";

  return `You are a senior application-security engineer helping me harden my AI feature.

## Context
- Endpoint under test: \`${target.method} ${route}\` (running locally)
- Risk category: ${playbook.owasp} — ${playbook.owaspName} (${playbook.title})
- Failing test: "${test.name}" — severity ${test.severity.toUpperCase()}, verdict ${result.verdict.toUpperCase()}
${target.appContext?.trim() ? `- What the app is supposed to do: ${target.appContext.trim()}\n` : ""}
## What went wrong
${result.weakness || test.remediation.summary}

Evaluator notes: ${result.reason}
${stats}
## Reproduction (from my local Siren audit)
${transcript}

## What a hardened app does here
${test.expected}

## Recommended fixes
${test.remediation.guidance.map((g, i) => `${i + 1}. ${g}`).join("\n")}

## Your task
1. Find the code that handles \`${route}\` and the system prompt / instructions it sends to the model.
2. Explain in 2–3 sentences why the reproduction above succeeds against the current code.
3. Propose the smallest set of changes that fixes it — system-prompt wording, input/output handling in the route, and server-side checks. Prefer enforcement in code over relying on the model to behave.
4. Show the changes as a diff, keeping my existing style and framework.
5. Give me one regression test I can add, using the reproduction prompt above as the input.
Do not weaken existing functionality or remove features unrelated to this issue.`;
}
