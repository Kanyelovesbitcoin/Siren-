#!/usr/bin/env node
/* eslint-disable */
// Siren CLI launcher — boots the local dashboard on 127.0.0.1 and opens your browser.
//
//   npx siren                       # start (production build if present, otherwise dev)
//   npx siren --demo                # also start the bundled demo bot and open it ready to test
//   npx siren --dev                 # force dev mode (hot reload)
//   npx siren --port 5000           # custom port (default 4141)
//   npx siren --playbooks ./rules   # load playbooks from your own folder
//   npx siren --demo-port 3002      # custom port for the demo bot (default 3001)
//   npx siren --no-open             # don't open a browser tab

"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));

const gold = (s) => (process.stdout.isTTY ? `\x1b[38;2;212;175;55m${s}\x1b[0m` : s);
const dim = (s) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const red = (s) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s);
const green = (s) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s);

function parseArgs(argv) {
  const out = {
    port: Number(process.env.SIREN_PORT) || 4141,
    dev: false,
    open: true,
    playbooks: null,
    demo: false,
    demoPort: Number(process.env.SIREN_DEMO_PORT) || 3001,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dev") out.dev = true;
    else if (a === "--no-open") out.open = false;
    else if (a === "--demo") out.demo = true;
    else if (a === "--demo-port") out.demoPort = Number(argv[++i]);
    else if (a.startsWith("--demo-port=")) out.demoPort = Number(a.split("=")[1]);
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

    --demo               Also start the bundled demo bot, ready to test (same as: npm run try)
    --demo-port <n>      Port for the demo bot (default 3001)
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
  if (out.demo && (!Number.isInteger(out.demoPort) || out.demoPort < 1 || out.demoPort > 65535)) {
    console.error(red("--demo-port must be a number between 1 and 65535"));
    process.exit(1);
  }
  if (out.demo && out.demoPort === out.port) {
    console.error(red(`The dashboard and the demo bot can't share port ${out.port}. Give them two different numbers.`));
    process.exit(1);
  }
  return out;
}

/**
 * Is something already listening on this port? Returns false when it's free, or the reason
 * ("EADDRINUSE", "EACCES"...) when it isn't.
 */
function portInUse(port) {
  // 1) Can we connect? Catches apps listening on every network interface, which a bind test
  //    on 127.0.0.1 alone can miss on macOS.
  const connects = new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
  // 2) Can we bind it ourselves?
  const bindFails = () =>
    new Promise((resolve) => {
      const probe = net.createServer();
      probe.once("error", (err) => resolve(err.code || "EADDRINUSE"));
      probe.once("listening", () => probe.close(() => resolve(false)));
      probe.listen(port, "127.0.0.1");
    });
  return connects.then((busy) => (busy ? "EADDRINUSE" : bindFails()));
}

/** Plain-English explanation of a port clash, with the exact command that fixes it. */
function explainPortClash({ port, reason, what, demo, flag, suggestion, url }) {
  const cmd = `npm run ${demo ? "try" : "siren"} -- ${flag} ${suggestion}`;
  if (reason === "EACCES") {
    return `
  ${red(`Siren isn't allowed to use port ${port} for ${what}.`)}

  Ports below 1024 need administrator rights. Pick a higher number instead:

    ${gold(cmd)}
`;
  }
  return `
  ${red(`Port ${port} is already in use, so Siren can't start ${what}.`)}

  ${
    url
      ? `Siren may already be running. Try opening ${gold(url)} in your browser.
  If that isn't Siren, close the app that's using port ${port}, or use a different port:`
      : `Another app is using it (maybe an earlier demo bot that's still running).
  Close that app, or use a different port:`
  }

    ${gold(cmd)}
`;
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

async function main() {
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
  const demoUrl = `http://localhost:${args.demoPort}/api/chat`;
  const openUrl = args.demo ? `${url}/?demo=1${args.demoPort === 3001 ? "" : `&demoPort=${args.demoPort}`}` : url;

  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  env.SIREN_PLAYBOOKS_DIR = args.playbooks ? path.resolve(process.cwd(), args.playbooks) : path.join(root, "playbooks");
  if (!fs.existsSync(env.SIREN_PLAYBOOKS_DIR)) {
    console.error(red(`Playbooks folder not found: ${env.SIREN_PLAYBOOKS_DIR}`));
    process.exit(1);
  }

  // Check the ports before starting anything, so a clash is one clear sentence instead of a stack trace.
  const dashboardBusy = await portInUse(args.port);
  if (dashboardBusy) {
    console.error(
      explainPortClash({ port: args.port, reason: dashboardBusy, what: "its dashboard", demo: args.demo, flag: "--port", suggestion: args.port + 101, url }),
    );
    process.exit(1);
  }
  if (args.demo) {
    const demoBusy = await portInUse(args.demoPort);
    if (demoBusy) {
      console.error(
        explainPortClash({ port: args.demoPort, reason: demoBusy, what: "the demo bot", demo: true, flag: "--demo-port", suggestion: args.demoPort + 1 }),
      );
      process.exit(1);
    }
  }

  console.log(`
  ${gold("◉ Siren")} ${dim(`v${pkg.version}`)}  local-first AI security bench
  ${dim("mode")}       ${mode === "dev" ? "development" : "production"}
  ${dim("dashboard")}  ${gold(url)}${args.demo ? `\n  ${dim("demo bot")}   ${demoUrl}` : ""}
  ${dim("playbooks")}  ${env.SIREN_PLAYBOOKS_DIR}
  ${dim("targets")}    localhost · 127.0.0.1 · 0.0.0.0 only
${args.demo ? `\n  ${dim("Starting the demo bot and the dashboard. This takes a few seconds…")}\n` : ""}`);

  // Bind to loopback only: the dashboard can send traffic, so it must never be reachable from your network.
  const child = spawn(process.execPath, [nextBin, mode, "-H", "127.0.0.1", "-p", String(args.port)], {
    cwd: root,
    env,
    stdio: "inherit",
  });

  // --demo: the deliberately weak demo bot runs alongside the dashboard, in this same terminal.
  const bot = args.demo
    ? spawn(process.execPath, [path.join(root, "examples", "vulnerable-bot.js")], {
        cwd: root,
        env: { ...process.env, SIREN_DEMO_PORT: String(args.demoPort), SIREN_DEMO_QUIET: "1" },
        stdio: "inherit",
      })
    : null;

  let stopping = false;
  const stopAll = (sig = "SIGTERM") => {
    stopping = true;
    for (const proc of [child, bot]) {
      if (proc && proc.exitCode === null && proc.signalCode === null) proc.kill(sig);
    }
  };
  process.on("SIGINT", () => stopAll("SIGINT"));
  process.on("SIGTERM", () => stopAll("SIGTERM"));
  process.on("exit", () => stopAll());
  child.on("exit", (code) => {
    stopAll();
    process.exit(code ?? 0);
  });
  if (bot) {
    bot.on("exit", (code) => {
      if (stopping) return;
      console.error(red(`\n  The demo bot stopped unexpectedly${code ? ` (exit code ${code})` : ""}, so Siren is shutting down too.\n`));
      stopAll();
      process.exit(1);
    });
  }

  const [dashboardUp, botUp] = await Promise.all([
    waitForServer(url),
    bot ? waitForServer(`http://127.0.0.1:${args.demoPort}/`, 20_000) : Promise.resolve(true),
  ]);
  if (stopping) return;
  if (!dashboardUp || !botUp) {
    console.error(
      red(`\n  ${!dashboardUp ? "The dashboard" : "The demo bot"} didn't start in time. Look for an error above, then try again.\n`),
    );
    if (args.demo) {
      stopAll();
      process.exit(1);
    }
    return;
  }

  if (args.demo) {
    console.log(`
  ${green("✓")} Demo bot ready    ${demoUrl}
  ${green("✓")} Dashboard ready   ${url}

  ${args.open ? "Your browser should open by itself. If it doesn't, open this link:" : "Open this link in your browser:"}
    ${gold(openUrl)}

  The demo bot is already selected. Click ${gold("Run audit")} to watch Siren test it.
  ${dim("Press Ctrl+C in this window to stop everything.")}
`);
  }
  if (args.open) openBrowser(openUrl);
}

main().catch((err) => {
  console.error(red(`Siren couldn't start: ${err && err.message ? err.message : err}`));
  process.exit(1);
});
