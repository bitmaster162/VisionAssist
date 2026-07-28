import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync
} from "node:fs";
import path from "node:path";

import {
  readJson,
  sha256File,
  sha256Json
} from "./canonical-json.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const CASE_PATTERN = /^MKT-R34-\d{3}$/;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const AUTHORITY = Object.freeze({
  decision_status: "DIAGNOSTIC_ONLY",
  action_code: "NO_ACTION",
  execution_permission: "HOLD",
  capital_permission: "DENY",
  can_trade: false
});

const TOP_LEVEL_KEYS = Object.freeze([
  "schema_version",
  "batch_id",
  "track_id",
  "case_id",
  "capture_mode",
  "timing",
  "instrument",
  "horizon",
  "applicability_matrix",
  "critical_group_status",
  "source_group_registry",
  "artifact_manifest",
  "price_and_volume",
  "token_metrics",
  "derivatives",
  "deterministic_indicators",
  "events_and_articles",
  "reference_market_and_regime",
  "leakage_scan",
  "authority"
]);

export const R34_CRITICAL_GROUPS = Object.freeze([
  "instrument_identity_and_horizon",
  "sequential_pre_cutoff_ohlcv",
  "cutoff_price",
  "spot_and_perpetual_volume",
  "spread_and_depth",
  "turnover",
  "market_cap_fdv_and_circulating_supply",
  "open_interest_and_pre_cutoff_changes",
  "funding_rate",
  "spot_perpetual_basis",
  "liquidations",
  "deterministic_indicators",
  "reference_market_and_regime",
  "bounded_pre_cutoff_event_search",
  "source_query_and_byte_provenance"
]);

const DERIVATIVE_GROUPS = new Set([
  "open_interest_and_pre_cutoff_changes",
  "funding_rate",
  "spot_perpetual_basis",
  "liquidations"
]);

const FORBIDDEN_KEYS = new Set([
  "outcome",
  "sealed_outcome",
  "outcome_artifact",
  "outcome_commentary",
  "future_bars",
  "future_frames",
  "ai_assessment",
  "fusion_output",
  "baseline_output",
  "reveal_output",
  "adjudication_output",
  "scoring_output"
]);

const FORBIDDEN_FILE_PATTERN =
  /(^|[._-])(outcome|future|reveal|fusion|score|scoring|adjudication|ai-assessment|ai_assessment|baseline-output|baseline_output)([._-]|$)/i;

const FORMULA_MANIFEST = JSON.parse(
  readFileSync(
    new URL("../schemas/market-indicator-formulas-r34.json", import.meta.url),
    "utf8"
  )
);

export const R34_FORMULA_MANIFEST_SHA256 = sha256Json(FORMULA_MANIFEST);

export class MarketEvidenceGateError extends Error {
  constructor(message, violations, receipt) {
    super(message);
    this.name = "MarketEvidenceGateError";
    this.code = "MARKET_EVIDENCE_GATE_FAILED";
    this.violations = violations;
    this.receipt = receipt;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addViolation(violations, code, pathName, message) {
  violations.push({ code, path: pathName, message });
}

function requireObject(value, pathName, violations) {
  if (!isObject(value)) {
    addViolation(
      violations,
      "MISSING_REQUIRED_CONTEXT",
      pathName,
      `${pathName} must be an object`
    );
    return false;
  }
  return true;
}

function requireExactKeys(value, keys, pathName, violations) {
  if (!requireObject(value, pathName, violations)) {
    return false;
  }
  const expected = new Set(keys);
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      addViolation(
        violations,
        "MISSING_REQUIRED_CONTEXT",
        `${pathName}.${key}`,
        `${pathName}.${key} is required`
      );
    }
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      addViolation(
        violations,
        "BLIND_MODE_VIOLATION",
        `${pathName}.${key}`,
        `${pathName}.${key} is not allowed`
      );
    }
  }
  return true;
}

function requireString(value, pathName, violations) {
  if (typeof value !== "string" || value.trim() === "") {
    addViolation(
      violations,
      "MISSING_REQUIRED_CONTEXT",
      pathName,
      `${pathName} must be a non-empty string`
    );
    return false;
  }
  return true;
}

function requireFinite(value, pathName, violations, {
  minimum = -Infinity,
  strictlyPositive = false
} = {}) {
  const valid = typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    (!strictlyPositive || value > 0);
  if (!valid) {
    addViolation(
      violations,
      "MISSING_REQUIRED_CONTEXT",
      pathName,
      `${pathName} must be a finite number`
    );
  }
  return valid;
}

function requireHash(value, pathName, violations) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    addViolation(
      violations,
      "HASH_MISMATCH",
      pathName,
      `${pathName} must be a lowercase SHA-256 digest`
    );
    return false;
  }
  return true;
}

function parseTimestamp(value, pathName, violations) {
  if (
    typeof value !== "string" ||
    !TIMESTAMP_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    addViolation(
      violations,
      "POST_CUTOFF_DATA",
      pathName,
      `${pathName} must be an explicit UTC timestamp`
    );
    return null;
  }
  return Date.parse(value);
}

function requireChronology(left, operator, right, pathName, violations) {
  if (left === null || right === null) {
    return;
  }
  const valid = operator === "<" ? left < right : left <= right;
  if (!valid) {
    addViolation(
      violations,
      "POST_CUTOFF_DATA",
      pathName,
      `chronology requires left ${operator} right`
    );
  }
}

function valuesClose(actual, expected) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    return false;
  }
  const absolute = FORMULA_MANIFEST.numeric_tolerance.absolute;
  const relative = FORMULA_MANIFEST.numeric_tolerance.relative;
  return Math.abs(actual - expected) <=
    Math.max(absolute, relative * Math.max(Math.abs(actual), Math.abs(expected)));
}

function requireReproduced(actual, expected, pathName, violations) {
  if (!valuesClose(actual, expected)) {
    addViolation(
      violations,
      "DERIVED_MISMATCH",
      pathName,
      `${pathName} does not reproduce from committed OHLCV`
    );
  }
}

function ema(values, period) {
  if (values.length < period) {
    return null;
  }
  let current = values
    .slice(0, period)
    .reduce((sum, value) => sum + value, 0) / period;
  const alpha = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    current = values[index] * alpha + current * (1 - alpha);
  }
  return current;
}

function atr(rows, period) {
  if (rows.length < period + 1) {
    return null;
  }
  const trueRanges = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const previousClose = rows[index - 1].close;
    trueRanges.push(Math.max(
      row.high - row.low,
      Math.abs(row.high - previousClose),
      Math.abs(row.low - previousClose)
    ));
  }
  let current = trueRanges
    .slice(0, period)
    .reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < trueRanges.length; index += 1) {
    current = ((current * (period - 1)) + trueRanges[index]) / period;
  }
  return current;
}

function rsi(rows, period) {
  if (rows.length < period + 1) {
    return null;
  }
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = rows[index].close - rows[index - 1].close;
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let index = period + 1; index < rows.length; index += 1) {
    const change = rows[index].close - rows[index - 1].close;
    averageGain = ((averageGain * (period - 1)) + Math.max(change, 0)) / period;
    averageLoss = ((averageLoss * (period - 1)) + Math.max(-change, 0)) / period;
  }
  if (averageGain === 0 && averageLoss === 0) {
    return FORMULA_MANIFEST.formulas.rsi_14.zero_gain_and_loss;
  }
  if (averageLoss === 0) {
    return FORMULA_MANIFEST.formulas.rsi_14.zero_loss;
  }
  const relativeStrength = averageGain / averageLoss;
  return 100 - (100 / (1 + relativeStrength));
}

export function computeMarketIndicatorsR34(rows, returnWindowBars = [1, 5, 20]) {
  if (!Array.isArray(rows) || rows.length < 200) {
    throw new TypeError("R34 indicator reproduction requires at least 200 OHLCV rows.");
  }
  const closes = rows.map((row) => row.close);
  const last = rows.at(-1);
  const lastClose = last.close;
  const atr14 = atr(rows, 14);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const volumeTotal = rows.reduce((sum, row) => sum + row.volume, 0);
  if (!(volumeTotal > 0)) {
    throw new TypeError("R34 VWAP requires positive aggregate volume.");
  }
  const vwap = rows.reduce(
    (sum, row) => sum + (((row.high + row.low + row.close) / 3) * row.volume),
    0
  ) / volumeTotal;
  const atrPercent = (atr14 / lastClose) * 100;
  const volatilityRegime =
    atrPercent < FORMULA_MANIFEST.formulas.volatility_regime.low_below
      ? "LOW"
      : atrPercent < FORMULA_MANIFEST.formulas.volatility_regime.medium_below
        ? "MEDIUM"
        : "HIGH";

  return {
    atr_14: atr14,
    atr_percent: atrPercent,
    rsi_14: rsi(rows, 14),
    ema_20: ema20,
    ema_50: ema50,
    ema_200: ema200,
    distance_to_ema_20_percent: ((lastClose - ema20) / ema20) * 100,
    distance_to_ema_50_percent: ((lastClose - ema50) / ema50) * 100,
    distance_to_ema_200_percent: ((lastClose - ema200) / ema200) * 100,
    vwap,
    return_windows: returnWindowBars.map((bars) => {
      if (!Number.isInteger(bars) || bars < 1 || bars >= rows.length) {
        throw new TypeError(`Invalid return window ${bars}.`);
      }
      return {
        bars,
        return_percent:
          ((lastClose / rows[rows.length - 1 - bars].close) - 1) * 100
      };
    }),
    volume_change_percent:
      ((last.volume / rows[rows.length - 2].volume) - 1) * 100,
    volatility_regime: volatilityRegime
  };
}

function validateAuthority(authority, violations) {
  if (!requireExactKeys(
    authority,
    Object.keys(AUTHORITY),
    "authority",
    violations
  )) {
    return;
  }
  for (const [key, expected] of Object.entries(AUTHORITY)) {
    if (authority[key] !== expected) {
      addViolation(
        violations,
        "AUTHORITY_VIOLATION",
        `authority.${key}`,
        `authority.${key} must remain ${String(expected)}`
      );
    }
  }
}

function safeArtifactPath(caseDirectory, relativePath, pathName, violations) {
  if (!requireString(relativePath, pathName, violations)) {
    return null;
  }
  if (path.isAbsolute(relativePath)) {
    addViolation(
      violations,
      "HASH_MISMATCH",
      pathName,
      `${pathName} must be relative`
    );
    return null;
  }
  const resolved = path.resolve(caseDirectory, relativePath);
  const prefix = `${path.resolve(caseDirectory)}${path.sep}`;
  if (!resolved.startsWith(prefix)) {
    addViolation(
      violations,
      "HASH_MISMATCH",
      pathName,
      `${pathName} escapes the case directory`
    );
    return null;
  }
  return resolved;
}

function listFilesRecursively(root, violations, relative = "") {
  const directory = path.join(root, relative);
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const childRelative = path.join(relative, entry.name);
    const child = path.join(root, childRelative);
    const stat = lstatSync(child);
    if (stat.isSymbolicLink()) {
      addViolation(
        violations,
        "HASH_MISMATCH",
        childRelative,
        "symbolic links are forbidden in an evidence bundle"
      );
      continue;
    }
    if (stat.isDirectory()) {
      files.push(...listFilesRecursively(root, violations, childRelative));
    } else if (stat.isFile()) {
      files.push(childRelative.split(path.sep).join("/"));
    } else {
      addViolation(
        violations,
        "HASH_MISMATCH",
        childRelative,
        "unsupported filesystem member"
      );
    }
  }
  return files;
}

function validateArtifactManifest(caseDirectory, bundle, violations) {
  const artifacts = bundle.artifact_manifest;
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    addViolation(
      violations,
      "MISSING_REQUIRED_CONTEXT",
      "artifact_manifest",
      "artifact_manifest requires at least one item"
    );
    return new Map();
  }

  const artifactMap = new Map();
  const caseInsensitivePaths = new Set();
  artifacts.forEach((artifact, index) => {
    const itemPath = `artifact_manifest[${index}]`;
    if (!requireExactKeys(
      artifact,
      ["path", "sha256", "media_type", "role"],
      itemPath,
      violations
    )) {
      return;
    }
    const resolved = safeArtifactPath(
      caseDirectory,
      artifact.path,
      `${itemPath}.path`,
      violations
    );
    requireHash(artifact.sha256, `${itemPath}.sha256`, violations);
    requireString(artifact.media_type, `${itemPath}.media_type`, violations);
    requireString(artifact.role, `${itemPath}.role`, violations);
    const normalized = typeof artifact.path === "string"
      ? artifact.path.split("\\").join("/")
      : "";
    const caseKey = normalized.toLowerCase();
    if (
      normalized !== artifact.path ||
      normalized === "market_evidence_bundle.json" ||
      artifactMap.has(normalized) ||
      caseInsensitivePaths.has(caseKey)
    ) {
      addViolation(
        violations,
        "HASH_MISMATCH",
        `${itemPath}.path`,
        "artifact paths must be unique POSIX paths and must not list the bundle"
      );
      return;
    }
    artifactMap.set(normalized, artifact);
    caseInsensitivePaths.add(caseKey);
    if (!resolved || !existsSync(resolved) || !lstatSync(resolved).isFile()) {
      addViolation(
        violations,
        "HASH_MISMATCH",
        `${itemPath}.path`,
        "artifact file is missing"
      );
      return;
    }
    if (lstatSync(resolved).isSymbolicLink()) {
      addViolation(
        violations,
        "HASH_MISMATCH",
        `${itemPath}.path`,
        "artifact file must not be a symbolic link"
      );
      return;
    }
    const actual = sha256File(resolved);
    if (actual !== artifact.sha256) {
      addViolation(
        violations,
        "HASH_MISMATCH",
        `${itemPath}.sha256`,
        "artifact SHA-256 does not match file bytes"
      );
    }
  });

  const diskFiles = listFilesRecursively(caseDirectory, violations);
  for (const file of diskFiles) {
    if (file === "market_evidence_bundle.json") {
      continue;
    }
    if (!artifactMap.has(file)) {
      addViolation(
        violations,
        "BLIND_MODE_VIOLATION",
        file,
        "unmanifested sidecar is forbidden"
      );
    }
    if (FORBIDDEN_FILE_PATTERN.test(path.basename(file))) {
      addViolation(
        violations,
        "BLIND_MODE_VIOLATION",
        file,
        "future, outcome, AI, fusion, reveal, or scoring sidecar is forbidden"
      );
    }
  }
  for (const artifactPath of artifactMap.keys()) {
    if (!diskFiles.includes(artifactPath)) {
      addViolation(
        violations,
        "HASH_MISMATCH",
        artifactPath,
        "manifested artifact is absent from disk"
      );
    }
  }
  return artifactMap;
}

function scanForbiddenKeys(value, violations, pathName = "bundle") {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      scanForbiddenKeys(item, violations, `${pathName}[${index}]`)
    );
    return;
  }
  if (!isObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const isLeakageAttestation = pathName === "bundle.leakage_scan";
    if (!isLeakageAttestation && FORBIDDEN_KEYS.has(key.toLowerCase())) {
      addViolation(
        violations,
        "BLIND_MODE_VIOLATION",
        `${pathName}.${key}`,
        "future, outcome, AI, fusion, reveal, or scoring material is forbidden"
      );
    }
    scanForbiddenKeys(child, violations, `${pathName}.${key}`);
  }
}

function validateTiming(bundle, violations) {
  const timing = bundle.timing;
  if (!requireExactKeys(timing, [
    "external_context_profile_frozen_at",
    "case_selected_at",
    "cutoff_at",
    "bundle_sealed_at",
    "analyst_access_not_before_at",
    "prior_deadline",
    "horizon_start_at"
  ], "timing", violations)) {
    return null;
  }
  const times = Object.fromEntries(
    Object.keys(timing).map((key) => [
      key,
      parseTimestamp(timing[key], `timing.${key}`, violations)
    ])
  );
  requireChronology(
    times.external_context_profile_frozen_at,
    "<=",
    times.case_selected_at,
    "timing.profile_before_selection",
    violations
  );
  requireChronology(
    times.case_selected_at,
    "<=",
    times.cutoff_at,
    "timing.selection_before_cutoff",
    violations
  );
  requireChronology(
    times.cutoff_at,
    "<=",
    times.bundle_sealed_at,
    "timing.cutoff_before_seal",
    violations
  );
  requireChronology(
    times.bundle_sealed_at,
    "<",
    times.analyst_access_not_before_at,
    "timing.seal_before_access",
    violations
  );
  requireChronology(
    times.analyst_access_not_before_at,
    "<=",
    times.prior_deadline,
    "timing.access_before_deadline",
    violations
  );
  requireChronology(
    times.prior_deadline,
    "<",
    times.horizon_start_at,
    "timing.deadline_before_horizon",
    violations
  );
  return times;
}

function validateIdentity(bundle, violations) {
  if (bundle.schema_version !==
    "visionassist.benchmark.market-evidence-bundle-r34.v1") {
    addViolation(
      violations,
      "MISSING_REQUIRED_CONTEXT",
      "schema_version",
      "wrong market evidence schema_version"
    );
  }
  requireString(bundle.batch_id, "batch_id", violations);
  if (bundle.track_id !== "MARKET-R34") {
    addViolation(
      violations,
      "MISSING_REQUIRED_CONTEXT",
      "track_id",
      "track_id must be MARKET-R34"
    );
  }
  if (typeof bundle.case_id !== "string" || !CASE_PATTERN.test(bundle.case_id)) {
    addViolation(
      violations,
      "MISSING_REQUIRED_CONTEXT",
      "case_id",
      "case_id must match MKT-R34-nnn"
    );
  }
  if (bundle.capture_mode !== "FORWARD_LOCKED_FULL_CONTEXT") {
    addViolation(
      violations,
      "BLIND_MODE_VIOLATION",
      "capture_mode",
      "capture_mode must be FORWARD_LOCKED_FULL_CONTEXT"
    );
  }

  if (requireExactKeys(bundle.instrument, [
    "symbol",
    "venue",
    "asset_class",
    "quote_currency",
    "market_type"
  ], "instrument", violations)) {
    for (const key of [
      "symbol",
      "venue",
      "asset_class",
      "quote_currency",
      "market_type"
    ]) {
      requireString(bundle.instrument[key], `instrument.${key}`, violations);
    }
  }

  if (requireExactKeys(bundle.horizon, [
    "timeframe",
    "completed_bars",
    "labels",
    "resolution_rule"
  ], "horizon", violations)) {
    requireString(bundle.horizon.timeframe, "horizon.timeframe", violations);
    if (!Number.isInteger(bundle.horizon.completed_bars) ||
        bundle.horizon.completed_bars < 1) {
      addViolation(
        violations,
        "MISSING_REQUIRED_CONTEXT",
        "horizon.completed_bars",
        "horizon.completed_bars must be a positive integer"
      );
    }
    if (
      !Array.isArray(bundle.horizon.labels) ||
      bundle.horizon.labels.length !== 3 ||
      !["up", "down", "range"].every((label) =>
        bundle.horizon.labels.includes(label)
      )
    ) {
      addViolation(
        violations,
        "MISSING_REQUIRED_CONTEXT",
        "horizon.labels",
        "horizon labels must be exactly up, down, and range"
      );
    }
    requireString(
      bundle.horizon.resolution_rule,
      "horizon.resolution_rule",
      violations
    );
  }
}

function validateApplicability(bundle, times, violations) {
  const matrix = bundle.applicability_matrix;
  if (!requireExactKeys(matrix, [
    "frozen_at",
    "matrix_sha256",
    "derivatives",
    "token_metrics",
    "event_search"
  ], "applicability_matrix", violations)) {
    return;
  }
  const frozenAt = parseTimestamp(
    matrix.frozen_at,
    "applicability_matrix.frozen_at",
    violations
  );
  requireChronology(
    frozenAt,
    "<=",
    times?.case_selected_at ?? null,
    "applicability_matrix.frozen_before_selection",
    violations
  );
  requireHash(
    matrix.matrix_sha256,
    "applicability_matrix.matrix_sha256",
    violations
  );
  const expectedMatrixSha256 = sha256Json({
    frozen_at: matrix.frozen_at,
    derivatives: matrix.derivatives,
    token_metrics: matrix.token_metrics,
    event_search: matrix.event_search
  });
  if (matrix.matrix_sha256 !== expectedMatrixSha256) {
    addViolation(
      violations,
      "HASH_MISMATCH",
      "applicability_matrix.matrix_sha256",
      "applicability matrix hash does not match frozen fields"
    );
  }
  for (const key of ["derivatives", "token_metrics", "event_search"]) {
    if (typeof matrix[key] !== "boolean") {
      addViolation(
        violations,
        "UNVERIFIED_AVAILABILITY",
        `applicability_matrix.${key}`,
        `${key} applicability must be frozen as boolean`
      );
    }
  }
}

function validateSources(bundle, artifactMap, times, violations) {
  const statuses = bundle.critical_group_status;
  requireExactKeys(
    statuses,
    R34_CRITICAL_GROUPS,
    "critical_group_status",
    violations
  );
  const registry = bundle.source_group_registry;
  if (!Array.isArray(registry)) {
    addViolation(
      violations,
      "MISSING_REQUIRED_CONTEXT",
      "source_group_registry",
      "source_group_registry must be an array"
    );
    return;
  }

  const entriesByGroup = new Map();
  registry.forEach((entry, index) => {
    const itemPath = `source_group_registry[${index}]`;
    if (!requireExactKeys(entry, [
      "group_id",
      "provider",
      "data_as_of",
      "retrieved_at",
      "artifact_path",
      "raw_artifact_sha256",
      "raw_readback_sha256",
      "parser_version",
      "parser_code_sha256",
      "parser_config_sha256",
      "freshness_status",
      "missingness_status",
      "missingness_reason"
    ], itemPath, violations)) {
      return;
    }
    requireString(entry.group_id, `${itemPath}.group_id`, violations);
    if (!R34_CRITICAL_GROUPS.includes(entry.group_id)) {
      addViolation(
        violations,
        "MISSING_REQUIRED_CONTEXT",
        `${itemPath}.group_id`,
        "source group is not part of the frozen R34 profile"
      );
    }
    const groupEntries = entriesByGroup.get(entry.group_id) ?? [];
    groupEntries.push(entry);
    entriesByGroup.set(entry.group_id, groupEntries);

    if (entry.missingness_status === "PRESENT") {
      requireString(entry.provider, `${itemPath}.provider`, violations);
      const dataAsOf = parseTimestamp(
        entry.data_as_of,
        `${itemPath}.data_as_of`,
        violations
      );
      const retrievedAt = parseTimestamp(
        entry.retrieved_at,
        `${itemPath}.retrieved_at`,
        violations
      );
      requireChronology(
        dataAsOf,
        "<=",
        times?.cutoff_at ?? null,
        `${itemPath}.data_as_of_before_cutoff`,
        violations
      );
      requireChronology(
        retrievedAt,
        "<=",
        times?.cutoff_at ?? null,
        `${itemPath}.retrieved_before_cutoff`,
        violations
      );
      const normalized = typeof entry.artifact_path === "string"
        ? entry.artifact_path.split("\\").join("/")
        : "";
      const artifact = artifactMap.get(normalized);
      if (!artifact) {
        addViolation(
          violations,
          "HASH_MISMATCH",
          `${itemPath}.artifact_path`,
          "source artifact is not in artifact_manifest"
        );
      }
      requireHash(
        entry.raw_artifact_sha256,
        `${itemPath}.raw_artifact_sha256`,
        violations
      );
      requireHash(
        entry.raw_readback_sha256,
        `${itemPath}.raw_readback_sha256`,
        violations
      );
      if (
        entry.raw_artifact_sha256 !== entry.raw_readback_sha256 ||
        (artifact && artifact.sha256 !== entry.raw_artifact_sha256)
      ) {
        addViolation(
          violations,
          "HASH_MISMATCH",
          `${itemPath}.raw_readback_sha256`,
          "source raw/readback/manifest hashes must match"
        );
      }
      requireString(entry.parser_version, `${itemPath}.parser_version`, violations);
      requireHash(
        entry.parser_code_sha256,
        `${itemPath}.parser_code_sha256`,
        violations
      );
      requireHash(
        entry.parser_config_sha256,
        `${itemPath}.parser_config_sha256`,
        violations
      );
      if (entry.freshness_status !== "PASS") {
        addViolation(
          violations,
          "POST_CUTOFF_DATA",
          `${itemPath}.freshness_status`,
          "freshness_status must be PASS"
        );
      }
      if (entry.missingness_reason !== null) {
        addViolation(
          violations,
          "UNVERIFIED_AVAILABILITY",
          `${itemPath}.missingness_reason`,
          "present source groups must not carry missingness reasons"
        );
      }
    } else if (entry.missingness_status === "NOT_APPLICABLE") {
      requireString(
        entry.missingness_reason,
        `${itemPath}.missingness_reason`,
        violations
      );
      const allowed =
        (DERIVATIVE_GROUPS.has(entry.group_id) &&
          bundle.applicability_matrix?.derivatives === false) ||
        (entry.group_id === "market_cap_fdv_and_circulating_supply" &&
          bundle.applicability_matrix?.token_metrics === false);
      if (!allowed) {
        addViolation(
          violations,
          "UNVERIFIED_AVAILABILITY",
          `${itemPath}.missingness_status`,
          "NOT_APPLICABLE is not allowed by the pre-capture matrix"
        );
      }
    } else {
      addViolation(
        violations,
        "UNVERIFIED_AVAILABILITY",
        `${itemPath}.missingness_status`,
        "critical source groups must be PRESENT or predeclared NOT_APPLICABLE"
      );
    }
  });

  for (const group of R34_CRITICAL_GROUPS) {
    const status = statuses?.[group];
    if (!["PRESENT", "NOT_APPLICABLE"].includes(status)) {
      addViolation(
        violations,
        "MISSING_REQUIRED_CONTEXT",
        `critical_group_status.${group}`,
        "critical group status must be PRESENT or NOT_APPLICABLE"
      );
    }
    const entries = entriesByGroup.get(group) ?? [];
    if (entries.length === 0) {
      addViolation(
        violations,
        "MISSING_REQUIRED_CONTEXT",
        `source_group_registry.${group}`,
        "critical group requires a provenance entry"
      );
    }
    if (status === "PRESENT" &&
        !entries.some((entry) => entry.missingness_status === "PRESENT")) {
      addViolation(
        violations,
        "MISSING_REQUIRED_CONTEXT",
        `source_group_registry.${group}`,
        "PRESENT critical group requires PRESENT source evidence"
      );
    }
  }
}

function timeframeMilliseconds(timeframe) {
  const match = /^([1-9]\d*)(m|h|d)$/.exec(timeframe ?? "");
  if (!match) {
    return null;
  }
  const multiplier = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
  return Number.parseInt(match[1], 10) * multiplier;
}

function validateOhlcv(bundle, caseDirectory, artifactMap, times, violations) {
  const price = bundle.price_and_volume;
  if (!requireExactKeys(price, [
    "cutoff_price",
    "spot_volume",
    "perpetual_volume",
    "turnover",
    "spread_bps",
    "depth_quote",
    "ohlcv"
  ], "price_and_volume", violations)) {
    return null;
  }
  for (const key of [
    "cutoff_price",
    "spot_volume",
    "perpetual_volume",
    "turnover",
    "spread_bps",
    "depth_quote"
  ]) {
    requireFinite(
      price[key],
      `price_and_volume.${key}`,
      violations,
      { minimum: 0 }
    );
  }
  const ohlcv = price.ohlcv;
  if (!requireExactKeys(ohlcv, [
    "timeframe",
    "required_rows",
    "rows",
    "artifact_path",
    "sha256"
  ], "price_and_volume.ohlcv", violations)) {
    return null;
  }
  if (ohlcv.timeframe !== bundle.horizon?.timeframe) {
    addViolation(
      violations,
      "SERIES_GAP",
      "price_and_volume.ohlcv.timeframe",
      "OHLCV timeframe must match the frozen horizon"
    );
  }
  const interval = timeframeMilliseconds(ohlcv.timeframe);
  if (interval === null) {
    addViolation(
      violations,
      "SERIES_GAP",
      "price_and_volume.ohlcv.timeframe",
      "unsupported timeframe"
    );
  }
  if (!Number.isInteger(ohlcv.required_rows) || ohlcv.required_rows < 200) {
    addViolation(
      violations,
      "SERIES_GAP",
      "price_and_volume.ohlcv.required_rows",
      "at least 200 completed rows are required"
    );
  }
  if (!Array.isArray(ohlcv.rows) ||
      ohlcv.rows.length !== ohlcv.required_rows) {
    addViolation(
      violations,
      "SERIES_GAP",
      "price_and_volume.ohlcv.rows",
      "OHLCV rows must exactly match required_rows"
    );
    return null;
  }

  let previousTimestamp = null;
  ohlcv.rows.forEach((row, index) => {
    const rowPath = `price_and_volume.ohlcv.rows[${index}]`;
    if (!requireExactKeys(
      row,
      ["timestamp", "open", "high", "low", "close", "volume"],
      rowPath,
      violations
    )) {
      return;
    }
    const timestamp = parseTimestamp(
      row.timestamp,
      `${rowPath}.timestamp`,
      violations
    );
    if (timestamp !== null && times?.cutoff_at !== null &&
        timestamp > times.cutoff_at) {
      addViolation(
        violations,
        "POST_CUTOFF_DATA",
        `${rowPath}.timestamp`,
        "OHLCV row is after cutoff"
      );
    }
    if (previousTimestamp !== null && timestamp !== null && interval !== null &&
        timestamp - previousTimestamp !== interval) {
      addViolation(
        violations,
        "SERIES_GAP",
        `${rowPath}.timestamp`,
        "OHLCV timestamps must be strictly consecutive"
      );
    }
    previousTimestamp = timestamp;
    for (const key of ["open", "high", "low", "close", "volume"]) {
      requireFinite(row[key], `${rowPath}.${key}`, violations, {
        minimum: key === "volume" ? 0 : -Infinity,
        strictlyPositive: key !== "volume"
      });
    }
    if (
      Number.isFinite(row.high) &&
      Number.isFinite(row.low) &&
      Number.isFinite(row.open) &&
      Number.isFinite(row.close) &&
      (
        row.high < Math.max(row.open, row.close, row.low) ||
        row.low > Math.min(row.open, row.close, row.high)
      )
    ) {
      addViolation(
        violations,
        "SERIES_GAP",
        rowPath,
        "OHLCV high/low envelope is invalid"
      );
    }
  });

  const rowsHash = sha256Json(ohlcv.rows);
  requireHash(ohlcv.sha256, "price_and_volume.ohlcv.sha256", violations);
  if (ohlcv.sha256 !== rowsHash) {
    addViolation(
      violations,
      "HASH_MISMATCH",
      "price_and_volume.ohlcv.sha256",
      "canonical OHLCV hash does not match rows"
    );
  }
  const normalizedArtifactPath =
    typeof ohlcv.artifact_path === "string"
      ? ohlcv.artifact_path.split("\\").join("/")
      : "";
  if (!artifactMap.has(normalizedArtifactPath)) {
    addViolation(
      violations,
      "HASH_MISMATCH",
      "price_and_volume.ohlcv.artifact_path",
      "OHLCV artifact is not manifested"
    );
  }
  const artifactPath = safeArtifactPath(
    caseDirectory,
    ohlcv.artifact_path,
    "price_and_volume.ohlcv.artifact_path",
    violations
  );
  if (artifactPath && existsSync(artifactPath)) {
    try {
      const artifactRows = readJson(artifactPath);
      if (sha256Json(artifactRows) !== rowsHash) {
        addViolation(
          violations,
          "HASH_MISMATCH",
          "price_and_volume.ohlcv.artifact_path",
          "OHLCV artifact content differs from committed rows"
        );
      }
    } catch {
      addViolation(
        violations,
        "HASH_MISMATCH",
        "price_and_volume.ohlcv.artifact_path",
        "OHLCV artifact must be valid JSON"
      );
    }
  }
  if (ohlcv.rows.length > 0 &&
      price.cutoff_price !== ohlcv.rows.at(-1).close) {
    addViolation(
      violations,
      "DERIVED_MISMATCH",
      "price_and_volume.cutoff_price",
      "cutoff price must equal the final completed close"
    );
  }
  return { rows: ohlcv.rows, rowsHash };
}

function validateIndicators(bundle, ohlcvResult, violations) {
  const indicators = bundle.deterministic_indicators;
  if (!requireExactKeys(indicators, [
    "formula_manifest_id",
    "formula_manifest_sha256",
    "computed_from_ohlcv_sha256",
    "atr_14",
    "atr_percent",
    "rsi_14",
    "ema_20",
    "ema_50",
    "ema_200",
    "distance_to_ema_20_percent",
    "distance_to_ema_50_percent",
    "distance_to_ema_200_percent",
    "vwap",
    "return_windows",
    "volume_change_percent",
    "volatility_regime"
  ], "deterministic_indicators", violations)) {
    return;
  }
  if (indicators.formula_manifest_id !== FORMULA_MANIFEST.manifest_id) {
    addViolation(
      violations,
      "HASH_MISMATCH",
      "deterministic_indicators.formula_manifest_id",
      "formula manifest ID is not frozen R34"
    );
  }
  if (indicators.formula_manifest_sha256 !== R34_FORMULA_MANIFEST_SHA256) {
    addViolation(
      violations,
      "HASH_MISMATCH",
      "deterministic_indicators.formula_manifest_sha256",
      "formula manifest SHA-256 mismatch"
    );
  }
  if (!ohlcvResult) {
    return;
  }
  if (indicators.computed_from_ohlcv_sha256 !== ohlcvResult.rowsHash) {
    addViolation(
      violations,
      "HASH_MISMATCH",
      "deterministic_indicators.computed_from_ohlcv_sha256",
      "indicator OHLCV binding mismatch"
    );
  }
  if (!Array.isArray(indicators.return_windows) ||
      indicators.return_windows.length === 0) {
    addViolation(
      violations,
      "DERIVED_MISMATCH",
      "deterministic_indicators.return_windows",
      "at least one return window is required"
    );
    return;
  }
  const windowBars = indicators.return_windows.map((entry) => entry?.bars);
  if (
    new Set(windowBars).size !== windowBars.length ||
    windowBars.some((bars) => !Number.isInteger(bars) || bars < 1)
  ) {
    addViolation(
      violations,
      "DERIVED_MISMATCH",
      "deterministic_indicators.return_windows",
      "return windows must use unique positive bar counts"
    );
    return;
  }
  let expected;
  try {
    expected = computeMarketIndicatorsR34(ohlcvResult.rows, windowBars);
  } catch (error) {
    addViolation(
      violations,
      "DERIVED_MISMATCH",
      "deterministic_indicators",
      error.message
    );
    return;
  }
  for (const key of [
    "atr_14",
    "atr_percent",
    "rsi_14",
    "ema_20",
    "ema_50",
    "ema_200",
    "distance_to_ema_20_percent",
    "distance_to_ema_50_percent",
    "distance_to_ema_200_percent",
    "vwap",
    "volume_change_percent"
  ]) {
    requireReproduced(
      indicators[key],
      expected[key],
      `deterministic_indicators.${key}`,
      violations
    );
  }
  indicators.return_windows.forEach((entry, index) => {
    const expectedEntry = expected.return_windows[index];
    if (!isObject(entry) ||
        !valuesClose(entry.return_percent, expectedEntry.return_percent)) {
      addViolation(
        violations,
        "DERIVED_MISMATCH",
        `deterministic_indicators.return_windows[${index}]`,
        "return window does not reproduce from OHLCV"
      );
    }
  });
  if (indicators.volatility_regime !== expected.volatility_regime) {
    addViolation(
      violations,
      "DERIVED_MISMATCH",
      "deterministic_indicators.volatility_regime",
      "volatility regime does not match frozen thresholds"
    );
  }
}

function validateMarketContext(bundle, violations) {
  if (requireExactKeys(bundle.token_metrics, [
    "applicable",
    "market_cap",
    "fdv",
    "circulating_supply"
  ], "token_metrics", violations)) {
    if (bundle.token_metrics.applicable !==
        bundle.applicability_matrix?.token_metrics) {
      addViolation(
        violations,
        "UNVERIFIED_AVAILABILITY",
        "token_metrics.applicable",
        "token applicability differs from frozen matrix"
      );
    }
    if (bundle.token_metrics.applicable === true) {
      for (const key of ["market_cap", "fdv", "circulating_supply"]) {
        requireFinite(
          bundle.token_metrics[key],
          `token_metrics.${key}`,
          violations,
          { minimum: 0, strictlyPositive: true }
        );
      }
    }
  }

  if (requireExactKeys(bundle.derivatives, [
    "applicable",
    "open_interest",
    "open_interest_change_percent",
    "funding_rate",
    "spot_perpetual_basis_percent",
    "liquidations_24h",
    "long_short_ratio",
    "cvd"
  ], "derivatives", violations)) {
    if (bundle.derivatives.applicable !==
        bundle.applicability_matrix?.derivatives) {
      addViolation(
        violations,
        "UNVERIFIED_AVAILABILITY",
        "derivatives.applicable",
        "derivatives applicability differs from frozen matrix"
      );
    }
    if (bundle.derivatives.applicable === true) {
      requireFinite(
        bundle.derivatives.open_interest,
        "derivatives.open_interest",
        violations,
        { minimum: 0, strictlyPositive: true }
      );
      for (const key of [
        "open_interest_change_percent",
        "funding_rate",
        "spot_perpetual_basis_percent"
      ]) {
        requireFinite(
          bundle.derivatives[key],
          `derivatives.${key}`,
          violations
        );
      }
      requireFinite(
        bundle.derivatives.liquidations_24h,
        "derivatives.liquidations_24h",
        violations,
        { minimum: 0 }
      );
      for (const key of ["long_short_ratio", "cvd"]) {
        if (bundle.derivatives[key] !== null) {
          requireFinite(
            bundle.derivatives[key],
            `derivatives.${key}`,
            violations
          );
        }
      }
    }
  }

  if (requireExactKeys(bundle.reference_market_and_regime, [
    "regime_definition",
    "regime_value",
    "reference_assets"
  ], "reference_market_and_regime", violations)) {
    requireString(
      bundle.reference_market_and_regime.regime_definition,
      "reference_market_and_regime.regime_definition",
      violations
    );
    requireString(
      bundle.reference_market_and_regime.regime_value,
      "reference_market_and_regime.regime_value",
      violations
    );
    if (!Array.isArray(bundle.reference_market_and_regime.reference_assets) ||
        bundle.reference_market_and_regime.reference_assets.length === 0) {
      addViolation(
        violations,
        "MISSING_REQUIRED_CONTEXT",
        "reference_market_and_regime.reference_assets",
        "at least one reference asset is required"
      );
    }
  }
}

function validateArticleArtifact(
  entry,
  itemPath,
  caseDirectory,
  artifactMap,
  cutoff,
  violations
) {
  requireString(entry.source_id, `${itemPath}.source_id`, violations);
  requireString(entry.provider, `${itemPath}.provider`, violations);
  const published = parseTimestamp(
    entry.first_published_at,
    `${itemPath}.first_published_at`,
    violations
  );
  const updated = parseTimestamp(
    entry.updated_at,
    `${itemPath}.updated_at`,
    violations
  );
  requireChronology(
    published,
    "<=",
    cutoff,
    `${itemPath}.published_before_cutoff`,
    violations
  );
  requireChronology(
    updated,
    "<=",
    cutoff,
    `${itemPath}.updated_before_cutoff`,
    violations
  );
  requireHash(
    entry.raw_artifact_sha256,
    `${itemPath}.raw_artifact_sha256`,
    violations
  );
  const normalized = typeof entry.artifact_path === "string"
    ? entry.artifact_path.split("\\").join("/")
    : "";
  const artifact = artifactMap.get(normalized);
  if (!artifact || artifact.sha256 !== entry.raw_artifact_sha256) {
    addViolation(
      violations,
      "HASH_MISMATCH",
      `${itemPath}.artifact_path`,
      "article/event artifact is missing or hash-mismatched"
    );
  }
  safeArtifactPath(
    caseDirectory,
    entry.artifact_path,
    `${itemPath}.artifact_path`,
    violations
  );
}

function validateEvents(bundle, caseDirectory, artifactMap, times, violations) {
  const events = bundle.events_and_articles;
  if (!requireExactKeys(events, [
    "query_policy_sha256",
    "search_performed_at",
    "search_cutoff_at",
    "items",
    "scheduled_events",
    "empty_search_receipt_artifact_path"
  ], "events_and_articles", violations)) {
    return;
  }
  requireHash(
    events.query_policy_sha256,
    "events_and_articles.query_policy_sha256",
    violations
  );
  const searchedAt = parseTimestamp(
    events.search_performed_at,
    "events_and_articles.search_performed_at",
    violations
  );
  const searchCutoff = parseTimestamp(
    events.search_cutoff_at,
    "events_and_articles.search_cutoff_at",
    violations
  );
  requireChronology(
    searchedAt,
    "<=",
    times?.cutoff_at ?? null,
    "events_and_articles.search_before_cutoff",
    violations
  );
  if (searchCutoff !== times?.cutoff_at) {
    addViolation(
      violations,
      "POST_CUTOFF_DATA",
      "events_and_articles.search_cutoff_at",
      "event-search cutoff must equal bundle cutoff"
    );
  }
  if (!Array.isArray(events.items) || !Array.isArray(events.scheduled_events)) {
    addViolation(
      violations,
      "MISSING_REQUIRED_CONTEXT",
      "events_and_articles",
      "items and scheduled_events must be arrays"
    );
    return;
  }
  events.items.forEach((entry, index) => {
    const itemPath = `events_and_articles.items[${index}]`;
    if (requireExactKeys(entry, [
      "source_id",
      "provider",
      "first_published_at",
      "updated_at",
      "artifact_path",
      "raw_artifact_sha256"
    ], itemPath, violations)) {
      validateArticleArtifact(
        entry,
        itemPath,
        caseDirectory,
        artifactMap,
        times?.cutoff_at ?? null,
        violations
      );
    }
  });
  events.scheduled_events.forEach((entry, index) => {
    const itemPath = `events_and_articles.scheduled_events[${index}]`;
    if (requireExactKeys(entry, [
      "source_id",
      "provider",
      "event_identity",
      "scheduled_at",
      "known_as_of",
      "artifact_path",
      "raw_artifact_sha256"
    ], itemPath, violations)) {
      requireString(entry.event_identity, `${itemPath}.event_identity`, violations);
      parseTimestamp(entry.scheduled_at, `${itemPath}.scheduled_at`, violations);
      const knownAsOf = parseTimestamp(
        entry.known_as_of,
        `${itemPath}.known_as_of`,
        violations
      );
      requireChronology(
        knownAsOf,
        "<=",
        times?.cutoff_at ?? null,
        `${itemPath}.known_before_cutoff`,
        violations
      );
      validateArticleArtifact(
        {
          ...entry,
          first_published_at: entry.known_as_of,
          updated_at: entry.known_as_of
        },
        itemPath,
        caseDirectory,
        artifactMap,
        times?.cutoff_at ?? null,
        violations
      );
    }
  });
  if (events.items.length === 0 && events.scheduled_events.length === 0) {
    const normalized = typeof events.empty_search_receipt_artifact_path === "string"
      ? events.empty_search_receipt_artifact_path.split("\\").join("/")
      : "";
    if (!artifactMap.has(normalized)) {
      addViolation(
        violations,
        "MISSING_REQUIRED_CONTEXT",
        "events_and_articles.empty_search_receipt_artifact_path",
        "empty event search requires a manifested receipt"
      );
    }
  } else if (events.empty_search_receipt_artifact_path !== null) {
    addViolation(
      violations,
      "UNVERIFIED_AVAILABILITY",
      "events_and_articles.empty_search_receipt_artifact_path",
      "non-empty event search must not claim an empty receipt"
    );
  }
}

function validateLeakageAttestation(bundle, violations) {
  const leakage = bundle.leakage_scan;
  if (!requireExactKeys(leakage, [
    "future_market_data",
    "outcome_material",
    "ai_assessment",
    "fusion_output",
    "baseline_output",
    "reveal_output",
    "adjudication_output",
    "scoring_output",
    "status"
  ], "leakage_scan", violations)) {
    return;
  }
  for (const key of [
    "future_market_data",
    "outcome_material",
    "ai_assessment",
    "fusion_output",
    "baseline_output",
    "reveal_output",
    "adjudication_output",
    "scoring_output"
  ]) {
    if (leakage[key] !== false) {
      addViolation(
        violations,
        "BLIND_MODE_VIOLATION",
        `leakage_scan.${key}`,
        `${key} must be absent`
      );
    }
  }
  if (leakage.status !== "PASS") {
    addViolation(
      violations,
      "BLIND_MODE_VIOLATION",
      "leakage_scan.status",
      "leakage scan status must be PASS"
    );
  }
}

function buildFailureReceipt(bundle, violations, bundleSha256 = null) {
  return {
    schema_version: "visionassist.benchmark.market-evidence-validation-receipt-r34.v1",
    market_evidence_status: "FAIL",
    case_id: bundle?.case_id ?? null,
    capture_mode: bundle?.capture_mode ?? null,
    canonical_bundle_sha256: bundleSha256,
    violation_codes: [...new Set(violations.map((item) => item.code))].sort(),
    violations,
    case_phase: "INPUT_REJECTED",
    authority: AUTHORITY
  };
}

export function verifyMarketInputR34(caseDirectory) {
  const resolvedCaseDirectory = path.resolve(caseDirectory);
  const violations = [];
  if (!existsSync(resolvedCaseDirectory) ||
      !lstatSync(resolvedCaseDirectory).isDirectory()) {
    const receipt = buildFailureReceipt(null, [{
      code: "MISSING_REQUIRED_CONTEXT",
      path: "case_directory",
      message: "case directory is missing"
    }]);
    throw new MarketEvidenceGateError(
      "R34 market evidence gate failed.",
      receipt.violations,
      receipt
    );
  }

  const bundlePath = path.join(
    resolvedCaseDirectory,
    "market_evidence_bundle.json"
  );
  if (
    !existsSync(bundlePath) ||
    !lstatSync(bundlePath).isFile() ||
    lstatSync(bundlePath).isSymbolicLink()
  ) {
    const receipt = buildFailureReceipt(null, [{
      code: "MISSING_REQUIRED_CONTEXT",
      path: "market_evidence_bundle.json",
      message: "market evidence bundle is missing"
    }]);
    throw new MarketEvidenceGateError(
      "R34 market evidence gate failed.",
      receipt.violations,
      receipt
    );
  }

  let bundle;
  try {
    bundle = readJson(bundlePath);
  } catch {
    const receipt = buildFailureReceipt(null, [{
      code: "MISSING_REQUIRED_CONTEXT",
      path: "market_evidence_bundle.json",
      message: "market evidence bundle is not valid JSON"
    }]);
    throw new MarketEvidenceGateError(
      "R34 market evidence gate failed.",
      receipt.violations,
      receipt
    );
  }
  const bundleSha256 = sha256Json(bundle);

  requireExactKeys(bundle, TOP_LEVEL_KEYS, "bundle", violations);
  validateIdentity(bundle, violations);
  const times = validateTiming(bundle, violations);
  validateApplicability(bundle, times, violations);
  scanForbiddenKeys(bundle, violations);
  const artifactMap = validateArtifactManifest(
    resolvedCaseDirectory,
    bundle,
    violations
  );
  validateSources(bundle, artifactMap, times, violations);
  const ohlcvResult = validateOhlcv(
    bundle,
    resolvedCaseDirectory,
    artifactMap,
    times,
    violations
  );
  validateIndicators(bundle, ohlcvResult, violations);
  validateMarketContext(bundle, violations);
  validateEvents(
    bundle,
    resolvedCaseDirectory,
    artifactMap,
    times,
    violations
  );
  validateLeakageAttestation(bundle, violations);
  validateAuthority(bundle.authority, violations);

  if (violations.length > 0) {
    const receipt = buildFailureReceipt(bundle, violations, bundleSha256);
    throw new MarketEvidenceGateError(
      `R34 market evidence gate failed with ${violations.length} violation(s).`,
      violations,
      receipt
    );
  }

  return {
    schema_version: "visionassist.benchmark.market-evidence-validation-receipt-r34.v1",
    market_evidence_status: "PASS",
    case_id: bundle.case_id,
    capture_mode: bundle.capture_mode,
    canonical_bundle_sha256: bundleSha256,
    formula_manifest_sha256: R34_FORMULA_MANIFEST_SHA256,
    checks: {
      cutoff_chronology: "PASS",
      ohlcv_completeness_and_hashes: "PASS",
      provenance: "PASS",
      indicator_reproducibility: "PASS",
      derivatives_applicability_and_missingness: "PASS",
      pre_cutoff_articles_and_events: "PASS",
      leakage_scan: "PASS",
      authority_boundary: "PASS"
    },
    case_phase: "CASE_FROZEN",
    authority: AUTHORITY
  };
}
