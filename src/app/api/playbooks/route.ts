import { loadPlaybooks, playbooksDir } from "@/lib/playbooks";
import { json, rejectUntrusted } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const blocked = rejectUntrusted(request);
  if (blocked) return blocked;
  const { playbooks, errors } = await loadPlaybooks();
  return json({ playbooks, errors, dir: playbooksDir() });
}
