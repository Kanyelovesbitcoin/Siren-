"use client";

import { ArrowRight, Bot, Check, Lock, Play, PlugZap, TriangleAlert } from "lucide-react";
import ConnectHelper from "./ConnectHelper";
import { ManualSetupDetails } from "./TargetPanel";
import { Button, CopyButton, cx } from "./ui";
import type { TargetConfig } from "@/lib/types";

/** Where the one-click demo is up to. "missing" = we looked and the demo bot isn't running. */
export type DemoStatus = "idle" | "checking" | "missing";

const DEMO_COMMAND = "npm run try";

function ChoiceCard({
  icon,
  title,
  tag,
  children,
  highlight,
}: {
  icon: React.ReactNode;
  title: string;
  tag?: React.ReactNode;
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <section
      className={cx(
        "flex flex-col rounded-2xl border bg-charcoal p-6 shadow-[0_1px_0_rgb(255_255_255/0.03)_inset]",
        highlight ? "border-gold/45" : "border-line",
      )}
    >
      <div className="mb-4 flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold">{icon}</span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
          {tag}
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * The first thing a new visitor sees: two plain choices instead of a technical form.
 */
export default function StartScreen({
  demoStatus,
  demoReady,
  onTryDemo,
  target,
  onTargetChange,
  onApplyConfig,
  onManualContinue,
  manualReady,
  hasResults,
  onBackToResults,
}: {
  demoStatus: DemoStatus;
  /** Launched with `npm run try`, so the demo bot is known to be running. */
  demoReady: boolean;
  onTryDemo: () => void;
  target: TargetConfig;
  onTargetChange: (next: TargetConfig) => void;
  /** A setup arrived from the Copy Setup Prompt flow. */
  onApplyConfig: (next: TargetConfig) => void;
  /** "Continue" inside Advanced / Manual Setup. */
  onManualContinue: () => void;
  manualReady: boolean;
  hasResults: boolean;
  onBackToResults: () => void;
}) {
  return (
    <main className="mx-auto max-w-[1040px] px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Find the weak spots in your AI app <span className="gold-text">before someone else does</span>
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-dim">
          Siren sends your chatbot the same tricks attackers use, shows you in plain English what got through, and hands you a
          ready-made prompt to fix each problem.
        </p>
      </div>

      <div className="mt-10 grid items-start gap-6 md:grid-cols-2">
        <ChoiceCard
          icon={<Bot className="size-6" />}
          title="Try the Demo Bot"
          highlight
          tag={
            demoReady ? (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-pass">
                <Check className="size-3.5" /> Demo bot is running and ready
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-muted">Takes about 30 seconds</p>
            )
          }
        >
          <p className="text-[14px] leading-relaxed text-ink-dim">
            Watch Siren test a practice chatbot that was built with security holes on purpose. You&apos;ll get a score, a list of what
            went wrong, and a fix for each one.
          </p>
          <ul className="mt-4 space-y-1.5 text-[13px] text-ink-dim">
            {["No setup needed", "No AI model or account needed", "Nothing leaves your computer"].map((line) => (
              <li key={line} className="flex items-center gap-2">
                <Check className="size-3.5 shrink-0 text-gold" />
                {line}
              </li>
            ))}
          </ul>
          <Button
            variant="gold"
            className="mt-6 w-full px-5 py-3 text-[15px]"
            icon={<Play className="size-4 fill-current" />}
            loading={demoStatus === "checking"}
            disabled={demoStatus === "checking"}
            onClick={onTryDemo}
          >
            {demoStatus === "checking" ? "Starting…" : "Try the Demo Bot"}
          </Button>

          {demoStatus === "missing" && (
            <div role="alert" className="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-4 text-[13px] leading-relaxed text-ink-dim">
              <p className="flex items-center gap-2 font-semibold text-warn">
                <TriangleAlert className="size-4 shrink-0" />
                The demo bot isn&apos;t running yet
              </p>
              <p className="mt-2">
                Go to the terminal window where you started Siren and press <span className="font-mono text-ink">Ctrl+C</span> to stop
                it. Then start Siren and the demo bot together with this command:
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="rounded-lg border border-line bg-obsidian px-3 py-2 font-mono text-[13px] text-ink">{DEMO_COMMAND}</code>
                <CopyButton text={DEMO_COMMAND} label="Copy" className="px-3 py-1.5 text-[13px]" />
              </div>
            </div>
          )}
        </ChoiceCard>

        <ChoiceCard
          icon={<PlugZap className="size-6" />}
          title="Connect My App"
          tag={<p className="mt-0.5 text-xs text-muted">Your coding agent does the setup</p>}
        >
          <p className="mb-5 text-[14px] leading-relaxed text-ink-dim">
            Test the AI chat feature you&apos;re building. Make sure your app is running on this computer first.
          </p>
          <ConnectHelper current={target} onApply={onApplyConfig} />
          <div className="mt-5">
            <ManualSetupDetails value={target} onChange={onTargetChange}>
              <Button icon={<ArrowRight className="size-4" />} onClick={onManualContinue} disabled={!manualReady}>
                Continue
              </Button>
            </ManualSetupDetails>
          </div>
        </ChoiceCard>
      </div>

      <div className="mt-8 flex flex-col items-center gap-3 text-center">
        <p className="flex items-center gap-2 text-xs text-muted">
          <Lock className="size-3.5 shrink-0" />
          Siren only tests apps running on your own computer. It can&apos;t be pointed at anyone else&apos;s website.
        </p>
        {hasResults && (
          <button className="text-xs text-gold/90 underline-offset-4 hover:underline" onClick={onBackToResults}>
            Back to my results
          </button>
        )}
      </div>
    </main>
  );
}
