import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import {
  validateCsvParity,
  validateLineage,
  validateReleaseProfileParity
} from "../validator.mjs";

const lineage = JSON.parse(
  readFileSync(new URL("../visionassist_lineage.json", import.meta.url), "utf8")
);
const sourceCsv = readFileSync(
  new URL(
    "../../../docs/research/lineage-r29/VISIONASSIST_LINEAGE_R29.csv",
    import.meta.url
  ),
  "utf8"
);
const releaseProfiles = JSON.parse(
  readFileSync(
    new URL("../../../docs/contracts/release-profiles.json", import.meta.url),
    "utf8"
  )
);
const sourceReceipt = JSON.parse(
  readFileSync(
    new URL("../../../docs/research/lineage-r29/receipt.json", import.meta.url),
    "utf8"
  )
);

function sha256(url) {
  return createHash("sha256").update(readFileSync(url)).digest("hex");
}

test("R29 lineage fixes four ordered stages and bounded claims", () => {
  assert.equal(validateLineage(lineage), lineage);
  assert.equal(lineage.current_stage, 4);
  assert.equal(lineage.authority.can_trade, false);
});

test("R29 source CSV and canonical lineage remain in parity", () => {
  const rows = validateCsvParity(sourceCsv, lineage);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].current_role, "OPTIONAL_ACCESSIBILITY_ADAPTER");
  assert.equal(rows[3].current_role, "CORE_PERCEPTION_LAYER");
});

test("release profiles follow the corrected portfolio identity", () => {
  assert.equal(
    validateReleaseProfileParity(releaseProfiles, lineage),
    releaseProfiles
  );
});

test("research architecture is not promoted to implementation proof", () => {
  const stage = lineage.stages.find((item) => item.stage === 3);
  assert.equal(stage.evidence_class, "RESEARCH_ARCHITECTURE");
  assert.match(stage.implementation_boundary, /not claimed as a completed runtime/i);
});

test("R29 repository copies match their recorded source receipt", () => {
  for (const artifact of sourceReceipt.artifacts) {
    const fileUrl = new URL(
      `../../../docs/research/lineage-r29/${artifact.name}`,
      import.meta.url
    );
    assert.equal(sha256(fileUrl), artifact.repository_copy_sha256);
  }
  for (const source of lineage.source_artifacts) {
    const receipt = sourceReceipt.artifacts.find(
      (artifact) => artifact.name === source.name
    );
    assert.equal(receipt.source_sha256, source.source_sha256);
  }
});
