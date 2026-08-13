import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  adaptIntentToMarketObservation,
  validateMarketObservation
} from "../src/market-observation-contract.js";

const intentSample = JSON.parse(
  readFileSync(
    new URL("../../../contracts/intent-r26/chart_intent_record.json", import.meta.url),
    "utf8"
  )
);

function buildRecord(requestId) {
  const alignedIntent = structuredClone(intentSample);
  alignedIntent.intent_hypotheses[0].evidence_refs = [
    ...alignedIntent.observations[0].evidence_refs
  ];
  return adaptIntentToMarketObservation(alignedIntent, {
    requestId,
    imageSha256: "e".repeat(64),
    marketContext: { symbol: "TEST_PAIR", venue: "TEST_VENUE", timeframe: "4h" }
  });
}

test("scene graph is deterministically grounded in validated evidence", () => {
  const record = buildRecord("scene-graph-001");
  assert.equal(record.scene_graph.schema_version, "visionassist.scene_graph.v1");
  assert.ok(record.scene_graph.nodes.length >= 3);
  assert.ok(record.scene_graph.nodes.every((node) => node.grounded === true));
  assert.ok(record.scene_graph.edges.some((edge) => edge.relation === "SUPPORTS"));
  assert.match(record.compact_digest, /\[SCENE_GRAPH\] nodes=/);
  assert.equal(validateMarketObservation(record).valid, true);
});

test("scene graph validator rejects ungrounded and dangling claims", () => {
  const ungrounded = buildRecord("scene-graph-002");
  ungrounded.scene_graph.nodes[0].grounded = false;
  assert.throws(() => validateMarketObservation(ungrounded), /must be grounded/);

  const dangling = buildRecord("scene-graph-003");
  assert.ok(dangling.scene_graph.edges.length > 0);
  dangling.scene_graph.edges[0].to_node_id = "hyp:missing";
  assert.throws(() => validateMarketObservation(dangling), /to_node_id unknown/);
});
