import { createHash } from "node:crypto";
import { validateMarketObservation } from "./market-observation-contract.js";

export const TRADINGOS_VISUAL_EVIDENCE_SCHEMA = "tradingos.visual_market_evidence.v1";

export class ShadowTradeExportError extends Error {
  constructor(code) {
    super(code);
    this.name = "ShadowTradeExportError";
    this.code = code;
  }
}

function requireCondition(condition, code) {
  if (!condition) {
    throw new ShadowTradeExportError(code);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Object(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function contextValue(field, name) {
  requireCondition(field && typeof field === "object", `market_context_${name}_missing`);
  requireCondition(field.provenance === "PROVIDED_CONTEXT", `market_context_${name}_not_provided`);
  requireCondition(typeof field.value === "string" && field.value.trim().length > 0, `market_context_${name}_empty`);
  return field.value.trim();
}

export function exportVisualMarketEvidence(record) {
  const validation = validateMarketObservation(record);
  requireCondition(validation.valid === true, "market_observation_invalid");
  requireCondition(record.safety?.decision_status === "DIAGNOSTIC_ONLY", "unsafe_decision_status");
  requireCondition(record.safety?.action_code === "NO_ACTION", "unsafe_action_code");
  requireCondition(record.safety?.execution_permission === "HOLD", "unsafe_execution_permission");
  requireCondition(record.safety?.capital_permission === "DENY", "unsafe_capital_permission");
  requireCondition(record.safety?.can_trade === false, "unsafe_can_trade");

  const detectorSummary = record.detector_report.detectors.map((item) => ({
    detector_type: item.detector_type,
    status: item.status,
    orientation: item.orientation,
    confidence: item.confidence,
    evidence_refs: [...item.evidence_refs],
    counterevidence_refs: [...item.counterevidence_refs],
    invalidation_conditions: [...item.invalidation_conditions]
  }));

  const body = {
    schema: TRADINGOS_VISUAL_EVIDENCE_SCHEMA,
    source_id: record.observation_id,
    source_schema: record.schema_version,
    source_sha256: sha256Object(record),
    image_sha256: record.source.image_sha256,
    captured_at: record.source.captured_at,
    symbol: contextValue(record.market_context.symbol, "symbol"),
    venue: contextValue(record.market_context.venue, "venue"),
    timeframe: contextValue(record.market_context.timeframe, "timeframe"),
    quality: {
      status: record.quality.status,
      reasons: [...record.quality.reasons],
      abstention_reason: record.quality.abstention_reason
    },
    visible_observations: record.visible_observations.map((item) => ({
      id: item.id,
      description: item.description,
      evidence_refs: [...item.evidence_refs]
    })),
    detector_summary: detectorSummary,
    counterevidence: [...record.counterevidence],
    uncertainties: [...record.uncertainties],
    alternative_explanations: [...record.alternative_explanations],
    compact_digest: record.compact_digest,
    safety: {
      mode: "SHADOW",
      execution_authority: "NONE",
      can_trade: false,
      capital_permission: "DENY",
      orders_allowed: false,
      signals_allowed: false
    }
  };
  return {
    ...body,
    evidence_sha256: sha256Object(body)
  };
}
