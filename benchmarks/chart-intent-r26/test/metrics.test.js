import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  buildScorecard,
  scoreCaseRecords,
  scoreCaseDirectories
} from "../src/metrics.js";
import {
  createFixture,
  freezeCompleteFixture
} from "./helpers.js";

function tempRoot() {
  return mkdtempSync(path.join(os.tmpdir(), "visionassist-r26-metrics-"));
}

test("case scoring separates human, AI, fusion, baseline, and quality metrics", () => {
  const root = tempRoot();
  try {
    const fixture = createFixture(root);
    const score = scoreCaseRecords(fixture.records);
    assert.equal(score.human_only.top1_correct, false);
    assert.equal(score.ai_only.top1_correct, true);
    assert.equal(score.human_ai.top1_correct, true);
    assert.equal(score.baseline.top1_correct, false);
    assert.equal(score.evidence_grounding, 1);
    assert.equal(score.alternative_hypothesis_coverage, 0.5);
    assert.equal(score.counterevidence_quality, 0.75);
    assert.equal(score.invalidation_quality, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("post-outcome correction is counted only for a frozen fusion miss", () => {
  const root = tempRoot();
  try {
    const fixture = createFixture(root, { fusionTopLabel: "down" });
    const score = scoreCaseRecords(fixture.records);
    assert.equal(score.correction.applicable, true);
    assert.equal(score.correction.acknowledged, true);
    assert.equal(score.correction.quality, 0.75);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("abstention remains a fusion miss even when its top label matches outcome", () => {
  const root = tempRoot();
  try {
    const fixture = createFixture(root, {
      fusionTopLabel: "up",
      fusionAbstain: true,
      shouldAbstain: true
    });
    const score = scoreCaseRecords(fixture.records);
    assert.equal(score.human_ai.top1_label, "up");
    assert.equal(score.human_ai.top1_correct, false);
    assert.equal(score.human_ai.abstention_correct, true);
    assert.equal(score.correction.applicable, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("partial scorecard remains HOLD", () => {
  const root = tempRoot();
  try {
    const score = scoreCaseRecords(createFixture(root).records);
    const card = buildScorecard([score], "2026-07-27T00:00:00.000Z");
    assert.equal(card.decision, "HOLD");
    assert.equal(card.gates.corpus_75_complete, "FAIL");
    assert.equal(card.gates.blinded_holdout_20_complete, "FAIL");
    assert.equal(card.gates.no_hindsight_leakage, "INSUFFICIENT_EVIDENCE");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("complete synthetic roster can satisfy gates without granting authority", () => {
  const root = tempRoot();
  try {
    const marketBase = scoreCaseRecords(createFixture(root, {
      caseId: "MKT-001"
    }).records);
    const visualBase = scoreCaseRecords(createFixture(root, {
      caseId: "VIS-001"
    }).records);
    const scores = [
      ...Array.from({ length: 60 }, (_, index) => ({
        ...structuredClone(marketBase),
        case_id: `MKT-${String(index + 1).padStart(3, "0")}`,
        split: index < 45 ? "development" : "blinded_holdout"
      })),
      ...Array.from({ length: 15 }, (_, index) => ({
        ...structuredClone(visualBase),
        case_id: `VIS-${String(index + 1).padStart(3, "0")}`,
        split: index < 10 ? "development" : "blinded_holdout"
      }))
    ];
    const card = buildScorecard(scores, "2026-07-27T00:00:00.000Z");
    assert.equal(card.case_count, 75);
    assert.equal(
      card.scopes.market_blinded_holdout.forecasts.candlestick_baseline.case_count,
      15
    );
    assert.equal(card.decision, "READY_FOR_INDEPENDENT_REVIEW");
    assert.equal(card.authority.can_trade, false);
    assert.ok(Object.values(card.gates).every((value) => value === "PASS"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verified complete fixture can be scored from disk", () => {
  const root = tempRoot();
  try {
    const fixture = freezeCompleteFixture(createFixture(root));
    const card = scoreCaseDirectories(
      [fixture.caseDirectory],
      "2026-07-27T00:00:00.000Z"
    );
    assert.equal(card.case_count, 1);
    assert.equal(card.decision, "HOLD");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
