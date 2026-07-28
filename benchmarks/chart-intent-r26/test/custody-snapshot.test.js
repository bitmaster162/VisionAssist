import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createCustodySnapshot,
  verifyCustodySnapshot
} from "../src/custody-snapshot.js";

const FIXED_TIME = "2026-07-28T00:00:00.000Z";

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("custody snapshot binds local trees without publishing inventory", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "visionassist-r33-custody-"));
  try {
    const casesRoot = path.join(root, "cases");
    const vaultRoot = path.join(root, "outcome-vault");
    const receiptPath = path.join(root, "receipt.json");
    const snapshotPath = path.join(root, "public", "custody.json");
    mkdirSync(
      path.join(casesRoot, "MKT-001", "evidence"),
      { recursive: true }
    );
    writeFileSync(
      path.join(casesRoot, "MKT-001", "evidence", "source.png"),
      "case evidence",
      "utf8"
    );
    writeJson(path.join(casesRoot, "MKT-001", "case.json"), {
      case_id: "MKT-001"
    });
    writeJson(path.join(vaultRoot, "outcomes", "MKT-001.json"), {
      outcome_label: "sealed"
    });
    writeJson(receiptPath, {
      intake_decision: {
        status: "ACCEPTED_BOUND_TO_EXACT_HANDOFF"
      }
    });

    const snapshot = createCustodySnapshot({
      casesRoot,
      vaultRoot,
      handoffReceiptPath: receiptPath,
      outputPath: snapshotPath,
      now: FIXED_TIME
    });
    const verified = verifyCustodySnapshot({
      casesRoot,
      vaultRoot,
      handoffReceiptPath: receiptPath,
      snapshotPath
    });

    assert.equal(snapshot.scope.case_directories, 1);
    assert.equal(snapshot.scope.cases_file_count, 2);
    assert.equal(snapshot.scope.outcome_vault_file_count, 1);
    assert.equal(snapshot.disclosure.file_paths_published, false);
    assert.equal(snapshot.disclosure.individual_file_hashes_published, false);
    assert.equal(verified.valid, true);
    assert.equal(verified.custody_transfer_bound, false);
    assert.equal(verified.independent_custody_proven, false);

    writeFileSync(
      path.join(casesRoot, "MKT-001", "evidence", "source.png"),
      "mutated evidence",
      "utf8"
    );
    assert.throws(
      () => verifyCustodySnapshot({
        casesRoot,
        vaultRoot,
        handoffReceiptPath: receiptPath,
        snapshotPath
      }),
      /does not match current bytes/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
