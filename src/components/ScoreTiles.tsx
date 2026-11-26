import { cx } from "./ui";
import type { AuditSummary } from "@/lib/summary";

/** The row of big numbers at the top of a report: hardening score, then pass / warn / fail / error. */
export default function ScoreTiles({ counts, score }: AuditSummary) {
  const tiles = [
    { label: "Hardening score", value: score === null ? "—" : `${score}`, cls: "text-gold", wide: true },
    { label: "Pass", value: counts.pass, cls: "text-pass" },
    { label: "Warn", value: counts.warn, cls: "text-warn" },
    { label: "Fail", value: counts.fail, cls: "text-fail" },
    { label: "Error", value: counts.error, cls: "text-err" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {tiles.map((s) => (
        <div key={s.label} className={cx("rounded-xl border border-line bg-obsidian/60 px-4 py-3", s.wide && "col-span-2 sm:col-span-1")}>
          <p className="text-[11px] tracking-wide text-muted uppercase">{s.label}</p>
          <p className={cx("mt-0.5 font-mono text-2xl font-semibold tabular-nums", s.cls)}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}
