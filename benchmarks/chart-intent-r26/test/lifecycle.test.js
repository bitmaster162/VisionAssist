import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  freezeCase,
  freezeStage,
  revealOutcome,
  verifyCase
} from "../src/lifecycle.js";
import {
  createFixture,
  freezeCompleteFixture,
  writeStage
} from "./helpers.js";

function tempRoot() {
  return mkdtempSync(path.join(os.tmpdir(), "visionassist-r26-lifecycle-"));
}

test("complete case follows the frozen stage order and verifies its hash chain", () => {
  const root = tempRoot();
  try {
    const fixture = freezeCompleteFixture(createFixture(root));
    const result = verifyCase(fixture.caseDirectory);
    assert.equal(result.valid, true);
    assert.equal(result.phase, "POST_OUTCOME_REVIEW_FROZEN");
    assert.equal(result.frozen_artifacts, 8);
    assert.match(result.chain_sha256, /^[a-f0-9]{64}$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("future outcome file before freeze is rejected as leakage risk", () => {
  const root = tempRoot();
  try {
    const fixture = createFixture(root);
    writeFileSync(
      path.join(fixture.caseDirectory, "outcome.json"),
      readFileSync(fixture.outcomePath)
    );
    assert.throws(
      () => freezeCase(fixture.caseDirectory, fixture.outcomePath),
      /outcome.json exists before its freeze phase/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("revealed outcome must match the precommitted canonical hash", () => {
  const root = tempRoot();
  try {
    const fixture = createFixture(root);
    freezeCase(fixture.caseDirectory, fixture.outcomePath);
    for (const kind of [
      "human_prior",
      "ai_assessment",
      "fusion_revision",
      "baseline_forecast"
    ]) {
      writeStage(fixture, kind);
      freezeStage(fixture.caseDirectory, kind);
    }

    const changedOutcome = structuredClone(fixture.records.outcome);
    changedOutcome.outcome_label = "down";
    writeFileSync(
      fixture.outcomePath,
      `${JSON.stringify(changedOutcome, null, 2)}\n`,
      "utf8"
    );
    assert.throws(
      () => revealOutcome(fixture.caseDirectory, fixture.outcomePath),
      /does not match precommitted hash/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("changing a frozen artifact breaks verification", () => {
  const root = tempRoot();
  try {
    const fixture = createFixture(root);
    freezeCase(fixture.caseDirectory, fixture.outcomePath);
    writeStage(fixture, "human_prior");
    freezeStage(fixture.caseDirectory, "human_prior");

    const changedPrior = structuredClone(fixture.records.human_prior);
    changedPrior.interpretation = "Changed after freeze.";
    writeFileSync(
      path.join(fixture.caseDirectory, "human_prior.json"),
      `${JSON.stringify(changedPrior, null, 2)}\n`,
      "utf8"
    );
    assert.throws(
      () => verifyCase(fixture.caseDirectory),
      /human_prior changed after freeze/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
