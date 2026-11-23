"use client";

import { useState } from "react";
import { EyeOff, FileWarning, FlaskConical, Gauge, Play, Square, VenetianMask, Wrench, ShieldAlert } from "lucide-react";
import { Button, Card, Chip, SeverityChip, cx } from "./ui";
import type { Playbook, PlaybookLoadError } from "@/lib/types";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "eye-off": EyeOff,
  wrench: Wrench,
  "file-warning": FileWarning,
  "venetian-mask": VenetianMask,
  gauge: Gauge,
};

export default function SuitePanel({
  playbooks,
  errors,
  dir,
  selected,
  onSelectedChange,
  running,
  attackerMode,
  canRun,
  blockReason,
  progress,
  onRun,
  onStop,
}: {
  playbooks: Playbook[];
  errors: PlaybookLoadError[];
  dir: string;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  running: boolean;
  attackerMode?: boolean;
  canRun: boolean;
  blockReason?: string;
  progress: { done: number; total: number };
  onRun: () => void;
  onStop: () => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const current = playbooks.find((p) => p.id === active) ?? playbooks[0];

  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    onSelectedChange(next);
  };
  const allIds = playbooks.flatMap((p) => p.tests.map((t) => t.id));
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  // In attacker mode, each category with an objective and a selected test becomes one campaign.
  const attackCategories = playbooks.filter((p) => p.objective && p.tests.some((t) => selected.has(t.id)));
  const runCount = attackerMode ? attackCategories.length : selected.size;

  return (
    <Card
      title="Test suites"
      icon={<FlaskConical className="size-4" />}
      action={
        <div className="flex items-center gap-3 text-xs text-muted">
          <span>
            <span className="text-ink">{selected.size}</span> / {allIds.length} selected
          </span>
          <button className="hover:text-gold" onClick={() => toggle(allIds, selected.size !== allIds.length)} disabled={running}>
            {selected.size === allIds.length ? "Clear all" : "Select all"}
          </button>
        </div>
      }
    >
      {attackerMode && playbooks.length > 0 && (
        <div className="mb-4 rounded-xl border border-gold/30 bg-gold/[0.06] p-3 text-[12.5px] leading-relaxed text-ink-dim">
          <span className="font-semibold text-gold">Attacker mode is on.</span> Each category you select below becomes one adaptive
          campaign — the model writes its own attacks, so the individual test prompts act as a checklist of which categories to probe.
          Rate &amp; token limits stay in standard mode.
        </div>
      )}

      {errors.length > 0 && (
        <div className="mb-4 rounded-xl border border-warn/35 bg-warn/10 p-3 text-xs text-warn">
          <p className="mb-1 font-semibold">Some playbooks failed to load</p>
          <ul className="space-y-0.5 font-mono text-[11px] text-warn/90">
            {errors.map((e) => (
              <li key={e.file}>
                {e.file}: {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {playbooks.length === 0 ? (
        <p className="text-sm text-muted">
          No playbooks found in <span className="font-mono text-ink-dim">{dir || "./playbooks"}</span>.
        </p>
      ) : (
        <>
          <div role="tablist" aria-label="OWASP categories" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1 scroll-quiet">
            {playbooks.map((p) => {
              const Icon = ICONS[p.icon ?? ""] ?? FlaskConical;
              const sel = p.tests.filter((t) => selected.has(t.id)).length;
              const isActive = current?.id === p.id;
              return (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActive(p.id)}
                  className={cx(
                    "group flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition",
                    isActive ? "border-gold/50 bg-gold/[0.07]" : "border-line bg-charcoal-2 hover:border-line-strong",
                  )}
                >
                  <Icon className={cx("size-4", isActive ? "text-gold" : "text-muted group-hover:text-ink-dim")} />
                  <span className="flex flex-col">
                    <span className={cx("text-[13px] font-medium", isActive ? "text-ink" : "text-ink-dim")}>{p.shortTitle}</span>
                    <span className="font-mono text-[10px] text-muted">
                      {p.owasp} · {sel}/{p.tests.length}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {current && (
            <div className="rounded-xl border border-line bg-obsidian/60">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4">
                <div className="max-w-2xl">
                  <h3 className="text-[15px] font-semibold text-ink">{current.title}</h3>
                  <p className="mt-0.5 font-mono text-[11px] text-gold/80">
                    OWASP {current.owasp} · {current.owaspName}
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{current.description}</p>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-dim">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-[#d4af37]"
                    checked={current.tests.every((t) => selected.has(t.id))}
                    onChange={(e) => toggle(current.tests.map((t) => t.id), e.target.checked)}
                    disabled={running}
                  />
                  Whole suite
                </label>
              </div>
              <ul className="divide-y divide-line">
                {current.tests.map((t) => (
                  <li key={t.id}>
                    <label className="flex cursor-pointer gap-3 p-4 transition hover:bg-charcoal-2/60">
                      <input
                        type="checkbox"
                        className="mt-1 size-3.5 shrink-0 accent-[#d4af37]"
                        checked={selected.has(t.id)}
                        onChange={(e) => toggle([t.id], e.target.checked)}
                        disabled={running}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-ink">{t.name}</span>
                          <SeverityChip severity={t.severity} />
                          <Chip>{t.id}</Chip>
                          {t.kind && t.kind !== "prompt" && <Chip className="text-gold/80">{t.kind}</Chip>}
                          {t.turns.length > 1 && <Chip>{t.turns.length} turns</Chip>}
                        </span>
                        <span className="mt-1.5 line-clamp-2 block font-mono text-[11.5px] leading-relaxed text-muted">{t.turns[0]}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-4">
        {running ? (
          <Button variant="danger" onClick={onStop} icon={<Square className="size-4 fill-current" />}>
            Stop audit
          </Button>
        ) : (
          <Button
            variant="gold"
            className="px-5 py-2.5 text-[15px]"
            onClick={onRun}
            disabled={!canRun}
            icon={<Play className="size-4 fill-current" />}
          >
            {attackerMode ? "Launch attack" : "Run audit"}
            {runCount ? ` (${runCount})` : ""}
          </Button>
        )}
        {running && (
          <div className="flex min-w-[200px] flex-1 items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-charcoal-3">
              <div className="gold-liquid h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(pct, 4)}%` }} />
            </div>
            <span className="font-mono text-xs text-ink-dim">
              {progress.done}/{progress.total}
            </span>
          </div>
        )}
        {!running && blockReason && (
          <span className="flex items-center gap-1.5 text-xs text-warn">
            <ShieldAlert className="size-3.5" />
            {blockReason}
          </span>
        )}
      </div>
    </Card>
  );
}
