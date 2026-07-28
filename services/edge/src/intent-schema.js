import { readFileSync } from "node:fs";

const schemaUrl = new URL(
  "../../../contracts/intent-r26/visionassist_intent_record_v1.json",
  import.meta.url
);

export const intentRecordSchema = Object.freeze(
  JSON.parse(readFileSync(schemaUrl, "utf8"))
);

const unsupportedGenerationKeywords = new Set([
  "$schema",
  "$id",
  "title",
  "minLength",
  "maxLength"
]);

function toStructuredOutputSchema(value) {
  if (Array.isArray(value)) {
    return value.map(toStructuredOutputSchema);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (unsupportedGenerationKeywords.has(key)) {
      continue;
    }
    if (key === "const") {
      result.enum = [child];
      continue;
    }
    result[key] = toStructuredOutputSchema(child);
  }
  return result;
}

// The canonical schema remains stricter; this derived copy uses only the
// JSON Schema subset accepted by Responses Structured Outputs.
export const intentGenerationSchema = Object.freeze(
  toStructuredOutputSchema(intentRecordSchema)
);
