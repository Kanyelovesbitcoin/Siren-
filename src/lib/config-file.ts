// Server-only: where Siren looks for a setup saved by a coding agent (see setup-prompt.ts).

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTargetConfig } from "./target-config";
import type { TargetConfig } from "./types";

const MAX_BYTES = 100_000;

/**
 * Where the coding agent is asked to save the setup: `siren.config.json` in the Siren folder
 * (git-ignored), or wherever SIREN_CONFIG_FILE points.
 */
export function configFilePath(): string {
  const custom = process.env.SIREN_CONFIG_FILE?.trim();
  return custom ? path.resolve(custom) : path.join(process.cwd(), "siren.config.json");
}

/** Every place Siren checks, in order. The older home-folder location still works. */
function candidatePaths(): string[] {
  const primary = configFilePath();
  return process.env.SIREN_CONFIG_FILE?.trim() ? [primary] : [primary, path.join(os.homedir(), ".siren", "target.json")];
}

export interface DetectedConfig {
  /** Absolute path the agent should save to. Goes into the setup prompt. */
  path: string;
  found: boolean;
  /** Last-modified time, so the dashboard can tell a new save from one it has already seen. */
  mtime?: number;
  target?: TargetConfig;
  error?: string;
}

export async function readConfigFile(): Promise<DetectedConfig> {
  const savePath = configFilePath();
  for (const file of candidatePaths()) {
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) continue;
      if (stat.size > MAX_BYTES) return { path: savePath, found: true, mtime: stat.mtimeMs, error: "The saved setup file is too large to be a Siren setup." };
      const parsed = parseTargetConfig(await fs.readFile(file, "utf8"));
      return parsed.ok
        ? { path: savePath, found: true, mtime: stat.mtimeMs, target: parsed.target }
        : { path: savePath, found: true, mtime: stat.mtimeMs, error: parsed.error };
    } catch {
      /* not there: try the next place */
    }
  }
  return { path: savePath, found: false };
}
