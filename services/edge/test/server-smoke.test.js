import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const edgeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function waitForOutput(child, pattern, getOutput, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${pattern}. Output: ${getOutput()}`));
    }, timeoutMs);

    function inspect() {
      if (pattern.test(getOutput())) {
        cleanup();
        resolve();
      }
    }

    function onExit(code) {
      cleanup();
      reject(new Error(`Edge exited before readiness with code ${code}. Output: ${getOutput()}`));
    }

    function cleanup() {
      clearTimeout(timeout);
      child.stdout.off("data", inspect);
      child.stderr.off("data", inspect);
      child.off("exit", onExit);
    }

    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.on("exit", onExit);
    inspect();
  });
}

test("android-pilot server fails closed and correlates requests", async () => {
  const port = 18000 + (process.pid % 1000);
  let output = "";
  const child = spawn(process.execPath, ["./src/server.js"], {
    cwd: edgeRoot,
    env: {
      ...process.env,
      PORT: String(port),
      VISIONASSIST_PROFILE: "android-pilot",
      OPENAI_API_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  try {
    await waitForOutput(child, /profile=android-pilot/, () => output);

    const healthResponse = await fetch(`http://127.0.0.1:${port}/v1/health`);
    const health = await healthResponse.json();
    assert.equal(healthResponse.status, 200);
    assert.equal(health.profile, "android-pilot");
    assert.deepEqual(health.capabilities, {
      describe: true,
      ocr: false,
      realtime: false,
      intent: false
    });

    const ocrResponse = await fetch(`http://127.0.0.1:${port}/v1/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    assert.equal(ocrResponse.status, 404);
    assert.equal((await ocrResponse.json()).error, "capability_disabled");

    const describeResponse = await fetch(`http://127.0.0.1:${port}/v1/describe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    assert.equal(describeResponse.status, 400);
    assert.match(describeResponse.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
    await waitForOutput(child, /"event":"describe_pilot"/, () => output);
  } finally {
    child.kill();
    if (child.exitCode === null) {
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
});
