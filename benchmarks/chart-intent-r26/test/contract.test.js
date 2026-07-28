import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  BenchmarkContractError,
  validateArtifact,
  validateCaseManifest
} from "../src/contract.js";
import { createFixture } from "./helpers.js";

function withFixture(options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "visionassist-r26-contract-"));
  return {
    root,
    fixture: createFixture(root, options)
  };
}

test("valid case and all pre-outcome artifacts satisfy the benchmark contract", () => {
  const { root, fixture } = withFixture();
  try {
    validateCaseManifest(fixture.records.case);
    const context = { caseManifest: fixture.records.case };
    validateArtifact("human_prior", fixture.records.human_prior, context);
    validateArtifact("ai_assessment", fixture.records.ai_assessment, context);
    context.aiAssessment = fixture.records.ai_assessment;
    validateArtifact("fusion_revision", fixture.records.fusion_revision, context);
    validateArtifact("baseline_forecast", fixture.records.baseline_forecast, context);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("AI-only assessment rejects human prior contamination", () => {
  const { root, fixture } = withFixture();
  try {
    const contaminated = structuredClone(fixture.records.ai_assessment);
    contaminated.intent_record.human_context = {
      present: true,
      operator_goal: "predict",
      operator_prior: "up",
      operator_confidence: 0.8,
      notes_sha256: null
    };
    contaminated.intent_record.fusion_status = "HUMAN_AI";
    assert.throws(
      () => validateArtifact("ai_assessment", contaminated, {
        caseManifest: fixture.records.case
      }),
      /AI-only assessment must not contain human context/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("forecasts must cover the frozen outcome space and sum to one", () => {
  const { root, fixture } = withFixture();
  try {
    const invalid = structuredClone(fixture.records.human_prior);
    invalid.outcome_forecast.probabilities[0].probability = 0.4;
    assert.throws(
      () => validateArtifact("human_prior", invalid, {
        caseManifest: fixture.records.case
      }),
      /must sum to 1/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("outcome custodian, analyst, and adjudicator must be separated", () => {
  const { root, fixture } = withFixture();
  try {
    const invalid = structuredClone(fixture.records.case);
    invalid.roles.adjudicator_id = invalid.roles.human_analyst_id;
    assert.throws(
      () => validateCaseManifest(invalid),
      BenchmarkContractError
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
