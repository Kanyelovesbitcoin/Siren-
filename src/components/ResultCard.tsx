"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown, Clock, Crosshair, RefreshCw, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { Chip, CopyButton, SeverityChip, VerdictBadge, cx } from "./ui";
import { tacticName } from "@/lib/tactics";
import type { TestResult, TurnOutcome, TurnRecord, Verdict } from "@/lib/types";

const DECIDED_LABEL: Record<TestResult["decidedBy"], string> = {
  canary: "canary match",
  rule: "playbook rule",
  judge: "judge model",
  heuristic: "heuristic",
  deterministic: "measurement",
  error: "error",
};

const OUTCOME: Record<TurnOutcome, { label: string; cls: string; dot: string }> = {
  held: { label: "Held", cls: "border-pass/35 text-pass", dot: "bg-pass" },
  partial: { label: "Wobbled", cls: "border-warn/40 text-warn", dot: "bg-warn" },
  broke: { label: "Broke", cls: "border-fail/45 text-fail", dot: "bg-fail" },
};

const RANK: Record<Verdict, number> = { pass: 3, warn: 2, fail: 1, error: 0 };

export interface LiveTest {
  testId: string;
  testName: string;
  playbookTitle: string;
  owasp: string;
  turns: TurnRecord[];
  result?: TestResult;
  /** Verdict from the run before a re-attack, for the before → after chip. */
  previousVerdict?: Verdict;
}

function OutcomeChip({ outcome }: { outcome: TurnOutcome }) {
  const o = OUTCOME[outcome];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase", o.cls)}>
      <span className={cx("size-1.5 rounded-full", o.dot)} />
      {o.label}
    </span>
  );
}

function TurnRow({ turn, total }: { turn: TurnRecord; total: number }) {
  return (
    <div>
      {turn.freshConversation && (
        <p className="mb-1.5 flex items-center gap-2 text-[10.5px] tracking-wide text-muted uppercase">
          <RotateCcw className="size-3" /> Fresh conversation — earlier turns cleared
        </p>
      )}
      <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-2">
        <div className="bg-obsidian p-3.5">
          <p className="mb-1.5 flex items-center gap-2 text-[10.5px] font-semibold tracking-wider text-muted uppercase">
            <span className="size-1.5 rounded-full bg-gold/80" />
            Siren{total > 1 ? ` · attempt ${turn.index + 1}` : ""}
            {turn.tactic && (
              <span className="rounded border border-gold/30 px-1 py-px font-medium tracking-normal text-gold/90 normal-case">
                {tacticName(turn.tactic)}
              </span>
            )}
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
            <p className="mt-2 flex flex-wrap items-start gap-1.5 border-t border-line pt-2 text-[11.5px] leading-relaxed text-muted">
              {turn.outcome && <OutcomeChip outcome={turn.outcome} />}
              <span>
                <span className="font-semibold text-ink-dim">Read:</span> {turn.assessment}
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** One square per attempt: a quick read of how the guardrail did against each tactic. */
function TacticStrip({ turns }: { turns: TurnRecord[] }) {
  const graded = turns.filter((t) => t.outcome);
  if (graded.length === 0) return null;
  return (
    <div className="rounded-xl border border-line bg-obsidian/60 p-3">
      <p className="mb-2 text-[10.5px] font-semibold tracking-wider text-muted uppercase">Guardrail scoreboard</p>
      <div className="flex flex-wrap gap-1.5">
        {graded.map((t) => {
          const o = OUTCOME[t.outcome!];
          return (
            <span
              key={t.index}
              title={`${tacticName(t.tactic)} — ${o.label}`}
              className={cx("inline-flex items-center gap-1.5 rounded-md border bg-charcoal-2 px-2 py-1 text-[11px]", o.cls)}
            >
              <span className={cx("size-2 rounded-sm", o.dot)} />
              <span className="text-ink-dim">
                {t.index + 1}. {tacticName(t.tactic)}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ChangeChip({ before, after }: { before: Verdict; after: Verdict }) {
  const better = RANK[after] > RANK[before];
  const worse = RANK[after] < RANK[before];
  const label = before === after ? (after === "pass" ? "Still passing" : "No change") : better ? (after === "pass" ? "Fixed" : "Improved") : "Regressed";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold tracking-wide uppercase",
        better ? "border-pass/40 bg-pass/10 text-pass" : worse ? "border-fail/40 bg-fail/10 text-fail" : "border-line-strong text-ink-dim",
      )}
    >
      {before}
      <ArrowRight className="size-3" />
      {after} · {label}
    </span>
  );
}

export default function ResultCard({
  live,
  running,
  onRerun,
}: {
  live: LiveTest;
  running: boolean;
  onRerun?: () => void;
}) {
  const r = live.result;
  const needsFix = r && (r.verdict === "fail" || r.verdict === "warn");
  const [open, setOpen] = useState(true);
  const [showPrompt, setShowPrompt] = useState(false);
  const isCampaign = live.turns.some((t) => t.tactic);

  return (
    <article
      className={cx(
        "rounded-2xl border bg-charcoal transition",
        running && !r ? "border-gold/40 shadow-[0_0_0_4px_rgb(212_175_55/0.06)]" : "border-line",
        r?.verdict === "fail" && "border-fail/30",
      )}
    >
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <button className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 text-left" onClick={() => setOpen((o) => !o)}>
          <VerdictBadge verdict={r ? r.verdict : "running"} />
          <span className="text-sm font-medium text-ink">{live.testName}</span>
          <Chip className="text-gold/80">{live.owasp}</Chip>
          {r && <SeverityChip severity={r.severity} />}
          {r && live.previousVerdict && <ChangeChip before={live.previousVerdict} after={r.verdict} />}
        </button>
        <span className="flex items-center gap-3 text-[11px] text-muted">
          {r && <span className="hidden sm:inline">via {DECIDED_LABEL[r.decidedBy]}</span>}
          {r && (
            <span className="flex items-center gap-1 font-mono">
              <Clock className="size-3" />
              {(r.totalLatencyMs / 1000).toFixed(2)}s
            </span>
          )}
          {r && onRerun && (
            <button
              onClick={onRerun}
              disabled={running}
              title="Run this again — e.g. after applying a fix"
              className="flex items-center gap-1 rounded-md border border-line-strong px-1.5 py-0.5 text-[11px] text-ink-dim transition hover:border-gold/50 hover:text-gold disabled:opacity-40"
            >
              <RefreshCw className="size-3" />
              Re-attack
            </button>
          )}
          <button aria-label={open ? "Collapse" : "Expand"} onClick={() => setOpen((o) => !o)}>
            <ChevronDown className={cx("size-4 transition", !open && "-rotate-90")} />
          </button>
        </span>
      </div>

      {open && (
        <div className="space-y-3 border-t border-line px-4 pt-3 pb-4">
          {isCampaign && <TacticStrip turns={live.turns} />}
          {live.turns.length === 0 && !r && <p className="text-xs text-muted">{isCampaign ? "Planning first attack…" : "Sending first turn…"}</p>}
          {live.turns.map((t) => (
            <TurnRow key={t.index} turn={t} total={live.turns.length} />
          ))}
          {running && !r && live.turns.length > 0 && isCampaign && (
            <p className="flex items-center gap-2 text-xs text-gold/80">
              <span className="siren-pulse size-1.5 rounded-full bg-gold" /> Planning the next tactic…
            </p>
          )}

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
              <ol className="mt-3 flex flex-wrap items-center gap-2 pl-7 text-[11px] text-muted">
                <li className="flex items-center gap-2">
                  <span className="font-mono text-gold/80">1</span>
                  <CopyButton text={r.fixPrompt} label="Copy Fix Prompt" variant="gold" />
                </li>
                <li className="flex items-center gap-2">
                  <span className="font-mono text-gold/80">2</span> Paste into Claude Code, Cursor or Copilot and apply the fix
                </li>
                {onRerun && (
                  <li className="flex items-center gap-2">
                    <span className="font-mono text-gold/80">3</span>
                    <button
                      onClick={onRerun}
                      disabled={running}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gold/40 px-2.5 py-1.5 text-xs text-gold transition hover:bg-gold/10 disabled:opacity-40"
                    >
                      <RefreshCw className="size-3.5" /> Re-attack to verify
                    </button>
                  </li>
                )}
              </ol>
              <button className="mt-2 ml-7 flex items-center gap-1.5 text-xs text-muted hover:text-gold" onClick={() => setShowPrompt((s) => !s)}>
                <Sparkles className="size-3.5" />
                {showPrompt ? "Hide" : "Preview"} fix prompt
              </button>
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
