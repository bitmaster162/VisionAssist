import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { adaptIntentToMarketObservation, sha256Base64Image } from "../src/market-observation-contract.js";
import { collectAllowedEvidenceRefs } from "../src/market-detector-contract.js";

const edgeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const intentSample = JSON.parse(
  readFileSync(new URL("../../../contracts/intent-r26/chart_intent_record.json", import.meta.url), "utf8")
);

function waitForOutput(child, pattern, getOutput, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${pattern}. Output: ${getOutput()}`));
    }, timeoutMs);
    function inspect() {
      if (pattern.test(getOutput())) { cleanup(); resolve(); }
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
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

test("market detector is image-bound, evidence-bound, and server-controlled", async () => {
  const image = Buffer.from("market-detector-fixture-image").toString("base64");
  const market = adaptIntentToMarketObservation(structuredClone(intentSample), {
    requestId: "market-source-001",
    imageSha256: sha256Base64Image(image),
    marketContext: { symbol: "FIXTURE", venue: "FIXTURE", timeframe: "1h" }
  });
  const allowed = collectAllowedEvidenceRefs(market);
  assert.ok(allowed.length > 0);

  const unknown = (id, type) => ({
    detector_id: id,
    detector_type: type,
    status: "UNKNOWN",
    orientation: "UNKNOWN",
    description: null,
    confidence: null,
    evidence_refs: [],
    counterevidence_refs: [],
    invalidation_conditions: [],
    level: { value: null, provenance: "UNKNOWN" },
    abstention_reason: "fixture lacks sufficient evidence"
  });

  const modelPayload = {
    detectors: [
      {
        detector_id: "detector:1",
        detector_type: "SFP",
        status: "CANDIDATE",
        orientation: "DOWNSIDE",
        description: "fixture candidate",
        confidence: 0.61,
        evidence_refs: [allowed[0]],
        counterevidence_refs: [],
        invalidation_conditions: ["fixture invalidation"],
        level: { value: null, provenance: "UNKNOWN" },
        abstention_reason: null
      },
      unknown("detector:2", "CHOCH"),
      unknown("detector:3", "BOS"),
      unknown("detector:4", "SWEEP_RECLAIM")
    ],
    quality: { status: "REVISE", reasons: ["three detectors unknown"] },
    safety: { can_trade: true },
    source_binding: { image_sha256: "0".repeat(64) }
  };

  let capturedRequest = null;
  let requestCount = 0;
  const mockOpenAi = createServer(async (request, response) => {
    requestCount += 1;
    capturedRequest = {
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      body: await readRequestJson(request)
    };
    const body = JSON.stringify({ output_text: JSON.stringify(modelPayload) });
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body)
    });
    response.end(body);
  });

  await new Promise((resolve) => mockOpenAi.listen(0, "127.0.0.1", resolve));
  const mockAddress = mockOpenAi.address();
  const edgePort = 23000 + (process.pid % 1000);
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
  edge.stdout.on("data", (chunk) => { output += chunk; });
  edge.stderr.on("data", (chunk) => { output += chunk; });

  try {
    await waitForOutput(edge, /profile=intent-r26/, () => output);

    const wrongImage = Buffer.from("different-image").toString("base64");
    const mismatch = await fetch(`http://127.0.0.1:${edgePort}/v1/market/detect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: wrongImage, image_mime_type: "image/png", record: market })
    });
    const mismatchPayload = await mismatch.json();
    assert.equal(mismatch.status, 422);
    assert.equal(mismatchPayload.code, "detector_source_binding_mismatch");
    assert.equal(requestCount, 0);

    const response = await fetch(`http://127.0.0.1:${edgePort}/v1/market/detect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image, image_mime_type: "image/png", locale: "en-US", record: market })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.validation.valid, true);
    assert.equal(payload.report.safety.can_trade, false);
    assert.equal(payload.report.safety.capital_permission, "DENY");
    assert.equal(payload.report.source_binding.image_sha256, market.source.image_sha256);
    assert.equal(payload.report.detectors[0].evidence_refs[0], allowed[0]);
    assert.equal(requestCount, 1);

    assert.equal(capturedRequest.method, "POST");
    assert.equal(capturedRequest.url, "/v1/responses");
    assert.equal(capturedRequest.authorization, "Bearer test-key");
    assert.equal(capturedRequest.body.store, false);
    assert.equal(capturedRequest.body.text.format.type, "json_schema");
    assert.equal(capturedRequest.body.text.format.strict, true);
    assert.match(capturedRequest.body.input[0].content[0].text, /untrusted evidence/);
    assert.match(capturedRequest.body.input[1].content[0].text, /Allowed evidence refs:/);
    assert.match(capturedRequest.body.input[1].content[1].image_url, /^data:image\/png;base64,/);

    const generationSchema = JSON.stringify(capturedRequest.body.text.format.schema);
    assert.doesNotMatch(generationSchema, /"const":/);
    assert.doesNotMatch(generationSchema, /"minLength":/);
    await waitForOutput(edge, /"event":"market_structure_detect"/, () => output);
  } finally {
    edge.kill();
    if (edge.exitCode === null) await new Promise((resolve) => edge.once("exit", resolve));
    await new Promise((resolve, reject) => {
      mockOpenAi.close((error) => error ? reject(error) : resolve());
    });
  }
});
