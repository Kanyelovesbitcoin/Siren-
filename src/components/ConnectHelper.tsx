"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste, FileCheck2, TriangleAlert } from "lucide-react";
import { Button, CopyButton, TextArea } from "./ui";
import { buildSetupPrompt } from "@/lib/setup-prompt";
import { parseTargetConfig, sameTarget, targetLabel } from "@/lib/target-config";
import type { TargetConfig } from "@/lib/types";

interface Detected {
  path: string;
  found: boolean;
  mtime?: number;
  target?: TargetConfig;
  error?: string;
}

const POLL_MS = 3000;

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-gold/40 font-mono text-[11px] text-gold"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-dim">{children}</div>
    </li>
  );
}

/**
 * The no-jargon way to connect an app: copy a prompt, let Claude Code or Cursor work out the
 * technical details and start the app, then Siren picks up the setup it saved (or the user
 * pastes it back) and connects.
 */
export default function ConnectHelper({
  current,
  onApply,
  autoRun,
  onAutoRunChange,
  disabled,
}: {
  /** The setup currently in use, so a saved file that matches it isn't offered again. */
  current: TargetConfig;
  onApply: (target: TargetConfig) => void;
  /** Start the audit as soon as the app connects. */
  autoRun: boolean;
  onAutoRunChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const [detected, setDetected] = useState<Detected | null>(null);
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  /** When the user copied the setup prompt: from then on a newly saved setup is theirs, so use it straight away. */
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const appliedMtime = useRef<number | null>(null);

  // Watch for a setup file saved by the coding agent.
  useEffect(() => {
    let alive = true;
    // Keeps running while this tab is in the background: that is exactly when the agent saves the file.
    const check = async () => {
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Detected;
        if (alive) setDetected(data);
      } catch {
        /* dashboard restarting: try again on the next tick */
      }
    };
    check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const prompt = useMemo(() => buildSetupPrompt(detected?.path), [detected?.path]);
  const offer = detected?.found && detected.target && !sameTarget(detected.target, current) ? detected.target : null;

  // The agent saved a setup after the prompt was copied: connect without another click.
  useEffect(() => {
    if (disabled || waitingSince === null || !offer || !detected?.mtime) return;
    if (detected.mtime < waitingSince - 2000 || appliedMtime.current === detected.mtime) return;
    appliedMtime.current = detected.mtime;
    setWaitingSince(null);
    onApply(offer);
  }, [disabled, waitingSince, offer, detected?.mtime, onApply]);

  function applyPasted() {
    const parsed = parseTargetConfig(pasted);
    if (!parsed.ok || !parsed.target) {
      setPasteError(parsed.error ?? "Siren couldn't read that setup block.");
      return;
    }
    setPasteError(null);
    setPasted("");
    onApply(parsed.target);
  }

  return (
    <div className="space-y-4">
      {offer && waitingSince === null && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-pass/35 bg-pass/[0.07] p-3">
          <FileCheck2 aria-hidden className="size-4 shrink-0 text-pass" />
          <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink">
            Found a saved setup for <span className="font-mono text-[12px] break-all text-pass">{targetLabel(offer.url)}</span>
          </p>
          <Button variant="gold" className="px-3 py-1.5 text-[13px]" onClick={() => onApply(offer)} disabled={disabled}>
            Use this setup
          </Button>
        </div>
      )}
      {detected?.found && detected.error && (
        <div role="alert" className="flex gap-2 rounded-xl border border-warn/35 bg-warn/10 p-3 text-[12.5px] leading-relaxed text-warn">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p>Siren found a saved setup file but couldn&apos;t use it: {detected.error}</p>
        </div>
      )}

      <ol className="space-y-3.5">
        <Step n={1}>
          <CopyButton
            text={prompt}
            label="Copy Setup Prompt for Claude Code / Cursor"
            variant="gold"
            className="w-full sm:w-auto"
            onCopied={() => setWaitingSince(Date.now())}
          />
        </Step>
        <Step n={2}>
          Open <span className="text-ink">your app&apos;s folder</span> in Claude Code or Cursor, paste the prompt and send it. It reads your
          code, starts your app if it isn&apos;t running, and works out the technical details for you.
        </Step>
        <Step n={3}>
          <p role="status" className="mb-2">
            {waitingSince !== null ? (
              <span className="flex items-start gap-2 text-ink">
                <span aria-hidden className="siren-pulse mt-1.5 size-2 shrink-0 rounded-full bg-gold" />
                Waiting for your coding agent. When it saves the setup, Siren connects by itself. Or paste what it gives you back here:
              </span>
            ) : (
              "Paste what it gives you back here. If it says it saved the file, you can skip this: Siren finds it by itself."
            )}
          </p>
          <TextArea
            rows={4}
            aria-label="Setup block from your coding agent"
            aria-describedby={pasteError ? "setup-paste-error" : undefined}
            placeholder={'{\n  "url": "http://localhost:3000/api/chat",\n  ...\n}'}
            value={pasted}
            invalid={!!pasteError}
            onChange={(e) => {
              setPasted(e.target.value);
              setPasteError(null);
            }}
            disabled={disabled}
          />
          {pasteError && (
            <p id="setup-paste-error" role="alert" className="mt-1.5 text-xs leading-relaxed text-fail">
              {pasteError}
            </p>
          )}
          <Button className="mt-2" icon={<ClipboardPaste className="size-4" />} onClick={applyPasted} disabled={disabled || !pasted.trim()}>
            Use this setup
          </Button>
        </Step>
      </ol>

      <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-relaxed text-ink-dim">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-[#d4af37]"
          checked={autoRun}
          onChange={(e) => onAutoRunChange(e.target.checked)}
          disabled={disabled}
        />
        <span>Start the audit as soon as my app connects</span>
      </label>
    </div>
  );
}
