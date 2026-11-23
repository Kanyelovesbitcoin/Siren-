// Shared types used by the dashboard (client) and the runner (server).

export type Verdict = "pass" | "warn" | "fail" | "error";
export type Severity = "low" | "medium" | "high" | "critical";
export type TestKind = "prompt" | "burst" | "oversize";

/** Deterministic checks that run before (and override) the judge model. */
export interface DetectRules {
  /** Fail if the extracted reply contains any of these (case-insensitive). */
  mustNotContain?: string[];
  /** Fail if the extracted reply matches any of these regexes (case-insensitive). */
  mustNotMatch?: string[];
  /** Fail if the raw HTTP body contains any of these — useful for tool-call payloads. */
  rawMustNotContain?: string[];
  /** Warn if the extracted reply is longer than this many characters (output amplification). */
  maxResponseChars?: number;
  /** Hint for the heuristic fallback: a safe app is expected to decline. */
  refusalExpected?: boolean;
}

export interface BurstConfig {
  /** Total requests to fire. Capped server-side. */
  count: number;
  /** How many requests are in flight at once. */
  concurrency: number;
}

export interface OversizeConfig {
  /** Filler text repeated to build a large input. */
  filler: string;
  /** Number of repetitions. Capped server-side. */
  repeat: number;
  /** Latency (ms) above which a successful response is flagged as a warning. */
  slowMs?: number;
}

export interface PlaybookTest {
  id: string;
  name: string;
  severity: Severity;
  kind?: TestKind;
  /** One or more user turns. Multi-turn tests replay history via {{messages}}. */
  turns: string[];
  /** What a hardened app should do — given to the judge model. */
  expected: string;
  detect?: DetectRules;
  burst?: BurstConfig;
  oversize?: OversizeConfig;
  remediation: {
    /** Plain-English description of the weakness when this test fails. */
    summary: string;
    /** Concrete hardening steps, injected into the Copy Fix Prompt. */
    guidance: string[];
  };
}

export interface Playbook {
  id: string;
  title: string;
  shortTitle: string;
  owasp: string;
  owaspName: string;
  description: string;
  icon?: string;
  order?: number;
  tests: PlaybookTest[];
  /** Filename the playbook was loaded from (set by the loader). */
  source?: string;
}

export interface PlaybookLoadError {
  file: string;
  error: string;
}

export interface HeaderPair {
  key: string;
  value: string;
}

export interface TargetConfig {
  url: string;
  method: "POST" | "PUT";
  headers: HeaderPair[];
  bodyTemplate: string;
  responsePath: string;
  /** Optional: describe what the app is for and its rules. Helps the judge + fix prompts. */
  appContext?: string;
  /** Optional: secret phrases that exist in your system prompt. Any leak = automatic fail. */
  canaries?: string[];
}

export type ProviderId = "ollama" | "lmstudio" | "openai";

export interface ProviderConfig {
  provider: ProviderId;
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** "judge" uses the model; "heuristic" uses only deterministic rules. */
  mode: "judge" | "heuristic";
}

export interface TurnRecord {
  index: number;
  prompt: string;
  /** Prompt shown in the UI (oversize prompts are truncated for display). */
  displayPrompt: string;
  response: string;
  status: number | null;
  latencyMs: number;
  error?: string;
}

export interface TestResult {
  testId: string;
  playbookId: string;
  playbookTitle: string;
  owasp: string;
  testName: string;
  severity: Severity;
  kind: TestKind;
  verdict: Verdict;
  reason: string;
  /** Which layer decided the verdict. */
  decidedBy: "canary" | "rule" | "judge" | "heuristic" | "deterministic" | "error";
  turns: TurnRecord[];
  totalLatencyMs: number;
  /** Extra stats for burst/oversize tests. */
  stats?: Record<string, number | string>;
  weakness?: string;
  fixPrompt?: string;
}

export type AuditEvent =
  | { type: "start"; total: number; startedAt: string }
  | { type: "test-start"; testId: string; playbookId: string; testName: string; index: number }
  | { type: "turn"; testId: string; turn: TurnRecord }
  | { type: "result"; result: TestResult }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | {
      type: "done";
      summary: { pass: number; warn: number; fail: number; error: number; durationMs: number };
      aborted?: boolean;
    };

export interface AuditRequest {
  target: TargetConfig;
  judge: ProviderConfig;
  testIds: string[];
}
