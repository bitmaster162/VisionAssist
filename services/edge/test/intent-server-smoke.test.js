import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

const edgeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const sample = JSON.parse(
  readFileSync(
    new URL("../../../contracts/intent-r26/chart_intent_record.json", import.meta.url),
    "utf8"
  )
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

test("default server boots intent-r26 and exposes no Describe flow", async () => {
  const port = 19000 + (process.pid % 1000);
  let output = "";
  const childEnvironment = {
    ...process.env,
    PORT: String(port),
    OPENAI_API_KEY: ""
  };
  delete childEnvironment.VISIONASSIST_PROFILE;
  const child = spawn(process.execPath, [path.join(edgeRoot, "src", "server.js")], {
    cwd: tmpdir(),
    env: childEnvironment,
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
    await waitForOutput(child, /profile=intent-r26/, () => output);

    const healthResponse = await fetch(`http://127.0.0.1:${port}/v1/health`);
    const health = await healthResponse.json();
    assert.equal(health.profile, "intent-r26");
    assert.equal(health.capabilities.intent, true);
    assert.equal(health.capabilities.describe, false);

    const consoleResponse = await fetch(`http://127.0.0.1:${port}/intent-r26`);
    const consoleHtml = await consoleResponse.text();
    assert.equal(consoleResponse.status, 200);
    assert.match(consoleHtml, /Intent R26/);
    assert.match(
      consoleResponse.headers.get("content-security-policy") ?? "",
      /default-src 'self'/
    );

    const exampleResponse = await fetch(`http://127.0.0.1:${port}/v1/intent/example`);
    const examplePayload = await exampleResponse.json();
    assert.equal(exampleResponse.status, 200);
    assert.equal(examplePayload.validation.valid, true);
    assert.equal(examplePayload.record.can_trade, false);

    const validationResponse = await fetch(`http://127.0.0.1:${port}/v1/intent/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ record: sample })
    });
    const validation = await validationResponse.json();
    assert.equal(validationResponse.status, 200);
    assert.equal(validation.valid, true);
    assert.equal(validation.hypothesis_count, 2);
    assert.equal(validation.can_trade, false);

    const unsafeRecord = structuredClone(sample);
    unsafeRecord.action_code = "LONG";
    const unsafeResponse = await fetch(`http://127.0.0.1:${port}/v1/intent/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ record: unsafeRecord })
    });
    assert.equal(unsafeResponse.status, 422);
    assert.equal((await unsafeResponse.json()).code, "intent_contract_error");

    const describeResponse = await fetch(`http://127.0.0.1:${port}/v1/describe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    assert.equal(describeResponse.status, 404);
    assert.equal((await describeResponse.json()).error, "capability_disabled");

    const analyzeResponse = await fetch(`http://127.0.0.1:${port}/v1/intent/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    assert.equal(analyzeResponse.status, 400);
    assert.match(analyzeResponse.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
    await waitForOutput(child, /"event":"intent_r26_validate"/, () => output);
  } finally {
    child.kill();
    if (child.exitCode === null) {
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
});
