// Keeping an audit polite and knowing when to stop.
//
//  - Pacing: a short pause between tests, and waiting when the app sends Retry-After, so
//    ordinary tests don't trip the app's rate limiter.
//  - Circuit breaker: when the app is rate-limiting Siren or has stopped answering, every
//    remaining test would fail the same way. Stop and say why once, in plain English.
//
// Pure helpers only (no network), so `npm test` can check them.

import type { TurnRecord } from "./types";

/** How long Siren is willing to wait when an app says "retry after N seconds". Longer than this, it stops instead. */
export const MAX_HONORED_WAIT_MS = 20_000;

/** Stop the run after this many tests in a row fail for a reason that will keep repeating. */
export const BREAKER_THRESHOLD = 2;

/** Parse a Retry-After header: a number of seconds, or an HTTP date. Returns milliseconds to wait, or null. */
export function parseRetryAfter(header: string | null | undefined, now: number = Date.now()): number | null {
  const value = (header ?? "").trim();
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

export interface Blockage {
  kind: "rate-limited" | "unreachable";
  /** The underlying error text, for the unreachable case. */
  detail?: string;
}

/**
 * Did this test fail for a reason that will repeat on every remaining test? That is the case
 * when the last request was rate-limited (HTTP 429) or got no response at all (app stopped,
 * connection refused, timed out). An ordinary app error (say a 500 on one message) is not.
 */
export function blockage(turns: Pick<TurnRecord, "status" | "error">[]): Blockage | null {
  const failed = [...turns].reverse().find((t) => t.error);
  if (!failed) return null;
  if (failed.status === 429) return { kind: "rate-limited" };
  if (failed.status === null) return { kind: "unreachable", detail: failed.error };
  return null;
}

/** The one plain-English sentence shown when a run is stopped early. */
export function haltReason(block: Blockage, host: string, retryAfterMs?: number | null): string {
  if (block.kind === "rate-limited") {
    const wait =
      retryAfterMs && retryAfterMs > 0 ? `wait about ${Math.ceil(retryAfterMs / 1000)} seconds` : "wait a minute or two";
    return `Your app is rate-limiting Siren (HTTP 429). Restart your local app to reset its rate limit, or ${wait} before re-testing.`;
  }
  const detail = block.detail ?? "";
  if (/timed out/i.test(detail)) {
    return `Your app at ${host} stopped answering (requests are timing out). Make sure it is still running, then run the audit again.`;
  }
  if (/connection refused|ECONNREFUSED|ECONNRESET|fetch failed|socket|network/i.test(detail)) {
    return `Can't reach ${host}. Make sure your app is still running, then run the audit again.`;
  }
  // Not a network problem: a bad address or request template fails identically every time.
  return `Siren stopped because every request is failing the same way: ${detail || "no response"}`;
}
