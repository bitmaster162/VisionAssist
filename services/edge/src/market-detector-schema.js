import { readFileSync } from "node:fs";

const schemaUrl = new URL(
  "../../../contracts/market-detectors-v1/visionassist_market_detector_report_v1.json",
  import.meta.url
);

export const marketDetectorReportSchema = Object.freeze(
  JSON.parse(readFileSync(schemaUrl, "utf8"))
);

const unsupportedGenerationKeywords = new Set([
  "$schema",
  "$id",
  "title",
  "description",
  "minLength",
  "maxLength",
  "pattern"
]);

function toStructuredOutputSchema(value) {
  if (Array.isArray(value)) return value.map(toStructuredOutputSchema);
  if (!value || typeof value !== "object") return value;

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (unsupportedGenerationKeywords.has(key)) continue;
    if (key === "const") {
      result.enum = [child];
      continue;
    }
    result[key] = toStructuredOutputSchema(child);
  }
  return result;
}

export const marketDetectorGenerationSchema = Object.freeze(
  toStructuredOutputSchema({
    type: "object",
    additionalProperties: false,
    properties: {
      detectors: marketDetectorReportSchema.properties.detectors,
      quality: marketDetectorReportSchema.properties.quality
    },
    required: ["detectors", "quality"]
  })
);
