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
  /** Attacker-mode goal: what the adaptive model tries to make the app do. Omit to exclude from attacker mode. */
  objective?: string;
  /** Optional tactic nudges handed to the attacker model. */
  attackerHints?: string[];
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

export type TurnOutcome = "broke" | "partial" | "held";

export interface TurnRecord {
  index: number;
  prompt: string;
  /** Prompt shown in the UI (oversize prompts are truncated for display). */
  displayPrompt: string;
  response: string;
  status: number | null;
  latencyMs: number;
  error?: string;
  /** Attacker mode: the model's plain-English plan for this turn. */
  attackerThought?: string;
  /** Attacker mode: the model's plain-English read of the app's reply. */
  assessment?: string;
  /** Attacker mode: tactic family used this turn (see tactics.ts). */
  tactic?: string;
  /** Attacker mode: how the guardrail did on this attempt. */
  outcome?: TurnOutcome;
  /** Attacker mode: the attacker restarted the conversation for this attempt. */
  freshConversation?: boolean;
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
      /**
       * Set when Siren stopped the run itself: the pre-flight check failed, or the app started
       * rate-limiting or stopped answering. One plain-English reason; tests after it did not run.
       */
      halted?: string;
    };

export interface AttackConfig {
  /** When true, an adaptive model drives each category instead of the fixed playbook turns. */
  enabled: boolean;
  /** Max conversation turns the attacker gets per category before giving up. */
  maxTurns: number;
}

export interface AuditRequest {
  target: TargetConfig;
  judge: ProviderConfig;
  testIds: string[];
  attack?: AttackConfig;
}
