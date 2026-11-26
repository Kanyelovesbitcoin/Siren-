import { cx } from "./ui";
import type { AuditSummary } from "@/lib/summary";

/**
 * The row of big numbers at the top of a report. Named and ordered like the result groups
 * below it (problems first), so the numbers and the list read as one thing.
 */
export default function ScoreTiles({ counts, score }: AuditSummary) {
  const tiles = [
    { label: "Hardening score", value: score === null ? "—" : `${score}`, cls: "text-gold", wide: true },
    { label: "Action needed", value: counts.fail, cls: "text-fail" },
    { label: "Needs review", value: counts.warn, cls: "text-warn" },
    { label: "Errors", value: counts.error, cls: "text-err" },
    { label: "Passed", value: counts.pass, cls: "text-pass" },
  ];
  return (
    <div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((s) => (
          <div key={s.label} className={cx("rounded-xl border border-line bg-obsidian/60 px-4 py-3", s.wide && "col-span-2 sm:col-span-1")}>
            <dt className="text-[11px] tracking-wide text-muted uppercase">{s.label}</dt>
            <dd className={cx("mt-0.5 font-mono text-2xl font-semibold tabular-nums", s.cls)}>{s.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        The hardening score is out of 100. Higher means your app held up against more of the tests. Tests that couldn&apos;t run
        aren&apos;t counted.
      </p>
    </div>
  );
}
