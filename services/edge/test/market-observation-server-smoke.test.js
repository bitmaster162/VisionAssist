import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

import { adaptIntentToMarketObservation } from "../src/market-observation-contract.js";
import { readFileSync } from "node:fs";

const edgeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const intentSample = JSON.parse(
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

test("market validation endpoint accepts safe record and rejects permission elevation", async () => {
  const port = 20000 + (process.pid % 1000);
  let output = "";
  const childEnvironment = { ...process.env, PORT: String(port), OPENAI_API_KEY: "" };
  delete childEnvironment.VISIONASSIST_PROFILE;

  const child = spawn(process.execPath, [path.join(edgeRoot, "src", "server.js")], {
    cwd: tmpdir(),
    env: childEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  try {
    await waitForOutput(child, /profile=intent-r26/, () => output);

    const record = adaptIntentToMarketObservation(intentSample, {
      requestId: "market-smoke-001",
      imageSha256: "a".repeat(64),
      marketContext: { symbol: "BTCUSDT", venue: "Binance", timeframe: "4h" }
    });

    const response = await fetch(`http://127.0.0.1:${port}/v1/market/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ record })
    });
    const validation = await response.json();
    assert.equal(response.status, 200);
    assert.equal(validation.valid, true);
    assert.equal(validation.quality_status, "PASS");
    assert.equal(validation.can_trade, false);

    const unsafe = structuredClone(record);
    unsafe.safety.can_trade = true;
    const unsafeResponse = await fetch(`http://127.0.0.1:${port}/v1/market/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ record: unsafe })
    });
    const unsafePayload = await unsafeResponse.json();
    assert.equal(unsafeResponse.status, 422);
    assert.equal(unsafePayload.code, "market_observation_contract_error");

    const observeWithoutImage = await fetch(`http://127.0.0.1:${port}/v1/market/observe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: { source_id: "x", modality: "chart_image" } })
    });
    assert.equal(observeWithoutImage.status, 400);
    assert.match(observeWithoutImage.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);

    await waitForOutput(child, /"event":"market_observation_validate"/, () => output);
    assert.match(output, /"raw_image_persisted":false/);
  } finally {
    child.kill();
    if (child.exitCode === null) {
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
});
