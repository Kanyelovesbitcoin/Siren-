import { callTarget } from "@/lib/runner";
import { checkTargetUrl } from "@/lib/safety";
import { validateTemplate } from "@/lib/template";
import { json, rejectUntrusted } from "@/lib/http";
import type { TargetConfig } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** "Send test message" — one friendly request so you can verify the URL, template and JSON path. */
export async function POST(request: Request) {
  const blocked = rejectUntrusted(request);
  if (blocked) return blocked;
  const { target, prompt } = (await request.json().catch(() => ({}))) as { target?: TargetConfig; prompt?: string };
  if (!target) return json({ error: "Missing target config." }, 400);
  const check = checkTargetUrl(target.url);
  if (!check.ok) return json({ ok: false, blocked: !!check.external, error: check.reason }, 400);
  const templateError = validateTemplate(target.bodyTemplate);
  if (templateError) return json({ ok: false, error: templateError }, 400);

  const call = await callTarget(target, prompt?.trim() || "Hello! In one sentence, what can you help me with?", []);
  return json({
    ok: !call.error && call.status !== null && call.status < 400,
    status: call.status,
    latencyMs: call.latencyMs,
    reply: call.text,
    resolved: call.resolved,
    raw: call.raw.slice(0, 4000),
    error: call.error,
  });
}
