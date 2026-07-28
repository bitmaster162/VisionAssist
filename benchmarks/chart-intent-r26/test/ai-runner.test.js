import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import path from "node:path";
import os from "node:os";

import { runAiAssessment } from "../src/ai-runner.js";
import {
  freezeCase,
  freezeStage,
  verifyCase
} from "../src/lifecycle.js";
import {
  createFixture,
  writeStage
} from "./helpers.js";

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

test("AI runner remains blind and writes a fail-closed benchmark assessment", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "visionassist-r26-ai-runner-"));
  const fixture = createFixture(root);
  freezeCase(fixture.caseDirectory, fixture.outcomePath);
  writeStage(fixture, "human_prior");
  freezeStage(fixture.caseDirectory, "human_prior");

  let captured;
  const unsafeIntent = structuredClone(
    fixture.records.ai_assessment.intent_record
  );
  unsafeIntent.action_code = "LONG";
  unsafeIntent.execution_permission = "ALLOW";
  unsafeIntent.capital_permission = "ALLOW";
  unsafeIntent.can_trade = true;
  const mock = createServer(async (request, response) => {
    captured = {
      authorization: request.headers.authorization,
      url: request.url,
      body: await readRequestJson(request)
    };
    const body = JSON.stringify({
      output_text: JSON.stringify({
        intent_record: unsafeIntent,
        outcome_forecast: fixture.records.ai_assessment.outcome_forecast
      })
    });
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body)
    });
    response.end(body);
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const address = mock.address();

  try {
    const result = await runAiAssessment({
      caseDirectory: fixture.caseDirectory,
      apiKey: "test-key",
      apiBaseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: "fixture-model",
      now: "2026-07-27T00:00:00.000Z"
    });
    const written = JSON.parse(readFileSync(result.output_path, "utf8"));
    const requestText = JSON.stringify(captured.body);

    assert.equal(captured.url, "/v1/responses");
    assert.equal(captured.authorization, "Bearer test-key");
    assert.equal(captured.body.store, false);
    assert.equal(captured.body.text.format.strict, true);
    assert.doesNotMatch(requestText, /Synthetic human-only interpretation/);
    assert.doesNotMatch(requestText, /fixture-candle-baseline/);
    assert.doesNotMatch(requestText, /Synthetic outcome used only/);
    assert.equal(written.intent_record.action_code, "NO_ACTION");
    assert.equal(written.intent_record.execution_permission, "HOLD");
    assert.equal(written.intent_record.capital_permission, "DENY");
    assert.equal(written.intent_record.can_trade, false);

    freezeStage(fixture.caseDirectory, "ai_assessment");
    assert.equal(
      verifyCase(fixture.caseDirectory).phase,
      "AI_ASSESSMENT_FROZEN"
    );
  } finally {
    await new Promise((resolve, reject) => {
      mock.close((error) => error ? reject(error) : resolve());
    });
    rmSync(root, { recursive: true, force: true });
  }
});
