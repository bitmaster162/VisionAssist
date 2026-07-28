import {
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import { sha256File, sha256Json } from "../src/canonical-json.js";
import {
  freezeCase,
  freezeStage,
  revealOutcome
} from "../src/lifecycle.js";

const intentTemplate = JSON.parse(
  readFileSync(
    new URL(
      "../../../contracts/intent-r26/chart_intent_record.json",
      import.meta.url
    ),
    "utf8"
  )
);

const FIXED_TIME = "2026-07-27T00:00:00.000Z";
const LABELS = ["up", "down", "range"];

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function forecast(probabilities, abstain = false) {
  return {
    probabilities: LABELS.map((label) => ({
      label,
      probability: probabilities[label]
    })),
    abstain,
    abstention_reason: abstain ? "insufficient visible evidence" : null
  };
}

function intentRecord(caseId, modality) {
  const record = structuredClone(intentTemplate);
  record.source = {
    source_id: caseId,
    modality,
    captured_at: FIXED_TIME
  };
  record.human_context = {
    present: false,
    operator_goal: null,
    operator_prior: null,
    operator_confidence: null,
    notes_sha256: null
  };
  record.fusion_status = "AI_ONLY_INCOMPLETE";
  return record;
}

export function createFixture(root, {
  caseId = "MKT-001",
  outcomeLabel = "up",
  fusionTopLabel = "up",
  fusionAbstain = false,
  shouldAbstain = false,
  leakageFlags = []
} = {}) {
  const domain = caseId.startsWith("MKT") ? "market" : "non_market_visual";
  const numericId = Number.parseInt(caseId.slice(-3), 10);
  const split = domain === "market"
    ? (numericId <= 45 ? "development" : "blinded_holdout")
    : (numericId <= 10 ? "development" : "blinded_holdout");
  const modality = domain === "market" ? "chart_image" : "scene_image";
  const caseDirectory = path.join(root, "cases", caseId);
  const vaultDirectory = path.join(root, "outcome-vault");
  const evidencePath = path.join(caseDirectory, "evidence", "source.png");
  const outcomePath = path.join(vaultDirectory, `${caseId}.json`);
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  mkdirSync(vaultDirectory, { recursive: true });
  writeFileSync(evidencePath, `synthetic evidence for ${caseId}`, "utf8");

  const outcome = {
    schema_version: "visionassist.benchmark.outcome.v1",
    case_id: caseId,
    custodian_id: "custodian-1",
    sealed_at: FIXED_TIME,
    outcome_label: outcomeLabel,
    outcome_summary: "Synthetic outcome used only for harness tests.",
    observation_window: "synthetic fixed window",
    should_abstain: shouldAbstain,
    evidence_refs: ["synthetic-outcome-ref"]
  };
  writeJson(outcomePath, outcome);

  const caseManifest = {
    schema_version: "visionassist.benchmark.case.v1",
    case_id: caseId,
    domain,
    split,
    modality,
    sampling: {
      candidate_id: `candidate-${caseId}`,
      protocol_id: "synthetic-test-protocol",
      source_family: "synthetic-source",
      stratum: domain === "market" ? "synthetic-market" : "synthetic-visual",
      timeframe: domain === "market" ? "synthetic-timeframe" : null,
      selected_without_outcome_access: true
    },
    evidence: {
      asset_path: "evidence/source.png",
      sha256: sha256File(evidencePath),
      captured_at: FIXED_TIME,
      cutoff_description: "Synthetic cutoff for harness testing only.",
      provenance: "GENERATED_TEST_FIXTURE_NOT_BENCHMARK_EVIDENCE"
    },
    outcome_definition: {
      labels: LABELS,
      horizon: "synthetic horizon",
      resolution_rule: "Use the sealed synthetic label.",
      should_abstain_rule: "Use the sealed synthetic ambiguity flag."
    },
    roles: {
      curator_id: "curator-1",
      outcome_custodian_id: "custodian-1",
      human_analyst_id: "analyst-1",
      adjudicator_id: "adjudicator-1"
    },
    outcome_commitment_sha256: sha256Json(outcome),
    created_at: FIXED_TIME,
    authority: {
      decision_status: "DIAGNOSTIC_ONLY",
      action_code: "NO_ACTION",
      execution_permission: "HOLD",
      capital_permission: "DENY",
      can_trade: false
    }
  };
  writeJson(path.join(caseDirectory, "case.json"), caseManifest);

  const humanPrior = {
    schema_version: "visionassist.benchmark.human-prior.v1",
    case_id: caseId,
    analyst_id: "analyst-1",
    recorded_at: FIXED_TIME,
    interpretation: "Synthetic human-only interpretation.",
    competing_hypotheses: ["down continuation", "range re-entry"],
    outcome_forecast: forecast({ up: 0.2, down: 0.6, range: 0.2 }),
    confidence: 0.6,
    outcome_unseen_attestation: true,
    ai_unseen_attestation: true
  };

  const aiAssessment = {
    schema_version: "visionassist.benchmark.ai-assessment.v1",
    case_id: caseId,
    run_id: `run-${caseId}`,
    model: "fixture-model",
    prompt_version: "fixture-prompt-v1",
    recorded_at: FIXED_TIME,
    intent_record: intentRecord(caseId, modality),
    outcome_forecast: forecast({ up: 0.7, down: 0.2, range: 0.1 }),
    outcome_unseen_attestation: true,
    human_prior_unseen_attestation: true,
    baseline_unseen_attestation: true
  };

  const fusionProbabilities = fusionTopLabel === "up"
    ? { up: 0.8, down: 0.1, range: 0.1 }
    : fusionTopLabel === "down"
      ? { up: 0.1, down: 0.8, range: 0.1 }
      : { up: 0.1, down: 0.1, range: 0.8 };
  const fusionRevision = {
    schema_version: "visionassist.benchmark.fusion-revision.v1",
    case_id: caseId,
    analyst_id: "analyst-1",
    recorded_at: FIXED_TIME,
    revised_interpretation: "Synthetic post-AI revision.",
    adopted_ai_hypothesis_ids: ["hyp-1"],
    rejected_ai_hypothesis_ids: ["hyp-2"],
    new_hypotheses: [],
    outcome_forecast: forecast(fusionProbabilities, fusionAbstain),
    confidence: 0.8,
    change_rationale: "AI evidence changed the synthetic interpretation.",
    outcome_unseen_attestation: true,
    ai_assessment_seen_attestation: true
  };

  const baseline = {
    schema_version: "visionassist.benchmark.baseline-forecast.v1",
    case_id: caseId,
    applicable: domain === "market",
    classifier_id: domain === "market" ? "fixture-candle-baseline" : null,
    classifier_version: domain === "market" ? "v1" : null,
    recorded_at: FIXED_TIME,
    outcome_forecast: domain === "market"
      ? forecast({ up: 0.25, down: 0.5, range: 0.25 })
      : null,
    outcome_unseen_attestation: true,
    human_prior_unseen_attestation: true,
    ai_assessment_unseen_attestation: true
  };

  const adjudication = {
    schema_version: "visionassist.benchmark.adjudication.v1",
    case_id: caseId,
    adjudicator_id: "adjudicator-1",
    recorded_at: FIXED_TIME,
    evidence_grounding: {
      supported_observation_ids: ["obs-1", "obs-2"],
      unsupported_observation_ids: []
    },
    reference_alternatives: [
      {
        id: "alt-1",
        description: "Synthetic primary alternative.",
        covered_by_ai_hypothesis_ids: ["hyp-1"]
      },
      {
        id: "alt-2",
        description: "Synthetic uncovered alternative.",
        covered_by_ai_hypothesis_ids: []
      }
    ],
    counterevidence_quality: {
      score_0_to_4: 3,
      rationale: "Synthetic counterevidence rubric result."
    },
    invalidation_quality: {
      score_0_to_4: 4,
      rationale: "Synthetic invalidation rubric result."
    },
    hindsight_leakage_flags: leakageFlags,
    notes: "Synthetic adjudication for harness tests only."
  };

  const originalWasCorrect = !fusionAbstain && fusionTopLabel === outcomeLabel;
  const postOutcomeReview = {
    schema_version: "visionassist.benchmark.post-outcome-review.v1",
    case_id: caseId,
    analyst_id: "analyst-1",
    recorded_at: FIXED_TIME,
    original_fusion_top1_label: fusionTopLabel,
    original_fusion_was_correct: originalWasCorrect,
    acknowledged_error: !originalWasCorrect,
    corrected_interpretation: originalWasCorrect
      ? null
      : "Synthetic correction after outcome reveal.",
    error_tags: originalWasCorrect ? [] : ["wrong-latent-force"],
    correction_quality_score_0_to_4: originalWasCorrect ? null : 3,
    outcome_seen_attestation: true
  };

  return {
    caseDirectory,
    outcomePath,
    records: {
      case: caseManifest,
      human_prior: humanPrior,
      ai_assessment: aiAssessment,
      fusion_revision: fusionRevision,
      baseline_forecast: baseline,
      outcome,
      adjudication,
      post_outcome_review: postOutcomeReview
    }
  };
}

export function writeStage(fixture, kind) {
  writeJson(
    path.join(fixture.caseDirectory, `${kind}.json`),
    fixture.records[kind]
  );
}

export function freezeCompleteFixture(fixture) {
  freezeCase(fixture.caseDirectory, fixture.outcomePath, { frozenAt: FIXED_TIME });
  for (const kind of [
    "human_prior",
    "ai_assessment",
    "fusion_revision",
    "baseline_forecast"
  ]) {
    writeStage(fixture, kind);
    freezeStage(fixture.caseDirectory, kind, { frozenAt: FIXED_TIME });
  }
  revealOutcome(fixture.caseDirectory, fixture.outcomePath, { frozenAt: FIXED_TIME });
  for (const kind of ["adjudication", "post_outcome_review"]) {
    writeStage(fixture, kind);
    freezeStage(fixture.caseDirectory, kind, { frozenAt: FIXED_TIME });
  }
  return fixture;
}
