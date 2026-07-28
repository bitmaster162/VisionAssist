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
import {
  bootstrapMarketCase,
  buildMarketCandidatePool,
  registerMarketCandidatePool,
  verifyPublishedMarketCaseFreezeReceipt,
  verifyMarketCandidatePool
} from "../src/market-corpus.js";
import { verifyCase } from "../src/lifecycle.js";

const FIXED_TIME = "2026-07-27T00:00:00.000Z";
const FIXED_SEED = "0123456789abcdef".repeat(4);

function intervalMilliseconds(interval) {
  return {
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000
  }[interval];
}

function fixtureRows(candidate) {
  const interval = intervalMilliseconds(candidate.interval);
  const start = candidate.cutoff_open_time_ms - 79 * interval;
  return Array.from({ length: 100 }, (_, index) => {
    const visibleWave = Math.sin(index / 5) * 0.35;
    const futureMove = index < 80 ? 0 : (index - 79) * 0.3;
    const open = 100 + visibleWave + futureMove;
    const close = open + (index % 2 === 0 ? 0.12 : -0.08);
    return [
      start + index * interval,
      open.toFixed(8),
      (Math.max(open, close) + 0.25).toFixed(8),
      (Math.min(open, close) - 0.25).toFixed(8),
      close.toFixed(8),
      "1000.0",
      start + (index + 1) * interval - 1
    ];
  });
}

test("market sampler freezes 60 opaque, balanced, outcome-independent slots", () => {
  const pool = buildMarketCandidatePool(FIXED_SEED);
  const secondPool = buildMarketCandidatePool(`f${FIXED_SEED.slice(1)}`);
  assert.equal(pool.candidates.length, 60);
  assert.equal(new Set(pool.candidates.map((candidate) => candidate.case_id)).size, 60);
  assert.equal(
    pool.candidates.filter((candidate) => candidate.split === "development").length,
    45
  );
  assert.equal(
    pool.candidates.filter((candidate) => candidate.split === "blinded_holdout").length,
    15
  );
  const holdoutPairs = pool.candidates
    .filter((candidate) => candidate.split === "blinded_holdout")
    .map((candidate) => `${candidate.symbol}|${candidate.interval}`);
  assert.equal(new Set(holdoutPairs).size, 15);
  assert.notEqual(sha256Json(pool), sha256Json(secondPool));
});

test("market protocol commits the hidden pool and refuses overwrite", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "visionassist-r26-pool-"));
  try {
    const samplingRoot = path.join(root, "sampling");
    const vaultRoot = path.join(root, "vault");
    const registered = registerMarketCandidatePool({
      samplingRoot,
      vaultRoot,
      seed: FIXED_SEED,
      now: FIXED_TIME
    });
    const verified = verifyMarketCandidatePool({ samplingRoot, vaultRoot });
    assert.equal(registered.status, "FROZEN");
    assert.equal(verified.valid, true);
    assert.equal(verified.pool.candidates.length, 60);
    assert.equal(
      verified.commitment.candidate_pool_commitment_sha256,
      sha256Json(verified.pool)
    );
    assert.throws(
      () => registerMarketCandidatePool({
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

test("market bootstrap exposes only 80 bars and freezes outcome outside case", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "visionassist-r26-market-"));
  try {
    const samplingRoot = path.join(root, "sampling");
    const vaultRoot = path.join(root, "vault");
    const casesRoot = path.join(root, "cases");
    registerMarketCandidatePool({
      samplingRoot,
      vaultRoot,
      seed: FIXED_SEED,
      now: FIXED_TIME
    });
    const pool = verifyMarketCandidatePool({ samplingRoot, vaultRoot }).pool;
    const candidate = pool.candidates.find((item) => item.case_id === "MKT-001");
    const rows = fixtureRows(candidate);
    const fetchImpl = async (url) => {
      assert.equal(url.searchParams.get("symbol"), candidate.symbol);
      assert.equal(url.searchParams.get("interval"), candidate.interval);
      assert.equal(url.searchParams.get("limit"), "100");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(rows)
      };
    };

    const result = await bootstrapMarketCase({
      caseId: "MKT-001",
      samplingRoot,
      vaultRoot,
      casesRoot,
      now: FIXED_TIME,
      fetchImpl
    });
    const caseDirectory = path.join(casesRoot, "MKT-001");
    const manifestText = readFileSync(
      path.join(caseDirectory, "case.json"),
      "utf8"
    );
    const png = readFileSync(path.join(caseDirectory, "evidence", "source.png"));
    const verification = verifyCase(caseDirectory);
    const publicVerification = verifyPublishedMarketCaseFreezeReceipt({
      caseId: "MKT-001",
      samplingRoot,
      vaultRoot,
      casesRoot
    });
    const raw = readJson(path.join(vaultRoot, "raw", "MKT-001.json"));

    assert.equal(result.phase, "CASE_FROZEN");
    assert.equal(result.next_required_stage, "HUMAN_PRIOR_FROZEN");
    assert.equal(verification.phase, "CASE_FROZEN");
    assert.equal(publicVerification.valid, true);
    assert.equal(raw.bars.length, 100);
    assert.equal(existsSync(path.join(caseDirectory, "outcome.json")), false);
    assert.equal(existsSync(path.join(vaultRoot, "outcomes", "MKT-001.json")), true);
    assert.equal(
      existsSync(path.join(
        samplingRoot,
        "frozen-case-receipts",
        "MKT-001.json"
      )),
      true
    );
    assert.equal(manifestText.includes(candidate.symbol), false);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
