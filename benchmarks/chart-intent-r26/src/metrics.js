import { getTopForecastLabel } from "./contract.js";
import { loadVerifiedCase } from "./lifecycle.js";

function round(value) {
  return value == null ? null : Math.round(value * 1_000_000) / 1_000_000;
}

function mean(values) {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function difference(left, right) {
  return left == null || right == null ? null : round(left - right);
}

function forecastScore(forecast, outcomeLabel, shouldAbstain) {
  const top1Label = getTopForecastLabel(forecast);
  const brier = forecast.probabilities.reduce((total, entry) => {
    const actual = entry.label === outcomeLabel ? 1 : 0;
    return total + ((entry.probability - actual) ** 2);
  }, 0);

  return {
    top1_label: top1Label,
    top1_correct: !forecast.abstain && top1Label === outcomeLabel,
    brier,
    abstained: forecast.abstain,
    should_abstain: shouldAbstain,
    abstention_correct: forecast.abstain === shouldAbstain
  };
}

export function scoreCaseRecords(records) {
  const caseManifest = records.case;
  const outcome = records.outcome;
  const adjudication = records.adjudication;

  const human = forecastScore(
    records.human_prior.outcome_forecast,
    outcome.outcome_label,
    outcome.should_abstain
  );
  const ai = forecastScore(
    records.ai_assessment.outcome_forecast,
    outcome.outcome_label,
    outcome.should_abstain
  );
  const fusion = forecastScore(
    records.fusion_revision.outcome_forecast,
    outcome.outcome_label,
    outcome.should_abstain
  );
  const baseline = records.baseline_forecast.applicable
    ? forecastScore(
        records.baseline_forecast.outcome_forecast,
        outcome.outcome_label,
        outcome.should_abstain
      )
    : null;

  const supportedCount =
    adjudication.evidence_grounding.supported_observation_ids.length;
  const unsupportedCount =
    adjudication.evidence_grounding.unsupported_observation_ids.length;
  const observationCount = supportedCount + unsupportedCount;
  const coveredAlternatives = adjudication.reference_alternatives.filter(
    (alternative) => alternative.covered_by_ai_hypothesis_ids.length > 0
  ).length;
  const referenceAlternativeCount = adjudication.reference_alternatives.length;

  const review = records.post_outcome_review;
  const correctionApplicable = !fusion.top1_correct;
  const acknowledgedCorrection =
    correctionApplicable && review.acknowledged_error === true;

  return {
    case_id: caseManifest.case_id,
    domain: caseManifest.domain,
    split: caseManifest.split,
    outcome_label: outcome.outcome_label,
    human_only: human,
    ai_only: ai,
    human_ai: fusion,
    baseline,
    evidence_grounding: supportedCount / observationCount,
    alternative_hypothesis_coverage:
      coveredAlternatives / referenceAlternativeCount,
    counterevidence_quality:
      adjudication.counterevidence_quality.score_0_to_4 / 4,
    invalidation_quality:
      adjudication.invalidation_quality.score_0_to_4 / 4,
    hindsight_leakage_flags: adjudication.hindsight_leakage_flags.length,
    correction: {
      applicable: correctionApplicable,
      acknowledged: acknowledgedCorrection,
      quality: acknowledgedCorrection
        ? review.correction_quality_score_0_to_4 / 4
        : null
    }
  };
}

function aggregateForecast(caseScores, field) {
  const values = caseScores
    .map((caseScore) => caseScore[field])
    .filter((value) => value !== null);

  return {
    case_count: values.length,
    accuracy: round(mean(values.map((value) => Number(value.top1_correct)))),
    brier_score: round(mean(values.map((value) => value.brier))),
    abstention_quality: round(
      mean(values.map((value) => Number(value.abstention_correct)))
    ),
    abstention_rate: round(mean(values.map((value) => Number(value.abstained))))
  };
}

function aggregateQuality(caseScores) {
  const fusionMisses = caseScores.filter((caseScore) => caseScore.correction.applicable);
  const acknowledged = fusionMisses.filter(
    (caseScore) => caseScore.correction.acknowledged
  );
  const correctionQualities = acknowledged
    .map((caseScore) => caseScore.correction.quality)
    .filter((value) => value !== null);
  const leakageFlags = sum(
    caseScores.map((caseScore) => caseScore.hindsight_leakage_flags)
  );

  return {
    evidence_grounding: round(mean(caseScores.map((value) => value.evidence_grounding))),
    alternative_hypothesis_coverage: round(
      mean(caseScores.map((value) => value.alternative_hypothesis_coverage))
    ),
    counterevidence_quality: round(
      mean(caseScores.map((value) => value.counterevidence_quality))
    ),
    invalidation_quality: round(
      mean(caseScores.map((value) => value.invalidation_quality))
    ),
    hindsight_leakage: {
      flagged_cases: caseScores.filter(
        (caseScore) => caseScore.hindsight_leakage_flags > 0
      ).length,
      flag_count: leakageFlags,
      pre_outcome_stage_rate: caseScores.length
        ? round(leakageFlags / (caseScores.length * 3))
        : null
    },
    correction_after_outcome_reveal: {
      fusion_miss_count: fusionMisses.length,
      acknowledged_miss_count: acknowledged.length,
      correction_rate: fusionMisses.length
        ? round(acknowledged.length / fusionMisses.length)
        : null,
      mean_correction_quality: round(mean(correctionQualities))
    }
  };
}

function aggregateScope(caseScores) {
  const humanOnly = aggregateForecast(caseScores, "human_only");
  const aiOnly = aggregateForecast(caseScores, "ai_only");
  const humanAi = aggregateForecast(caseScores, "human_ai");
  const baseline = aggregateForecast(caseScores, "baseline");

  return {
    case_count: caseScores.length,
    forecasts: {
      human_only: humanOnly,
      ai_only: aiOnly,
      human_ai: humanAi,
      candlestick_baseline: baseline
    },
    quality: aggregateQuality(caseScores),
    deltas: {
      human_ai_accuracy_minus_human_only: difference(
        humanAi.accuracy,
        humanOnly.accuracy
      ),
      human_ai_accuracy_minus_ai_only: difference(
        humanAi.accuracy,
        aiOnly.accuracy
      ),
      human_ai_brier_improvement_vs_human_only: difference(
        humanOnly.brier_score,
        humanAi.brier_score
      ),
      human_ai_brier_improvement_vs_ai_only: difference(
        aiOnly.brier_score,
        humanAi.brier_score
      ),
      human_ai_accuracy_minus_baseline: baseline.case_count
        ? difference(humanAi.accuracy, baseline.accuracy)
        : null,
      human_ai_brier_improvement_vs_baseline: baseline.case_count
        ? difference(baseline.brier_score, humanAi.brier_score)
        : null
    }
  };
}

function evaluateGate(condition, sufficient = true) {
  if (!sufficient) {
    return "INSUFFICIENT_EVIDENCE";
  }
  return condition ? "PASS" : "FAIL";
}

export function buildScorecard(caseScores, generatedAt = new Date().toISOString()) {
  const uniqueCaseIds = new Set(caseScores.map((caseScore) => caseScore.case_id));
  if (uniqueCaseIds.size !== caseScores.length) {
    throw new Error("Scorecard input contains duplicate case IDs.");
  }
  const holdoutCases = caseScores.filter(
    (caseScore) => caseScore.split === "blinded_holdout"
  );
  const marketCases = caseScores.filter((caseScore) => caseScore.domain === "market");
  const marketHoldoutCases = marketCases.filter(
    (caseScore) => caseScore.split === "blinded_holdout"
  );
  const visualCases = caseScores.filter(
    (caseScore) => caseScore.domain === "non_market_visual"
  );
  const visualHoldoutCases = visualCases.filter(
    (caseScore) => caseScore.split === "blinded_holdout"
  );
  const full = aggregateScope(caseScores);
  const holdout = aggregateScope(holdoutCases);
  const market = aggregateScope(marketCases);
  const marketHoldout = aggregateScope(marketHoldoutCases);
  const nonMarketVisual = aggregateScope(visualCases);
  const corpusComplete =
    caseScores.length === 75 &&
    marketCases.length === 60 &&
    visualCases.length === 15;
  const holdoutComplete =
    holdoutCases.length === 20 &&
    marketHoldoutCases.length === 15 &&
    visualHoldoutCases.length === 5;
  const marketBaselineComplete =
    marketHoldout.forecasts.candlestick_baseline.case_count === 15;

  const gates = {
    corpus_75_complete: evaluateGate(corpusComplete),
    market_60_complete: evaluateGate(marketCases.length === 60),
    non_market_visual_15_complete: evaluateGate(visualCases.length === 15),
    blinded_holdout_20_complete: evaluateGate(holdoutComplete),
    no_hindsight_leakage: evaluateGate(
      holdout.quality.hindsight_leakage.flag_count === 0,
      holdoutComplete
    ),
    fusion_not_worse_than_human_accuracy: evaluateGate(
      holdout.forecasts.human_ai.accuracy >= holdout.forecasts.human_only.accuracy,
      holdoutComplete
    ),
    fusion_not_worse_than_human_brier: evaluateGate(
      holdout.forecasts.human_ai.brier_score <=
        holdout.forecasts.human_only.brier_score,
      holdoutComplete
    ),
    fusion_beats_candlestick_baseline_brier: evaluateGate(
      marketHoldout.forecasts.human_ai.brier_score <
        marketHoldout.forecasts.candlestick_baseline.brier_score,
      marketBaselineComplete
    )
  };
  const gateValues = Object.values(gates);
  const decision = gateValues.every((value) => value === "PASS")
    ? "READY_FOR_INDEPENDENT_REVIEW"
    : "HOLD";

  return {
    schema_version: "visionassist.benchmark.scorecard.v1",
    benchmark_id: "VISIONASSIST_CHART_INTENT_AND_HUMAN_AI_FUSION_PROOF",
    generated_at: generatedAt,
    case_count: caseScores.length,
    scopes: {
      full,
      blinded_holdout: holdout,
      market,
      market_blinded_holdout: marketHoldout,
      non_market_visual: nonMarketVisual
    },
    gates,
    decision,
    authority: {
      decision_status: "DIAGNOSTIC_ONLY",
      action_code: "NO_ACTION",
      execution_permission: "HOLD",
      capital_permission: "DENY",
      can_trade: false
    },
    case_scores: caseScores
  };
}

export function scoreCaseDirectories(caseDirectories, generatedAt) {
  const caseScores = caseDirectories.map((caseDirectory) => {
    const loaded = loadVerifiedCase(caseDirectory);
    if (loaded.verification.phase !== "POST_OUTCOME_REVIEW_FROZEN") {
      throw new Error(
        `${loaded.verification.case_id} is not complete: ${loaded.verification.phase}`
      );
    }
    return scoreCaseRecords(loaded.records);
  });
  return buildScorecard(caseScores, generatedAt);
}
