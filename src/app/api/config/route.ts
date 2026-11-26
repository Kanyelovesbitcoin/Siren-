import { readConfigFile } from "@/lib/config-file";
import { json, rejectUntrusted } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Connect My App": reports where Siren looks for a setup saved by a coding agent, and the
 * setup itself once the file exists. Read-only. The localhost lock still applies when the
 * setup is used.
 */
export async function GET(request: Request) {
  const blocked = rejectUntrusted(request);
  if (blocked) return blocked;
  return json(await readConfigFile());
}
