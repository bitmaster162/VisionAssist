import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const edgeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

test("intent analyze sends a strict Responses request and enforces the safety envelope", async () => {
  let capturedRequest;
  const unsafeModelRecord = {
    ...structuredClone(sample),
    source: {
      source_id: "model-controlled",
      modality: "chart_image",
      captured_at: null
    },
    action_code: "LONG",
    execution_permission: "ALLOW",
    capital_permission: "ALLOW",
    can_trade: true
  };

  const mockOpenAi = createServer(async (request, response) => {
    capturedRequest = {
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      body: await readRequestJson(request)
    };
    const body = JSON.stringify({
      output_text: JSON.stringify(unsafeModelRecord)
    });
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body)
    });
    response.end(body);
  });

  await new Promise((resolve) => mockOpenAi.listen(0, "127.0.0.1", resolve));
  const mockAddress = mockOpenAi.address();
  const edgePort = 20000 + (process.pid % 1000);
  let output = "";
  const edge = spawn(process.execPath, ["./src/server.js"], {
    cwd: edgeRoot,
    env: {
      ...process.env,
      PORT: String(edgePort),
      HOST: "127.0.0.1",
      VISIONASSIST_PROFILE: "intent-r26",
      OPENAI_API_KEY: "test-key",
      OPENAI_API_BASE_URL: `http://127.0.0.1:${mockAddress.port}/v1`
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  edge.stdout.setEncoding("utf8");
  edge.stderr.setEncoding("utf8");
  edge.stdout.on("data", (chunk) => {
    output += chunk;
  });
  edge.stderr.on("data", (chunk) => {
    output += chunk;
  });

  try {
    await waitForOutput(edge, /profile=intent-r26/, () => output);

    const response = await fetch(`http://127.0.0.1:${edgePort}/v1/intent/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: Buffer.from("bounded-test-image").toString("base64"),
        image_mime_type: "image/png",
        locale: "ru-RU",
        source: {
          source_id: "operator-source",
          modality: "chart_image",
          captured_at: "2026-07-27T00:00:00Z"
        },
        human_context: {
          present: false
        }
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.validation.valid, true);
    assert.equal(payload.record.source.source_id, "operator-source");
    assert.equal(payload.record.fusion_status, "AI_ONLY_INCOMPLETE");
    assert.equal(payload.record.action_code, "NO_ACTION");
    assert.equal(payload.record.execution_permission, "HOLD");
    assert.equal(payload.record.capital_permission, "DENY");
    assert.equal(payload.record.can_trade, false);

    assert.equal(capturedRequest.method, "POST");
    assert.equal(capturedRequest.url, "/v1/responses");
    assert.equal(capturedRequest.authorization, "Bearer test-key");
    assert.equal(capturedRequest.body.store, false);
    assert.equal(capturedRequest.body.text.format.type, "json_schema");
    assert.equal(capturedRequest.body.text.format.strict, true);
    assert.match(
      capturedRequest.body.input[1].content[1].image_url,
      /^data:image\/png;base64,/
    );

    const generationSchema = JSON.stringify(capturedRequest.body.text.format.schema);
    assert.doesNotMatch(generationSchema, /"const":/);
    assert.doesNotMatch(generationSchema, /"minLength":/);
    await waitForOutput(edge, /"event":"intent_r26_analyze"/, () => output);
  } finally {
    edge.kill();
    if (edge.exitCode === null) {
      await new Promise((resolve) => edge.once("exit", resolve));
    }
    await new Promise((resolve, reject) => {
      mockOpenAi.close((error) => error ? reject(error) : resolve());
    });
  }
});
