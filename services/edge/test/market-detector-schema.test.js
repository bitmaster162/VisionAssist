import test from "node:test";
import assert from "node:assert/strict";

import {
  marketDetectorGenerationSchema,
  marketDetectorReportSchema
} from "../src/market-detector-schema.js";

test("detector schema exposes only evidence-bound structural detector types", () => {
  const detector = marketDetectorReportSchema.properties.detectors.items;
  assert.deepEqual(detector.properties.detector_type.enum, ["SFP", "CHOCH", "BOS", "SWEEP_RECLAIM"]);
  assert.deepEqual(detector.properties.status.enum, ["SUPPORTED", "CANDIDATE", "UNKNOWN", "REJECTED"]);
  assert.equal(marketDetectorReportSchema.properties.safety.properties.can_trade.const, false);
  assert.equal(marketDetectorReportSchema.properties.safety.properties.capital_permission.const, "DENY");
});


test("detector generation schema strips unsupported structured-output keywords", () => {
  const text = JSON.stringify(marketDetectorGenerationSchema);
  assert.doesNotMatch(text, /"const":/);
  assert.doesNotMatch(text, /"minLength":/);
  assert.doesNotMatch(text, /"pattern":/);
  assert.deepEqual(marketDetectorGenerationSchema.required, ["detectors", "quality"]);
});
