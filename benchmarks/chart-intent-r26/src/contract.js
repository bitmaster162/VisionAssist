import path from "node:path";

import { validateIntentRecord } from "../../../services/edge/src/intent-contract.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const LABEL_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CASE_PATTERN = /^(MKT|VIS)-(\d{3})$/;
const PRE_OUTCOME_PHASES = new Set([
  "human_prior",
  "ai_assessment",
  "fusion_revision"
]);

const AUTHORITY = Object.freeze({
  decision_status: "DIAGNOSTIC_ONLY",
  action_code: "NO_ACTION",
  execution_permission: "HOLD",
  capital_permission: "DENY",
  can_trade: false
});

export class BenchmarkContractError extends Error {
  constructor(message, code = "benchmark_contract_error") {
    super(message);
    this.name = "BenchmarkContractError";
    this.code = code;
  }
}

function requireCondition(condition, message, code) {
  if (!condition) {
    throw new BenchmarkContractError(message, code);
  }
}

function requireObject(value, pathName) {
  requireCondition(
    value && typeof value === "object" && !Array.isArray(value),
    `${pathName} must be an object`
  );
}

function requireExactKeys(value, keys, pathName) {
  requireObject(value, pathName);
  const expected = new Set(keys);

  for (const key of keys) {
    requireCondition(Object.hasOwn(value, key), `${pathName}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    requireCondition(expected.has(key), `${pathName}.${key} is not allowed`);
  }
}

function requireString(value, pathName, { nullable = false } = {}) {
  if (nullable && value === null) {
    return;
  }
  requireCondition(
    typeof value === "string" && value.trim().length > 0,
    `${pathName} must be a non-empty string`
  );
}

function requireBoolean(value, pathName) {
  requireCondition(typeof value === "boolean", `${pathName} must be boolean`);
}

function requireNumber(value, pathName, minimum = 0, maximum = 1) {
  requireCondition(
    typeof value === "number" &&
      Number.isFinite(value) &&
      value >= minimum &&
      value <= maximum,
    `${pathName} must be between ${minimum} and ${maximum}`
  );
}

function requireInteger(value, pathName, minimum, maximum) {
  requireCondition(
    Number.isInteger(value) && value >= minimum && value <= maximum,
    `${pathName} must be an integer between ${minimum} and ${maximum}`
  );
}

function requireTimestamp(value, pathName) {
  requireString(value, pathName);
  requireCondition(!Number.isNaN(Date.parse(value)), `${pathName} must be an ISO timestamp`);
}

function requireHash(value, pathName) {
  requireCondition(
    typeof value === "string" && HASH_PATTERN.test(value),
    `${pathName} must be a lowercase SHA-256 digest`
  );
}

function requireStringArray(value, pathName, minItems = 0) {
  requireCondition(Array.isArray(value), `${pathName} must be an array`);
  requireCondition(
    value.length >= minItems,
    `${pathName} requires at least ${minItems} item(s)`
  );
  value.forEach((item, index) => requireString(item, `${pathName}[${index}]`));
}

function requireUnique(values, pathName) {
  requireCondition(
    new Set(values).size === values.length,
    `${pathName} must not contain duplicates`
  );
}

function requireRelativeAssetPath(value, pathName) {
  requireString(value, pathName);
  requireCondition(!path.isAbsolute(value), `${pathName} must be relative`);
  const normalized = path.normalize(value);
  requireCondition(
    !normalized.startsWith("..") && !normalized.includes(`..${path.sep}`),
    `${pathName} must stay inside the case directory`
  );
}

export function getExpectedSlot(caseId) {
  const match = CASE_PATTERN.exec(caseId);
  requireCondition(match, "case_id must match MKT-001..060 or VIS-001..015");

  const index = Number.parseInt(match[2], 10);
  const isMarket = match[1] === "MKT";
  const maximum = isMarket ? 60 : 15;
  requireCondition(index >= 1 && index <= maximum, `${caseId} is outside the frozen slot roster`);

  return {
    domain: isMarket ? "market" : "non_market_visual",
    split: isMarket
      ? (index <= 45 ? "development" : "blinded_holdout")
      : (index <= 10 ? "development" : "blinded_holdout"),
    allowedModalities: isMarket
      ? new Set(["chart_image", "dashboard"])
      : new Set(["scene_image", "document", "ui", "dashboard"])
  };
}

function validateAuthority(authority, pathName = "authority") {
  requireExactKeys(authority, Object.keys(AUTHORITY), pathName);
  for (const [key, expected] of Object.entries(AUTHORITY)) {
    requireCondition(authority[key] === expected, `${pathName}.${key} must remain ${expected}`);
  }
}

export function validateCaseManifest(record) {
  requireExactKeys(record, [
    "schema_version",
    "case_id",
    "domain",
    "split",
    "modality",
    "sampling",
    "evidence",
    "outcome_definition",
    "roles",
    "outcome_commitment_sha256",
    "created_at",
    "authority"
  ], "case");
  requireCondition(
    record.schema_version === "visionassist.benchmark.case.v1",
    "wrong case schema_version"
  );

  const slot = getExpectedSlot(record.case_id);
  requireCondition(record.domain === slot.domain, "case domain does not match slot");
  requireCondition(record.split === slot.split, "case split does not match slot");
  requireCondition(slot.allowedModalities.has(record.modality), "case modality is not allowed");

  requireExactKeys(record.sampling, [
    "candidate_id",
    "protocol_id",
    "source_family",
    "stratum",
    "timeframe",
    "selected_without_outcome_access"
  ], "case.sampling");
  requireString(record.sampling.candidate_id, "case.sampling.candidate_id");
  requireString(record.sampling.protocol_id, "case.sampling.protocol_id");
  requireString(record.sampling.source_family, "case.sampling.source_family");
  requireString(record.sampling.stratum, "case.sampling.stratum");
  requireString(record.sampling.timeframe, "case.sampling.timeframe", {
    nullable: true
  });
  requireCondition(
    record.sampling.selected_without_outcome_access === true,
    "case must be selected without outcome access"
  );
  if (record.domain === "market") {
    requireString(record.sampling.timeframe, "case.sampling.timeframe");
  }

  requireExactKeys(record.evidence, [
    "asset_path",
    "sha256",
    "captured_at",
    "cutoff_description",
    "provenance"
  ], "case.evidence");
  requireRelativeAssetPath(record.evidence.asset_path, "case.evidence.asset_path");
  requireHash(record.evidence.sha256, "case.evidence.sha256");
  requireTimestamp(record.evidence.captured_at, "case.evidence.captured_at");
  requireString(record.evidence.cutoff_description, "case.evidence.cutoff_description");
  requireString(record.evidence.provenance, "case.evidence.provenance");

  requireExactKeys(record.outcome_definition, [
    "labels",
    "horizon",
    "resolution_rule",
    "should_abstain_rule"
  ], "case.outcome_definition");
  requireStringArray(record.outcome_definition.labels, "case.outcome_definition.labels", 2);
  requireUnique(record.outcome_definition.labels, "case.outcome_definition.labels");
  for (const label of record.outcome_definition.labels) {
    requireCondition(LABEL_PATTERN.test(label), `invalid outcome label ${label}`);
  }
  requireString(record.outcome_definition.horizon, "case.outcome_definition.horizon");
  requireString(record.outcome_definition.resolution_rule, "case.outcome_definition.resolution_rule");
  requireString(
    record.outcome_definition.should_abstain_rule,
    "case.outcome_definition.should_abstain_rule"
  );

  requireExactKeys(record.roles, [
    "curator_id",
    "outcome_custodian_id",
    "human_analyst_id",
    "adjudicator_id"
  ], "case.roles");
  Object.entries(record.roles).forEach(([key, value]) =>
    requireString(value, `case.roles.${key}`)
  );
  requireCondition(
    record.roles.outcome_custodian_id !== record.roles.human_analyst_id,
    "outcome custodian and human analyst must be different"
  );
  requireCondition(
    record.roles.adjudicator_id !== record.roles.human_analyst_id,
    "adjudicator and human analyst must be different"
  );
  requireCondition(
    record.roles.adjudicator_id !== record.roles.outcome_custodian_id,
    "adjudicator and outcome custodian must be different"
  );

  requireHash(record.outcome_commitment_sha256, "case.outcome_commitment_sha256");
  requireTimestamp(record.created_at, "case.created_at");
  validateAuthority(record.authority, "case.authority");
  return record;
}

export function validateForecast(forecast, outcomeLabels, pathName = "forecast") {
  requireExactKeys(forecast, [
    "probabilities",
    "abstain",
    "abstention_reason"
  ], pathName);
  requireCondition(Array.isArray(forecast.probabilities), `${pathName}.probabilities must be an array`);
  requireCondition(
    forecast.probabilities.length === outcomeLabels.length,
    `${pathName}.probabilities must cover every outcome label`
  );

  const labels = [];
  let total = 0;
  forecast.probabilities.forEach((entry, index) => {
    const entryPath = `${pathName}.probabilities[${index}]`;
    requireExactKeys(entry, ["label", "probability"], entryPath);
    requireCondition(outcomeLabels.includes(entry.label), `${entryPath}.label is unknown`);
    requireNumber(entry.probability, `${entryPath}.probability`);
    labels.push(entry.label);
    total += entry.probability;
  });
  requireUnique(labels, `${pathName}.probabilities labels`);
  requireCondition(
    outcomeLabels.every((label) => labels.includes(label)),
    `${pathName}.probabilities must include all labels`
  );
  requireCondition(
    Math.abs(total - 1) <= 1e-9,
    `${pathName}.probabilities must sum to 1`
  );

  requireBoolean(forecast.abstain, `${pathName}.abstain`);
  requireString(forecast.abstention_reason, `${pathName}.abstention_reason`, {
    nullable: true
  });
  if (forecast.abstain) {
    requireString(forecast.abstention_reason, `${pathName}.abstention_reason`);
  } else {
    requireCondition(
      forecast.abstention_reason === null,
      `${pathName}.abstention_reason must be null when abstain=false`
    );
  }
  return forecast;
}

function validateHumanPrior(record, context) {
  requireExactKeys(record, [
    "schema_version",
    "case_id",
    "analyst_id",
    "recorded_at",
    "interpretation",
    "competing_hypotheses",
    "outcome_forecast",
    "confidence",
    "outcome_unseen_attestation",
    "ai_unseen_attestation"
  ], "human_prior");
  requireCondition(
    record.schema_version === "visionassist.benchmark.human-prior.v1",
    "wrong human prior schema_version"
  );
  requireCondition(record.case_id === context.caseManifest.case_id, "human prior case mismatch");
  requireCondition(
    record.analyst_id === context.caseManifest.roles.human_analyst_id,
    "human prior analyst mismatch"
  );
  requireTimestamp(record.recorded_at, "human_prior.recorded_at");
  requireString(record.interpretation, "human_prior.interpretation");
  requireStringArray(record.competing_hypotheses, "human_prior.competing_hypotheses", 1);
  validateForecast(
    record.outcome_forecast,
    context.caseManifest.outcome_definition.labels,
    "human_prior.outcome_forecast"
  );
  requireNumber(record.confidence, "human_prior.confidence");
  requireCondition(record.outcome_unseen_attestation === true, "human prior outcome must remain unseen");
  requireCondition(record.ai_unseen_attestation === true, "human prior AI output must remain unseen");
}

function validateAiAssessment(record, context) {
  requireExactKeys(record, [
    "schema_version",
    "case_id",
    "run_id",
    "model",
    "prompt_version",
    "recorded_at",
    "intent_record",
    "outcome_forecast",
    "outcome_unseen_attestation",
    "human_prior_unseen_attestation",
    "baseline_unseen_attestation"
  ], "ai_assessment");
  requireCondition(
    record.schema_version === "visionassist.benchmark.ai-assessment.v1",
    "wrong AI assessment schema_version"
  );
  requireCondition(record.case_id === context.caseManifest.case_id, "AI assessment case mismatch");
  requireString(record.run_id, "ai_assessment.run_id");
  requireString(record.model, "ai_assessment.model");
  requireString(record.prompt_version, "ai_assessment.prompt_version");
  requireTimestamp(record.recorded_at, "ai_assessment.recorded_at");
  validateIntentRecord(record.intent_record);
  requireCondition(
    record.intent_record.source.source_id === context.caseManifest.case_id,
    "AI intent source must equal case_id"
  );
  requireCondition(
    record.intent_record.source.modality === context.caseManifest.modality,
    "AI intent modality must equal case modality"
  );
  requireCondition(
    record.intent_record.human_context.present === false &&
      record.intent_record.fusion_status === "AI_ONLY_INCOMPLETE",
    "AI-only assessment must not contain human context"
  );
  validateForecast(
    record.outcome_forecast,
    context.caseManifest.outcome_definition.labels,
    "ai_assessment.outcome_forecast"
  );
  requireCondition(record.outcome_unseen_attestation === true, "AI outcome must remain unseen");
  requireCondition(
    record.human_prior_unseen_attestation === true,
    "AI assessment must not see human prior"
  );
  requireCondition(
    record.baseline_unseen_attestation === true,
    "AI assessment must not see baseline output"
  );
}

function validateFusionRevision(record, context) {
  requireExactKeys(record, [
    "schema_version",
    "case_id",
    "analyst_id",
    "recorded_at",
    "revised_interpretation",
    "adopted_ai_hypothesis_ids",
    "rejected_ai_hypothesis_ids",
    "new_hypotheses",
    "outcome_forecast",
    "confidence",
    "change_rationale",
    "outcome_unseen_attestation",
    "ai_assessment_seen_attestation"
  ], "fusion_revision");
  requireCondition(
    record.schema_version === "visionassist.benchmark.fusion-revision.v1",
    "wrong fusion revision schema_version"
  );
  requireCondition(record.case_id === context.caseManifest.case_id, "fusion case mismatch");
  requireCondition(
    record.analyst_id === context.caseManifest.roles.human_analyst_id,
    "fusion analyst mismatch"
  );
  requireTimestamp(record.recorded_at, "fusion_revision.recorded_at");
  requireString(record.revised_interpretation, "fusion_revision.revised_interpretation");
  requireStringArray(
    record.adopted_ai_hypothesis_ids,
    "fusion_revision.adopted_ai_hypothesis_ids"
  );
  requireStringArray(
    record.rejected_ai_hypothesis_ids,
    "fusion_revision.rejected_ai_hypothesis_ids"
  );
  requireStringArray(record.new_hypotheses, "fusion_revision.new_hypotheses");
  const aiHypothesisIds = new Set(
    context.aiAssessment.intent_record.intent_hypotheses.map((hypothesis) => hypothesis.id)
  );
  const reviewedIds = [
    ...record.adopted_ai_hypothesis_ids,
    ...record.rejected_ai_hypothesis_ids
  ];
  requireUnique(reviewedIds, "fusion_revision reviewed AI hypothesis ids");
  reviewedIds.forEach((id) =>
    requireCondition(aiHypothesisIds.has(id), `fusion revision references unknown hypothesis ${id}`)
  );
  requireCondition(
    aiHypothesisIds.size === reviewedIds.length,
    "fusion revision must adopt or reject every AI hypothesis"
  );
  validateForecast(
    record.outcome_forecast,
    context.caseManifest.outcome_definition.labels,
    "fusion_revision.outcome_forecast"
  );
  requireNumber(record.confidence, "fusion_revision.confidence");
  requireString(record.change_rationale, "fusion_revision.change_rationale");
  requireCondition(
    record.outcome_unseen_attestation === true,
    "fusion revision outcome must remain unseen"
  );
  requireCondition(
    record.ai_assessment_seen_attestation === true,
    "fusion revision must attest that AI assessment was seen"
  );
}

function validateBaseline(record, context) {
  requireExactKeys(record, [
    "schema_version",
    "case_id",
    "applicable",
    "classifier_id",
    "classifier_version",
    "recorded_at",
    "outcome_forecast",
    "outcome_unseen_attestation",
    "human_prior_unseen_attestation",
    "ai_assessment_unseen_attestation"
  ], "baseline_forecast");
  requireCondition(
    record.schema_version === "visionassist.benchmark.baseline-forecast.v1",
    "wrong baseline schema_version"
  );
  requireCondition(record.case_id === context.caseManifest.case_id, "baseline case mismatch");
  requireBoolean(record.applicable, "baseline_forecast.applicable");
  requireTimestamp(record.recorded_at, "baseline_forecast.recorded_at");
  requireCondition(
    record.outcome_unseen_attestation === true &&
      record.human_prior_unseen_attestation === true &&
      record.ai_assessment_unseen_attestation === true,
    "baseline must remain blind to outcome, human prior, and AI assessment"
  );

  const shouldApply = context.caseManifest.domain === "market";
  requireCondition(record.applicable === shouldApply, "baseline applicability does not match domain");
  if (record.applicable) {
    requireString(record.classifier_id, "baseline_forecast.classifier_id");
    requireString(record.classifier_version, "baseline_forecast.classifier_version");
    validateForecast(
      record.outcome_forecast,
      context.caseManifest.outcome_definition.labels,
      "baseline_forecast.outcome_forecast"
    );
  } else {
    requireCondition(record.classifier_id === null, "non-market classifier_id must be null");
    requireCondition(record.classifier_version === null, "non-market classifier_version must be null");
    requireCondition(record.outcome_forecast === null, "non-market baseline forecast must be null");
  }
}

export function validateOutcome(record, caseManifest) {
  requireExactKeys(record, [
    "schema_version",
    "case_id",
    "custodian_id",
    "sealed_at",
    "outcome_label",
    "outcome_summary",
    "observation_window",
    "should_abstain",
    "evidence_refs"
  ], "outcome");
  requireCondition(
    record.schema_version === "visionassist.benchmark.outcome.v1",
    "wrong outcome schema_version"
  );
  requireCondition(record.case_id === caseManifest.case_id, "outcome case mismatch");
  requireCondition(
    record.custodian_id === caseManifest.roles.outcome_custodian_id,
    "outcome custodian mismatch"
  );
  requireTimestamp(record.sealed_at, "outcome.sealed_at");
  requireCondition(
    caseManifest.outcome_definition.labels.includes(record.outcome_label),
    "outcome label is outside case outcome space"
  );
  requireString(record.outcome_summary, "outcome.outcome_summary");
  requireString(record.observation_window, "outcome.observation_window");
  requireBoolean(record.should_abstain, "outcome.should_abstain");
  requireStringArray(record.evidence_refs, "outcome.evidence_refs", 1);
}

function validateAdjudication(record, context) {
  requireExactKeys(record, [
    "schema_version",
    "case_id",
    "adjudicator_id",
    "recorded_at",
    "evidence_grounding",
    "reference_alternatives",
    "counterevidence_quality",
    "invalidation_quality",
    "hindsight_leakage_flags",
    "notes"
  ], "adjudication");
  requireCondition(
    record.schema_version === "visionassist.benchmark.adjudication.v1",
    "wrong adjudication schema_version"
  );
  requireCondition(record.case_id === context.caseManifest.case_id, "adjudication case mismatch");
  requireCondition(
    record.adjudicator_id === context.caseManifest.roles.adjudicator_id,
    "adjudicator identity mismatch"
  );
  requireTimestamp(record.recorded_at, "adjudication.recorded_at");

  requireExactKeys(record.evidence_grounding, [
    "supported_observation_ids",
    "unsupported_observation_ids"
  ], "adjudication.evidence_grounding");
  requireStringArray(
    record.evidence_grounding.supported_observation_ids,
    "adjudication.evidence_grounding.supported_observation_ids"
  );
  requireStringArray(
    record.evidence_grounding.unsupported_observation_ids,
    "adjudication.evidence_grounding.unsupported_observation_ids"
  );
  const observationIds = context.aiAssessment.intent_record.observations.map(
    (observation) => observation.id
  );
  const groundedIds = [
    ...record.evidence_grounding.supported_observation_ids,
    ...record.evidence_grounding.unsupported_observation_ids
  ];
  requireUnique(groundedIds, "adjudication evidence-grounding ids");
  requireCondition(
    groundedIds.length === observationIds.length &&
      groundedIds.every((id) => observationIds.includes(id)),
    "adjudication must classify every AI observation exactly once"
  );

  requireCondition(
    Array.isArray(record.reference_alternatives) && record.reference_alternatives.length >= 1,
    "adjudication.reference_alternatives requires at least one item"
  );
  const aiHypothesisIds = new Set(
    context.aiAssessment.intent_record.intent_hypotheses.map((hypothesis) => hypothesis.id)
  );
  const alternativeIds = [];
  record.reference_alternatives.forEach((alternative, index) => {
    const itemPath = `adjudication.reference_alternatives[${index}]`;
    requireExactKeys(
      alternative,
      ["id", "description", "covered_by_ai_hypothesis_ids"],
      itemPath
    );
    requireString(alternative.id, `${itemPath}.id`);
    requireString(alternative.description, `${itemPath}.description`);
    requireStringArray(
      alternative.covered_by_ai_hypothesis_ids,
      `${itemPath}.covered_by_ai_hypothesis_ids`
    );
    requireUnique(
      alternative.covered_by_ai_hypothesis_ids,
      `${itemPath}.covered_by_ai_hypothesis_ids`
    );
    alternative.covered_by_ai_hypothesis_ids.forEach((id) =>
      requireCondition(aiHypothesisIds.has(id), `${itemPath} references unknown AI hypothesis ${id}`)
    );
    alternativeIds.push(alternative.id);
  });
  requireUnique(alternativeIds, "adjudication.reference_alternatives ids");

  for (const field of ["counterevidence_quality", "invalidation_quality"]) {
    requireExactKeys(record[field], ["score_0_to_4", "rationale"], `adjudication.${field}`);
    requireInteger(record[field].score_0_to_4, `adjudication.${field}.score_0_to_4`, 0, 4);
    requireString(record[field].rationale, `adjudication.${field}.rationale`);
  }

  requireCondition(
    Array.isArray(record.hindsight_leakage_flags),
    "adjudication.hindsight_leakage_flags must be an array"
  );
  record.hindsight_leakage_flags.forEach((flag, index) => {
    const flagPath = `adjudication.hindsight_leakage_flags[${index}]`;
    requireExactKeys(flag, ["phase", "evidence"], flagPath);
    requireCondition(PRE_OUTCOME_PHASES.has(flag.phase), `${flagPath}.phase is invalid`);
    requireString(flag.evidence, `${flagPath}.evidence`);
  });
  requireString(record.notes, "adjudication.notes", { nullable: true });
}

function topForecastLabel(forecast) {
  return [...forecast.probabilities]
    .sort((left, right) =>
      right.probability - left.probability ||
        (left.label < right.label ? -1 : left.label > right.label ? 1 : 0)
    )[0].label;
}

function validatePostOutcomeReview(record, context) {
  requireExactKeys(record, [
    "schema_version",
    "case_id",
    "analyst_id",
    "recorded_at",
    "original_fusion_top1_label",
    "original_fusion_was_correct",
    "acknowledged_error",
    "corrected_interpretation",
    "error_tags",
    "correction_quality_score_0_to_4",
    "outcome_seen_attestation"
  ], "post_outcome_review");
  requireCondition(
    record.schema_version === "visionassist.benchmark.post-outcome-review.v1",
    "wrong post-outcome review schema_version"
  );
  requireCondition(record.case_id === context.caseManifest.case_id, "post-outcome case mismatch");
  requireCondition(
    record.analyst_id === context.caseManifest.roles.human_analyst_id,
    "post-outcome analyst mismatch"
  );
  requireTimestamp(record.recorded_at, "post_outcome_review.recorded_at");

  const topLabel = topForecastLabel(context.fusionRevision.outcome_forecast);
  const wasCorrect =
    !context.fusionRevision.outcome_forecast.abstain &&
    topLabel === context.outcome.outcome_label;
  requireCondition(
    record.original_fusion_top1_label === topLabel,
    "post-outcome review must preserve original fusion top-1 label"
  );
  requireCondition(
    record.original_fusion_was_correct === wasCorrect,
    "post-outcome correctness does not match frozen fusion forecast"
  );
  requireBoolean(record.acknowledged_error, "post_outcome_review.acknowledged_error");
  requireString(
    record.corrected_interpretation,
    "post_outcome_review.corrected_interpretation",
    { nullable: true }
  );
  requireStringArray(record.error_tags, "post_outcome_review.error_tags");
  requireCondition(
    record.correction_quality_score_0_to_4 === null ||
      (Number.isInteger(record.correction_quality_score_0_to_4) &&
        record.correction_quality_score_0_to_4 >= 0 &&
        record.correction_quality_score_0_to_4 <= 4),
    "post_outcome_review.correction_quality_score_0_to_4 must be 0..4 or null"
  );
  requireCondition(
    record.outcome_seen_attestation === true,
    "post-outcome review must attest outcome reveal"
  );

  if (wasCorrect) {
    requireCondition(record.acknowledged_error === false, "correct fusion cannot acknowledge an error");
    requireCondition(record.corrected_interpretation === null, "correct fusion needs no correction");
    requireCondition(record.error_tags.length === 0, "correct fusion needs no error tags");
    requireCondition(
      record.correction_quality_score_0_to_4 === null,
      "correct fusion has no correction-quality score"
    );
  } else if (record.acknowledged_error) {
    requireString(
      record.corrected_interpretation,
      "post_outcome_review.corrected_interpretation"
    );
    requireCondition(record.error_tags.length >= 1, "acknowledged error requires error tags");
    requireInteger(
      record.correction_quality_score_0_to_4,
      "post_outcome_review.correction_quality_score_0_to_4",
      0,
      4
    );
  } else {
    requireCondition(
      record.corrected_interpretation === null,
      "unacknowledged error cannot contain a correction"
    );
    requireCondition(
      record.correction_quality_score_0_to_4 === null,
      "unacknowledged error has no correction-quality score"
    );
  }
}

export function validateArtifact(kind, record, context) {
  requireObject(context?.caseManifest, "context.caseManifest");
  validateCaseManifest(context.caseManifest);

  switch (kind) {
    case "human_prior":
      validateHumanPrior(record, context);
      break;
    case "ai_assessment":
      validateAiAssessment(record, context);
      break;
    case "fusion_revision":
      requireObject(context.aiAssessment, "context.aiAssessment");
      validateFusionRevision(record, context);
      break;
    case "baseline_forecast":
      validateBaseline(record, context);
      break;
    case "outcome":
      validateOutcome(record, context.caseManifest);
      break;
    case "adjudication":
      requireObject(context.aiAssessment, "context.aiAssessment");
      validateAdjudication(record, context);
      break;
    case "post_outcome_review":
      requireObject(context.fusionRevision, "context.fusionRevision");
      requireObject(context.outcome, "context.outcome");
      validatePostOutcomeReview(record, context);
      break;
    default:
      throw new BenchmarkContractError(`Unknown artifact kind ${kind}`);
  }
  return record;
}

export function getTopForecastLabel(forecast) {
  return topForecastLabel(forecast);
}

export function getAuthorityBoundary() {
  return AUTHORITY;
}
