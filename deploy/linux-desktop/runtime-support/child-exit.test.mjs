import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const helper = new URL("./child-exit.mjs", import.meta.url).href;

// The application starts a background process that inherits the supervisor's pipes (fd 3-5),
// reports its pid on the telemetry pipe and exits; the background process keeps running.
const application = `
const { spawn } = require("node:child_process");
const grandchild = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"],
  { stdio: ["ignore", "ignore", "ignore", 3, 4, 5], detached: true });
grandchild.unref();
require("node:fs").writeSync(5, grandchild.pid + "\\n");
process.exit(0);
`;

// Mirrors the supervisor: it reads the CDP and telemetry pipes, then handles the child's exit.
const supervisor = (mode) => `
import { spawn } from "node:child_process";
import { exitWithChild } from ${JSON.stringify(helper)};
const child = spawn(process.execPath, ["-e", ${JSON.stringify(application)}],
  { stdio: ["ignore", "inherit", "inherit", "pipe", "pipe", "pipe"] });
child.stdio[4].on("data", () => {});
child.stdio[5].on("data", chunk => process.stdout.write("grandchild " + chunk));
child.on("exit", code => {
  if (${JSON.stringify(mode)} === "explicit") exitWithChild(child, code === 0 ? 0 : 1);
  else process.exitCode = code === 0 ? 0 : 1;
});
`;

function run(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cindy-child-exit-test-"));
  const file = path.join(dir, "supervisor.mjs");
  fs.writeFileSync(file, supervisor(mode));
  const proc = spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "inherit"] });
  let output = "";
  proc.stdout.on("data", chunk => { output += chunk; });
  const exited = new Promise(resolve => proc.on("exit", code => resolve(code)));
  const grandchildPid = () => Number(/grandchild (\d+)/.exec(output)?.[1]);
  const cleanup = () => {
    const pid = grandchildPid();
    if (pid) try { process.kill(pid, "SIGKILL"); } catch {}
    if (proc.exitCode === null) proc.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { proc, exited, grandchildPid, cleanup };
}

const within = (promise, ms) =>
  Promise.race([promise, new Promise(resolve => setTimeout(() => resolve("timeout"), ms).unref())]);

test("waiting for pipe end-of-file keeps the supervisor alive after the application exits", async () => {
  const run1 = run("exit-code-only");
  try {
    assert.equal(await within(run1.exited, 3000), "timeout");
    assert.ok(run1.grandchildPid() > 0, "the background process should still hold the pipes");
  } finally { run1.cleanup(); }
});

test("the supervisor exits with the application even while background processes hold its pipes", async () => {
  const run2 = run("explicit");
  try {
    assert.equal(await within(run2.exited, 10000), 0);
    const pid = run2.grandchildPid();
    assert.ok(pid > 0);
    assert.doesNotThrow(() => process.kill(pid, 0), "the background process is still running");
  } finally { run2.cleanup(); }
});

test("profile supervisor exits through the helper on both child exit paths", () => {
  const source = fs.readFileSync(fileURLToPath(new URL("../profile-supervisor.mjs", import.meta.url)), "utf8");
  assert.match(source, /import \{ exitWithChild \} from '\.\/child-exit\.mjs';/);
  assert.match(source, /child\.on\('error',\(\)=>\{[^}]*exitWithChild\(child,1\);\}\);/);
  assert.match(source, /child\.on\('exit',\(code\)=>\{[^}]*exitWithChild\(child,code===0\?0:1\);\}\);/);
});
