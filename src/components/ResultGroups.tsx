"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import ResultCard, { type LiveTest } from "./ResultCard";
import { cx } from "./ui";
import type { Severity, Verdict } from "@/lib/types";

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** What needs fixing comes first; what already works is tucked away at the bottom. */
const GROUPS: { verdict: Verdict; title: string; help: string; dot: string; text: string; startOpen: boolean }[] = [
  { verdict: "fail", title: "Action needed", help: "Your app did something it shouldn't. Fix these first.", dot: "bg-fail", text: "text-fail", startOpen: true },
  { verdict: "warn", title: "Needs review", help: "Not clearly safe or unsafe. Read the reply and decide.", dot: "bg-warn", text: "text-warn", startOpen: true },
  { verdict: "error", title: "Errors", help: "These tests couldn't run, so they aren't counted in your score.", dot: "bg-err", text: "text-err", startOpen: true },
  { verdict: "pass", title: "Passed", help: "Your app held up against these.", dot: "bg-pass", text: "text-pass", startOpen: false },
];

function bySeverity(a: LiveTest, b: LiveTest) {
  return SEVERITY_RANK[a.result!.severity] - SEVERITY_RANK[b.result!.severity];
}

/** The first failure (or, with none, the first warning): the card worth opening for the user. */
function firstProblem(items: LiveTest[]): string | undefined {
  for (const verdict of ["fail", "warn"] as const) {
    const hit = items.filter((i) => i.result?.verdict === verdict).sort(bySeverity)[0];
    if (hit) return hit.testId;
  }
  return undefined;
}

/**
 * The results list, grouped by what the user has to do about each result. Passed starts
 * collapsed, cards start collapsed with a one-line summary, and the first problem is opened
 * once the run finishes. Used by the live dashboard and the read-only sample report.
 */
export default function ResultGroups({
  items,
  running,
  onRerun,
}: {
  items: LiveTest[];
  running: boolean;
  /** Leave out for a read-only list (the sample report). */
  onRerun?: (testId: string) => void;
}) {
  const [openCards, setOpenCards] = useState<Set<string>>(() => new Set([firstProblem(items)].filter((id): id is string => !!id)));
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => Object.fromEntries(GROUPS.map((g) => [g.verdict, g.startOpen])));
  const wasRunning = useRef(running);

  // When a run finishes and nothing is open, open the first problem so the fix flow is in view.
  useEffect(() => {
    if (wasRunning.current && !running) {
      setOpenCards((prev) => {
        if ([...prev].some((id) => items.some((i) => i.testId === id && i.result))) return prev;
        const id = firstProblem(items);
        return id ? new Set([id]) : prev;
      });
    }
    wasRunning.current = running;
  }, [running, items]);

  const toggleCard = (id: string) =>
    setOpenCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const inProgress = items.filter((i) => !i.result);

  return (
    <div className="space-y-6">
      {inProgress.length > 0 && (
        <section aria-label="Testing now">
          <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-gold">
            <span aria-hidden className="siren-pulse size-2 rounded-full bg-gold" />
            Testing now
          </h3>
          <div className="space-y-3">
            {inProgress.map((l) => (
              // Always open while it runs, so the reply can be watched as it arrives.
              <ResultCard key={l.testId} live={l} running={running} open onToggle={() => {}} />
            ))}
          </div>
        </section>
      )}

      {GROUPS.map((g) => {
        const group = items.filter((i) => i.result?.verdict === g.verdict).sort(bySeverity);
        if (group.length === 0) return null;
        const open = openGroups[g.verdict];
        return (
          <section key={g.verdict} data-group={g.verdict} aria-labelledby={`group-${g.verdict}`}>
            {/* A heading that contains the toggle, so screen reader users can jump between groups. */}
            <h3 id={`group-${g.verdict}`}>
              <button
                className="flex min-h-11 w-full items-center gap-3 text-left"
                aria-expanded={open}
                aria-describedby={`group-${g.verdict}-help`}
                onClick={() => setOpenGroups((prev) => ({ ...prev, [g.verdict]: !prev[g.verdict] }))}
              >
                <span aria-hidden className={cx("size-2 shrink-0 rounded-full", g.dot)} />
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className={cx("text-[15px] font-semibold", g.text)}>{g.title}</span>
                  <span data-count className="font-mono text-[13px] font-normal text-ink-dim tabular-nums">
                    {group.length}
                    <span className="sr-only">{group.length === 1 ? " result" : " results"}</span>
                  </span>
                </span>
                <span aria-hidden className="flex shrink-0 items-center gap-1 text-xs font-normal text-muted">
                  {open ? "Hide" : "Show"}
                  <ChevronDown className={cx("size-4 transition", !open && "-rotate-90")} />
                </span>
              </button>
            </h3>
            <p id={`group-${g.verdict}-help`} className="-mt-1.5 ml-5 text-xs leading-relaxed text-muted">
              {g.help}
            </p>
            {open && (
              <div className="mt-3 space-y-3">
                {group.map((l) => (
                  <ResultCard
                    key={l.testId}
                    live={l}
                    running={running}
                    onRerun={onRerun ? () => onRerun(l.testId) : undefined}
                    open={openCards.has(l.testId)}
                    onToggle={() => toggleCard(l.testId)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
