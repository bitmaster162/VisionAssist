import { createHash } from "node:crypto";

export const AGENT_CONSUMER_CONTRACT_VERSION = "visionassist.agent_consumer_contract.v1";
export const VISUAL_EVIDENCE_SCHEMA = "tradingos.visual_market_evidence.v1";
export const VISUAL_EVIDENCE_SOURCE_SCHEMA = "visionassist.market_observation.v1";

const TOP_LEVEL_KEYS = Object.freeze([
  "schema",
  "source_id",
  "source_schema",
  "source_sha256",
  "image_sha256",
  "captured_at",
  "symbol",
  "venue",
  "timeframe",
  "quality",
  "visible_observations",
  "detector_summary",
  "counterevidence",
  "uncertainties",
  "alternative_explanations",
  "compact_digest",
  "safety",
  "evidence_sha256",
  "trade_case_ref"
]);
const EVIDENCE_BODY_KEYS = Object.freeze(TOP_LEVEL_KEYS.filter(
  (key) => key !== "evidence_sha256" && key !== "trade_case_ref"
));
const SAFETY_KEYS = Object.freeze([
  "mode",
  "execution_authority",
  "can_trade",
  "capital_permission",
  "orders_allowed",
  "signals_allowed"
]);
const TRADE_CASE_REF_KEYS = Object.freeze(["source_id", "sha256", "schema"]);
const QUALITY_KEYS = Object.freeze(["status", "reasons", "abstention_reason"]);
const OBSERVATION_KEYS = Object.freeze(["id", "description", "evidence_refs"]);
const DETECTOR_KEYS = Object.freeze([
  "detector_type",
  "status",
  "orientation",
  "confidence",
  "evidence_refs",
  "counterevidence_refs",
  "invalidation_conditions"
]);
const DETECTOR_TYPES = new Set(["SFP", "CHOCH", "BOS", "SWEEP_RECLAIM"]);
const DETECTOR_STATUSES = new Set(["SUPPORTED", "CANDIDATE", "UNKNOWN", "REJECTED"]);
const DETECTOR_ORIENTATIONS = new Set(["UPSIDE", "DOWNSIDE", "NEUTRAL", "UNKNOWN"]);
const QUALITY_STATUSES = new Set(["PASS", "REVISE", "REJECT", "ABSTAIN"]);
const SHA256 = /^[a-f0-9]{64}$/;
const RFC3339_WITH_TZ = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/;

export class AgentConsumerContractError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "AgentConsumerContractError";
    this.code = code;
  }
}

function requireCondition(condition, code, message = code) {
  if (!condition) {
    throw new AgentConsumerContractError(code, message);
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function requireExactKeys(value, expectedKeys, path) {
  requireCondition(isObject(value), `${path}_not_object`, `${path} must be an object`);
  const expected = new Set(expectedKeys);
  for (const key of expectedKeys) {
    requireCondition(Object.hasOwn(value, key), `${path}_${key}_missing`, `${path}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    requireCondition(expected.has(key), `${path}_${key}_unexpected`, `${path}.${key} is not allowed`);
  }
}

function requireStringArray(value, path, { minItems = 0 } = {}) {
  requireCondition(Array.isArray(value), `${path}_not_array`, `${path} must be an array`);
  requireCondition(value.length >= minItems, `${path}_too_short`, `${path} requires at least ${minItems} item(s)`);
  value.forEach((item, index) => {
    requireCondition(nonEmpty(item), `${path}_${index}_empty`, `${path}[${index}] must be a non-empty string`);
  });
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

export function sha256CanonicalObject(value) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function evidenceBody(record) {
  const body = {};
  for (const key of EVIDENCE_BODY_KEYS) {
    body[key] = record[key];
  }
  return body;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function validateCapturedAt(value) {
  requireCondition(nonEmpty(value), "captured_at_missing", "captured_at must be a non-empty string");
  const match = RFC3339_WITH_TZ.exec(value);
  requireCondition(Boolean(match), "captured_at_not_rfc3339_tz", "captured_at must be strict RFC3339 with Z or numeric offset");

  const [, y, mo, d, h, mi, s, , zone, offH, offM] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);

  requireCondition(year >= 1 && year <= 9999, "captured_at_year_invalid");
  requireCondition(month >= 1 && month <= 12, "captured_at_month_invalid");
  requireCondition(day >= 1 && day <= daysInMonth(year, month), "captured_at_day_invalid");
  requireCondition(hour >= 0 && hour <= 23, "captured_at_hour_invalid");
  requireCondition(minute >= 0 && minute <= 59, "captured_at_minute_invalid");
  requireCondition(second >= 0 && second <= 59, "captured_at_second_invalid");
  if (zone !== "Z") {
    requireCondition(Number(offH) <= 23, "captured_at_offset_hour_invalid");
    requireCondition(Number(offM) <= 59, "captured_at_offset_minute_invalid");
  }
  requireCondition(Number.isFinite(Date.parse(value)), "captured_at_unparseable");
  return value;
}

function validateQuality(quality) {
  requireExactKeys(quality, QUALITY_KEYS, "quality");
  requireCondition(QUALITY_STATUSES.has(quality.status), "quality_status_invalid");
  requireStringArray(quality.reasons, "quality_reasons");
  requireCondition(
    quality.abstention_reason === null || nonEmpty(quality.abstention_reason),
    "quality_abstention_reason_invalid"
  );
}

function validateVisibleObservations(items) {
  requireCondition(Array.isArray(items) && items.length > 0, "visible_observations_missing");
  items.forEach((item, index) => {
    requireExactKeys(item, OBSERVATION_KEYS, `visible_observations_${index}`);
    requireCondition(nonEmpty(item.id), `visible_observations_${index}_id_invalid`);
    requireCondition(nonEmpty(item.description), `visible_observations_${index}_description_invalid`);
    requireStringArray(item.evidence_refs, `visible_observations_${index}_evidence_refs`, { minItems: 1 });
  });
}

function validateDetectorSummary(items) {
  requireCondition(Array.isArray(items) && items.length === DETECTOR_TYPES.size, "detector_summary_count_invalid");
  const seen = new Set();
  items.forEach((item, index) => {
    requireExactKeys(item, DETECTOR_KEYS, `detector_summary_${index}`);
    requireCondition(DETECTOR_TYPES.has(item.detector_type), `detector_summary_${index}_type_invalid`);
    requireCondition(!seen.has(item.detector_type), `detector_summary_${index}_type_duplicate`);
    seen.add(item.detector_type);
    requireCondition(DETECTOR_STATUSES.has(item.status), `detector_summary_${index}_status_invalid`);
    requireCondition(DETECTOR_ORIENTATIONS.has(item.orientation), `detector_summary_${index}_orientation_invalid`);
    requireCondition(
      item.confidence === null || (typeof item.confidence === "number" && Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1),
      `detector_summary_${index}_confidence_invalid`
    );
    requireStringArray(item.evidence_refs, `detector_summary_${index}_evidence_refs`);
    requireStringArray(item.counterevidence_refs, `detector_summary_${index}_counterevidence_refs`);
    requireStringArray(item.invalidation_conditions, `detector_summary_${index}_invalidation_conditions`);
  });
  for (const detectorType of DETECTOR_TYPES) {
    requireCondition(seen.has(detectorType), `detector_summary_${detectorType}_missing`);
  }
}

function validateSafety(safety) {
  requireExactKeys(safety, SAFETY_KEYS, "safety");
  requireCondition(safety.mode === "SHADOW", "unsafe_mode");
  requireCondition(safety.execution_authority === "NONE", "unsafe_execution_authority");
  requireCondition(safety.can_trade === false, "unsafe_can_trade");
  requireCondition(safety.capital_permission === "DENY", "unsafe_capital_permission");
  requireCondition(safety.orders_allowed === false, "unsafe_orders_allowed");
  requireCondition(safety.signals_allowed === false, "unsafe_signals_allowed");
}

export function validateAgentConsumerEvidence(record) {
  requireExactKeys(record, TOP_LEVEL_KEYS, "record");
  requireCondition(record.schema === VISUAL_EVIDENCE_SCHEMA, "wrong_schema");
  requireCondition(record.source_schema === VISUAL_EVIDENCE_SOURCE_SCHEMA, "wrong_source_schema");
  requireCondition(nonEmpty(record.source_id), "source_id_missing");
  requireCondition(SHA256.test(record.source_sha256), "source_sha256_invalid");
  requireCondition(SHA256.test(record.image_sha256), "image_sha256_invalid");
  validateCapturedAt(record.captured_at);
  for (const field of ["symbol", "venue", "timeframe", "compact_digest"]) {
    requireCondition(nonEmpty(record[field]), `${field}_missing`);
  }

  validateQuality(record.quality);
  validateVisibleObservations(record.visible_observations);
  validateDetectorSummary(record.detector_summary);
  requireStringArray(record.counterevidence, "counterevidence");
  requireStringArray(record.uncertainties, "uncertainties", { minItems: 1 });
  requireStringArray(record.alternative_explanations, "alternative_explanations", { minItems: 1 });
  validateSafety(record.safety);

  requireCondition(SHA256.test(record.evidence_sha256), "evidence_sha256_invalid");
  const recomputed = sha256CanonicalObject(evidenceBody(record));
  requireCondition(recomputed === record.evidence_sha256, "evidence_sha256_mismatch");

  requireExactKeys(record.trade_case_ref, TRADE_CASE_REF_KEYS, "trade_case_ref");
  requireCondition(record.trade_case_ref.source_id === record.source_id, "trade_case_ref_source_mismatch");
  requireCondition(record.trade_case_ref.sha256 === record.evidence_sha256, "trade_case_ref_sha_mismatch");
  requireCondition(record.trade_case_ref.schema === record.schema, "trade_case_ref_schema_mismatch");

  return {
    valid: true,
    contract_version: AGENT_CONSUMER_CONTRACT_VERSION,
    schema: record.schema,
    source_id: record.source_id,
    evidence_sha256: record.evidence_sha256,
    captured_at: record.captured_at,
    decision_authority: "NONE",
    execution_authority: "NONE",
    can_trade: false,
    capital_permission: "DENY"
  };
}
