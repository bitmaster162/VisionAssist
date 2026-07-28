import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import {
  readJson,
  sha256CanonicalJsonFile,
  sha256File,
  sha256Json,
  sha256Text
} from "./canonical-json.js";
import { prepareCase } from "./intake.js";
import { freezeCase, verifyCase } from "./lifecycle.js";
import { renderCandlestickPng } from "./png-chart.js";

export const MARKET_PROTOCOL_ID = "market-calendar-stratified-v1";
export const MARKET_SELECTION_CODE_VERSION = "visionassist-market-selection-v1";
export const MARKET_SOURCE_ENDPOINT = "https://api.binance.com/api/v3/klines";

const SYMBOLS = Object.freeze([
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT"
]);
const INTERVALS = Object.freeze(["15m", "1h", "4h"]);
const INTERVAL_MILLISECONDS = Object.freeze({
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000
});
const QUARTERS = Object.freeze([
  {
    id: "2024-q1",
    start: Date.UTC(2024, 0, 1),
    endExclusive: Date.UTC(2024, 3, 1)
  },
  {
    id: "2024-q2",
    start: Date.UTC(2024, 3, 1),
    endExclusive: Date.UTC(2024, 6, 1)
  },
  {
    id: "2024-q3",
    start: Date.UTC(2024, 6, 1),
    endExclusive: Date.UTC(2024, 9, 1)
  },
  {
    id: "2024-q4",
    start: Date.UTC(2024, 9, 1),
    endExclusive: Date.UTC(2025, 0, 1)
  }
]);

const VISIBLE_BARS = 80;
const OUTCOME_BARS = 20;
const LABELS = Object.freeze(["up", "down", "range"]);
const DEFAULT_ROLES = Object.freeze({
  curator_id: "r26-curator-001",
  outcome_custodian_id: "r26-outcome-custodian-001",
  human_analyst_id: "r26-human-analyst-001",
  adjudicator_id: "r26-adjudicator-001"
});

function requireCondition(condition, message, code = "market_corpus_error") {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function writeJsonExclusive(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  });
}

function writeBufferExclusive(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, { flag: "wx" });
}

function poolPaths(samplingRoot, vaultRoot) {
  return {
    protocol: path.join(path.resolve(samplingRoot), "market-sampling-protocol-v1.json"),
    commitment: path.join(path.resolve(samplingRoot), "market-candidate-pool.commitment.json"),
    pool: path.join(path.resolve(vaultRoot), "market-candidate-pool.json"),
    secret: path.join(path.resolve(vaultRoot), "market-sampling-secret.json")
  };
}

function deterministicIndex(material, count) {
  const digest = sha256Text(material);
  const head = BigInt(`0x${digest.slice(0, 16)}`);
  return Number(head % BigInt(count));
}

function alignedCandidateTimes(quarter, intervalMilliseconds) {
  const historyGuard = 14 * 24 * 60 * 60 * 1000;
  const futureGuard = 7 * 24 * 60 * 60 * 1000;
  const first = Math.ceil(
    (quarter.start + historyGuard) / intervalMilliseconds
  ) * intervalMilliseconds;
  const last = Math.floor(
    (quarter.endExclusive - futureGuard) / intervalMilliseconds
  ) * intervalMilliseconds;
  const count = Math.floor((last - first) / intervalMilliseconds) + 1;
  requireCondition(count > 0, `No eligible times for ${quarter.id}`);
  return { first, count };
}

export function buildMarketCandidatePool(seed) {
  requireCondition(
    typeof seed === "string" && seed.length >= 32,
    "Sampling seed must contain at least 32 characters."
  );

  const developmentStrata = [];
  const holdoutStrata = [];
  for (const interval of INTERVALS) {
    for (const symbol of SYMBOLS) {
      const holdoutQuarterIndex = deterministicIndex(
        [MARKET_SELECTION_CODE_VERSION, seed, symbol, interval, "holdout-quarter"]
          .join("\u0000"),
        QUARTERS.length
      );
      for (const [quarterIndex, quarter] of QUARTERS.entries()) {
        const intervalMilliseconds = INTERVAL_MILLISECONDS[interval];
        const eligible = alignedCandidateTimes(quarter, intervalMilliseconds);
        const selectionMaterial = [
          MARKET_SELECTION_CODE_VERSION,
          seed,
          quarter.id,
          symbol,
          interval,
          "cutoff"
        ].join("\u0000");
        const selectedIndex = deterministicIndex(selectionMaterial, eligible.count);
        const cutoffOpenTime = eligible.first + selectedIndex * intervalMilliseconds;
        const stratum = {
          source: "binance_spot",
          symbol,
          interval,
          temporal_stratum: quarter.id,
          cutoff_open_time_ms: cutoffOpenTime,
          cutoff_open_time: new Date(cutoffOpenTime).toISOString(),
          visible_bars: VISIBLE_BARS,
          outcome_bars: OUTCOME_BARS
        };
        if (quarterIndex === holdoutQuarterIndex) {
          holdoutStrata.push(stratum);
        } else {
          developmentStrata.push(stratum);
        }
      }
    }
  }

  const byHiddenOrder = (left, right) => {
    const leftKey = sha256Text([
      MARKET_SELECTION_CODE_VERSION,
      seed,
      left.symbol,
      left.interval,
      left.temporal_stratum,
      "slot-order"
    ].join("\u0000"));
    const rightKey = sha256Text([
      MARKET_SELECTION_CODE_VERSION,
      seed,
      right.symbol,
      right.interval,
      right.temporal_stratum,
      "slot-order"
    ].join("\u0000"));
    return leftKey.localeCompare(rightKey);
  };
  developmentStrata.sort(byHiddenOrder);
  holdoutStrata.sort(byHiddenOrder);
  requireCondition(
    developmentStrata.length === 45 && holdoutStrata.length === 15,
    "Market split must contain 45 development and 15 holdout strata."
  );

  const candidates = [
    ...developmentStrata.map((candidate, index) => ({
      case_id: `MKT-${String(index + 1).padStart(3, "0")}`,
      split: "development",
      ...candidate
    })),
    ...holdoutStrata.map((candidate, index) => ({
      case_id: `MKT-${String(index + 46).padStart(3, "0")}`,
      split: "blinded_holdout",
      ...candidate
    }))
  ];

  requireCondition(candidates.length === 60, "Market pool must contain 60 cases.");
  requireCondition(
    new Set(candidates.map((candidate) =>
      `${candidate.symbol}|${candidate.interval}|${candidate.cutoff_open_time_ms}`
    )).size === 60,
    "Market pool contains duplicate source windows."
  );

  return {
    schema_version: "visionassist.benchmark.market-candidate-pool.v1",
    protocol_id: MARKET_PROTOCOL_ID,
    selection_code_version: MARKET_SELECTION_CODE_VERSION,
    candidates
  };
}

export function registerMarketCandidatePool({
  samplingRoot,
  vaultRoot,
  seed = randomBytes(32).toString("hex"),
  now = new Date().toISOString()
}) {
  const paths = poolPaths(samplingRoot, vaultRoot);
  Object.values(paths).forEach((filePath) =>
    requireCondition(!existsSync(filePath), `${filePath} already exists`)
  );

  const pool = buildMarketCandidatePool(seed);
  const poolCommitment = sha256Json(pool);
  const seedCommitment = sha256Text(seed);
  const caseIds = pool.candidates.map((candidate) => candidate.case_id);
  const commitment = {
    schema_version: "visionassist.benchmark.market-pool-commitment.v1",
    protocol_id: MARKET_PROTOCOL_ID,
    frozen_at: now,
    candidate_count: pool.candidates.length,
    case_ids_sha256: sha256Json(caseIds),
    candidate_pool_commitment_sha256: poolCommitment,
    seed_commitment_sha256: seedCommitment,
    selection_code_version: MARKET_SELECTION_CODE_VERSION
  };
  const protocol = {
    schema_version: "visionassist.benchmark.sampling-protocol.v1",
    protocol_id: MARKET_PROTOCOL_ID,
    status: "FROZEN",
    frozen_at: now,
    source: {
      provider: "Binance",
      market: "spot",
      endpoint: MARKET_SOURCE_ENDPOINT,
      symbols_count: SYMBOLS.length,
      intervals: [...INTERVALS]
    },
    corpus: {
      case_count: 60,
      visible_bars_per_case: VISIBLE_BARS,
      outcome_bars_per_case: OUTCOME_BARS,
      development_slots: "MKT-001..045",
      blinded_holdout_slots: "MKT-046..060",
      temporal_strata: QUARTERS.map((quarter) => quarter.id)
    },
    selection: {
      method: "One cutoff per symbol, interval, and calendar-quarter stratum; hidden-seed SHA-256 selects cutoffs, one holdout quarter per symbol and interval, and an opaque slot permutation.",
      price_or_outcome_fields_used: false,
      hidden_seed_custodian_only: true,
      slot_to_source_mapping_public: false,
      seed_commitment_sha256: seedCommitment,
      candidate_pool_commitment_sha256: poolCommitment,
      selection_code_version: MARKET_SELECTION_CODE_VERSION
    },
    outcome: {
      labels: [...LABELS],
      horizon: "next 20 completed bars",
      resolution_rule: "Compare final close at bar 20 with cutoff close. Up/down requires an absolute move of at least max(0.5 * visible ATR14, 0.2% of cutoff close); otherwise range.",
      should_abstain_rule: "True only when the source extract is incomplete, non-consecutive, non-finite, or the rendered evidence cannot be validated."
    },
    authority: {
      decision_status: "DIAGNOSTIC_ONLY",
      action_code: "NO_ACTION",
      execution_permission: "HOLD",
      capital_permission: "DENY",
      can_trade: false
    }
  };
  const secret = {
    schema_version: "visionassist.benchmark.market-sampling-secret.v1",
    protocol_id: MARKET_PROTOCOL_ID,
    seed,
    seed_commitment_sha256: seedCommitment,
    created_at: now,
    access_class: "OUTCOME_CUSTODIAN_ONLY"
  };

  const created = [];
  try {
    writeJsonExclusive(paths.protocol, protocol);
    created.push(paths.protocol);
    writeJsonExclusive(paths.commitment, commitment);
    created.push(paths.commitment);
    writeJsonExclusive(paths.pool, pool);
    created.push(paths.pool);
    writeJsonExclusive(paths.secret, secret);
    created.push(paths.secret);
  } catch (error) {
    for (const filePath of created.reverse()) {
      rmSync(filePath, { force: true });
    }
    throw error;
  }

  return {
    protocol_id: MARKET_PROTOCOL_ID,
    status: "FROZEN",
    frozen_at: now,
    candidate_count: 60,
    candidate_pool_commitment_sha256: poolCommitment,
    seed_commitment_sha256: seedCommitment,
    public_protocol_path: paths.protocol,
    public_commitment_path: paths.commitment,
    custodian_pool_path: paths.pool
  };
}

export function verifyMarketCandidatePool({ samplingRoot, vaultRoot }) {
  const paths = poolPaths(samplingRoot, vaultRoot);
  Object.values(paths).forEach((filePath) =>
    requireCondition(existsSync(filePath), `${filePath} is missing`)
  );
  const protocol = readJson(paths.protocol);
  const commitment = readJson(paths.commitment);
  const pool = readJson(paths.pool);
  const secret = readJson(paths.secret);

  requireCondition(protocol.status === "FROZEN", "Market protocol is not frozen.");
  requireCondition(
    protocol.protocol_id === MARKET_PROTOCOL_ID &&
      commitment.protocol_id === MARKET_PROTOCOL_ID &&
      pool.protocol_id === MARKET_PROTOCOL_ID &&
      secret.protocol_id === MARKET_PROTOCOL_ID,
    "Market protocol identifiers do not match."
  );
  requireCondition(
    sha256Text(secret.seed) === secret.seed_commitment_sha256 &&
      secret.seed_commitment_sha256 === commitment.seed_commitment_sha256 &&
      commitment.seed_commitment_sha256 ===
        protocol.selection.seed_commitment_sha256,
    "Sampling seed commitment mismatch."
  );
  const regenerated = buildMarketCandidatePool(secret.seed);
  requireCondition(
    sha256Json(regenerated) === sha256Json(pool),
    "Custodian candidate pool does not match the frozen selection rule."
  );
  requireCondition(
    sha256Json(pool) === commitment.candidate_pool_commitment_sha256 &&
      commitment.candidate_pool_commitment_sha256 ===
        protocol.selection.candidate_pool_commitment_sha256,
    "Candidate pool commitment mismatch."
  );
  requireCondition(
    commitment.candidate_count === 60 &&
      pool.candidates.length === 60,
    "Candidate count must remain 60."
  );

  return {
    valid: true,
    protocol,
    commitment,
    pool,
    paths
  };
}

function parseKline(row, index) {
  requireCondition(
    Array.isArray(row) && row.length >= 7,
    `Kline ${index} has an invalid shape.`,
    "market_source_invalid"
  );
  const bar = {
    open_time_ms: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    close_time_ms: Number(row[6])
  };
  requireCondition(
    Object.values(bar).every(Number.isFinite),
    `Kline ${index} contains a non-finite value.`,
    "market_source_invalid"
  );
  requireCondition(
    bar.high >= Math.max(bar.open, bar.close) &&
      bar.low <= Math.min(bar.open, bar.close) &&
      bar.high >= bar.low,
    `Kline ${index} violates OHLC bounds.`,
    "market_source_invalid"
  );
  return bar;
}

export function validateMarketBars(rows, candidate) {
  requireCondition(
    Array.isArray(rows) && rows.length === VISIBLE_BARS + OUTCOME_BARS,
    "Market source must return exactly 100 bars.",
    "market_source_invalid"
  );
  const bars = rows.map(parseKline);
  const intervalMilliseconds = INTERVAL_MILLISECONDS[candidate.interval];
  const expectedStart =
    candidate.cutoff_open_time_ms - (VISIBLE_BARS - 1) * intervalMilliseconds;
  bars.forEach((bar, index) => {
    requireCondition(
      bar.open_time_ms === expectedStart + index * intervalMilliseconds,
      `Kline ${index} is not consecutive or aligned.`,
      "market_source_invalid"
    );
  });
  requireCondition(
    bars[VISIBLE_BARS - 1].open_time_ms === candidate.cutoff_open_time_ms,
    "Visible bars do not end at the frozen cutoff.",
    "market_source_invalid"
  );
  return bars;
}

export async function fetchBinanceMarketBars(candidate, {
  fetchImpl = fetch
} = {}) {
  const intervalMilliseconds = INTERVAL_MILLISECONDS[candidate.interval];
  const startTime =
    candidate.cutoff_open_time_ms - (VISIBLE_BARS - 1) * intervalMilliseconds;
  const url = new URL(MARKET_SOURCE_ENDPOINT);
  url.searchParams.set("symbol", candidate.symbol);
  url.searchParams.set("interval", candidate.interval);
  url.searchParams.set("startTime", String(startTime));
  url.searchParams.set("limit", String(VISIBLE_BARS + OUTCOME_BARS));
  url.searchParams.set("timeZone", "0");

  const response = await fetchImpl(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "VisionAssist-R26-Benchmark/0.1"
    }
  });
  const rawText = await response.text();
  requireCondition(
    response.ok,
    `Binance kline request failed with ${response.status}.`,
    "market_source_request_failed"
  );
  const rows = JSON.parse(rawText);
  return {
    request_url: url.toString(),
    rows,
    bars: validateMarketBars(rows, candidate)
  };
}

function averageTrueRange14(visibleBars) {
  const start = visibleBars.length - 14;
  let total = 0;
  for (let index = start; index < visibleBars.length; index += 1) {
    const bar = visibleBars[index];
    const previousClose = index > 0
      ? visibleBars[index - 1].close
      : bar.open;
    total += Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previousClose),
      Math.abs(bar.low - previousClose)
    );
  }
  return total / 14;
}

export function resolveMarketOutcome(bars) {
  requireCondition(
    bars.length === VISIBLE_BARS + OUTCOME_BARS,
    "Outcome resolver requires exactly 100 validated bars."
  );
  const visible = bars.slice(0, VISIBLE_BARS);
  const future = bars.slice(VISIBLE_BARS);
  const cutoffClose = visible.at(-1).close;
  const finalClose = future.at(-1).close;
  const atr14 = averageTrueRange14(visible);
  const threshold = Math.max(0.5 * atr14, 0.002 * cutoffClose);
  const delta = finalClose - cutoffClose;
  const label = delta >= threshold
    ? "up"
    : delta <= -threshold
      ? "down"
      : "range";
  return {
    label,
    cutoff_close: cutoffClose,
    final_close: finalClose,
    delta,
    atr14,
    threshold,
    future_start_ms: future[0].open_time_ms,
    future_end_ms: future.at(-1).close_time_ms
  };
}

export function publishMarketCaseFreezeReceipt({
  caseId,
  samplingRoot,
  vaultRoot,
  casesRoot
}) {
  const poolVerification = verifyMarketCandidatePool({ samplingRoot, vaultRoot });
  requireCondition(
    poolVerification.pool.candidates.some((candidate) => candidate.case_id === caseId),
    `${caseId} is not in the frozen market pool.`
  );
  const caseDirectory = path.join(path.resolve(casesRoot), caseId);
  const caseVerification = verifyCase(caseDirectory);
  const manifest = caseVerification.context.caseManifest;
  requireCondition(manifest.domain === "market", `${caseId} is not a market case.`);
  requireCondition(
    manifest.sampling.protocol_id === MARKET_PROTOCOL_ID,
    `${caseId} uses a different sampling protocol.`
  );
  const firstEntry = caseVerification.receipt.chain[0];
  const publicReceipt = {
    schema_version: "visionassist.benchmark.market-case-freeze-receipt.v1",
    benchmark_id: "VISIONASSIST_CHART_INTENT_AND_HUMAN_AI_FUSION_PROOF",
    case_id: caseId,
    split: manifest.split,
    phase_at_publication: caseVerification.phase,
    protocol_id: MARKET_PROTOCOL_ID,
    candidate_pool_commitment_sha256:
      poolVerification.commitment.candidate_pool_commitment_sha256,
    case_manifest_sha256: sha256CanonicalJsonFile(
      path.join(caseDirectory, "case.json")
    ),
    evidence_sha256: manifest.evidence.sha256,
    outcome_commitment_sha256: manifest.outcome_commitment_sha256,
    initial_chain_sha256: firstEntry.chain_sha256,
    case_frozen_at: firstEntry.frozen_at,
    source_identity_exposed: false,
    outcome_exposed: false,
    claims_boundary: "This receipt proves local hash consistency only. It is not an independent timestamp, operator identity proof, or benchmark result.",
    authority: {
      decision_status: "DIAGNOSTIC_ONLY",
      action_code: "NO_ACTION",
      execution_permission: "HOLD",
      capital_permission: "DENY",
      can_trade: false
    }
  };
  const receiptPath = path.join(
    path.resolve(samplingRoot),
    "frozen-case-receipts",
    `${caseId}.json`
  );
  writeJsonExclusive(receiptPath, publicReceipt);
  return {
    case_id: caseId,
    public_receipt_path: receiptPath,
    receipt: publicReceipt
  };
}

export function verifyPublishedMarketCaseFreezeReceipt({
  caseId,
  samplingRoot,
  vaultRoot,
  casesRoot
}) {
  const poolVerification = verifyMarketCandidatePool({ samplingRoot, vaultRoot });
  const candidate = poolVerification.pool.candidates.find(
    (item) => item.case_id === caseId
  );
  requireCondition(candidate, `${caseId} is not in the frozen market pool.`);
  const caseDirectory = path.join(path.resolve(casesRoot), caseId);
  const caseVerification = verifyCase(caseDirectory);
  const manifest = caseVerification.context.caseManifest;
  const publicReceiptPath = path.join(
    path.resolve(samplingRoot),
    "frozen-case-receipts",
    `${caseId}.json`
  );
  const outcomePath = path.join(
    path.resolve(vaultRoot),
    "outcomes",
    `${caseId}.json`
  );
  const rawPath = path.join(
    path.resolve(vaultRoot),
    "raw",
    `${caseId}.json`
  );
  requireCondition(existsSync(publicReceiptPath), `${caseId} public receipt is missing.`);
  requireCondition(existsSync(outcomePath), `${caseId} sealed outcome is missing.`);
  requireCondition(existsSync(rawPath), `${caseId} raw source extract is missing.`);
  const publicReceipt = readJson(publicReceiptPath);
  const outcome = readJson(outcomePath);
  const rawRecord = readJson(rawPath);
  const firstEntry = caseVerification.receipt.chain[0];

  requireCondition(
    publicReceipt.case_id === caseId &&
      publicReceipt.phase_at_publication === "CASE_FROZEN",
    `${caseId} public receipt phase mismatch.`
  );
  requireCondition(
    publicReceipt.candidate_pool_commitment_sha256 ===
      poolVerification.commitment.candidate_pool_commitment_sha256,
    `${caseId} public receipt pool commitment mismatch.`
  );
  requireCondition(
    publicReceipt.case_manifest_sha256 ===
      sha256CanonicalJsonFile(path.join(caseDirectory, "case.json")),
    `${caseId} public receipt manifest hash mismatch.`
  );
  requireCondition(
    publicReceipt.evidence_sha256 === manifest.evidence.sha256 &&
      publicReceipt.outcome_commitment_sha256 ===
        manifest.outcome_commitment_sha256 &&
      publicReceipt.initial_chain_sha256 === firstEntry.chain_sha256,
    `${caseId} public receipt artifact hash mismatch.`
  );
  requireCondition(
    sha256Json(outcome) === manifest.outcome_commitment_sha256,
    `${caseId} sealed outcome no longer matches its commitment.`
  );
  requireCondition(
    outcome.evidence_refs.includes(
      `market-source-extract-sha256:${sha256Json(rawRecord)}`
    ),
    `${caseId} raw source extract hash is not bound to the outcome.`
  );
  requireCondition(
    !JSON.stringify(manifest).includes(candidate.symbol),
    `${caseId} manifest exposes its custodian-held source symbol.`,
    "hindsight_leakage_risk"
  );
  requireCondition(
    publicReceipt.source_identity_exposed === false &&
      publicReceipt.outcome_exposed === false,
    `${caseId} public receipt declares exposure.`
  );

  return {
    valid: true,
    case_id: caseId,
    split: manifest.split,
    phase: caseVerification.phase,
    evidence_sha256: manifest.evidence.sha256,
    outcome_commitment_sha256: manifest.outcome_commitment_sha256,
    chain_sha256: caseVerification.chain_sha256
  };
}

export function verifyCompleteMarketCorpus({
  samplingRoot,
  vaultRoot,
  casesRoot
}) {
  const poolVerification = verifyMarketCandidatePool({ samplingRoot, vaultRoot });
  const results = poolVerification.pool.candidates.map((candidate) =>
    verifyPublishedMarketCaseFreezeReceipt({
      caseId: candidate.case_id,
      samplingRoot,
      vaultRoot,
      casesRoot
    })
  );
  requireCondition(results.length === 60, "Complete market corpus must contain 60 cases.");
  requireCondition(
    new Set(results.map((result) => result.evidence_sha256)).size === 60,
    "Market corpus contains duplicate evidence assets."
  );
  const phaseCounts = {};
  for (const result of results) {
    phaseCounts[result.phase] = (phaseCounts[result.phase] ?? 0) + 1;
  }
  return {
    valid: true,
    protocol_id: MARKET_PROTOCOL_ID,
    candidate_pool_commitment_sha256:
      poolVerification.commitment.candidate_pool_commitment_sha256,
    market_cases: results.length,
    development_cases: results.filter((result) => result.split === "development").length,
    blinded_holdout_cases: results.filter((result) =>
      result.split === "blinded_holdout"
    ).length,
    unique_evidence_assets: new Set(
      results.map((result) => result.evidence_sha256)
    ).size,
    phase_counts: phaseCounts,
    source_identity_exposed: false,
    outcome_exposed: false,
    authority: {
      decision_status: "DIAGNOSTIC_ONLY",
      action_code: "NO_ACTION",
      execution_permission: "HOLD",
      capital_permission: "DENY",
      can_trade: false
    }
  };
}

export async function bootstrapMarketCase({
  caseId,
  samplingRoot,
  vaultRoot,
  casesRoot,
  roles = DEFAULT_ROLES,
  now = new Date().toISOString(),
  fetchImpl = fetch
}) {
  const verification = verifyMarketCandidatePool({ samplingRoot, vaultRoot });
  const candidate = verification.pool.candidates.find(
    (item) => item.case_id === caseId
  );
  requireCondition(candidate, `${caseId} is not in the frozen market pool.`);
  const resolvedVaultRoot = path.resolve(vaultRoot);
  const resolvedCasesRoot = path.resolve(casesRoot);
  const caseDirectory = path.join(resolvedCasesRoot, caseId);
  requireCondition(!existsSync(caseDirectory), `${caseId} already exists.`);

  const fetched = await fetchBinanceMarketBars(candidate, { fetchImpl });
  const visibleBars = fetched.bars.slice(0, VISIBLE_BARS);
  const outcomeResult = resolveMarketOutcome(fetched.bars);
  const rawRecord = {
    schema_version: "visionassist.benchmark.market-source-extract.v1",
    case_id: caseId,
    protocol_id: MARKET_PROTOCOL_ID,
    source: {
      provider: "Binance",
      market: "spot",
      endpoint: MARKET_SOURCE_ENDPOINT,
      symbol: candidate.symbol,
      interval: candidate.interval
    },
    query: {
      start_time_ms: fetched.bars[0].open_time_ms,
      limit: VISIBLE_BARS + OUTCOME_BARS,
      cutoff_open_time_ms: candidate.cutoff_open_time_ms
    },
    fetched_at: now,
    bars: fetched.rows
  };
  const rawHash = sha256Json(rawRecord);
  const evidencePath = path.join(resolvedVaultRoot, "evidence-staging", `${caseId}.png`);
  const rawPath = path.join(resolvedVaultRoot, "raw", `${caseId}.json`);
  const outcomePath = path.join(resolvedVaultRoot, "outcomes", `${caseId}.json`);
  const intakePath = path.join(resolvedVaultRoot, "intake", `${caseId}.json`);
  const evidence = renderCandlestickPng(visibleBars);
  const outcome = {
    schema_version: "visionassist.benchmark.outcome.v1",
    case_id: caseId,
    custodian_id: roles.outcome_custodian_id,
    sealed_at: now,
    outcome_label: outcomeResult.label,
    outcome_summary: [
      `Final close after 20 bars: ${outcomeResult.final_close}.`,
      `Cutoff close: ${outcomeResult.cutoff_close}.`,
      `Absolute threshold: ${outcomeResult.threshold}.`
    ].join(" "),
    observation_window: `${new Date(outcomeResult.future_start_ms).toISOString()} to ${new Date(outcomeResult.future_end_ms).toISOString()}`,
    should_abstain: false,
    evidence_refs: [
      `market-source-extract-sha256:${rawHash}`,
      "binance-spot-api-v3-klines"
    ]
  };
  const cutoffBar = visibleBars.at(-1);
  const intake = {
    schema_version: "visionassist.benchmark.case-intake.v1",
    case_id: caseId,
    modality: "chart_image",
    sampling: {
      candidate_id: `candidate-${caseId}`,
      protocol_id: MARKET_PROTOCOL_ID,
      source_family: "binance-spot-klines-v3",
      stratum: candidate.temporal_stratum,
      timeframe: candidate.interval,
      selected_without_outcome_access: true
    },
    captured_at: new Date(cutoffBar.close_time_ms).toISOString(),
    cutoff_description: "Exactly 80 completed candles end at the frozen cutoff. No future candle, symbol, price label, or source identity is rendered.",
    provenance: `Custodian-held Binance Spot extract committed as ${rawHash}; public pool commitment ${verification.commitment.candidate_pool_commitment_sha256}.`,
    outcome_definition: {
      labels: [...LABELS],
      horizon: "next 20 completed bars",
      resolution_rule: verification.protocol.outcome.resolution_rule,
      should_abstain_rule: verification.protocol.outcome.should_abstain_rule
    },
    roles,
    created_at: now
  };

  const created = [];
  try {
    writeBufferExclusive(evidencePath, evidence);
    created.push(evidencePath);
    writeJsonExclusive(rawPath, rawRecord);
    created.push(rawPath);
    writeJsonExclusive(outcomePath, outcome);
    created.push(outcomePath);
    writeJsonExclusive(intakePath, intake);
    created.push(intakePath);

    const prepared = prepareCase({
      intakePath,
      evidenceSourcePath: evidencePath,
      sealedOutcomePath: outcomePath,
      casesRoot: resolvedCasesRoot
    });
    const frozen = freezeCase(prepared.case_directory, outcomePath, {
      frozenAt: now
    });
    const publicReceipt = publishMarketCaseFreezeReceipt({
      caseId,
      samplingRoot,
      vaultRoot,
      casesRoot: resolvedCasesRoot
    });
    created.push(publicReceipt.public_receipt_path);
    return {
      case_id: caseId,
      phase: frozen.phase,
      split: frozen.split,
      evidence_sha256: sha256File(
        path.join(prepared.case_directory, "evidence", "source.png")
      ),
      outcome_commitment_sha256:
        frozen.context.caseManifest.outcome_commitment_sha256,
      chain_sha256: frozen.chain_sha256,
      source_identity_exposed: false,
      outcome_exposed: false,
      public_freeze_receipt: publicReceipt.public_receipt_path,
      next_required_stage: "HUMAN_PRIOR_FROZEN"
    };
  } catch (error) {
    if (existsSync(caseDirectory)) {
      rmSync(caseDirectory, { recursive: true, force: true });
    }
    for (const filePath of created.reverse()) {
      rmSync(filePath, { force: true });
    }
    throw error;
  }
}
