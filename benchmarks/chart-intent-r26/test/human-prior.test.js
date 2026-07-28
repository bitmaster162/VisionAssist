import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createHumanPriorDraft,
  submitHumanPrior
} from "../src/human-prior.js";
import { freezeCase, verifyCase } from "../src/lifecycle.js";
import { createFixture } from "./helpers.js";

const FIXED_TIME = "2026-07-27T00:00:00.000Z";

test("human-prior draft is case-specific, blind, and outside the frozen case", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "visionassist-r26-prior-"));
  try {
    const fixture = createFixture(root);
    freezeCase(fixture.caseDirectory, fixture.outcomePath, {
      frozenAt: FIXED_TIME
    });
    const draftPath = path.join(root, "analyst-work", "MKT-001.human-prior.json");
    const result = createHumanPriorDraft(fixture.caseDirectory, draftPath);
    const draft = JSON.parse(readFileSync(draftPath, "utf8"));
    const verification = verifyCase(fixture.caseDirectory);

    assert.equal(result.draft_status, "INCOMPLETE_NOT_FREEZABLE");
    assert.equal(verification.phase, "CASE_FROZEN");
    assert.equal(draft.case_id, "MKT-001");
    assert.equal(draft.analyst_id, "analyst-1");
    assert.deepEqual(
      draft.outcome_forecast.probabilities.map((item) => item.label),
      ["up", "down", "range"]
    );
    assert.equal(draft.outcome_unseen_attestation, false);
    assert.equal(draft.ai_unseen_attestation, false);
    assert.equal(readFileSync(draftPath, "utf8").includes("outcome_label"), false);
    assert.throws(
      () => createHumanPriorDraft(
        fixture.caseDirectory,
        path.join(fixture.caseDirectory, "draft.json")
      ),
      /outside the frozen case directory/
    );
    assert.throws(
      () => createHumanPriorDraft(
        fixture.caseDirectory,
        path.join(root, "outcome-vault", "draft.json")
      ),
      /outside the outcome vault/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("human-prior submission fails closed, then freezes a completed draft", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "visionassist-r26-prior-submit-"));
  try {
    const fixture = createFixture(root);
    freezeCase(fixture.caseDirectory, fixture.outcomePath, {
      frozenAt: FIXED_TIME
    });
    const draftPath = path.join(root, "analyst-work", "MKT-001.human-prior.json");
    createHumanPriorDraft(fixture.caseDirectory, draftPath);
    assert.throws(
      () => submitHumanPrior(fixture.caseDirectory, draftPath),
      /human_prior\.recorded_at/
    );
    assert.equal(verifyCase(fixture.caseDirectory).phase, "CASE_FROZEN");

    const completed = JSON.parse(readFileSync(draftPath, "utf8"));
    completed.recorded_at = FIXED_TIME;
    completed.interpretation = "Visible structure suggests continuation, with range as an alternative.";
    completed.competing_hypotheses = [
      "Continuation",
      "Range re-entry"
    ];
    completed.outcome_forecast.probabilities = [
      { label: "up", probability: 0.55 },
      { label: "down", probability: 0.15 },
      { label: "range", probability: 0.3 }
    ];
    completed.confidence = 0.55;
    completed.outcome_unseen_attestation = true;
    completed.ai_unseen_attestation = true;
    writeFileSync(draftPath, `${JSON.stringify(completed, null, 2)}\n`, "utf8");

    const result = submitHumanPrior(fixture.caseDirectory, draftPath, {
      frozenAt: FIXED_TIME
    });
    assert.equal(result.phase, "HUMAN_PRIOR_FROZEN");
    assert.equal(result.next_required_stage, "AI_ASSESSMENT_FROZEN");
    assert.equal(verifyCase(fixture.caseDirectory).phase, "HUMAN_PRIOR_FROZEN");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
