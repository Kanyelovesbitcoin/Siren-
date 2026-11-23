import { loadPlaybooks } from "@/lib/playbooks";
import { runAudit } from "@/lib/runner";
import { checkTargetUrl } from "@/lib/safety";
import { validateTemplate } from "@/lib/template";
import { json, rejectUntrusted } from "@/lib/http";
import type { AuditEvent, AuditRequest } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 3600;

/** Streams audit progress as newline-delimited JSON (one AuditEvent per line). */
export async function POST(request: Request) {
  const blocked = rejectUntrusted(request);
  if (blocked) return blocked;

  const body = (await request.json().catch(() => null)) as AuditRequest | null;
  if (!body?.target || !body.judge || !Array.isArray(body.testIds)) {
    return json({ error: "Expected { target, judge, testIds }." }, 400);
  }
  const check = checkTargetUrl(body.target.url);
  if (!check.ok) return json({ error: check.reason, blocked: !!check.external }, 400);
  const templateError = validateTemplate(body.target.bodyTemplate);
  if (templateError) return json({ error: templateError }, 400);
  if (body.testIds.length === 0) return json({ error: "Select at least one test." }, 400);

  const { playbooks } = await loadPlaybooks();
  const encoder = new TextEncoder();
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(sink) {
      const emit = (e: AuditEvent) => {
        try {
          sink.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          controller.abort(); // client went away
        }
      };
      try {
        await runAudit({ playbooks, testIds: body.testIds, target: body.target, judge: body.judge, emit, signal: controller.signal });
      } catch (e) {
        emit({ type: "log", level: "error", message: (e as Error).message });
      } finally {
        try {
          sink.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
