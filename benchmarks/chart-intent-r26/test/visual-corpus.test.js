import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { readJson, sha256Json } from "../src/canonical-json.js";
import { verifyCase } from "../src/lifecycle.js";
import {
  bootstrapVisualCase,
  buildVisualCandidatePool,
  registerVisualCandidatePool,
  verifyCompleteVisualCorpus,
  verifyPublishedVisualCaseFreezeReceipt,
  verifyVisualCandidatePool
} from "../src/visual-corpus.js";

const FIXED_TIME = "2026-07-27T00:00:00.000Z";
const FIXED_SEED = "0123456789abcdef".repeat(4);

test("visual sampler freezes 15 opaque, balanced synthetic control slots", () => {
  const pool = buildVisualCandidatePool(FIXED_SEED);
  const secondPool = buildVisualCandidatePool(`f${FIXED_SEED.slice(1)}`);

  assert.equal(pool.candidates.length, 15);
  assert.equal(new Set(pool.candidates.map((candidate) => candidate.case_id)).size, 15);
  assert.equal(
    pool.candidates.filter((candidate) => candidate.split === "development").length,
    10
  );
  assert.equal(
    pool.candidates.filter((candidate) => candidate.split === "blinded_holdout").length,
    5
  );
  for (const label of ["left_target", "right_target", "hold_position"]) {
    assert.equal(
      pool.candidates.filter((candidate) => candidate.outcome_label === label).length,
      5
    );
  }
  assert.equal(
    new Set(
      pool.candidates.map(
        (candidate) => `${candidate.layout}|${candidate.outcome_label}`
      )
    ).size,
    15
  );
  assert.notEqual(sha256Json(pool), sha256Json(secondPool));
});

test("visual protocol commits the hidden pool and refuses overwrite", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "visionassist-r26-visual-pool-"));
  try {
    const samplingRoot = path.join(root, "sampling");
    const vaultRoot = path.join(root, "vault");
    const registered = registerVisualCandidatePool({
      samplingRoot,
      vaultRoot,
      seed: FIXED_SEED,
      now: FIXED_TIME
    });
    const verified = verifyVisualCandidatePool({ samplingRoot, vaultRoot });

    assert.equal(registered.status, "FROZEN");
    assert.equal(registered.natural_scene_generality, "NOT_ESTABLISHED");
    assert.equal(verified.valid, true);
    assert.equal(verified.pool.candidates.length, 15);
    assert.equal(
      verified.commitment.candidate_pool_commitment_sha256,
      sha256Json(verified.pool)
    );
    assert.throws(
      () => registerVisualCandidatePool({
        samplingRoot,
        vaultRoot,
        seed: FIXED_SEED,
        now: FIXED_TIME
      }),
      /already exists/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("visual bootstrap freezes visible evidence and keeps future state in vault", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "visionassist-r26-visual-"));
  try {
    const samplingRoot = path.join(root, "sampling");
    const vaultRoot = path.join(root, "vault");
    const casesRoot = path.join(root, "cases");
    registerVisualCandidatePool({
      samplingRoot,
      vaultRoot,
      seed: FIXED_SEED,
      now: FIXED_TIME
    });
    const candidate = verifyVisualCandidatePool({
      samplingRoot,
      vaultRoot
    }).pool.candidates.find((item) => item.case_id === "VIS-001");

    const result = await bootstrapVisualCase({
      caseId: "VIS-001",
      samplingRoot,
      vaultRoot,
      casesRoot,
      now: FIXED_TIME
    });
    const caseDirectory = path.join(casesRoot, "VIS-001");
    const manifestText = readFileSync(path.join(caseDirectory, "case.json"), "utf8");
    const png = readFileSync(path.join(caseDirectory, "evidence", "source.png"));
    const verification = verifyCase(caseDirectory);
    const publicVerification = verifyPublishedVisualCaseFreezeReceipt({
      caseId: "VIS-001",
      samplingRoot,
      vaultRoot,
      casesRoot
    });
    const outcome = readJson(
      path.join(vaultRoot, "outcomes", "VIS-001.json")
    );

    assert.equal(result.phase, "CASE_FROZEN");
    assert.equal(result.next_required_stage, "HUMAN_PRIOR_FROZEN");
    assert.equal(result.natural_scene_generality, "NOT_ESTABLISHED");
    assert.equal(verification.phase, "CASE_FROZEN");
    assert.equal(publicVerification.valid, true);
    assert.equal(outcome.outcome_label, candidate.outcome_label);
    assert.equal(existsSync(path.join(caseDirectory, "outcome.json")), false);
    assert.equal(
      existsSync(path.join(vaultRoot, "visual-future", "VIS-001.png")),
      true
    );
    assert.equal(
      existsSync(path.join(vaultRoot, "visual-traces", "VIS-001.json")),
      true
    );
    assert.equal(
      existsSync(path.join(
        samplingRoot,
        "frozen-case-receipts",
        "VIS-001.json"
      )),
      true
    );
    assert.equal(manifestText.includes(candidate.layout), false);
    assert.equal(manifestText.includes("\"outcome_label\""), false);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("complete visual verifier requires all 15 unique frozen cases", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "visionassist-r26-visual-all-"));
  try {
    const samplingRoot = path.join(root, "sampling");
    const vaultRoot = path.join(root, "vault");
    const casesRoot = path.join(root, "cases");
    registerVisualCandidatePool({
      samplingRoot,
      vaultRoot,
      seed: FIXED_SEED,
      now: FIXED_TIME
    });
    for (let index = 1; index <= 15; index += 1) {
      await bootstrapVisualCase({
        caseId: `VIS-${String(index).padStart(3, "0")}`,
        samplingRoot,
        vaultRoot,
        casesRoot,
        now: FIXED_TIME
      });
    }

    const result = verifyCompleteVisualCorpus({
      samplingRoot,
      vaultRoot,
      casesRoot
    });
    assert.equal(result.valid, true);
    assert.equal(result.visual_cases, 15);
    assert.equal(result.development_cases, 10);
    assert.equal(result.blinded_holdout_cases, 5);
    assert.equal(result.unique_evidence_assets, 15);
    assert.deepEqual(result.phase_counts, { CASE_FROZEN: 15 });
    assert.equal(result.natural_scene_generality, "NOT_ESTABLISHED");
    assert.equal(
      result.geometry_qa.fully_visible_cases +
        result.geometry_qa.partially_clipped_cases.length,
      15
    );
    assert.equal(result.geometry_qa.generated_visible_steps_per_case, 6);
    assert.ok(result.geometry_qa.minimum_visible_steps_inside_frame >= 4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
