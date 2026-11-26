"use client";

import { ArrowRight, Monitor } from "lucide-react";
import ResultCard, { type LiveTest } from "./ResultCard";
import ScoreTiles from "./ScoreTiles";
import { CopyButton } from "./ui";
import sample from "@/data/sample-report.json";
import { summarize } from "@/lib/summary";
import type { TestResult } from "@/lib/types";

const RESULTS = sample.results as TestResult[];
const CARDS: LiveTest[] = RESULTS.map((r) => ({
  testId: r.testId,
  testName: r.testName,
  playbookTitle: r.playbookTitle,
  owasp: r.owasp,
  turns: r.turns,
  result: r,
}));
const SUMMARY = summarize(RESULTS);
/** Open the first problem so the "what this means" and Copy Fix Prompt flow is visible straight away. */
const FIRST_PROBLEM = CARDS.find((c) => c.result?.verdict === "fail")?.testId ?? CARDS[0]?.testId;

/**
 * A read-only sample audit report. It is built from a saved, real audit of the demo bot and
 * makes no network requests, so it works on a phone, where Siren can't reach an app to test.
 */
export default function SampleReport({
  onPhone,
  onLeave,
}: {
  /** True when shown because the screen is phone-sized. */
  onPhone: boolean;
  /** Leave the sample and go to the full app. */
  onLeave: () => void;
}) {
  const pageUrl = typeof window === "undefined" ? "" : window.location.origin + window.location.pathname;

  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-5 sm:px-6 sm:py-8">
      <div className="flex gap-3 rounded-2xl border border-gold/40 bg-gold/[0.07] p-4">
        <Monitor className="mt-0.5 size-5 shrink-0 text-gold" />
        <div className="min-w-0 text-[13.5px] leading-relaxed">
          <p className="font-semibold text-ink">This is a sample report</p>
          {onPhone ? (
            <>
              <p className="mt-1 text-ink-dim">
                Siren tests AI apps that run on your computer, so scanning your own app needs a desktop or laptop. Open this page there
                to get started.
              </p>
              {pageUrl && <CopyButton text={pageUrl} label="Copy link to open on my computer" className="mt-3 px-3 py-1.5 text-[13px]" />}
            </>
          ) : (
            <p className="mt-1 text-ink-dim">It shows what you get after Siren scans an app. Nothing here is from your own app.</p>
          )}
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          What Siren found in a <span className="gold-text">practice chatbot</span>
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-dim">
          We pointed Siren at a demo support bot that was built with security holes on purpose. It sent the bot the same tricks
          attackers use and graded every reply.
        </p>
      </div>

      <div>
        <ScoreTiles {...SUMMARY} />
        <p className="mt-2 text-xs leading-relaxed text-muted">
          The hardening score is out of 100. Higher means the app held up against more of the tests.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-charcoal-2/60 px-4 py-3 text-[13px] leading-relaxed text-ink-dim">
        <span className="font-semibold text-ink">Try it:</span> tap a result to open it. Each problem explains what went wrong in plain
        English and has a <span className="text-gold">Copy Fix Prompt</span> button. That prompt is what you&apos;d paste into Claude Code
        or Cursor to fix it.
      </div>

      <div className="space-y-3">
        {CARDS.map((card) => (
          <ResultCard key={card.testId} live={card} running={false} defaultOpen={card.testId === FIRST_PROBLEM} />
        ))}
      </div>

      <div className="rounded-2xl border border-line bg-charcoal p-5 text-center">
        <p className="text-[15px] font-semibold text-ink">Want this for your own AI app?</p>
        <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-ink-dim">
          {onPhone
            ? "Open Siren on your computer. It runs there, tests the app you're building, and nothing leaves your machine."
            : "Head back to the start screen to try the demo bot or connect your app."}
        </p>
        <button
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-gold/90 underline-offset-4 hover:underline"
          onClick={onLeave}
        >
          {onPhone ? "Use the full app on this screen anyway" : "Back to the start screen"}
          <ArrowRight className="size-3.5" />
        </button>
      </div>
    </main>
  );
}
