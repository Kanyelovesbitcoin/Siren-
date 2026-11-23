#!/usr/bin/env node
/* eslint-disable */
// Siren CLI launcher — boots the local dashboard on 127.0.0.1 and opens your browser.
//
//   npx siren                       # start (production build if present, otherwise dev)
//   npx siren --dev                 # force dev mode (hot reload)
//   npx siren --port 5000           # custom port (default 4141)
//   npx siren --playbooks ./rules   # load playbooks from your own folder
//   npx siren --no-open             # don't open a browser tab

"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));

const gold = (s) => (process.stdout.isTTY ? `\x1b[38;2;212;175;55m${s}\x1b[0m` : s);
const dim = (s) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const red = (s) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s);

function parseArgs(argv) {
  const out = { port: Number(process.env.SIREN_PORT) || 4141, dev: false, open: true, playbooks: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dev") out.dev = true;
    else if (a === "--no-open") out.open = false;
    else if (a === "--port" || a === "-p") out.port = Number(argv[++i]);
    else if (a.startsWith("--port=")) out.port = Number(a.split("=")[1]);
    else if (a === "--playbooks") out.playbooks = argv[++i];
    else if (a.startsWith("--playbooks=")) out.playbooks = a.split("=")[1];
    else if (a === "--version" || a === "-v") {
      console.log(pkg.version);
      process.exit(0);
    } else if (a === "--help" || a === "-h") {
      console.log(`
  ${gold("Siren")} ${dim(`v${pkg.version}`)} — local-first AI security bench

  Usage: siren [options]

    --port, -p <n>       Port for the dashboard (default 4141)
    --dev                Run in development mode (hot reload)
    --playbooks <dir>    Load playbooks from a custom folder
    --no-open            Don't open the browser automatically
    --version, -v        Print version
`);
      process.exit(0);
    } else {
      console.error(red(`Unknown option: ${a}`) + dim("  (try --help)"));
      process.exit(1);
    }
  }
  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) {
    console.error(red("--port must be a number between 1 and 65535"));
    process.exit(1);
  }
  return out;
}

function openBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", '""', url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true, windowsVerbatimArguments: process.platform === "win32" });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* headless machine — the URL is printed anyway */
  }
}

function waitForServer(url, timeoutMs = 90_000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) return resolve(false);
        setTimeout(tick, 400);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    tick();
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let nextBin;
  try {
    nextBin = require.resolve("next/dist/bin/next", { paths: [root] });
  } catch {
    console.error(red("Couldn't find Next.js. Run `npm install` in the Siren folder first."));
    process.exit(1);
  }

  const hasBuild = fs.existsSync(path.join(root, ".next", "BUILD_ID"));
  const mode = args.dev || !hasBuild ? "dev" : "start";
  const url = `http://127.0.0.1:${args.port}`;

  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  env.SIREN_PLAYBOOKS_DIR = args.playbooks ? path.resolve(process.cwd(), args.playbooks) : path.join(root, "playbooks");
  if (!fs.existsSync(env.SIREN_PLAYBOOKS_DIR)) {
    console.error(red(`Playbooks folder not found: ${env.SIREN_PLAYBOOKS_DIR}`));
    process.exit(1);
  }

  console.log(`
  ${gold("◉ Siren")} ${dim(`v${pkg.version}`)}  local-first AI security bench
  ${dim("mode")}       ${mode === "dev" ? "development" : "production"}
  ${dim("dashboard")}  ${gold(url)}
  ${dim("playbooks")}  ${env.SIREN_PLAYBOOKS_DIR}
  ${dim("targets")}    localhost · 127.0.0.1 · 0.0.0.0 only
`);

  // Bind to loopback only: the dashboard can send traffic, so it must never be reachable from your network.
  const child = spawn(process.execPath, [nextBin, mode, "-H", "127.0.0.1", "-p", String(args.port)], {
    cwd: root,
    env,
    stdio: "inherit",
  });

  if (args.open) {
    waitForServer(url).then((ok) => ok && openBrowser(url));
  }

  const forward = (sig) => {
    if (!child.killed) child.kill(sig);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
  child.on("exit", (code) => process.exit(code ?? 0));
}

main();
