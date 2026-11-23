"use client";

import { Cloud, Cpu, Laptop, Server, Sparkles } from "lucide-react";
import catalog from "@/data/attacker-models.json";
import { CopyButton, cx } from "./ui";

interface CatalogModel {
  id: string;
  name: string;
  family: string;
  pull: string;
  lmstudioSearch?: string;
  match: string;
  size: string;
  tier: "laptop" | "desktop" | "workstation" | "cloud";
  status: "ready" | "cloud" | "pending";
  recommended?: boolean;
  note: string;
}

const MODELS = catalog.models as CatalogModel[];

const TIER: Record<CatalogModel["tier"], { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  laptop: { label: "Laptop", icon: Laptop, cls: "text-pass border-pass/30" },
  desktop: { label: "Desktop · 24 GB+", icon: Cpu, cls: "text-ink-dim border-line-strong" },
  workstation: { label: "Workstation", icon: Server, cls: "text-warn border-warn/30" },
  cloud: { label: "Cloud", icon: Cloud, cls: "text-warn border-warn/40 bg-warn/10" },
};

/** Pick the best installed model: catalog order (top pick first), then whatever is installed. */
export function preferredModel(installed: string[]): string | undefined {
  const ranked = [...MODELS].sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended));
  for (const m of ranked) {
    const hit = installed.find((name) => name.toLowerCase().includes(m.match.toLowerCase()) && !isCloudModel(name));
    if (hit) return hit;
  }
  return installed.find((name) => !isCloudModel(name)) ?? installed[0];
}

export function isCloudModel(name: string) {
  return /:cloud\b|-cloud$/i.test(name);
}

export default function ModelPicker({
  installed,
  current,
  onUse,
}: {
  installed: string[];
  current: string;
  onUse: (model: string) => void;
}) {
  return (
    <details className="group rounded-xl border border-line bg-charcoal-2/50">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium text-ink-dim select-none hover:text-ink">
        <span className="inline-block transition group-open:rotate-90">›</span>
        <Sparkles className="size-3.5 text-gold/80" />
        Recommended attacker models
      </summary>
      <ul className="space-y-2 px-3 pb-3">
        {MODELS.map((m) => {
          const match = installed.find((name) => name.toLowerCase().includes(m.match.toLowerCase()));
          const active = !!match && match === current;
          const tier = TIER[m.tier];
          const TierIcon = tier.icon;
          return (
            <li
              key={m.id}
              className={cx("rounded-lg border p-2.5", active ? "border-gold/50 bg-gold/[0.06]" : "border-line bg-obsidian/60")}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-medium text-ink">{m.name}</span>
                {m.recommended && (
                  <span className="rounded border border-gold/40 px-1 text-[9.5px] font-semibold tracking-wider text-gold uppercase">Top pick</span>
                )}
                <span className={cx("inline-flex items-center gap-1 rounded border px-1 text-[10px]", tier.cls)}>
                  <TierIcon className="size-2.5" />
                  {tier.label}
                </span>
                <span className="font-mono text-[10px] text-muted">{m.size}</span>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{m.note}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {match ? (
                  <button
                    onClick={() => onUse(match)}
                    disabled={active}
                    className={cx(
                      "rounded-md border px-2 py-1 text-[11px] font-medium transition",
                      active ? "border-gold/50 text-gold" : "border-pass/40 text-pass hover:bg-pass/10",
                    )}
                  >
                    {active ? "In use" : `Installed · use ${match}`}
                  </button>
                ) : m.pull ? (
                  <>
                    <code className="rounded bg-charcoal-3 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-dim">{m.pull}</code>
                    <CopyButton text={m.pull} label="Copy" variant="ghost" className="px-1.5 py-0.5 text-[11px]" />
                  </>
                ) : (
                  <span className="text-[11px] text-muted">
                    Local support pending{m.lmstudioSearch ? <> · search LM Studio for “{m.lmstudioSearch}”</> : null}
                  </span>
                )}
              </div>
            </li>
          );
        })}
        <li className="px-1 pt-1 text-[11px] leading-relaxed text-muted">
          After pulling, hit <span className="text-ink-dim">Test connection</span> and installed models light up here. Edit{" "}
          <span className="font-mono">src/data/attacker-models.json</span> to add your own.
        </li>
      </ul>
    </details>
  );
}
