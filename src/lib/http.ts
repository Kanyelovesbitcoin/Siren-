import { isTrustedOrigin } from "./safety";

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Returns a 403 response for cross-site requests, or null when the request is trusted. */
export function rejectUntrusted(request: Request): Response | null {
  if (isTrustedOrigin(request)) return null;
  return json({ error: "Cross-origin requests to Siren are blocked." }, 403);
}
