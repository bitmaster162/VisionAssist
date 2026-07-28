import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { validateHandoffIntake } from "../validator.mjs";

const repositoryRoot = new URL("../../../", import.meta.url);
const receipt = JSON.parse(
  readFileSync(
    new URL("docs/handoffs/r33/receipt.json", repositoryRoot),
    "utf8"
  )
);
const intake = JSON.parse(
  readFileSync(
    new URL(
      "docs/handoffs/r33/VISIONASSIST_R29_HANDOFF_INTAKE_R33.json",
      repositoryRoot
    ),
    "utf8"
  )
);
const intakeMarkdown = readFileSync(
  new URL(
    "docs/handoffs/r33/VISIONASSIST_HANDOFF_INTAKE_R33.md",
    repositoryRoot
  ),
  "utf8"
);
const handoffBytes = readFileSync(
  new URL(
    "docs/handoffs/VISIONASSIST_R29_P1_HANDOFF_2026-07-27.md",
    repositoryRoot
  )
);
const repositoryCopies = new Map(
  receipt.source_artifacts.map((artifact) => [
    artifact.repository_copy,
    readFileSync(new URL(artifact.repository_copy, repositoryRoot))
  ])
);

test("R33 intake binds the exact R29 handoff and bounded authority", () => {
  const result = validateHandoffIntake({
    receipt,
    intake,
    intakeMarkdown,
    handoffBytes,
    repositoryCopies
  });
  assert.equal(result.valid, true);
  assert.equal(
    result.handoff_sha256,
    "5a4411151673d7afee18d239418c05ee448600a7132db69c3c7ed5d6e0721428"
  );
  assert.equal(result.git_state_at_intake, "UNBORN_NO_COMMITS");
  assert.equal(result.git_identity_bound, false);
  assert.equal(result.custody_transfer_bound, false);
});
