import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import os from "node:os";

import { readJson, sha256File } from "../src/canonical-json.js";
import { prepareCase } from "../src/intake.js";

const FIXED_TIME = "2026-07-27T00:00:00.000Z";

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("case intake computes commitments and never overwrites an existing slot", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "visionassist-r26-intake-"));
  try {
    const intakePath = path.join(root, "intake.json");
    const evidencePath = path.join(root, "source.png");
    const outcomePath = path.join(root, "vault", "MKT-001.json");
    const casesRoot = path.join(root, "cases");
    writeFileSync(evidencePath, "synthetic png bytes", "utf8");
    writeJson(outcomePath, {
      schema_version: "visionassist.benchmark.outcome.v1",
      case_id: "MKT-001",
      custodian_id: "custodian-1",
      sealed_at: FIXED_TIME,
      outcome_label: "up",
      outcome_summary: "Synthetic intake outcome.",
      observation_window: "synthetic window",
      should_abstain: false,
      evidence_refs: ["synthetic-ref"]
    });
    writeJson(intakePath, {
      schema_version: "visionassist.benchmark.case-intake.v1",
      case_id: "MKT-001",
      modality: "chart_image",
      sampling: {
        candidate_id: "candidate-MKT-001",
        protocol_id: "synthetic-test-protocol",
        source_family: "synthetic-source",
        stratum: "synthetic-market",
        timeframe: "synthetic-timeframe",
        selected_without_outcome_access: true
      },
      captured_at: FIXED_TIME,
      cutoff_description: "Synthetic cutoff.",
      provenance: "TEST_FIXTURE_ONLY",
      outcome_definition: {
        labels: ["up", "down", "range"],
        horizon: "synthetic horizon",
        resolution_rule: "Use the sealed label.",
        should_abstain_rule: "Use the sealed ambiguity flag."
      },
      roles: {
        curator_id: "curator-1",
        outcome_custodian_id: "custodian-1",
        human_analyst_id: "analyst-1",
        adjudicator_id: "adjudicator-1"
      },
      created_at: FIXED_TIME
    });

    const result = prepareCase({
      intakePath,
      evidenceSourcePath: evidencePath,
      sealedOutcomePath: outcomePath,
      casesRoot
    });
    const manifest = readJson(result.case_manifest);
    const copiedEvidence = path.join(result.case_directory, manifest.evidence.asset_path);
    assert.equal(result.status, "INGESTED_UNFROZEN");
    assert.equal(manifest.case_id, "MKT-001");
    assert.equal(manifest.evidence.sha256, sha256File(copiedEvidence));
    assert.equal(existsSync(path.join(result.case_directory, "receipt.json")), false);
    assert.throws(
      () => prepareCase({
        intakePath,
        evidenceSourcePath: evidencePath,
        sealedOutcomePath: outcomePath,
        casesRoot
      }),
      /MKT-001 already exists/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
