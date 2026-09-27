const REPORT_SCHEMA_VERSION = "visionassist.market_detector_report.v1";
const MODULE_IDENTITY = "MARKET_STRUCTURE_DETECTOR_LAYER";
const DETECTOR_TYPES = new Set(["SFP", "CHOCH", "BOS", "SWEEP_RECLAIM"]);
const STATUSES = new Set(["SUPPORTED", "CANDIDATE", "UNKNOWN", "REJECTED"]);
const ORIENTATIONS = new Set(["UPSIDE", "DOWNSIDE", "NEUTRAL", "UNKNOWN"]);
const LEVEL_PROVENANCE = new Set([
  "VISIBLE_LABEL",
  "DERIVED_FROM_VISIBLE_GEOMETRY",
  "UNKNOWN"
]);
const QUALITY = new Set(["PASS", "REVISE", "ABSTAIN"]);

export class MarketDetectorContractError extends Error {
  constructor(message, { statusCode = 422, code = "market_detector_contract_error" } = {}) {
    super(message);
    this.name = "MarketDetectorContractError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireCondition(condition, message, options) {
  if (!condition) {
    throw new MarketDetectorContractError(message, options);
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function requireStringArray(value, path, { minItems = 0 } = {}) {
  requireCondition(Array.isArray(value), `${path} must be an array`);
  requireCondition(value.length >= minItems, `${path} requires at least ${minItems} item(s)`);
  value.forEach((item, index) => {
    requireCondition(nonEmpty(item), `${path}[${index}] must be a non-empty string`);
  });
}

function validateLevel(level, path) {
  requireCondition(isObject(level), `${path} must be an object`);
  requireCondition(LEVEL_PROVENANCE.has(level.provenance), `${path}.provenance invalid`);
  if (level.provenance === "UNKNOWN") {
    requireCondition(level.value === null, `${path}.value must be null when provenance is UNKNOWN`);
  } else {
    requireCondition(Number.isFinite(level.value), `${path}.value must be numeric when grounded`);
  }
}

function validateDetector(detector, index) {
  const path = `detectors[${index}]`;
  requireCondition(isObject(detector), `${path} must be an object`);
  requireCondition(nonEmpty(detector.detector_id), `${path}.detector_id required`);
  requireCondition(DETECTOR_TYPES.has(detector.detector_type), `${path}.detector_type invalid`);
  requireCondition(STATUSES.has(detector.status), `${path}.status invalid`);
  requireCondition(ORIENTATIONS.has(detector.orientation), `${path}.orientation invalid`);
  requireCondition(detector.description === null || nonEmpty(detector.description), `${path}.description invalid`);
  requireStringArray(detector.evidence_refs, `${path}.evidence_refs`);
  requireStringArray(detector.counterevidence_refs, `${path}.counterevidence_refs`);
  requireStringArray(detector.invalidation_conditions, `${path}.invalidation_conditions`);
  validateLevel(detector.level, `${path}.level`);
  requireCondition(
    detector.abstention_reason === null || nonEmpty(detector.abstention_reason),
    `${path}.abstention_reason invalid`
  );

  if (detector.status === "SUPPORTED" || detector.status === "CANDIDATE") {
    requireCondition(nonEmpty(detector.description), `${path}.description required for evidence-bearing status`);
    requireCondition(
      Number.isFinite(detector.confidence) && detector.confidence >= 0 && detector.confidence <= 1,
      `${path}.confidence must be evidence-bound 0..1`
    );
    requireStringArray(detector.evidence_refs, `${path}.evidence_refs`, { minItems: 1 });
    requireStringArray(detector.invalidation_conditions, `${path}.invalidation_conditions`, { minItems: 1 });
    requireCondition(detector.abstention_reason === null, `${path}.abstention_reason must be null`);
  } else if (detector.status === "UNKNOWN") {
    requireCondition(detector.confidence === null, `${path}.confidence must be null for UNKNOWN`);
    requireCondition(detector.orientation === "UNKNOWN", `${path}.orientation must be UNKNOWN`);
    requireCondition(nonEmpty(detector.abstention_reason), `${path}.abstention_reason required for UNKNOWN`);
  } else if (detector.status === "REJECTED") {
    requireCondition(detector.confidence === null, `${path}.confidence must be null for REJECTED`);
    requireStringArray(detector.counterevidence_refs, `${path}.counterevidence_refs`, { minItems: 1 });
    requireCondition(nonEmpty(detector.abstention_reason), `${path}.abstention_reason required for REJECTED`);
  }
}

export function validateMarketDetectorReport(report, { allowedEvidenceRefs = null } = {}) {
  requireCondition(isObject(report), "detector report must be an object");
  requireCondition(report.schema_version === REPORT_SCHEMA_VERSION, "wrong schema_version");
  requireCondition(report.module_identity === MODULE_IDENTITY, "wrong module_identity");
  requireCondition(nonEmpty(report.report_id), "report_id required");
  requireCondition(nonEmpty(report.request_id), "request_id required");

  requireCondition(isObject(report.source_binding), "source_binding must be an object");
  requireCondition(nonEmpty(report.source_binding.source_id), "source_binding.source_id required");
  requireCondition(
    /^[a-f0-9]{64}$/i.test(String(report.source_binding.image_sha256 ?? "")),
    "source_binding.image_sha256 must be SHA-256"
  );
  requireCondition(
    report.source_binding.captured_at === null || nonEmpty(report.source_binding.captured_at),
    "source_binding.captured_at invalid"
  );

  requireCondition(Array.isArray(report.detectors) && report.detectors.length > 0, "detectors required");
  requireCondition(report.detectors.length === DETECTOR_TYPES.size, "detectors must contain exactly one result per detector type");
  const allowed = allowedEvidenceRefs == null ? null : new Set(allowedEvidenceRefs);
  const ids = new Set();
  const types = new Set();
  report.detectors.forEach((detector, index) => {
    validateDetector(detector, index);
    requireCondition(!ids.has(detector.detector_id), `detectors[${index}].detector_id must be unique`);
    ids.add(detector.detector_id);
    requireCondition(!types.has(detector.detector_type), `detectors[${index}].detector_type must be unique`);
    types.add(detector.detector_type);
    if (allowed) {
      for (const ref of [...detector.evidence_refs, ...detector.counterevidence_refs]) {
        requireCondition(allowed.has(ref), `detectors[${index}] references unknown evidence: ${ref}`);
      }
    }
  });

  for (const detectorType of DETECTOR_TYPES) {
    requireCondition(types.has(detectorType), `missing detector type: ${detectorType}`);
  }

  requireCondition(isObject(report.quality), "quality must be an object");
  requireCondition(QUALITY.has(report.quality.status), "quality.status invalid");
  requireStringArray(report.quality.reasons, "quality.reasons");
  const unknownCount = report.detectors.filter((detector) => detector.status === "UNKNOWN").length;
  if (report.quality.status === "PASS") {
    requireCondition(unknownCount === 0, "PASS quality cannot contain UNKNOWN detectors");
  }
  if (report.quality.status === "ABSTAIN") {
    requireCondition(
      report.detectors.some((detector) => detector.status === "UNKNOWN"),
      "ABSTAIN quality requires at least one UNKNOWN detector"
    );
  }

  requireCondition(isObject(report.safety), "safety must be an object");
  requireCondition(report.safety.decision_status === "DIAGNOSTIC_ONLY", "decision_status must be DIAGNOSTIC_ONLY");
  requireCondition(report.safety.action_code === "NO_ACTION", "action_code must be NO_ACTION");
  requireCondition(report.safety.execution_permission === "HOLD", "execution_permission must be HOLD");
  requireCondition(report.safety.capital_permission === "DENY", "capital_permission must be DENY");
  requireCondition(report.safety.can_trade === false, "can_trade must be false");

  return {
    valid: true,
    schema_version: REPORT_SCHEMA_VERSION,
    detector_count: report.detectors.length,
    supported_count: report.detectors.filter((item) => item.status === "SUPPORTED").length,
    candidate_count: report.detectors.filter((item) => item.status === "CANDIDATE").length,
    unknown_count: report.detectors.filter((item) => item.status === "UNKNOWN").length,
    rejected_count: report.detectors.filter((item) => item.status === "REJECTED").length,
    quality_status: report.quality.status,
    can_trade: false,
    capital_permission: "DENY"
  };
}

export function collectAllowedEvidenceRefs(marketObservation) {
  requireCondition(isObject(marketObservation), "market observation required");
  const refs = new Set();
  for (const observation of marketObservation.visible_observations ?? []) {
    if (nonEmpty(observation?.id)) refs.add(observation.id);
    for (const ref of observation?.evidence_refs ?? []) {
      if (nonEmpty(ref)) refs.add(ref);
    }
  }
  for (const hypothesis of marketObservation.structure_hypotheses ?? []) {
    for (const ref of hypothesis?.evidence_refs ?? []) {
      if (nonEmpty(ref)) refs.add(ref);
    }
    for (const ref of hypothesis?.counterevidence_refs ?? []) {
      if (nonEmpty(ref)) refs.add(ref);
    }
  }
  return [...refs].sort();
}

export function bindDetectorModelPayload(modelPayload, { requestId, source, allowedEvidenceRefs }) {
  requireCondition(isObject(modelPayload), "model detector payload must be an object", {
    statusCode: 502,
    code: "detector_model_contract_violation"
  });
  requireCondition(Array.isArray(modelPayload.detectors), "model detector payload.detectors required", {
    statusCode: 502,
    code: "detector_model_contract_violation"
  });
  requireCondition(isObject(modelPayload.quality), "model detector payload.quality required", {
    statusCode: 502,
    code: "detector_model_contract_violation"
  });

  const report = {
    schema_version: REPORT_SCHEMA_VERSION,
    module_identity: MODULE_IDENTITY,
    report_id: `detectors:${requestId}`,
    request_id: requestId,
    source_binding: {
      source_id: source.source_id,
      image_sha256: String(source.image_sha256 ?? "").toLowerCase(),
      captured_at: source.captured_at ?? null
    },
    detectors: structuredClone(modelPayload.detectors),
    quality: structuredClone(modelPayload.quality),
    safety: {
      decision_status: "DIAGNOSTIC_ONLY",
      action_code: "NO_ACTION",
      execution_permission: "HOLD",
      capital_permission: "DENY",
      can_trade: false
    }
  };

  validateMarketDetectorReport(report, { allowedEvidenceRefs });
  return report;
}

export function createUnknownDetectorReport({ requestId, source }) {
  requireCondition(nonEmpty(requestId), "request_id required", {
    statusCode: 400,
    code: "invalid_detector_input"
  });
  requireCondition(isObject(source), "source required", {
    statusCode: 400,
    code: "invalid_detector_input"
  });

  const detectors = [...DETECTOR_TYPES].map((detectorType, index) => ({
    detector_id: `detector:${index + 1}`,
    detector_type: detectorType,
    status: "UNKNOWN",
    orientation: "UNKNOWN",
    description: null,
    confidence: null,
    evidence_refs: [],
    counterevidence_refs: [],
    invalidation_conditions: [],
    level: { value: null, provenance: "UNKNOWN" },
    abstention_reason: "detector inference has not been executed"
  }));

  const report = {
    schema_version: REPORT_SCHEMA_VERSION,
    module_identity: MODULE_IDENTITY,
    report_id: `detectors:${requestId}`,
    request_id: requestId,
    source_binding: {
      source_id: source.source_id,
      image_sha256: String(source.image_sha256 ?? "").toLowerCase(),
      captured_at: source.captured_at ?? null
    },
    detectors,
    quality: {
      status: "ABSTAIN",
      reasons: ["detector_inference_not_executed"]
    },
    safety: {
      decision_status: "DIAGNOSTIC_ONLY",
      action_code: "NO_ACTION",
      execution_permission: "HOLD",
      capital_permission: "DENY",
      can_trade: false
    }
  };

  validateMarketDetectorReport(report);
  return report;
}
