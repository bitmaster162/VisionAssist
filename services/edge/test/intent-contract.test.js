import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  applyIntentSafetyEnvelope,
  IntentContractError,
  normalizeHumanContext,
  normalizeIntentSource,
  validateIntentRecord
} from "../src/intent-contract.js";

const sample = JSON.parse(
  readFileSync(
    new URL("../../../contracts/intent-r26/chart_intent_record.json", import.meta.url),
    "utf8"
  )
);

function clone(value) {
  return structuredClone(value);
}

test("valid human-AI record passes", () => {
  const result = validateIntentRecord(clone(sample));
  assert.equal(result.valid, true);
  assert.equal(result.can_trade, false);
});

test("two hypotheses are required", () => {
  const record = clone(sample);
  record.intent_hypotheses = record.intent_hypotheses.slice(0, 1);
  assert.throws(() => validateIntentRecord(record), IntentContractError);
});

test("intent cannot be asserted as fact", () => {
  const record = clone(sample);
  record.intent_hypotheses[0].status = "FACT";
  assert.throws(() => validateIntentRecord(record), /intent cannot be asserted as fact/);
});

test("confidence is bounded", () => {
  const record = clone(sample);
  record.intent_hypotheses[0].confidence = 1.2;
  assert.throws(() => validateIntentRecord(record), /confidence must be calibrated/);
});

test("counterevidence field is required", () => {
  const record = clone(sample);
  delete record.intent_hypotheses[0].counterevidence_refs;
  assert.throws(
    () => validateIntentRecord(record),
    /intent_hypotheses\[0\]\.counterevidence_refs is required/
  );
});

test("human context binds fusion status", () => {
  const record = clone(sample);
  record.fusion_status = "AI_ONLY_INCOMPLETE";
  assert.throws(() => validateIntentRecord(record), /fusion status mismatch/);
});

test("AI-only mode is explicitly incomplete", () => {
  const record = clone(sample);
  record.human_context = {
    present: false,
    operator_goal: null,
    operator_prior: null,
    operator_confidence: null,
    notes_sha256: null
  };
  record.fusion_status = "AI_ONLY_INCOMPLETE";
  assert.equal(validateIntentRecord(record).fusion_status, "AI_ONLY_INCOMPLETE");
});

test("uncertainty is required", () => {
  const record = clone(sample);
  record.uncertainties = [];
  assert.throws(
    () => validateIntentRecord(record),
    /uncertainties requires at least 1 item/
  );
});

test("trade action is forbidden", () => {
  const record = clone(sample);
  record.action_code = "LONG";
  assert.throws(() => validateIntentRecord(record), /direct trading action forbidden/);
});

test("effect permissions fail closed", () => {
  const record = clone(sample);
  record.execution_permission = "ALLOW";
  assert.throws(() => validateIntentRecord(record), /execution permission must remain HOLD/);
});

test("system envelope overrides model effect permissions and source identity", () => {
  const modelRecord = {
    ...clone(sample),
    source: {
      source_id: "model-controlled",
      modality: "chart_image",
      captured_at: null
    },
    action_code: "BUY",
    execution_permission: "ALLOW",
    capital_permission: "ALLOW",
    can_trade: true
  };
  const source = normalizeIntentSource({
    source_id: "operator-source",
    modality: "chart_image",
    captured_at: "2026-07-26T21:19:21Z"
  });
  const humanContext = normalizeHumanContext(sample.human_context);
  const record = applyIntentSafetyEnvelope(modelRecord, { source, humanContext });

  assert.equal(record.source.source_id, "operator-source");
  assert.equal(record.action_code, "NO_ACTION");
  assert.equal(record.execution_permission, "HOLD");
  assert.equal(record.capital_permission, "DENY");
  assert.equal(record.can_trade, false);
  assert.equal(validateIntentRecord(record).valid, true);
});

test("human prior input is bounded and hash-only", () => {
  assert.throws(
    () => normalizeHumanContext({
      present: true,
      operator_goal: "diagnose",
      operator_prior: "reversal",
      operator_confidence: 1.2
    }),
    /operator_confidence must be between 0 and 1/
  );
  assert.throws(
    () => normalizeHumanContext({
      present: true,
      operator_goal: "diagnose",
      operator_prior: "reversal",
      operator_confidence: 0.4,
      notes_sha256: "raw notes"
    }),
    /must be a SHA-256/
  );
});

test("canonical validator rejects undeclared fields", () => {
  const record = clone(sample);
  record.trade_signal = "LONG";
  assert.throws(() => validateIntentRecord(record), /trade_signal is not allowed/);
});

test("canonical validator rejects incomplete nested records", () => {
  const record = clone(sample);
  delete record.observations[0].description;
  assert.throws(
    () => validateIntentRecord(record),
    /observations\[0\]\.description is required/
  );
});

test("AI-only records cannot smuggle a human prior", () => {
  const record = clone(sample);
  record.human_context = {
    present: false,
    operator_goal: null,
    operator_prior: "hidden prior",
    operator_confidence: null,
    notes_sha256: null
  };
  record.fusion_status = "AI_ONLY_INCOMPLETE";
  assert.throws(() => validateIntentRecord(record), /AI-only operator prior must be null/);
});
