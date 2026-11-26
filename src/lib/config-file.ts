// Server-only: where Siren looks for a setup saved by a coding agent (see setup-prompt.ts).

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTargetConfig } from "./target-config";
import type { TargetConfig } from "./types";

const MAX_BYTES = 100_000;

/** `~/.siren/target.json`, or wherever SIREN_CONFIG_FILE points. */
export function configFilePath(): string {
  const custom = process.env.SIREN_CONFIG_FILE?.trim();
  return custom ? path.resolve(custom) : path.join(os.homedir(), ".siren", "target.json");
}

export interface DetectedConfig {
  /** Absolute path Siren watches. Goes into the setup prompt so the agent knows where to save. */
  path: string;
  found: boolean;
  /** Last-modified time, so the dashboard can tell a new save from one it has already seen. */
  mtime?: number;
  target?: TargetConfig;
  error?: string;
}

export async function readConfigFile(): Promise<DetectedConfig> {
  const file = configFilePath();
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return { path: file, found: false };
    if (stat.size > MAX_BYTES) return { path: file, found: true, mtime: stat.mtimeMs, error: "The saved setup file is too large to be a Siren setup." };
    const parsed = parseTargetConfig(await fs.readFile(file, "utf8"));
    return parsed.ok
      ? { path: file, found: true, mtime: stat.mtimeMs, target: parsed.target }
      : { path: file, found: true, mtime: stat.mtimeMs, error: parsed.error };
  } catch {
    return { path: file, found: false };
  }
}
