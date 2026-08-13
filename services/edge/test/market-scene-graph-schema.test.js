import test from "node:test";
import assert from "node:assert/strict";

import { marketObservationSchema } from "../src/market-observation-schema.js";

test("scene graph schema permits only grounded evidence relations", () => {
  const graph = marketObservationSchema.properties.scene_graph;
  assert.equal(graph.properties.schema_version.const, "visionassist.scene_graph.v1");
  assert.deepEqual(graph.properties.nodes.items.properties.kind.enum, ["OBSERVATION", "HYPOTHESIS"]);
  assert.equal(graph.properties.nodes.items.properties.grounded.const, true);
  assert.deepEqual(graph.properties.edges.items.properties.relation.enum, ["SUPPORTS", "CONTRADICTS"]);
});
