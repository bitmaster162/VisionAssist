import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptIntentToMarketObservation,
  normalizeMarketContext,
  sha256Base64Image,
  validateMarketObservation
} from "../src/market-observation-contract.js";

const safeIntent = {
  schema_version: "visionassist.intent.v1",
  module_identity: "VISUAL_SEMANTIC_COGNITION_LAYER",
  source: {
    source_id: "chart:test-001",
    modality: "chart_image",
    captured_at: "2026-08-14T00:00:00Z"
  },
  observations: [
    {
      id: "obs-1",
      status: "OBSERVATION",
      description: "Price tests a previously marked range high.",
      evidence_refs: ["region:upper-right"]
    }
  ],
  intent_hypotheses: [
    {
      id: "hyp-1",
      status: "HYPOTHESIS",
      description: "Range breakout continuation.",
      confidence: 0.68,
      evidence_refs: ["region:upper-right"],
      counterevidence_refs: ["obs-1"],
      invalidation_conditions: ["Price closes back inside the range."]
    },
    {
      id: "hyp-2",
      status: "HYPOTHESIS",
      description: "Failed breakout and rotation.",
      confidence: 0.32,
      evidence_refs: ["region:upper-right"],
      counterevidence_refs: [],
      invalidation_conditions: ["Price accepts above the marked range high."]
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
  uncertainties: ["Lower-timeframe confirmation is not visible."],
  alternative_explanations: ["The highlighted level may be an annotation rather than a structural level."],
  decision_status: "DIAGNOSTIC_ONLY",
  action_code: "NO_ACTION",
  execution_permission: "HOLD",
  capital_permission: "DENY",
  can_trade: false
};

test("market adapter preserves evidence and freezes execution permissions", () => {
  const record = adaptIntentToMarketObservation(safeIntent, {
    requestId: "req-market-001",
    imageSha256: "a".repeat(64),
    marketContext: { symbol: "BTCUSDT", venue: "Binance", timeframe: "4h" }
  });

  assert.equal(record.schema_version, "visionassist.market_observation.v1");
  assert.equal(record.visible_observations[0].evidence_refs[0], "region:upper-right");
  assert.equal(record.structure_hypotheses.length, 2);
  assert.deepEqual(record.counterevidence, ["obs-1"]);
  assert.equal(record.market_context.symbol.provenance, "PROVIDED_CONTEXT");
  assert.equal(record.quality.status, "PASS");
  assert.equal(record.safety.can_trade, false);
  assert.equal(record.safety.capital_permission, "DENY");
  assert.match(record.compact_digest, /\[SAFETY\].*can_trade=false/);
  assert.equal(validateMarketObservation(record).valid, true);
});

test("unknown caller context remains unknown and quality is REVISE", () => {
  const record = adaptIntentToMarketObservation(safeIntent, {
    requestId: "req-market-002",
    imageSha256: "b".repeat(64),
    marketContext: { symbol: "BTCUSDT" }
  });

  assert.equal(record.market_context.symbol.value, "BTCUSDT");
  assert.equal(record.market_context.timeframe.value, null);
  assert.equal(record.market_context.timeframe.provenance, "UNKNOWN");
  assert.equal(record.quality.status, "REVISE");
  assert.ok(record.quality.reasons.includes("market_context_unknown:timeframe"));
});

test("normalizeMarketContext never invents symbol venue or timeframe", () => {
  assert.deepEqual(normalizeMarketContext({}), {
    symbol: { value: null, provenance: "UNKNOWN" },
    venue: { value: null, provenance: "UNKNOWN" },
    timeframe: { value: null, provenance: "UNKNOWN" }
  });
});

test("image SHA is computed from decoded bytes", () => {
  const base64 = Buffer.from("visionassist-image").toString("base64");
  assert.match(sha256Base64Image(base64), /^[a-f0-9]{64}$/);
  assert.equal(sha256Base64Image(base64), sha256Base64Image(base64));
});

test("validator rejects any attempt to elevate trading permission", () => {
  const record = adaptIntentToMarketObservation(safeIntent, {
    requestId: "req-market-003",
    imageSha256: "c".repeat(64),
    marketContext: { symbol: "BTCUSDT", venue: "Binance", timeframe: "4h" }
  });
  record.safety.can_trade = true;
  assert.throws(() => validateMarketObservation(record), /can_trade must be false/);
});

test("validator rejects unsupported market modality", () => {
  const intent = structuredClone(safeIntent);
  intent.source.modality = "scene_image";
  assert.throws(
    () => adaptIntentToMarketObservation(intent, {
      requestId: "req-market-004",
      imageSha256: "d".repeat(64),
      marketContext: { symbol: "BTCUSDT", venue: "Binance", timeframe: "4h" }
    }),
    /source.modality must be chart_image or dashboard/
  );
});
