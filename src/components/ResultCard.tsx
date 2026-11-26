"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Crosshair, RefreshCw, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { Chip, CopyButton, SeverityChip, VerdictBadge, cx } from "./ui";
import { tacticName } from "@/lib/tactics";
import type { TestResult, TurnOutcome, TurnRecord, Verdict } from "@/lib/types";

const DECIDED_LABEL: Record<TestResult["decidedBy"], string> = {
  canary: "canary phrase match",
  rule: "playbook rule",
  judge: "AI grader",
  heuristic: "built-in rules",
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

/**
 * Load tests put a status-code and latency summary ahead of a sample reply. Those numbers are
 * all in the Technical details drawer ("Measurements"), so the main view shows just the reply.
 */
function splitLoadSummary(response: string): { isSample: boolean; reply: string } {
  // Older saved results put a "Status breakdown" summary ahead of the sample reply.
  const marker = "\n\nSample response:\n";
  const i = response.indexOf(marker);
  if (i < 0 || !response.startsWith("Status breakdown")) return { isSample: false, reply: response };
  return { isSample: true, reply: response.slice(i + marker.length) };
}

/**
 * One reply from the app. The message Siren sent is deliberately not shown here; it is in the
 * Technical details drawer ("What Siren sent"), so the card leads with what matters.
 */
function TurnRow({ turn, total, isSample }: { turn: TurnRecord; total: number; isSample: boolean }) {
  const { reply } = splitLoadSummary(turn.response);
  return (
    <div className="rounded-xl border border-line bg-charcoal-2/70 p-3.5">
      {turn.freshConversation && (
        <p className="mb-1.5 flex items-center gap-2 text-[10.5px] tracking-wide text-muted uppercase">
          <RotateCcw className="size-3" /> Fresh conversation — earlier turns cleared
        </p>
      )}
      <p className="mb-1.5 flex flex-wrap items-center gap-2 text-[10.5px] font-semibold tracking-wider text-muted uppercase">
        <span className="size-1.5 rounded-full bg-ink-dim" />
        {isSample ? "One of your app\u2019s replies" : `Your app replied${total > 1 ? ` · ${turn.index + 1} of ${total}` : ""}`}
        {turn.tactic && (
          <span className="rounded border border-gold/30 px-1 py-px font-medium tracking-normal text-gold/90 normal-case">
            Tactic: {tacticName(turn.tactic)}
          </span>
        )}
      </p>
      {turn.attackerThought && (
        <p className="mb-2 flex gap-1.5 rounded-md border border-gold/20 bg-gold/[0.06] px-2 py-1.5 text-[11.5px] leading-relaxed text-gold/90">
          <Crosshair className="mt-px size-3 shrink-0" />
          <span>
            <span className="font-semibold">Siren&apos;s plan:</span> {turn.attackerThought}
          </span>
        </p>
      )}
      {turn.error ? (
        <p className="text-[12.5px] leading-relaxed text-fail">{turn.error}</p>
      ) : (
        <p className="max-h-56 overflow-auto text-[13px] leading-relaxed whitespace-pre-wrap text-ink scroll-quiet">
          {reply || <span className="text-muted italic">(empty response)</span>}
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

/**
 * Everything a developer wants and a beginner doesn't: the raw messages Siren sent, test ID,
 * OWASP code, which layer decided the verdict, HTTP status codes, response times and load-test
 * measurements. Collapsed by default.
 */
function TechnicalDetails({ live }: { live: LiveTest }) {
  const r = live.result;
  const rows: [string, React.ReactNode][] = [
    ["Test ID", <span key="id" className="font-mono">{live.testId}</span>],
    [
      "Category",
      <span key="cat">
        <span className="font-mono text-gold/80">OWASP {live.owasp}</span>
        {live.playbookTitle ? ` · ${live.playbookTitle}` : ""}
      </span>,
    ],
  ];
  if (r) {
    rows.push(["Decided by", DECIDED_LABEL[r.decidedBy]]);
    rows.push(["Total time", <span key="t" className="font-mono">{(r.totalLatencyMs / 1000).toFixed(2)}s</span>]);
  }
  return (
    <details className="group rounded-xl border border-line bg-obsidian/40">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted select-none hover:text-ink">
        <span className="mr-1 inline-block transition group-open:rotate-90">›</span> Technical details
      </summary>
      <div className="space-y-3 px-3 pb-3 text-[12px] text-ink-dim">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>

        {live.turns.length > 0 && (
          <table className="w-full max-w-md border-collapse text-left font-mono text-[11.5px]">
            <thead>
              <tr className="text-[10.5px] tracking-wider text-muted uppercase">
                <th className="py-1 pr-4 font-sans font-semibold">Attempt</th>
                <th className="py-1 pr-4 font-sans font-semibold">HTTP status</th>
                <th className="py-1 font-sans font-semibold">Response time</th>
              </tr>
            </thead>
            <tbody>
              {live.turns.map((t) => (
                <tr key={t.index} className="border-t border-line">
                  <td className="py-1 pr-4">{t.index + 1}</td>
                  <td className={cx("py-1 pr-4", t.status !== null && t.status >= 400 && "text-fail")}>{t.status ?? "no response"}</td>
                  <td className="py-1">{t.latencyMs.toLocaleString()} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {live.turns.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10.5px] font-semibold tracking-wider text-muted uppercase">What Siren sent</p>
            <div className="space-y-2">
              {live.turns.map((t) => (
                <div key={t.index} className="rounded-lg border border-line bg-obsidian p-2.5">
                  {live.turns.length > 1 && <p className="mb-1 text-[10.5px] text-muted">Attempt {t.index + 1}</p>}
                  <p className="max-h-48 overflow-auto font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-dim scroll-quiet">
                    {t.displayPrompt}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {r?.stats && (
          <div>
            <p className="mb-1.5 text-[10.5px] font-semibold tracking-wider text-muted uppercase">Measurements</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(r.stats).map(([k, v]) => (
                <Chip key={k}>
                  {k}: <span className="text-ink">{typeof v === "number" ? v.toLocaleString() : v}</span>
                </Chip>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

/** The numbered circle used in the fix steps. */
function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-gold/40 font-mono text-[11px] text-gold">
      {n}
    </span>
  );
}

export default function ResultCard({
  live,
  running,
  onRerun,
  open,
  onToggle,
}: {
  live: LiveTest;
  running: boolean;
  /** Leave out for a read-only card (the sample report): the re-attack buttons disappear. */
  onRerun?: () => void;
  /** Whether the card is expanded. The list that renders the cards owns this. */
  open: boolean;
  onToggle: () => void;
}) {
  const r = live.result;
  const needsFix = r && (r.verdict === "fail" || r.verdict === "warn");
  const [showPrompt, setShowPrompt] = useState(false);
  const isCampaign = live.turns.some((t) => t.tactic);
  // Shown under the title while the card is collapsed: the plain-English point of this result.
  const preview = r ? (r.verdict === "fail" || r.verdict === "warn" ? r.weakness || r.reason : r.verdict === "error" ? r.reason : "") : "";

  return (
    <article
      className={cx(
        "rounded-2xl border bg-charcoal transition",
        running && !r ? "border-gold/40 shadow-[0_0_0_4px_rgb(212_175_55/0.06)]" : "border-line",
        r?.verdict === "fail" && "border-fail/30",
      )}
    >
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <button className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 text-left" onClick={onToggle} aria-expanded={open}>
          <VerdictBadge verdict={r ? r.verdict : "running"} />
          <span className="text-sm font-medium text-ink">{live.testName}</span>
          {r && <SeverityChip severity={r.severity} />}
          {r && live.previousVerdict && <ChangeChip before={live.previousVerdict} after={r.verdict} />}
        </button>
        <span className="flex items-center gap-3 text-[11px] text-muted">
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
          <button aria-label={open ? "Collapse" : "Expand"} onClick={onToggle}>
            <ChevronDown className={cx("size-4 transition", !open && "-rotate-90")} />
          </button>
        </span>
      </div>
      {!open && preview && (
        <button className="-mt-1 block w-full px-4 pb-3 text-left" onClick={onToggle} tabIndex={-1}>
          <span className="line-clamp-2 text-[12.5px] leading-relaxed text-ink-dim">{preview}</span>
        </button>
      )}

      {open && (
        <div className="space-y-3 border-t border-line px-4 pt-3 pb-4">
          {isCampaign && <TacticStrip turns={live.turns} />}
          {live.turns.length === 0 && !r && <p className="text-xs text-muted">{isCampaign ? "Planning first attack…" : "Sending first turn…"}</p>}
          {live.turns.map((t) => (
            <TurnRow key={t.index} turn={t} total={live.turns.length} isSample={r?.kind === "burst"} />
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

          {needsFix && r.fixPrompt && (
            <div className={cx("rounded-xl border p-4", r.verdict === "fail" ? "border-fail/30 bg-fail/[0.06]" : "border-warn/30 bg-warn/[0.06]")}>
              <div className="flex flex-wrap items-start gap-3">
                <TriangleAlert className={cx("mt-0.5 size-4 shrink-0", r.verdict === "fail" ? "text-fail" : "text-warn")} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-ink">What this means</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">{r.weakness}</p>
                </div>
              </div>
              {/* The fix, as one bar: copy → paste → re-test. Stacks on narrow screens. */}
              <ol className="mt-4 flex flex-col overflow-hidden rounded-xl border border-line bg-obsidian/60 text-[12.5px] text-ink-dim sm:flex-row sm:items-stretch">
                <li className="flex items-center gap-2.5 px-3 py-2.5">
                  <StepNumber n={1} />
                  <CopyButton text={r.fixPrompt} label="Copy Fix Prompt" variant="gold" className="px-3 py-1.5 text-[13px] whitespace-nowrap" />
                </li>
                <li className="flex flex-1 items-center gap-2.5 border-t border-line px-3 py-2.5 sm:border-t-0 sm:border-l">
                  <ChevronRight className="-ml-1 hidden size-4 shrink-0 text-muted sm:block" />
                  <StepNumber n={2} />
                  <span>Paste it into Claude Code or Cursor</span>
                </li>
                {onRerun && (
                  <li className="flex items-center gap-2.5 border-t border-line px-3 py-2.5 sm:border-t-0 sm:border-l">
                    <ChevronRight className="-ml-1 hidden size-4 shrink-0 text-muted sm:block" />
                    <StepNumber n={3} />
                    <button
                      onClick={onRerun}
                      disabled={running}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gold/40 px-2.5 py-1.5 text-xs whitespace-nowrap text-gold transition hover:bg-gold/10 disabled:opacity-40"
                    >
                      <RefreshCw className="size-3.5" /> Re-attack to verify
                    </button>
                  </li>
                )}
              </ol>
              <button className="mt-2.5 flex items-center gap-1.5 text-xs text-muted hover:text-gold" onClick={() => setShowPrompt((s) => !s)}>
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

          {(r || live.turns.length > 0) && <TechnicalDetails live={live} />}
        </div>
      )}
    </article>
  );
}
