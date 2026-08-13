import { createHash } from "node:crypto";
import { validateIntentRecord } from "./intent-contract.js";
import {
  createUnknownDetectorReport,
  validateMarketDetectorReport
} from "./market-detector-contract.js";

const MARKET_SCHEMA_VERSION = "visionassist.market_observation.v1";
const MARKET_MODULE_IDENTITY = "TRADING_AGENT_VISUAL_PERCEPTION_LAYER";
const MARKET_MODALITIES = new Set(["chart_image", "dashboard"]);
const QUALITY_STATUSES = new Set(["PASS", "REVISE", "REJECT", "ABSTAIN"]);
const PROVENANCE = Object.freeze({
  PROVIDED: "PROVIDED_CONTEXT",
  UNKNOWN: "UNKNOWN"
});

export class MarketObservationContractError extends Error {
  constructor(message, { statusCode = 422, code = "market_observation_contract_error" } = {}) {
    super(message);
    this.name = "MarketObservationContractError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function requireCondition(condition, message, options) {
  if (!condition) {
    throw new MarketObservationContractError(message, options);
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeContextValue(value) {
  if (!isNonEmptyString(value)) {
    return { value: null, provenance: PROVENANCE.UNKNOWN };
  }
  return { value: value.trim(), provenance: PROVENANCE.PROVIDED };
}

export function normalizeMarketContext(context = {}) {
  requireCondition(isObject(context), "market_context must be an object", {
    statusCode: 400,
    code: "invalid_market_input"
  });

  return {
    symbol: normalizeContextValue(context.symbol),
    venue: normalizeContextValue(context.venue),
    timeframe: normalizeContextValue(context.timeframe)
  };
}

export function sha256Base64Image(imageBase64) {
  requireCondition(isNonEmptyString(imageBase64), "image must be a non-empty base64 string", {
    statusCode: 400,
    code: "invalid_market_input"
  });

  let bytes;
  try {
    bytes = Buffer.from(imageBase64, "base64");
  } catch {
    throw new MarketObservationContractError("image base64 is invalid", {
      statusCode: 400,
      code: "invalid_market_input"
    });
  }
  requireCondition(bytes.length > 0, "image base64 decodes to empty bytes", {
    statusCode: 400,
    code: "invalid_market_input"
  });
  return createHash("sha256").update(bytes).digest("hex");
}

function qualityFor(source, marketContext) {
  if (!MARKET_MODALITIES.has(source.modality)) {
    return {
      status: "REJECT",
      reasons: ["unsupported_market_modality"],
      drift_detected: false,
      abstention_reason: null
    };
  }

  const missing = Object.entries(marketContext)
    .filter(([, field]) => field.provenance === PROVENANCE.UNKNOWN)
    .map(([key]) => key);

  if (missing.length > 0) {
    return {
      status: "REVISE",
      reasons: missing.map((key) => `market_context_unknown:${key}`),
      drift_detected: false,
      abstention_reason: null
    };
  }

  return {
    status: "PASS",
    reasons: [],
    drift_detected: false,
    abstention_reason: null
  };
}

function sharedRefs(left = [], right = []) {
  const rightSet = new Set(right);
  return [...new Set(left.filter((item) => rightSet.has(item)))].sort();
}

function buildSceneGraph(visibleObservations, structureHypotheses) {
  const nodes = [
    ...visibleObservations.map((observation) => ({
      id: `obs:${observation.id}`,
      kind: "OBSERVATION",
      semantic_type: "GENERIC_VISUAL_EVIDENCE",
      label: observation.description,
      evidence_refs: [...observation.evidence_refs],
      confidence: null,
      grounded: true
    })),
    ...structureHypotheses.map((hypothesis) => ({
      id: `hyp:${hypothesis.id}`,
      kind: "HYPOTHESIS",
      semantic_type: "STRUCTURE_HYPOTHESIS",
      label: hypothesis.description,
      evidence_refs: [...hypothesis.evidence_refs],
      confidence: hypothesis.confidence,
      grounded: true
    }))
  ];

  const edges = [];
  for (const hypothesis of structureHypotheses) {
    for (const observation of visibleObservations) {
      const supportRefs = sharedRefs(observation.evidence_refs, hypothesis.evidence_refs);
      if (supportRefs.length > 0) {
        edges.push({
          id: `edge:${edges.length + 1}`,
          relation: "SUPPORTS",
          from_node_id: `obs:${observation.id}`,
          to_node_id: `hyp:${hypothesis.id}`,
          evidence_refs: supportRefs
        });
      }

      const contradictRefs = [
        ...sharedRefs(observation.evidence_refs, hypothesis.counterevidence_refs),
        ...(hypothesis.counterevidence_refs.includes(observation.id) ? [observation.id] : [])
      ];
      const uniqueContradictRefs = [...new Set(contradictRefs)].sort();
      if (uniqueContradictRefs.length > 0) {
        edges.push({
          id: `edge:${edges.length + 1}`,
          relation: "CONTRADICTS",
          from_node_id: `obs:${observation.id}`,
          to_node_id: `hyp:${hypothesis.id}`,
          evidence_refs: uniqueContradictRefs
        });
      }
    }
  }

  return {
    schema_version: "visionassist.scene_graph.v1",
    nodes,
    edges
  };
}

function renderCompactDigest(record) {
  const context = ["symbol", "venue", "timeframe"]
    .map((key) => {
      const field = record.market_context[key];
      return `${key}=${field.value ?? "UNKNOWN"}(${field.provenance})`;
    })
    .join(" ");
  const strongest = [...record.structure_hypotheses]
    .sort((a, b) => b.confidence - a.confidence)[0];
  const detectorDigest = record.detector_report.detectors
    .map((item) => `${item.detector_type}=${item.status}`)
    .join(" ");

  return [
    `[CONTEXT] ${context}`,
    `[HYPOTHESIS] ${strongest?.id ?? "UNKNOWN"} conf=${strongest?.confidence ?? "UNKNOWN"}`,
    `[SCENE_GRAPH] nodes=${record.scene_graph.nodes.length} edges=${record.scene_graph.edges.length}`,
    `[DETECTORS] ${detectorDigest}`,
    `[EVIDENCE] observations=${record.visible_observations.length} counterevidence=${record.counterevidence.length}`,
    `[UNCERTAINTY] count=${record.uncertainties.length}`,
    `[QUALITY] ${record.quality.status}`,
    "[SAFETY] DIAGNOSTIC_ONLY NO_ACTION HOLD DENY can_trade=false"
  ].join("\n");
}

export function adaptIntentToMarketObservation(intentRecord, {
  requestId,
  imageSha256,
  marketContext = {}
} = {}) {
  validateIntentRecord(intentRecord);
  requireCondition(isNonEmptyString(requestId), "request_id is required", {
    statusCode: 400,
    code: "invalid_market_input"
  });
  requireCondition(/^[a-f0-9]{64}$/i.test(String(imageSha256 ?? "")), "image_sha256 must be SHA-256", {
    statusCode: 400,
    code: "invalid_market_input"
  });

  const normalizedContext = normalizeMarketContext(marketContext);
  const source = {
    ...intentRecord.source,
    image_sha256: String(imageSha256).toLowerCase()
  };

  const visibleObservations = intentRecord.observations.map((observation) => ({
    id: observation.id,
    status: "VISIBLE_OBSERVATION",
    description: observation.description,
    evidence_refs: [...observation.evidence_refs]
  }));

  const structureHypotheses = intentRecord.intent_hypotheses.map((hypothesis) => ({
    id: hypothesis.id,
    status: "HYPOTHESIS",
    description: hypothesis.description,
    confidence: hypothesis.confidence,
    evidence_refs: [...hypothesis.evidence_refs],
    counterevidence_refs: [...hypothesis.counterevidence_refs],
    invalidation_conditions: [...hypothesis.invalidation_conditions]
  }));

  const sceneGraph = buildSceneGraph(visibleObservations, structureHypotheses);
  const detectorReport = createUnknownDetectorReport({
    requestId,
    source
  });
  const counterevidence = [...new Set(
    structureHypotheses.flatMap((hypothesis) => hypothesis.counterevidence_refs)
  )].sort();

  const record = {
    schema_version: MARKET_SCHEMA_VERSION,
    module_identity: MARKET_MODULE_IDENTITY,
    observation_id: `market:${requestId}`,
    request_id: requestId,
    source,
    market_context: normalizedContext,
    visible_observations: visibleObservations,
    structure_hypotheses: structureHypotheses,
    scene_graph: sceneGraph,
    detector_report: detectorReport,
    counterevidence,
    uncertainties: [...intentRecord.uncertainties],
    alternative_explanations: [...intentRecord.alternative_explanations],
    quality: qualityFor(source, normalizedContext),
    compact_digest: "",
    safety: {
      decision_status: "DIAGNOSTIC_ONLY",
      action_code: "NO_ACTION",
      execution_permission: "HOLD",
      capital_permission: "DENY",
      can_trade: false
    }
  };

  record.compact_digest = renderCompactDigest(record);
  validateMarketObservation(record);
  return record;
}

function validateContextField(field, path) {
  requireCondition(isObject(field), `${path} must be an object`);
  requireCondition(
    field.provenance === PROVENANCE.PROVIDED || field.provenance === PROVENANCE.UNKNOWN,
    `${path}.provenance is invalid`
  );
  if (field.provenance === PROVENANCE.PROVIDED) {
    requireCondition(isNonEmptyString(field.value), `${path}.value required for PROVIDED_CONTEXT`);
  } else {
    requireCondition(field.value === null, `${path}.value must be null for UNKNOWN`);
  }
}

export function validateMarketObservation(record) {
  requireCondition(isObject(record), "market observation must be an object");
  requireCondition(record.schema_version === MARKET_SCHEMA_VERSION, "wrong schema_version");
  requireCondition(record.module_identity === MARKET_MODULE_IDENTITY, "wrong module_identity");
  requireCondition(isNonEmptyString(record.observation_id), "observation_id is required");
  requireCondition(isNonEmptyString(record.request_id), "request_id is required");

  requireCondition(isObject(record.source), "source must be an object");
  requireCondition(isNonEmptyString(record.source.source_id), "source.source_id is required");
  requireCondition(MARKET_MODALITIES.has(record.source.modality), "source.modality must be chart_image or dashboard");
  requireCondition(/^[a-f0-9]{64}$/i.test(record.source.image_sha256), "source.image_sha256 must be SHA-256");

  requireCondition(isObject(record.market_context), "market_context must be an object");
  for (const key of ["symbol", "venue", "timeframe"]) {
    validateContextField(record.market_context[key], `market_context.${key}`);
  }

  requireCondition(Array.isArray(record.visible_observations) && record.visible_observations.length > 0, "visible observations required");
  for (const [index, observation] of record.visible_observations.entries()) {
    requireCondition(observation.status === "VISIBLE_OBSERVATION", `visible_observations[${index}] status invalid`);
    requireCondition(isNonEmptyString(observation.description), `visible_observations[${index}].description required`);
    requireCondition(Array.isArray(observation.evidence_refs) && observation.evidence_refs.length > 0, `visible_observations[${index}].evidence_refs required`);
  }

  requireCondition(Array.isArray(record.structure_hypotheses) && record.structure_hypotheses.length >= 2, "at least two structure hypotheses required");
  for (const [index, hypothesis] of record.structure_hypotheses.entries()) {
    requireCondition(hypothesis.status === "HYPOTHESIS", `structure_hypotheses[${index}] status invalid`);
    requireCondition(typeof hypothesis.confidence === "number" && hypothesis.confidence >= 0 && hypothesis.confidence <= 1, `structure_hypotheses[${index}].confidence invalid`);
    requireCondition(Array.isArray(hypothesis.evidence_refs) && hypothesis.evidence_refs.length > 0, `structure_hypotheses[${index}].evidence_refs required`);
    requireCondition(Array.isArray(hypothesis.counterevidence_refs), `structure_hypotheses[${index}].counterevidence_refs required`);
    requireCondition(Array.isArray(hypothesis.invalidation_conditions) && hypothesis.invalidation_conditions.length > 0, `structure_hypotheses[${index}].invalidation_conditions required`);
  }

  requireCondition(isObject(record.scene_graph), "scene_graph must be an object");
  requireCondition(record.scene_graph.schema_version === "visionassist.scene_graph.v1", "scene_graph schema_version invalid");
  requireCondition(Array.isArray(record.scene_graph.nodes) && record.scene_graph.nodes.length > 0, "scene_graph nodes required");
  requireCondition(Array.isArray(record.scene_graph.edges), "scene_graph edges must be an array");

  const nodeIds = new Set();
  for (const [index, node] of record.scene_graph.nodes.entries()) {
    requireCondition(isObject(node), `scene_graph.nodes[${index}] must be an object`);
    requireCondition(isNonEmptyString(node.id), `scene_graph.nodes[${index}].id required`);
    requireCondition(!nodeIds.has(node.id), `scene_graph.nodes[${index}].id must be unique`);
    nodeIds.add(node.id);
    requireCondition(node.kind === "OBSERVATION" || node.kind === "HYPOTHESIS", `scene_graph.nodes[${index}].kind invalid`);
    requireCondition(isNonEmptyString(node.semantic_type), `scene_graph.nodes[${index}].semantic_type required`);
    requireCondition(isNonEmptyString(node.label), `scene_graph.nodes[${index}].label required`);
    requireCondition(Array.isArray(node.evidence_refs) && node.evidence_refs.length > 0, `scene_graph.nodes[${index}].evidence_refs required`);
    requireCondition(node.grounded === true, `scene_graph.nodes[${index}] must be grounded`);
    if (node.kind === "OBSERVATION") {
      requireCondition(node.confidence === null, `scene_graph.nodes[${index}] observation confidence must be null`);
    } else {
      requireCondition(typeof node.confidence === "number" && node.confidence >= 0 && node.confidence <= 1, `scene_graph.nodes[${index}] hypothesis confidence invalid`);
    }
  }

  const edgeIds = new Set();
  for (const [index, edge] of record.scene_graph.edges.entries()) {
    requireCondition(isObject(edge), `scene_graph.edges[${index}] must be an object`);
    requireCondition(isNonEmptyString(edge.id) && !edgeIds.has(edge.id), `scene_graph.edges[${index}].id invalid`);
    edgeIds.add(edge.id);
    requireCondition(edge.relation === "SUPPORTS" || edge.relation === "CONTRADICTS", `scene_graph.edges[${index}].relation invalid`);
    requireCondition(nodeIds.has(edge.from_node_id), `scene_graph.edges[${index}].from_node_id unknown`);
    requireCondition(nodeIds.has(edge.to_node_id), `scene_graph.edges[${index}].to_node_id unknown`);
    requireCondition(Array.isArray(edge.evidence_refs) && edge.evidence_refs.length > 0, `scene_graph.edges[${index}].evidence_refs required`);
  }

  requireCondition(isObject(record.detector_report), "detector_report must be an object");
  const detectorValidation = validateMarketDetectorReport(record.detector_report);
  requireCondition(detectorValidation.can_trade === false, "detector_report can_trade must be false");
  requireCondition(detectorValidation.capital_permission === "DENY", "detector_report capital_permission must be DENY");

  requireCondition(Array.isArray(record.counterevidence), "counterevidence must be an array");
  requireCondition(Array.isArray(record.uncertainties) && record.uncertainties.length > 0, "uncertainties required");
  requireCondition(Array.isArray(record.alternative_explanations) && record.alternative_explanations.length > 0, "alternative explanations required");
  requireCondition(isObject(record.quality), "quality must be an object");
  requireCondition(QUALITY_STATUSES.has(record.quality.status), "quality.status invalid");
  requireCondition(record.quality.status !== "REJECT", "rejected market observation cannot validate");
  requireCondition(record.quality.drift_detected === false, "drift must fail closed");
  requireCondition(isNonEmptyString(record.compact_digest), "compact_digest required");

  requireCondition(isObject(record.safety), "safety must be an object");
  requireCondition(record.safety.decision_status === "DIAGNOSTIC_ONLY", "safety decision_status must be DIAGNOSTIC_ONLY");
  requireCondition(record.safety.action_code === "NO_ACTION", "safety action_code must be NO_ACTION");
  requireCondition(record.safety.execution_permission === "HOLD", "safety execution_permission must be HOLD");
  requireCondition(record.safety.capital_permission === "DENY", "safety capital_permission must be DENY");
  requireCondition(record.safety.can_trade === false, "safety can_trade must be false");

  return {
    valid: true,
    schema_version: MARKET_SCHEMA_VERSION,
    quality_status: record.quality.status,
    observation_count: record.visible_observations.length,
    hypothesis_count: record.structure_hypotheses.length,
    scene_node_count: record.scene_graph.nodes.length,
    scene_edge_count: record.scene_graph.edges.length,
    detector_count: record.detector_report.detectors.length,
    detector_quality_status: record.detector_report.quality.status,
    decision_status: "DIAGNOSTIC_ONLY",
    execution_permission: "HOLD",
    capital_permission: "DENY",
    can_trade: false
  };
}
