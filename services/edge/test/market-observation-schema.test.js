import test from "node:test";
import assert from "node:assert/strict";

import { marketObservationSchema } from "../src/market-observation-schema.js";

test("canonical market-observation schema freezes trading safety", () => {
  assert.equal(marketObservationSchema.$id, "visionassist.market_observation.v1");
  assert.equal(
    marketObservationSchema.properties.module_identity.const,
    "TRADING_AGENT_VISUAL_PERCEPTION_LAYER"
  );
  assert.deepEqual(
    marketObservationSchema.properties.source.properties.modality.enum,
    ["chart_image", "dashboard"]
  );
  assert.equal(
    marketObservationSchema.properties.safety.properties.decision_status.const,
    "DIAGNOSTIC_ONLY"
  );
  assert.equal(marketObservationSchema.properties.safety.properties.action_code.const, "NO_ACTION");
  assert.equal(marketObservationSchema.properties.safety.properties.execution_permission.const, "HOLD");
  assert.equal(marketObservationSchema.properties.safety.properties.capital_permission.const, "DENY");
  assert.equal(marketObservationSchema.properties.safety.properties.can_trade.const, false);
});

test("market context schema distinguishes provided context from unknown", () => {
  const variants = marketObservationSchema.$defs.context_field.oneOf;
  assert.equal(variants.length, 2);
  assert.equal(variants[0].properties.provenance.const, "PROVIDED_CONTEXT");
  assert.equal(variants[1].properties.provenance.const, "UNKNOWN");
  assert.equal(variants[1].properties.value.type, "null");
});
