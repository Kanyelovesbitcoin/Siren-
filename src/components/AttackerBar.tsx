"use client";

import { Lock, Swords, Minus, Plus } from "lucide-react";
import { cx } from "./ui";
import type { AttackConfig } from "@/lib/types";

export default function AttackerBar({
  value,
  onChange,
  modelName,
  disabled,
}: {
  value: AttackConfig;
  onChange: (next: AttackConfig) => void;
  modelName: string | null;
  disabled?: boolean;
}) {
  const on = value.enabled;
  return (
    <div
      className={cx(
        "rounded-2xl border p-4 transition",
        on ? "border-gold/45 bg-gold/[0.05]" : "border-line bg-charcoal",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <button
          role="switch"
          aria-checked={on}
          disabled={disabled}
          onClick={() => onChange({ ...value, enabled: !on })}
          className={cx(
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50",
            on ? "gold-liquid" : "bg-charcoal-3 ring-1 ring-line-strong",
          )}
        >
          <span className={cx("inline-block size-4 rounded-full bg-white shadow transition", on ? "translate-x-6" : "translate-x-1")} />
        </button>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Swords className={cx("size-4", on ? "text-gold" : "text-muted")} />
            Attacker mode
            <span className="rounded-md border border-gold/30 bg-gold/10 px-1.5 py-px text-[10px] font-medium tracking-wide text-gold/90 uppercase">
              adaptive
            </span>
          </p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
            {on ? (
              <>
                Your model writes its own attacks and escalates over several turns per category, grading each reply as it goes.
              </>
            ) : (
              <>Run the fixed playbook prompts. Turn this on to let a model probe adaptively instead.</>
            )}
          </p>
        </div>

        {on && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted">Max turns</span>
            <div className="flex items-center gap-1 rounded-lg border border-line-strong bg-obsidian p-0.5">
              <button
                aria-label="Fewer turns"
                disabled={disabled || value.maxTurns <= 2}
                onClick={() => onChange({ ...value, maxTurns: Math.max(2, value.maxTurns - 1) })}
                className="rounded-md p-1 text-ink-dim hover:text-gold disabled:opacity-40"
              >
                <Minus className="size-3.5" />
              </button>
              <span className="w-5 text-center font-mono text-sm text-ink tabular-nums">{value.maxTurns}</span>
              <button
                aria-label="More turns"
                disabled={disabled || value.maxTurns >= 8}
                onClick={() => onChange({ ...value, maxTurns: Math.min(8, value.maxTurns + 1) })}
                className="rounded-md p-1 text-ink-dim hover:text-gold disabled:opacity-40"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {on && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-gold/15 pt-3 text-[11.5px]">
          <span className="flex items-center gap-1.5 text-ink-dim">
            <Lock className="size-3 text-gold/80" />
            Still localhost-only — attacks only hit the target you own
          </span>
          {modelName ? (
            <span className="text-muted">
              Attacker &amp; judge: <span className="font-mono text-ink-dim">{modelName}</span>
            </span>
          ) : (
            <span className="text-warn">Connect a model below — it generates the attacks.</span>
          )}
          <span className="text-muted">Rate &amp; token tests stay in standard mode.</span>
        </div>
      )}
    </div>
  );
}
