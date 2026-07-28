import test from "node:test";
import assert from "node:assert/strict";

import {
  intentGenerationSchema,
  intentRecordSchema
} from "../src/intent-schema.js";

function collectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, keys);
    }
    return keys;
  }

  if (!value || typeof value !== "object") {
    return keys;
  }

  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    collectKeys(child, keys);
  }
  return keys;
}

test("canonical intent schema retains strict local constraints", () => {
  assert.equal(
    intentRecordSchema.properties.schema_version.const,
    "visionassist.intent.v1"
  );
  assert.equal(intentRecordSchema.properties.source.properties.source_id.minLength, 1);
});

test("generation schema uses the supported Structured Outputs subset", () => {
  const keys = new Set(collectKeys(intentGenerationSchema));

  assert.equal(keys.has("$schema"), false);
  assert.equal(keys.has("$id"), false);
  assert.equal(keys.has("title"), false);
  assert.equal(keys.has("const"), false);
  assert.equal(keys.has("minLength"), false);
  assert.equal(keys.has("maxLength"), false);
  assert.deepEqual(
    intentGenerationSchema.properties.schema_version.enum,
    ["visionassist.intent.v1"]
  );
  assert.deepEqual(intentGenerationSchema.properties.can_trade.enum, [false]);
});
