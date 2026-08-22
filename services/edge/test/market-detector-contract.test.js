import test from "node:test";
import assert from "node:assert/strict";

import {
  createUnknownDetectorReport,
  validateMarketDetectorReport
} from "../src/market-detector-contract.js";

function source() {
  return {
    source_id: "fixture:chart",
    image_sha256: "a".repeat(64),
    captured_at: "2026-08-14T00:00:00Z"
  };
}

function supportedReport() {
  const report = createUnknownDetectorReport({ requestId: "detector-test-001", source: source() });
  report.detectors[0] = {
    detector_id: "detector:1",
    detector_type: "SFP",
    status: "SUPPORTED",
    orientation: "DOWNSIDE",
    description: "fixture structural pattern",
    confidence: 0.72,
    evidence_refs: ["region:1"],
    counterevidence_refs: ["region:2"],
    invalidation_conditions: ["fixture invalidation condition"],
    level: { value: 100, provenance: "VISIBLE_LABEL" },
    abstention_reason: null
  };
  report.quality = { status: "REVISE", reasons: ["other detectors unknown"] };
  return report;
}

test("unknown detector report abstains instead of inventing patterns", () => {
  const report = createUnknownDetectorReport({ requestId: "detector-test-002", source: source() });
  const validation = validateMarketDetectorReport(report);
  assert.equal(validation.valid, true);
  assert.equal(validation.unknown_count, 4);
  assert.equal(validation.quality_status, "ABSTAIN");
  assert.equal(validation.can_trade, false);
});

test("evidence-bearing detector requires evidence confidence and invalidation", () => {
  const report = supportedReport();
  assert.equal(validateMarketDetectorReport(report).supported_count, 1);

  const noEvidence = structuredClone(report);
  noEvidence.detectors[0].evidence_refs = [];
  assert.throws(() => validateMarketDetectorReport(noEvidence), /requires at least 1 item/);

  const noConfidence = structuredClone(report);
  noConfidence.detectors[0].confidence = null;
  assert.throws(() => validateMarketDetectorReport(noConfidence), /confidence must be evidence-bound/);

  const noInvalidation = structuredClone(report);
  noInvalidation.detectors[0].invalidation_conditions = [];
  assert.throws(() => validateMarketDetectorReport(noInvalidation), /requires at least 1 item/);
});

test("unknown detector cannot carry fabricated confidence or orientation", () => {
  const report = createUnknownDetectorReport({ requestId: "detector-test-003", source: source() });
  report.detectors[1].confidence = 0.5;
  assert.throws(() => validateMarketDetectorReport(report), /confidence must be null for UNKNOWN/);

  const report2 = createUnknownDetectorReport({ requestId: "detector-test-004", source: source() });
  report2.detectors[1].orientation = "UPSIDE";
  assert.throws(() => validateMarketDetectorReport(report2), /orientation must be UNKNOWN/);
});

test("safety envelope cannot be elevated", () => {
  const report = supportedReport();
  report.safety.can_trade = true;
  assert.throws(() => validateMarketDetectorReport(report), /can_trade must be false/);
});

test("market observation detector scaffold remains explicit UNKNOWN until inference exists", async () => {
  const { readFileSync } = await import("node:fs");
  const { adaptIntentToMarketObservation } = await import("../src/market-observation-contract.js");
  const intent = JSON.parse(readFileSync(new URL("../../../contracts/intent-r26/chart_intent_record.json", import.meta.url), "utf8"));
  const record = adaptIntentToMarketObservation(intent, {
    requestId: "detector-scaffold-001",
    imageSha256: "b".repeat(64),
    marketContext: { symbol: "FIXTURE", venue: "FIXTURE", timeframe: "1h" }
  });
  assert.equal(record.detector_report.quality.status, "ABSTAIN");
  assert.ok(record.detector_report.detectors.every((item) => item.status === "UNKNOWN"));
  assert.match(record.compact_digest, /SFP=UNKNOWN/);
  assert.match(record.compact_digest, /CHOCH=UNKNOWN/);
});

test("detector model payload is server-bound and cannot invent evidence refs", async () => {
  const {
    bindDetectorModelPayload,
    collectAllowedEvidenceRefs
  } = await import("../src/market-detector-contract.js");
  const { readFileSync } = await import("node:fs");
  const { adaptIntentToMarketObservation } = await import("../src/market-observation-contract.js");
  const intent = JSON.parse(readFileSync(new URL("../../../contracts/intent-r26/chart_intent_record.json", import.meta.url), "utf8"));
  const market = adaptIntentToMarketObservation(intent, {
    requestId: "detector-bind-001",
    imageSha256: "c".repeat(64),
    marketContext: { symbol: "FIXTURE", venue: "FIXTURE", timeframe: "1h" }
  });
  const allowed = collectAllowedEvidenceRefs(market);
  assert.ok(allowed.length > 0);

  const scaffold = createUnknownDetectorReport({ requestId: "detector-bind-scaffold", source: source() });
  const detectors = structuredClone(scaffold.detectors);
  detectors[0] = {
    detector_id: "detector:1",
    detector_type: "SFP",
    status: "CANDIDATE",
    orientation: "DOWNSIDE",
    description: "fixture candidate",
    confidence: 0.6,
    evidence_refs: [allowed[0]],
    counterevidence_refs: [],
    invalidation_conditions: ["fixture invalidation"],
    level: { value: null, provenance: "UNKNOWN" },
    abstention_reason: null
  };
  const modelPayload = {
    detectors,
    quality: { status: "REVISE", reasons: ["fixture"] },
    safety: { can_trade: true },
    source_binding: { image_sha256: "0".repeat(64) }
  };

  const bound = bindDetectorModelPayload(modelPayload, {
    requestId: market.request_id,
    source: market.source,
    allowedEvidenceRefs: allowed
  });
  assert.equal(bound.safety.can_trade, false);
  assert.equal(bound.source_binding.image_sha256, market.source.image_sha256);

  const invented = structuredClone(modelPayload);
  invented.detectors[0].evidence_refs = ["invented:evidence"];
  assert.throws(
    () => bindDetectorModelPayload(invented, {
      requestId: market.request_id,
      source: market.source,
      allowedEvidenceRefs: allowed
    }),
    /references unknown evidence/
  );
});

test("detector report requires exactly one result for every structural detector type", () => {
  const report = createUnknownDetectorReport({ requestId: "detector-test-005", source: source() });
  report.detectors.pop();
  assert.throws(() => validateMarketDetectorReport(report), /exactly one result per detector type/);

  const duplicate = createUnknownDetectorReport({ requestId: "detector-test-006", source: source() });
  duplicate.detectors[3].detector_type = duplicate.detectors[0].detector_type;
  assert.throws(() => validateMarketDetectorReport(duplicate), /detector_type must be unique/);
});
