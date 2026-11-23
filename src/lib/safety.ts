// The Strict Localhost Lock.
//
// Siren only fires test traffic at machines you own. This module is imported by
// BOTH the dashboard (for the instant warning banner) and every server route
// that touches a target (the real enforcement). Never relax it in the UI only.

export const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"] as const;

export interface TargetCheck {
  ok: boolean;
  /** Normalised URL when ok. */
  url?: URL;
  reason?: string;
  /** True when the URL parsed but points somewhere that isn't allowed. */
  external?: boolean;
  hostname?: string;
}

function extraHostsFromEnv(): string[] {
  // process.env is only meaningful on the server; on the client this is empty.
  if (typeof process === "undefined" || !process.env) return [];
  return (process.env.SIREN_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    // Exact hostnames only — no wildcards, no paths.
    .filter((h) => /^[a-z0-9.\-[\]:]+$/.test(h) && !h.includes("*"));
}

export function allowedHosts(extra: string[] = extraHostsFromEnv()): string[] {
  return [...DEFAULT_ALLOWED_HOSTS, ...extra];
}

export function checkTargetUrl(raw: string, extra?: string[]): TargetCheck {
  const value = (raw ?? "").trim();
  if (!value) return { ok: false, reason: "Enter your target endpoint URL." };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "That doesn't look like a valid URL (include http://)." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `Protocol "${url.protocol}" is not supported. Use http:// or https://.` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Credentials in the URL are not allowed. Use a header instead." };
  }

  // URL normalises hostnames to lowercase and strips trailing dots inconsistently,
  // so compare against a strictly normalised value. "localhost.evil.com" fails here.
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const hosts = allowedHosts(extra);
  if (!hosts.includes(hostname)) {
    return {
      ok: false,
      external: true,
      hostname,
      reason: `Blocked: "${hostname}" is not a local address. Siren only tests apps running on your machine (localhost, 127.0.0.1, 0.0.0.0).`,
    };
  }

  return { ok: true, url, hostname };
}

/**
 * Reject cross-site requests to Siren's own API. A random web page you visit
 * must not be able to make your local Siren fire requests on your behalf.
 */
export function isTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  if (!origin) return true; // same-origin fetches from older browsers, curl, CLI
  try {
    const o = new URL(origin);
    const host = request.headers.get("host");
    return o.host === host && allowedHosts().includes(o.hostname.toLowerCase());
  } catch {
    return false;
  }
}
