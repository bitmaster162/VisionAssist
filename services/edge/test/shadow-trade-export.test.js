import test from "node:test";
import assert from "node:assert/strict";

import { adaptIntentToMarketObservation } from "../src/market-observation-contract.js";
import { exportVisualMarketEvidence, ShadowTradeExportError } from "../src/shadow-trade-export.js";

const safeIntent = {
  schema_version: "visionassist.intent.v1",
  module_identity: "VISUAL_SEMANTIC_COGNITION_LAYER",
  source: {
    source_id: "chart:shadow-001",
    modality: "chart_image",
    captured_at: "2026-08-19T15:00:00Z"
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

test("exports a compact TradingOS visual evidence object without action authority", () => {
  const observation = adaptIntentToMarketObservation(safeIntent, {
    requestId: "shadow-req-001",
    imageSha256: "a".repeat(64),
    marketContext: { symbol: "BTCUSDT", venue: "Binance", timeframe: "1h" }
  });
  const exported = exportVisualMarketEvidence(observation);
  assert.equal(exported.schema, "tradingos.visual_market_evidence.v1");
  assert.equal(exported.symbol, "BTCUSDT");
  assert.equal(exported.safety.execution_authority, "NONE");
  assert.equal(exported.safety.can_trade, false);
  assert.equal(exported.safety.capital_permission, "DENY");
  assert.match(exported.evidence_sha256, /^[a-f0-9]{64}$/);
});

test("fails closed when required market context is unknown", () => {
  const observation = adaptIntentToMarketObservation(safeIntent, {
    requestId: "shadow-req-002",
    imageSha256: "b".repeat(64),
    marketContext: { symbol: "BTCUSDT", venue: "Binance" }
  });
  assert.throws(
    () => exportVisualMarketEvidence(observation),
    (error) => error instanceof ShadowTradeExportError && error.code === "market_context_timeframe_not_provided"
  );
});

test("fails closed if observation safety is widened", () => {
  const observation = adaptIntentToMarketObservation(safeIntent, {
    requestId: "shadow-req-003",
    imageSha256: "c".repeat(64),
    marketContext: { symbol: "BTCUSDT", venue: "Binance", timeframe: "1h" }
  });
  observation.safety.can_trade = true;
  assert.throws(() => exportVisualMarketEvidence(observation));
});
