import test from "node:test";
import assert from "node:assert/strict";

import {
  AgentConsumerContractError,
  sha256CanonicalObject,
  validateAgentConsumerEvidence
} from "../src/agent-consumer-contract-v1.js";
import { adaptIntentToMarketObservation } from "../src/market-observation-contract.js";
import { exportVisualMarketEvidence } from "../src/shadow-trade-export.js";

const safeIntent = {
  schema_version: "visionassist.intent.v1",
  module_identity: "VISUAL_SEMANTIC_COGNITION_LAYER",
  source: {
    source_id: "chart:consumer-001",
    modality: "chart_image",
    captured_at: "2026-08-25T15:00:00Z"
  },
  observations: [
    {
      id: "obs-1",
      status: "OBSERVATION",
      description: "Price tests a marked resistance region.",
      evidence_refs: ["region:resistance"]
    }
  ],
  intent_hypotheses: [
    {
      id: "hyp-1",
      status: "HYPOTHESIS",
      description: "Breakout continuation.",
      confidence: 0.6,
      evidence_refs: ["region:resistance"],
      counterevidence_refs: [],
      invalidation_conditions: ["Price closes back below resistance."]
    },
    {
      id: "hyp-2",
      status: "HYPOTHESIS",
      description: "Failed breakout.",
      confidence: 0.4,
      evidence_refs: ["region:resistance"],
      counterevidence_refs: [],
      invalidation_conditions: ["Price accepts above resistance."]
    }
  ],
  human_context: {
    present: false,
    operator_goal: null,
    operator_prior: null,
    operator_confidence: null,
    notes_sha256: null
  },
  fusion_status: "AI_ONLY_INCOMPLETE",
  uncertainties: ["Lower timeframe confirmation is not visible."],
  alternative_explanations: ["The marked region may be stale."],
  decision_status: "DIAGNOSTIC_ONLY",
  action_code: "NO_ACTION",
  execution_permission: "HOLD",
  capital_permission: "DENY",
  can_trade: false
};

function exportedEvidence(capturedAt = "2026-08-25T15:00:00Z") {
  const intent = structuredClone(safeIntent);
  intent.source.captured_at = capturedAt;
  const observation = adaptIntentToMarketObservation(intent, {
    requestId: "consumer-contract-001",
    imageSha256: "a".repeat(64),
    marketContext: { symbol: "BTCUSDT", venue: "Binance", timeframe: "1h" }
  });
  return exportVisualMarketEvidence(observation);
}

function rehash(record) {
  const copy = structuredClone(record);
  const { evidence_sha256: _sha, trade_case_ref: _ref, ...body } = copy;
  copy.evidence_sha256 = sha256CanonicalObject(body);
  copy.trade_case_ref = {
    source_id: copy.source_id,
    sha256: copy.evidence_sha256,
    schema: copy.schema
  };
  return copy;
}

function expectDeny(fn, code) {
  assert.throws(
    fn,
    (error) => error instanceof AgentConsumerContractError && (!code || error.code === code)
  );
}

test("current exporter emits evidence that passes the frozen consumer contract", () => {
  const evidence = exportedEvidence();
  const receipt = validateAgentConsumerEvidence(evidence);
  assert.equal(receipt.valid, true);
  assert.equal(receipt.execution_authority, "NONE");
  assert.equal(receipt.can_trade, false);
  assert.equal(receipt.capital_permission, "DENY");
});

test("golden vector has stable deterministic evidence SHA-256 and exact trade_case_ref", () => {
  const evidence = exportedEvidence();
  assert.equal(evidence.evidence_sha256, "4ae5446d6faa50760a04d14c665174ca9ce59e2ca91ed7d36fe8c36fba30486f");
  assert.equal(evidence.trade_case_ref.sha256, evidence.evidence_sha256);
});

test("one-field tamper with stale hash fails closed", () => {
  const evidence = exportedEvidence();
  evidence.symbol = "ETHUSDT";
  expectDeny(() => validateAgentConsumerEvidence(evidence), "evidence_sha256_mismatch");
});

test("schema, source schema, and trade-case ref mismatches fail closed", () => {
  const wrongSchema = exportedEvidence();
  wrongSchema.schema = "tradingos.visual_market_evidence.v2";
  expectDeny(() => validateAgentConsumerEvidence(wrongSchema), "wrong_schema");

  const wrongSource = exportedEvidence();
  wrongSource.source_schema = "visionassist.market_observation.v2";
  expectDeny(() => validateAgentConsumerEvidence(wrongSource), "wrong_source_schema");

  const wrongRef = exportedEvidence();
  wrongRef.trade_case_ref.sha256 = "b".repeat(64);
  expectDeny(() => validateAgentConsumerEvidence(wrongRef), "trade_case_ref_sha_mismatch");
});

test("missing, timezone-less, malformed, and impossible captured_at fail closed", () => {
  for (const capturedAt of [null, "2026-08-25T15:00:00", "not-a-time", "2026-02-30T15:00:00Z"]) {
    const evidence = exportedEvidence();
    evidence.captured_at = capturedAt;
    const rebound = capturedAt == null ? evidence : rehash(evidence);
    expectDeny(() => validateAgentConsumerEvidence(rebound));
  }
});

test("Z and explicit-offset captured_at pass", () => {
  assert.equal(validateAgentConsumerEvidence(exportedEvidence("2026-08-25T15:00:00Z")).valid, true);
  assert.equal(validateAgentConsumerEvidence(exportedEvidence("2026-08-25T22:00:00+07:00")).valid, true);
});

test("wall-clock freshness is deliberately outside the deterministic hash contract", () => {
  assert.equal(validateAgentConsumerEvidence(exportedEvidence("2000-01-01T00:00:00Z")).valid, true);
});

test("all authority widening attempts fail closed", () => {
  const mutations = [
    (x) => { x.safety.can_trade = true; },
    (x) => { x.safety.execution_authority = "LIVE"; },
    (x) => { x.safety.capital_permission = "ALLOW"; },
    (x) => { x.safety.orders_allowed = true; },
    (x) => { x.safety.signals_allowed = true; }
  ];
  for (const mutate of mutations) {
    const evidence = exportedEvidence();
    mutate(evidence);
    const rebound = rehash(evidence);
    expectDeny(() => validateAgentConsumerEvidence(rebound));
  }
});

test("uncertainty, counterevidence, and invalidation semantics survive validation unchanged", () => {
  const evidence = exportedEvidence();
  const before = structuredClone({
    uncertainties: evidence.uncertainties,
    counterevidence: evidence.counterevidence,
    invalidation: evidence.detector_summary.map((item) => item.invalidation_conditions)
  });
  validateAgentConsumerEvidence(evidence);
  assert.deepEqual({
    uncertainties: evidence.uncertainties,
    counterevidence: evidence.counterevidence,
    invalidation: evidence.detector_summary.map((item) => item.invalidation_conditions)
  }, before);
});
