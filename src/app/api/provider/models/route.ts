import { listModels, PROVIDER_PRESETS } from "@/lib/providers";
import { json, rejectUntrusted } from "@/lib/http";
import type { ProviderId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const blocked = rejectUntrusted(request);
  if (blocked) return blocked;
  const body = (await request.json().catch(() => ({}))) as { provider?: ProviderId; baseUrl?: string; apiKey?: string };
  const provider = body.provider;
  if (!provider || !(provider in PROVIDER_PRESETS)) return json({ error: "Unknown provider." }, 400);
  try {
    const models = await listModels({ provider, baseUrl: body.baseUrl ?? "", apiKey: body.apiKey });
    return json({ ok: true, models });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    const preset = PROVIDER_PRESETS[provider];
    const message =
      err.cause?.code === "ECONNREFUSED"
        ? `Couldn't reach ${preset.label} at ${body.baseUrl || preset.baseUrl}. ${preset.hint}`
        : err.name === "TimeoutError"
          ? `${preset.label} didn't answer in time. ${preset.hint}`
          : err.message;
    return json({ ok: false, error: message }, 502);
  }
}
