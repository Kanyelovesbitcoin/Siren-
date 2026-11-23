import { promises as fs } from "node:fs";
import path from "node:path";
import type { Playbook, PlaybookLoadError, PlaybookTest, Severity, TestKind } from "./types";

const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
const KINDS: TestKind[] = ["prompt", "burst", "oversize"];

/** Where playbooks live. `siren --playbooks ./my-rules` sets SIREN_PLAYBOOKS_DIR. */
export function playbooksDir(): string {
  return process.env.SIREN_PLAYBOOKS_DIR
    ? path.resolve(process.env.SIREN_PLAYBOOKS_DIR)
    : path.join(process.cwd(), "playbooks");
}

function validateTest(t: unknown, file: string, i: number): PlaybookTest {
  const where = `${file} → tests[${i}]`;
  if (!t || typeof t !== "object") throw new Error(`${where} must be an object`);
  const test = t as Record<string, unknown>;
  for (const key of ["id", "name", "expected"]) {
    if (typeof test[key] !== "string" || !(test[key] as string).trim()) {
      throw new Error(`${where} is missing "${key}"`);
    }
  }
  // Allow a single "prompt" as shorthand for one turn.
  const turns = Array.isArray(test.turns)
    ? test.turns
    : typeof test.prompt === "string"
      ? [test.prompt]
      : null;
  if (!turns || turns.length === 0 || !turns.every((x) => typeof x === "string")) {
    throw new Error(`${where} needs "turns" (string[]) or "prompt" (string)`);
  }
  const severity = (test.severity ?? "medium") as Severity;
  if (!SEVERITIES.includes(severity)) throw new Error(`${where} has invalid severity "${severity}"`);
  const kind = (test.kind ?? "prompt") as TestKind;
  if (!KINDS.includes(kind)) throw new Error(`${where} has invalid kind "${kind}"`);
  if (kind === "burst" && !test.burst) throw new Error(`${where} is kind "burst" but has no "burst" config`);
  if (kind === "oversize" && !test.oversize) throw new Error(`${where} is kind "oversize" but has no "oversize" config`);
  const rem = (test.remediation ?? {}) as Record<string, unknown>;
  return {
    ...(test as unknown as PlaybookTest),
    turns: turns as string[],
    severity,
    kind,
    remediation: {
      summary: typeof rem.summary === "string" ? rem.summary : "This test revealed a weakness.",
      guidance: Array.isArray(rem.guidance) ? (rem.guidance as string[]) : [],
    },
  };
}

function validatePlaybook(raw: unknown, file: string): Playbook {
  if (!raw || typeof raw !== "object") throw new Error(`${file} must contain a JSON object`);
  const p = raw as Record<string, unknown>;
  for (const key of ["id", "title", "owasp"]) {
    if (typeof p[key] !== "string" || !(p[key] as string).trim()) throw new Error(`${file} is missing "${key}"`);
  }
  if (!Array.isArray(p.tests)) throw new Error(`${file} needs a "tests" array`);
  const tests = p.tests.map((t, i) => validateTest(t, file, i));
  return {
    id: p.id as string,
    title: p.title as string,
    shortTitle: (p.shortTitle as string) || (p.title as string),
    owasp: p.owasp as string,
    owaspName: (p.owaspName as string) || "",
    description: (p.description as string) || "",
    icon: p.icon as string | undefined,
    order: typeof p.order === "number" ? p.order : 999,
    objective: typeof p.objective === "string" ? p.objective : undefined,
    attackerHints: Array.isArray(p.attackerHints) ? (p.attackerHints as string[]) : undefined,
    tests,
    source: file,
  };
}

/**
 * Read every *.json file in the playbooks folder. Re-read on every call so you can
 * edit rules while Siren is running — just refresh the dashboard.
 */
export async function loadPlaybooks(): Promise<{ playbooks: Playbook[]; errors: PlaybookLoadError[] }> {
  const dir = playbooksDir();
  const errors: PlaybookLoadError[] = [];
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return { playbooks: [], errors: [{ file: dir, error: "Playbooks folder not found." }] };
  }

  const playbooks: Playbook[] = [];
  const seenTestIds = new Set<string>();
  for (const file of files) {
    try {
      const text = await fs.readFile(path.join(dir, file), "utf8");
      const pb = validatePlaybook(JSON.parse(text), file);
      for (const t of pb.tests) {
        if (seenTestIds.has(t.id)) throw new Error(`${file}: duplicate test id "${t.id}"`);
        seenTestIds.add(t.id);
      }
      playbooks.push(pb);
    } catch (e) {
      errors.push({ file, error: (e as Error).message });
    }
  }
  playbooks.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  return { playbooks, errors };
}
