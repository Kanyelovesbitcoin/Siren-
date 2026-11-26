"use client";

import { ArrowRight, Monitor } from "lucide-react";
import { type LiveTest } from "./ResultCard";
import ResultGroups from "./ResultGroups";
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
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                {pageUrl && <CopyButton text={pageUrl} label="Copy link to open on my computer" className="min-h-11 px-3 py-1.5 text-[13px]" />}
                {/* Zooming in on a computer also makes the screen "small". Don't make those users hunt for the way out. */}
                <button className="min-h-11 text-left text-[13px] text-gold underline underline-offset-4" onClick={onLeave}>
                  Already on a computer? Use the full app
                </button>
              </div>
            </>
          ) : (
            <p className="mt-1 text-ink-dim">It shows what you get after Siren scans an app. Nothing here is from your own app.</p>
          )}
        </div>
      </div>

      <div>
        <h1 data-screen-heading tabIndex={-1} className="text-2xl font-semibold tracking-tight text-ink outline-none">
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

      {/* Same grouped list as the live dashboard. The first problem starts open; read-only, so no re-attack. */}
      <h2 className="sr-only">Findings</h2>
      <ResultGroups items={CARDS} running={false} />

      <div className="rounded-2xl border border-line bg-charcoal p-5 text-center">
        <p className="text-[15px] font-semibold text-ink">Want this for your own AI app?</p>
        <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-ink-dim">
          {onPhone
            ? "Open Siren on your computer. It runs there, tests the app you're building, and nothing leaves your machine."
            : "Head back to the start screen to try the demo bot or connect your app."}
        </p>
        <button className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-xs text-gold underline underline-offset-4" onClick={onLeave}>
          {onPhone ? "Use the full app on this screen anyway" : "Back to the start screen"}
          <ArrowRight className="size-3.5" />
        </button>
      </div>
    </main>
  );
}
