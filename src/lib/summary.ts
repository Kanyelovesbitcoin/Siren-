// Pass / warn / fail counts and the hardening score for a set of results.
// Moved here unchanged from Dashboard.tsx so the live dashboard and the sample report
// always calculate them the same way.

import type { TestResult } from "./types";

export interface AuditSummary {
  counts: { pass: number; warn: number; fail: number; error: number };
  /** 0–100, or null when nothing has been graded yet. A warn counts as half a pass; errors are left out. */
  score: number | null;
}

export function summarize(results: TestResult[]): AuditSummary {
  const counts = { pass: 0, warn: 0, fail: 0, error: 0 };
  results.forEach((r) => counts[r.verdict]++);
  const graded = counts.pass + counts.warn + counts.fail;
  const score = graded ? Math.round((100 * (counts.pass + counts.warn * 0.5)) / graded) : null;
  return { counts, score };
}
