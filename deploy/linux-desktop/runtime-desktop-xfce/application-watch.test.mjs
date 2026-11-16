import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const watch = fileURLToPath(new URL("./application-watch", import.meta.url));
const wrapper = fileURLToPath(new URL("./cindy-linux-desktop", import.meta.url));

// A stand-in supervisor: starts one long-lived child (the application),
// optionally kills it later and keeps running, like a supervisor that failed to exit.
function supervisor({ killAfterMs = null, exitAfterMs = null }) {
  const source = `
    const { spawn } = require("node:child_process");
    const app = spawn("sleep", ["600"], { stdio: "ignore" });
    ${killAfterMs === null ? "" : `setTimeout(() => app.kill("SIGKILL"), ${killAfterMs});`}
    ${exitAfterMs === null ? "setInterval(() => {}, 1000);" : `setTimeout(() => { app.kill("SIGKILL"); process.exit(0); }, ${exitAfterMs});`}
  `;
  // Own process group, so cleanup also stops the application child.
  return spawn(process.execPath, ["-e", source], { stdio: "ignore", detached: true });
}

function startWatch(pid) {
  const proc = spawn("bash", [watch, String(pid), "0.2", "3"], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", chunk => { stderr += chunk; });
  const exited = new Promise(resolve => proc.on("exit", code => resolve({ code, stderr })));
  return { proc, exited };
}

const within = (promise, ms) =>
  Promise.race([promise, new Promise(resolve => setTimeout(() => resolve("timeout"), ms).unref())]);

function stop(watcher, sup) {
  if (watcher.exitCode === null && watcher.signalCode === null) watcher.kill("SIGKILL");
  try { process.kill(-sup.pid, "SIGKILL"); } catch {}
}

test("stays quiet while the application runs", async () => {
  const sup = supervisor({});
  const w = startWatch(sup.pid);
  try {
    assert.equal(await within(w.exited, 1500), "timeout");
  } finally { stop(w.proc, sup); }
});

test("an application that dies before the first check is still detected", async () => {
  const sup = supervisor({ killAfterMs: 50 });
  const w = startWatch(sup.pid);
  try {
    const result = await within(w.exited, 5000);
    assert.notEqual(result, "timeout");
    assert.equal(result.code, 1);
    assert.match(result.stderr, /INSTANCE_APPLICATION_GONE/);
  } finally { stop(w.proc, sup); }
});

test("an application seen again resets the count", async () => {
  // Gone briefly (one miss), then a new application process appears.
  const source = `
    const { spawn } = require("node:child_process");
    let app = spawn("sleep", ["600"], { stdio: "ignore" });
    setTimeout(() => app.kill("SIGKILL"), 300);
    setTimeout(() => { app = spawn("sleep", ["600"], { stdio: "ignore" }); }, 500);
    setInterval(() => {}, 1000);
  `;
  const sup = spawn(process.execPath, ["-e", source], { stdio: "ignore", detached: true });
  const w = startWatch(sup.pid);
  try {
    assert.equal(await within(w.exited, 2500), "timeout");
  } finally { stop(w.proc, sup); }
});

test("exits once the application has been gone for consecutive checks", async () => {
  const sup = supervisor({ killAfterMs: 500 });
  const w = startWatch(sup.pid);
  try {
    const result = await within(w.exited, 5000);
    assert.notEqual(result, "timeout");
    assert.equal(result.code, 1);
    assert.match(result.stderr, /INSTANCE_APPLICATION_GONE/);
  } finally { stop(w.proc, sup); }
});

test("ends quietly when the supervisor exits", async () => {
  const sup = supervisor({ exitAfterMs: 500 });
  const w = startWatch(sup.pid);
  try {
    const result = await within(w.exited, 5000);
    assert.notEqual(result, "timeout");
    assert.equal(result.code, 0);
  } finally { stop(w.proc, sup); }
});

test("the PID 1 wrapper watches only the profile supervisor and stops the container", () => {
  execFileSync("bash", ["-n", wrapper]);
  execFileSync("bash", ["-n", watch]);
  const source = fs.readFileSync(wrapper, "utf8");
  assert.match(source, /node \/usr\/local\/lib\/cindy\/profile-supervisor\.mjs &\n  application=\$!\n[\s\S]*\/usr\/local\/lib\/cindy\/application-watch "\$application" &\n  watch=\$!\nelse\n  "\$@" &\n  application=\$!\nfi/);
  assert.match(source, /if \[ -n "\$watch" \]; then pids\+=\("\$watch"\); fi\nwait -n -p finished "\$\{pids\[@\]\}"/);
  assert.match(source, /if \[ -n "\$watch" \] && \[ "\$\{finished:-\}" = "\$watch" \]; then exit 1; fi/);
});
