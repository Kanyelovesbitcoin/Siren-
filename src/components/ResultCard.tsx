"use client";

import { useState } from "react";
import { ChevronDown, Clock, Crosshair, Sparkles, TriangleAlert } from "lucide-react";
import { Chip, CopyButton, SeverityChip, VerdictBadge, cx } from "./ui";
import type { TestResult, TurnRecord } from "@/lib/types";

const DECIDED_LABEL: Record<TestResult["decidedBy"], string> = {
  canary: "canary match",
  rule: "playbook rule",
  judge: "judge model",
  heuristic: "heuristic",
  deterministic: "measurement",
  error: "error",
};

export interface LiveTest {
  testId: string;
  testName: string;
  playbookTitle: string;
  owasp: string;
  turns: TurnRecord[];
  result?: TestResult;
}

function TurnRow({ turn, total }: { turn: TurnRecord; total: number }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-2">
      <div className="bg-obsidian p-3.5">
        <p className="mb-1.5 flex items-center gap-2 text-[10.5px] font-semibold tracking-wider text-muted uppercase">
          <span className="size-1.5 rounded-full bg-gold/80" />
          Siren{total > 1 ? ` · turn ${turn.index + 1}` : ""}
        </p>
        {turn.attackerThought && (
          <p className="mb-2 flex gap-1.5 rounded-md border border-gold/20 bg-gold/[0.06] px-2 py-1.5 text-[11.5px] leading-relaxed text-gold/90">
            <Crosshair className="mt-px size-3 shrink-0" />
            <span>
              <span className="font-semibold">Plan:</span> {turn.attackerThought}
            </span>
          </p>
        )}
        <p className="max-h-56 overflow-auto font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-dim scroll-quiet">
          {turn.displayPrompt}
        </p>
      </div>
      <div className="bg-charcoal-2/70 p-3.5">
        <p className="mb-1.5 flex items-center justify-between gap-2 text-[10.5px] font-semibold tracking-wider text-muted uppercase">
          <span className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-ink-dim" />
            Your app
          </span>
          <span className="flex items-center gap-2 font-mono font-normal tracking-normal normal-case">
            {turn.status !== null && (
              <span className={cx(turn.status >= 400 ? "text-fail" : "text-ink-dim")}>HTTP {turn.status}</span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {turn.latencyMs.toLocaleString()} ms
            </span>
          </span>
        </p>
        {turn.error ? (
          <p className="text-[12.5px] text-fail">{turn.error}</p>
        ) : (
          <p className="max-h-56 overflow-auto text-[13px] leading-relaxed whitespace-pre-wrap text-ink scroll-quiet">
            {turn.response || <span className="text-muted italic">(empty response)</span>}
          </p>
        )}
        {turn.assessment && (
          <p className="mt-2 border-t border-line pt-2 text-[11.5px] leading-relaxed text-muted">
            <span className="font-semibold text-ink-dim">Read:</span> {turn.assessment}
          </p>
        )}
      </div>
    </div>
  );
}

export default function ResultCard({ live, running }: { live: LiveTest; running: boolean }) {
  const r = live.result;
  const needsFix = r && (r.verdict === "fail" || r.verdict === "warn");
  const [open, setOpen] = useState(true);
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <article
      className={cx(
        "rounded-2xl border bg-charcoal transition",
        running && !r ? "border-gold/40 shadow-[0_0_0_4px_rgb(212_175_55/0.06)]" : "border-line",
        r?.verdict === "fail" && "border-fail/30",
      )}
    >
      <button className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left" onClick={() => setOpen((o) => !o)}>
        <VerdictBadge verdict={r ? r.verdict : "running"} />
        <span className="text-sm font-medium text-ink">{live.testName}</span>
        <Chip className="text-gold/80">{live.owasp}</Chip>
        {r && <SeverityChip severity={r.severity} />}
        <span className="ml-auto flex items-center gap-3 text-[11px] text-muted">
          {r && <span>via {DECIDED_LABEL[r.decidedBy]}</span>}
          {r && (
            <span className="flex items-center gap-1 font-mono">
              <Clock className="size-3" />
              {(r.totalLatencyMs / 1000).toFixed(2)}s
            </span>
          )}
          <ChevronDown className={cx("size-4 transition", !open && "-rotate-90")} />
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-line px-4 pt-3 pb-4">
          {live.turns.length === 0 && !r && <p className="text-xs text-muted">Sending first turn…</p>}
          {live.turns.map((t) => (
            <TurnRow key={t.index} turn={t} total={live.turns.length} />
          ))}

          {r && (
            <p className="text-[13px] leading-relaxed text-ink-dim">
              <span className="font-medium text-ink">Verdict: </span>
              {r.reason}
            </p>
          )}

          {r?.stats && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(r.stats).map(([k, v]) => (
                <Chip key={k}>
                  {k}: <span className="text-ink">{typeof v === "number" ? v.toLocaleString() : v}</span>
                </Chip>
              ))}
            </div>
          )}

          {needsFix && r.fixPrompt && (
            <div className={cx("rounded-xl border p-4", r.verdict === "fail" ? "border-fail/30 bg-fail/[0.06]" : "border-warn/30 bg-warn/[0.06]")}>
              <div className="flex flex-wrap items-start gap-3">
                <TriangleAlert className={cx("mt-0.5 size-4 shrink-0", r.verdict === "fail" ? "text-fail" : "text-warn")} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-ink">What this means</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">{r.weakness}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 pl-7">
                <CopyButton text={r.fixPrompt} label="Copy Fix Prompt" variant="gold" />
                <button className="flex items-center gap-1.5 text-xs text-muted hover:text-gold" onClick={() => setShowPrompt((s) => !s)}>
                  <Sparkles className="size-3.5" />
                  {showPrompt ? "Hide" : "Preview"} prompt
                </button>
                <span className="text-[11px] text-muted">Paste into Claude Code, Cursor or Copilot to harden this route.</span>
              </div>
              {showPrompt && (
                <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-line bg-obsidian p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-dim scroll-quiet">
                  {r.fixPrompt}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
