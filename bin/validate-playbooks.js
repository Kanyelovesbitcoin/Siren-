#!/usr/bin/env node
/* eslint-disable */
// Lint your playbooks before running them:  npm run validate:playbooks [-- ./my-playbooks]
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const dir = path.resolve(process.argv[2] || path.join(__dirname, "..", "playbooks"));
const SEVERITIES = ["low", "medium", "high", "critical"];
const KINDS = ["prompt", "burst", "oversize"];

let problems = 0;
let tests = 0;
const ids = new Map();
const report = (file, msg) => {
  problems++;
  console.log(`  \x1b[31m✗\x1b[0m ${file}: ${msg}`);
};

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
console.log(`\nValidating ${files.length} playbook(s) in ${dir}\n`);

for (const file of files) {
  let pb;
  try {
    pb = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  } catch (e) {
    report(file, `invalid JSON — ${e.message}`);
    continue;
  }
  for (const k of ["id", "title", "owasp"]) if (!pb[k]) report(file, `missing "${k}"`);
  if (!Array.isArray(pb.tests)) {
    report(file, `"tests" must be an array`);
    continue;
  }
  pb.tests.forEach((t, i) => {
    tests++;
    const where = `${file} tests[${i}]${t.id ? ` (${t.id})` : ""}`;
    for (const k of ["id", "name", "expected"]) if (!t[k]) report(where, `missing "${k}"`);
    if (!Array.isArray(t.turns) && typeof t.prompt !== "string") report(where, `needs "turns" or "prompt"`);
    if (t.severity && !SEVERITIES.includes(t.severity)) report(where, `severity must be one of ${SEVERITIES.join(", ")}`);
    if (t.kind && !KINDS.includes(t.kind)) report(where, `kind must be one of ${KINDS.join(", ")}`);
    if (t.kind === "burst" && !t.burst) report(where, `kind "burst" requires a "burst" object`);
    if (t.kind === "oversize" && !t.oversize) report(where, `kind "oversize" requires an "oversize" object`);
    if (!t.remediation || !t.remediation.summary) report(where, `add remediation.summary so failures explain themselves`);
    for (const re of (t.detect && t.detect.mustNotMatch) || []) {
      try {
        new RegExp(re, "i");
      } catch (e) {
        report(where, `bad regex ${re} — ${e.message}`);
      }
    }
    if (t.id) {
      if (ids.has(t.id)) report(where, `duplicate test id (also in ${ids.get(t.id)})`);
      ids.set(t.id, file);
    }
  });
  console.log(`  \x1b[32m✓\x1b[0m ${file} — ${pb.tests.length} test(s), ${pb.owasp}`);
}

console.log(problems ? `\n${problems} problem(s) found across ${tests} tests.\n` : `\nAll ${tests} tests look good.\n`);
process.exit(problems ? 1 : 0);
