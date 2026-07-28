import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  rmSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MarketEvidenceGateError,
  R34_FORMULA_MANIFEST_SHA256,
  verifyMarketInputR34
} from "../src/market-evidence-r34.js";
import {
  readJson,
  sha256File
} from "../src/canonical-json.js";
import {
  applyNegativeFixture,
  createMarketEvidenceFixture,
  readNegativeFixtures
} from "./market-evidence-r34-fixture.js";

const benchmarkRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function temporaryRoot() {
  return mkdtempSync(path.join(os.tmpdir(), "visionassist-r34-test-"));
}

function fileSnapshot(root, relative = "") {
  const directory = path.join(root, relative);
  const snapshot = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const childRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      Object.assign(snapshot, fileSnapshot(root, childRelative));
    } else {
      snapshot[childRelative.split(path.sep).join("/")] =
        sha256File(path.join(root, childRelative));
    }
  }
  return snapshot;
}

test("valid FORWARD_LOCKED_FULL_CONTEXT fixture passes without mutation", () => {
  const root = temporaryRoot();
  try {
    const fixture = createMarketEvidenceFixture(root);
    const before = fileSnapshot(fixture.caseDirectory);
    const receipt = verifyMarketInputR34(fixture.caseDirectory);
    const after = fileSnapshot(fixture.caseDirectory);

    assert.equal(receipt.market_evidence_status, "PASS");
    assert.equal(receipt.case_id, "MKT-R34-001");
    assert.equal(receipt.capture_mode, "FORWARD_LOCKED_FULL_CONTEXT");
    assert.equal(receipt.case_phase, "CASE_FROZEN");
    assert.equal(receipt.authority.can_trade, false);
    assert.equal(
      receipt.formula_manifest_sha256,
      R34_FORMULA_MANIFEST_SHA256
    );
    assert.deepEqual(after, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("all required R34 negative fixtures fail closed with expected codes", async (t) => {
  for (const mutation of readNegativeFixtures()) {
    await t.test(mutation.fixture_id, () => {
      const root = temporaryRoot();
      try {
        const fixture = createMarketEvidenceFixture(root);
        applyNegativeFixture(fixture, mutation);

        assert.throws(
          () => verifyMarketInputR34(fixture.caseDirectory),
          (error) => {
            assert.ok(error instanceof MarketEvidenceGateError);
            assert.equal(error.receipt.market_evidence_status, "FAIL");
            assert.equal(error.receipt.case_phase, "INPUT_REJECTED");
            assert.ok(
              error.receipt.violation_codes.includes(mutation.expected_code),
              `${mutation.fixture_id} should include ${mutation.expected_code}; got ${error.receipt.violation_codes.join(", ")}`
            );
            return true;
          }
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});

test("CLI returns a PASS receipt and a structured non-zero failure", () => {
  const root = temporaryRoot();
  try {
    const valid = createMarketEvidenceFixture(root, {
      caseId: "MKT-R34-002"
    });
    const tool = path.join(benchmarkRoot, "tools", "benchmark.js");
    const pass = spawnSync(
      process.execPath,
      [tool, "verify-market-input-r34", valid.caseDirectory],
      { cwd: benchmarkRoot, encoding: "utf8" }
    );
    assert.equal(pass.status, 0, pass.stderr);
    assert.equal(JSON.parse(pass.stdout).market_evidence_status, "PASS");

    const invalid = createMarketEvidenceFixture(
      path.join(root, "invalid"),
      { caseId: "MKT-R34-003" }
    );
    applyNegativeFixture(invalid, readNegativeFixtures()[0]);
    const fail = spawnSync(
      process.execPath,
      [tool, "verify-market-input-r34", invalid.caseDirectory],
      { cwd: benchmarkRoot, encoding: "utf8" }
    );
    assert.equal(fail.status, 1);
    const failure = JSON.parse(fail.stderr);
    assert.equal(failure.code, "MARKET_EVIDENCE_GATE_FAILED");
    assert.equal(failure.receipt.market_evidence_status, "FAIL");
    assert.ok(
      failure.receipt.violation_codes.includes("MISSING_REQUIRED_CONTEXT")
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("schemas, visual-only isolation, and replacement templates are bounded", () => {
  const evidenceSchema = readJson(
    path.join(
      benchmarkRoot,
      "schemas",
      "market-evidence-bundle-r34.schema.json"
    )
  );
  const priorSchema = readJson(
    path.join(
      benchmarkRoot,
      "schemas",
      "market-human-prior-r34.schema.json"
    )
  );
  const visualManifest = readJson(
    path.join(benchmarkRoot, "templates", "r34", "visual-only-manifest.json")
  );
  const replacements = [1, 2, 3].map((index) =>
    readJson(path.join(
      benchmarkRoot,
      "templates",
      "r34",
      "replacements",
      `MKT-R34-${String(index).padStart(3, "0")}.json`
    ))
  );

  assert.equal(evidenceSchema.additionalProperties, false);
  assert.ok(evidenceSchema.required.includes("artifact_manifest"));
  assert.ok(evidenceSchema.required.includes("deterministic_indicators"));
  assert.ok(
    priorSchema.properties.outcome_forecast.properties
      .abstention_reason_code.enum
      .includes("INSUFFICIENT_DECISION_CONTEXT")
  );
  assert.equal(visualManifest.join_with_market_manifest_or_metric, false);
  assert.equal(visualManifest.authority.can_trade, false);
  assert.deepEqual(
    replacements.map((record) => record.case_id),
    ["MKT-R34-001", "MKT-R34-002", "MKT-R34-003"]
  );
  replacements.forEach((record) => {
    assert.equal(record.template_status, "INCOMPLETE_NOT_FREEZABLE");
    assert.equal(record.contains_case_observation, false);
    assert.equal(record.contains_human_prior, false);
    assert.equal(record.contains_ai_or_fusion, false);
    assert.equal(record.contains_outcome_or_reveal, false);
    assert.equal(record.authority.can_trade, false);
  });
});
