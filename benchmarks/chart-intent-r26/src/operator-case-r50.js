import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MarketEvidenceGateError,
  R34_CRITICAL_GROUPS,
  R34_FORMULA_MANIFEST_SHA256,
  computeMarketIndicatorsR34,
  verifyMarketInputR50
} from "./market-evidence-r34.js";
import {
  readJson,
  sha256File,
  sha256Json,
  sha256Text
} from "./canonical-json.js";

export const R50_CASE_IDS = Object.freeze([
  "MKT-R50-001",
  "MKT-R50-002",
  "MKT-R50-003"
]);

export const R50_AUTHORITY = Object.freeze({
  decision_status: "DIAGNOSTIC_ONLY",
  action_code: "NO_ACTION",
  execution_permission: "HOLD",
  capital_permission: "DENY",
  can_trade: false
});

const MODULE_PATH = fileURLToPath(import.meta.url);
const PARSER_CODE_SHA256 = sha256File(MODULE_PATH);
const DERIVATIVE_GROUPS = new Set([
  "open_interest_and_pre_cutoff_changes",
  "funding_rate",
  "spot_perpetual_basis",
  "liquidations"
]);
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const FORBIDDEN_TEXT =
  /\b(outcome|future[ _-]?bars?|reveal|fusion|scoring|ai[ _-]?assessment|baseline[ _-]?output)\b/i;

export class OperatorCaseR50Error extends Error {
  constructor(message, {
    code = "OPERATOR_CASE_ERROR",
    status = 400,
    violations = []
  } = {}) {
    super(message);
    this.name = "OperatorCaseR50Error";
    this.code = code;
    this.status = status;
    this.violations = violations;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireCaseId(caseId) {
  if (!R50_CASE_IDS.includes(caseId)) {
    throw new OperatorCaseR50Error(
      `case_id must be one of ${R50_CASE_IDS.join(", ")}`,
      { code: "INVALID_CASE_ID", status: 404 }
    );
  }
  return caseId;
}

function resolveStoreRoot(storeRoot) {
  const resolved = path.resolve(
    storeRoot || path.join(os.tmpdir(), "VisionAssist-R50-Operator")
  );
  mkdirSync(resolved, { recursive: true });
  return resolved;
}

function storePaths(storeRoot, caseId) {
  const root = resolveStoreRoot(storeRoot);
  const id = requireCaseId(caseId);
  return {
    root,
    slot: path.join(root, "slots", `${id}.json`),
    evidence: path.join(root, "evidence", id),
    evidenceReceipt: path.join(root, "receipts", "evidence", `${id}.json`),
    prior: path.join(root, "priors", `${id}.json`),
    priorReceipt: path.join(root, "receipts", "prior", `${id}.json`),
    aiPacket: path.join(root, "exports", `${id}-ai-runner-packet.json`)
  };
}

function writeJson(filePath, value, { exclusive = false } = {}) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: exclusive ? "wx" : "w"
  });
}

function isoNow(now) {
  const date = now instanceof Date ? now : new Date(now ?? Date.now());
  if (!Number.isFinite(date.getTime())) {
    throw new OperatorCaseR50Error("Invalid runtime timestamp.", {
      code: "INVALID_RUNTIME_TIME"
    });
  }
  return date.toISOString();
}

function addViolation(violations, pathName, message, code = "MISSING_REQUIRED_CONTEXT") {
  violations.push({ code, path: pathName, message });
}

function requireString(value, pathName, violations) {
  if (typeof value !== "string" || value.trim() === "") {
    addViolation(violations, pathName, "A non-empty string is required.");
    return null;
  }
  return value.trim();
}

function requireTimestamp(value, pathName, violations) {
  if (
    typeof value !== "string" ||
    !TIMESTAMP_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    addViolation(
      violations,
      pathName,
      "An ISO-8601 UTC timestamp with Z is required."
    );
    return null;
  }
  return Date.parse(value);
}

function requireFinite(value, pathName, violations, { minimum = -Infinity } = {}) {
  if (!Number.isFinite(value) || value < minimum) {
    const requirement = Number.isFinite(minimum)
      ? `A finite number >= ${minimum} is required.`
      : "A finite number is required.";
    addViolation(
      violations,
      pathName,
      requirement
    );
    return null;
  }
  return value;
}

function validateArticle(entry, index, cutoff, violations) {
  const base = `event_search.articles[${index}]`;
  if (!isObject(entry)) {
    addViolation(violations, base, "Article metadata must be an object.");
    return;
  }
  requireString(entry.source_id, `${base}.source_id`, violations);
  requireString(entry.provider, `${base}.provider`, violations);
  requireString(entry.title, `${base}.title`, violations);
  requireString(entry.url, `${base}.url`, violations);
  const first = requireTimestamp(
    entry.first_published_at,
    `${base}.first_published_at`,
    violations
  );
  const updated = requireTimestamp(
    entry.updated_at,
    `${base}.updated_at`,
    violations
  );
  if (cutoff !== null && first !== null && first > cutoff) {
    addViolation(
      violations,
      `${base}.first_published_at`,
      "Article was first published after cutoff.",
      "POST_CUTOFF_DATA"
    );
  }
  if (cutoff !== null && updated !== null && updated > cutoff) {
    addViolation(
      violations,
      `${base}.updated_at`,
      "Article was updated after cutoff.",
      "POST_CUTOFF_DATA"
    );
  }
  if (typeof entry.title === "string" && FORBIDDEN_TEXT.test(entry.title)) {
    addViolation(
      violations,
      `${base}.title`,
      "Outcome, future, AI, fusion, reveal, baseline, or scoring language is forbidden.",
      "BLIND_MODE_VIOLATION"
    );
  }
}

function validateScheduledEvent(entry, index, cutoff, violations) {
  const base = `event_search.scheduled_events[${index}]`;
  if (!isObject(entry)) {
    addViolation(violations, base, "Scheduled event metadata must be an object.");
    return;
  }
  requireString(entry.source_id, `${base}.source_id`, violations);
  requireString(entry.provider, `${base}.provider`, violations);
  requireString(entry.event_identity, `${base}.event_identity`, violations);
  requireString(entry.url, `${base}.url`, violations);
  requireTimestamp(entry.scheduled_at, `${base}.scheduled_at`, violations);
  const known = requireTimestamp(
    entry.known_as_of,
    `${base}.known_as_of`,
    violations
  );
  if (cutoff !== null && known !== null && known > cutoff) {
    addViolation(
      violations,
      `${base}.known_as_of`,
      "Scheduled event became known after cutoff.",
      "POST_CUTOFF_DATA"
    );
  }
  if (
    typeof entry.event_identity === "string" &&
    FORBIDDEN_TEXT.test(entry.event_identity)
  ) {
    addViolation(
      violations,
      `${base}.event_identity`,
      "Outcome, future bars, AI, fusion, reveal, baseline, or scoring language is forbidden.",
      "BLIND_MODE_VIOLATION"
    );
  }
}

export function validateCaptureInputR50(slot, input) {
  const violations = [];
  if (!isObject(input)) {
    return [{
      code: "MISSING_REQUIRED_CONTEXT",
      path: "capture",
      message: "Capture input must be a JSON object."
    }];
  }
  if (input.case_id !== slot.case_id) {
    addViolation(
      violations,
      "case_id",
      `case_id must equal the opened slot ${slot.case_id}.`
    );
  }

  const instrument = input.instrument;
  if (!isObject(instrument)) {
    addViolation(violations, "instrument", "Instrument identity is required.");
  } else {
    for (const key of [
      "symbol",
      "venue",
      "asset_class",
      "quote_currency",
      "market_type"
    ]) {
      requireString(instrument[key], `instrument.${key}`, violations);
    }
  }

  const cutoff = requireTimestamp(input.cutoff_at, "cutoff_at", violations);
  const deadline = requireTimestamp(
    input.prior_deadline,
    "prior_deadline",
    violations
  );
  const horizonStart = requireTimestamp(
    input.horizon_start_at,
    "horizon_start_at",
    violations
  );
  if (cutoff !== null && deadline !== null && cutoff >= deadline) {
    addViolation(
      violations,
      "prior_deadline",
      "prior_deadline must be after cutoff_at."
    );
  }
  if (deadline !== null && horizonStart !== null && deadline >= horizonStart) {
    addViolation(
      violations,
      "horizon_start_at",
      "horizon_start_at must be after prior_deadline."
    );
  }

  const horizon = input.horizon;
  if (!isObject(horizon)) {
    addViolation(violations, "horizon", "Horizon definition is required.");
  } else {
    requireString(horizon.timeframe, "horizon.timeframe", violations);
    if (!Number.isInteger(horizon.completed_bars) || horizon.completed_bars < 1) {
      addViolation(
        violations,
        "horizon.completed_bars",
        "A positive integer is required."
      );
    }
    requireString(
      horizon.resolution_rule,
      "horizon.resolution_rule",
      violations
    );
  }

  const provenance = input.provenance;
  if (!isObject(provenance)) {
    addViolation(violations, "provenance", "Source provenance is required.");
  } else {
    requireString(provenance.provider, "provenance.provider", violations);
    const dataAsOf = requireTimestamp(
      provenance.data_as_of,
      "provenance.data_as_of",
      violations
    );
    const retrievedAt = requireTimestamp(
      provenance.retrieved_at,
      "provenance.retrieved_at",
      violations
    );
    requireString(provenance.source_url, "provenance.source_url", violations);
    if (cutoff !== null && dataAsOf !== null && dataAsOf > cutoff) {
      addViolation(
        violations,
        "provenance.data_as_of",
        "Source data is after cutoff.",
        "POST_CUTOFF_DATA"
      );
    }
    if (cutoff !== null && retrievedAt !== null && retrievedAt > cutoff) {
      addViolation(
        violations,
        "provenance.retrieved_at",
        "Source retrieval is after cutoff.",
        "POST_CUTOFF_DATA"
      );
    }
  }

  const price = input.price_and_volume;
  if (!isObject(price)) {
    addViolation(
      violations,
      "price_and_volume",
      "Price and volume context is required."
    );
  } else {
    for (const key of [
      "spot_volume",
      "perpetual_volume",
      "turnover",
      "spread_bps",
      "depth_quote"
    ]) {
      requireFinite(price[key], `price_and_volume.${key}`, violations, {
        minimum: 0
      });
    }
  }

  const rows = input.ohlcv_rows;
  if (!Array.isArray(rows) || rows.length < 200) {
    addViolation(
      violations,
      "ohlcv_rows",
      "At least 200 consecutive OHLCV rows are required.",
      "SERIES_GAP"
    );
  } else {
    rows.forEach((row, index) => {
      const base = `ohlcv_rows[${index}]`;
      if (!isObject(row)) {
        addViolation(violations, base, "OHLCV row must be an object.");
        return;
      }
      requireTimestamp(row.timestamp, `${base}.timestamp`, violations);
      for (const key of ["open", "high", "low", "close", "volume"]) {
        requireFinite(row[key], `${base}.${key}`, violations, {
          minimum: key === "volume" ? 0 : Number.MIN_VALUE
        });
      }
    });
  }

  const token = input.token_metrics;
  if (!isObject(token)) {
    addViolation(violations, "token_metrics", "Token applicability is required.");
  } else if (token.applicable !== slot.applicability.token_metrics) {
    addViolation(
      violations,
      "token_metrics.applicable",
      "Token applicability differs from the frozen slot matrix.",
      "UNVERIFIED_AVAILABILITY"
    );
  } else if (token.applicable) {
    for (const key of ["market_cap", "fdv", "circulating_supply"]) {
      requireFinite(token[key], `token_metrics.${key}`, violations, {
        minimum: 0
      });
    }
  } else {
    requireString(
      token.missingness_reason,
      "token_metrics.missingness_reason",
      violations
    );
  }

  const derivatives = input.derivatives;
  if (!isObject(derivatives)) {
    addViolation(
      violations,
      "derivatives",
      "Derivatives applicability is required."
    );
  } else if (derivatives.applicable !== slot.applicability.derivatives) {
    addViolation(
      violations,
      "derivatives.applicable",
      "Derivatives applicability differs from the frozen slot matrix.",
      "UNVERIFIED_AVAILABILITY"
    );
  } else if (derivatives.applicable) {
    for (const key of [
      "open_interest",
      "open_interest_change_percent",
      "funding_rate",
      "spot_perpetual_basis_percent",
      "liquidations_24h",
      "long_short_ratio",
      "cvd"
    ]) {
      requireFinite(derivatives[key], `derivatives.${key}`, violations);
    }
  } else {
    requireString(
      derivatives.missingness_reason,
      "derivatives.missingness_reason",
      violations
    );
  }

  const reference = input.reference_market_and_regime;
  if (!isObject(reference)) {
    addViolation(
      violations,
      "reference_market_and_regime",
      "Reference market and regime are required."
    );
  } else {
    requireString(
      reference.regime_definition,
      "reference_market_and_regime.regime_definition",
      violations
    );
    requireString(
      reference.regime_value,
      "reference_market_and_regime.regime_value",
      violations
    );
    if (
      !Array.isArray(reference.reference_assets) ||
      reference.reference_assets.length === 0 ||
      reference.reference_assets.some(
        (item) => typeof item !== "string" || item.trim() === ""
      )
    ) {
      addViolation(
        violations,
        "reference_market_and_regime.reference_assets",
        "At least one reference asset is required."
      );
    }
  }

  const eventSearch = input.event_search;
  if (!isObject(eventSearch)) {
    addViolation(
      violations,
      "event_search",
      "A bounded pre-cutoff event search is required."
    );
  } else {
    const searchedAt = requireTimestamp(
      eventSearch.search_performed_at,
      "event_search.search_performed_at",
      violations
    );
    requireString(eventSearch.query, "event_search.query", violations);
    if (
      !Array.isArray(eventSearch.providers) ||
      eventSearch.providers.length === 0
    ) {
      addViolation(
        violations,
        "event_search.providers",
        "At least one searched provider is required."
      );
    }
    if (cutoff !== null && searchedAt !== null && searchedAt > cutoff) {
      addViolation(
        violations,
        "event_search.search_performed_at",
        "Event search was performed after cutoff.",
        "POST_CUTOFF_DATA"
      );
    }
    if (!Array.isArray(eventSearch.articles)) {
      addViolation(
        violations,
        "event_search.articles",
        "articles must be an array."
      );
    } else {
      eventSearch.articles.forEach((entry, index) =>
        validateArticle(entry, index, cutoff, violations)
      );
    }
    if (!Array.isArray(eventSearch.scheduled_events)) {
      addViolation(
        violations,
        "event_search.scheduled_events",
        "scheduled_events must be an array."
      );
    } else {
      eventSearch.scheduled_events.forEach((entry, index) =>
        validateScheduledEvent(entry, index, cutoff, violations)
      );
    }
    if (
      Array.isArray(eventSearch.articles) &&
      Array.isArray(eventSearch.scheduled_events) &&
      eventSearch.articles.length === 0 &&
      eventSearch.scheduled_events.length === 0 &&
      eventSearch.empty_search_attestation !== true
    ) {
      addViolation(
        violations,
        "event_search.empty_search_attestation",
        "An explicit empty-search attestation is required."
      );
    }
  }
  return violations;
}

export function startOperatorCaseR50(storeRoot, caseId, {
  derivatives,
  token_metrics,
  event_search = true
}, { now } = {}) {
  const paths = storePaths(storeRoot, caseId);
  if (existsSync(paths.slot)) {
    throw new OperatorCaseR50Error(`${caseId} is already opened.`, {
      code: "SLOT_ALREADY_OPEN",
      status: 409
    });
  }
  if (
    typeof derivatives !== "boolean" ||
    typeof token_metrics !== "boolean" ||
    event_search !== true
  ) {
    throw new OperatorCaseR50Error(
      "Applicability must freeze derivatives/token_metrics as booleans and event_search=true.",
      { code: "INVALID_APPLICABILITY" }
    );
  }
  const selectedAt = isoNow(now);
  const slot = {
    schema_version: "visionassist.product.operator-slot.r50.v1",
    case_id: requireCaseId(caseId),
    phase: "CAPTURE_OPEN",
    selected_at: selectedAt,
    external_context_profile_frozen_at: selectedAt,
    applicability: {
      derivatives,
      token_metrics,
      event_search: true
    },
    authority: { ...R50_AUTHORITY }
  };
  writeJson(paths.slot, slot, { exclusive: true });
  return slot;
}

export function createCaptureTemplateR50(storeRoot, caseId) {
  const paths = storePaths(storeRoot, caseId);
  if (!existsSync(paths.slot)) {
    throw new OperatorCaseR50Error(`${caseId} must be opened first.`, {
      code: "SLOT_NOT_OPEN",
      status: 409
    });
  }
  const slot = readJson(paths.slot);
  return {
    case_id: caseId,
    cutoff_at: null,
    prior_deadline: null,
    horizon_start_at: null,
    instrument: {
      symbol: "",
      venue: "",
      asset_class: "",
      quote_currency: "",
      market_type: ""
    },
    horizon: {
      timeframe: "",
      completed_bars: null,
      resolution_rule: ""
    },
    provenance: {
      provider: "",
      data_as_of: null,
      retrieved_at: null,
      source_url: ""
    },
    price_and_volume: {
      spot_volume: null,
      perpetual_volume: null,
      turnover: null,
      spread_bps: null,
      depth_quote: null
    },
    ohlcv_rows: [],
    token_metrics: {
      applicable: slot.applicability.token_metrics,
      market_cap: null,
      fdv: null,
      circulating_supply: null,
      missingness_reason: slot.applicability.token_metrics ? null : ""
    },
    derivatives: {
      applicable: slot.applicability.derivatives,
      open_interest: null,
      open_interest_change_percent: null,
      funding_rate: null,
      spot_perpetual_basis_percent: null,
      liquidations_24h: null,
      long_short_ratio: null,
      cvd: null,
      missingness_reason: slot.applicability.derivatives ? null : ""
    },
    reference_market_and_regime: {
      regime_definition: "",
      regime_value: "",
      reference_assets: []
    },
    event_search: {
      search_performed_at: null,
      query: "",
      providers: [],
      articles: [],
      scheduled_events: [],
      empty_search_attestation: false
    }
  };
}

function artifactRecord(caseDirectory, relativePath, mediaType, role) {
  return {
    path: relativePath,
    sha256: sha256File(path.join(caseDirectory, relativePath)),
    media_type: mediaType,
    role
  };
}

function presentSourceEntry(groupId, artifact, input, parserConfigSha256) {
  return {
    group_id: groupId,
    provider: input.provenance.provider,
    data_as_of: input.provenance.data_as_of,
    retrieved_at: input.provenance.retrieved_at,
    artifact_path: artifact.path,
    raw_artifact_sha256: artifact.sha256,
    raw_readback_sha256: artifact.sha256,
    parser_version: "visionassist-r50-operator-v1",
    parser_code_sha256: PARSER_CODE_SHA256,
    parser_config_sha256: parserConfigSha256,
    freshness_status: "PASS",
    missingness_status: "PRESENT",
    missingness_reason: null
  };
}

function notApplicableSourceEntry(groupId, reason) {
  return {
    group_id: groupId,
    provider: null,
    data_as_of: null,
    retrieved_at: null,
    artifact_path: null,
    raw_artifact_sha256: null,
    raw_readback_sha256: null,
    parser_version: null,
    parser_code_sha256: null,
    parser_config_sha256: null,
    freshness_status: null,
    missingness_status: "NOT_APPLICABLE",
    missingness_reason: reason
  };
}

function buildCandidate(caseDirectory, slot, input, now) {
  const violations = validateCaptureInputR50(slot, input);
  if (violations.length > 0) {
    throw new OperatorCaseR50Error(
      `Capture input has ${violations.length} missing or invalid field(s).`,
      {
        code: "CAPTURE_INCOMPLETE",
        status: 422,
        violations
      }
    );
  }
  const sealedAt = new Date(now instanceof Date ? now : now ?? Date.now());
  const accessAt = new Date(sealedAt.getTime() + 1);
  mkdirSync(path.join(caseDirectory, "artifacts"), { recursive: true });

  const rowsPath = "artifacts/ohlcv.json";
  const contextPath = "artifacts/market-context.json";
  writeJson(path.join(caseDirectory, rowsPath), input.ohlcv_rows);
  writeJson(path.join(caseDirectory, contextPath), {
    schema_version: "visionassist.product.market-context.r50.v1",
    case_id: slot.case_id,
    instrument: input.instrument,
    provenance: input.provenance,
    price_and_volume: input.price_and_volume,
    token_metrics: input.token_metrics,
    derivatives: input.derivatives,
    reference_market_and_regime: input.reference_market_and_regime
  });

  const articlePaths = input.event_search.articles.map((article, index) => {
    const relative = `artifacts/articles/article-${String(index + 1).padStart(3, "0")}.json`;
    writeJson(path.join(caseDirectory, relative), {
      source_id: article.source_id,
      provider: article.provider,
      title: article.title,
      url: article.url,
      first_published_at: article.first_published_at,
      updated_at: article.updated_at
    });
    return relative;
  });
  const eventPaths = input.event_search.scheduled_events.map((event, index) => {
    const relative = `artifacts/events/event-${String(index + 1).padStart(3, "0")}.json`;
    writeJson(path.join(caseDirectory, relative), {
      source_id: event.source_id,
      provider: event.provider,
      event_identity: event.event_identity,
      url: event.url,
      scheduled_at: event.scheduled_at,
      known_as_of: event.known_as_of
    });
    return relative;
  });
  let emptySearchPath = null;
  if (articlePaths.length === 0 && eventPaths.length === 0) {
    emptySearchPath = "artifacts/events/empty-search-receipt.json";
    writeJson(path.join(caseDirectory, emptySearchPath), {
      schema_version: "visionassist.product.empty-event-search.r50.v1",
      case_id: slot.case_id,
      query: input.event_search.query,
      providers: input.event_search.providers,
      searched_at: input.event_search.search_performed_at,
      cutoff_at: input.cutoff_at,
      attested_empty: true
    });
  }

  const artifactManifest = [
    artifactRecord(
      caseDirectory,
      rowsPath,
      "application/json",
      "SEQUENTIAL_PRE_CUTOFF_OHLCV"
    ),
    artifactRecord(
      caseDirectory,
      contextPath,
      "application/json",
      "MARKET_CONTEXT"
    ),
    ...articlePaths.map((relative) =>
      artifactRecord(
        caseDirectory,
        relative,
        "application/json",
        "PRE_CUTOFF_ARTICLE"
      )
    ),
    ...eventPaths.map((relative) =>
      artifactRecord(
        caseDirectory,
        relative,
        "application/json",
        "PRE_CUTOFF_EVENT_RECEIPT"
      )
    ),
    ...(emptySearchPath
      ? [artifactRecord(
          caseDirectory,
          emptySearchPath,
          "application/json",
          "EMPTY_PRE_CUTOFF_EVENT_SEARCH"
        )]
      : [])
  ];
  const artifactByPath = new Map(
    artifactManifest.map((item) => [item.path, item])
  );
  const ohlcvArtifact = artifactByPath.get(rowsPath);
  const contextArtifact = artifactByPath.get(contextPath);
  const eventArtifact = articlePaths.length > 0
    ? artifactByPath.get(articlePaths[0])
    : eventPaths.length > 0
      ? artifactByPath.get(eventPaths[0])
      : artifactByPath.get(emptySearchPath);
  const parserConfigSha256 = sha256Json({
    schema_version: "visionassist.product.operator-parser-config.r50.v1",
    case_id: slot.case_id,
    selected_at: slot.selected_at,
    applicability: slot.applicability,
    source_url: input.provenance.source_url
  });
  const criticalGroupStatus = {};
  const sourceGroupRegistry = R34_CRITICAL_GROUPS.map((groupId) => {
    const derivativeNotApplicable =
      DERIVATIVE_GROUPS.has(groupId) && !slot.applicability.derivatives;
    const tokenNotApplicable =
      groupId === "market_cap_fdv_and_circulating_supply" &&
      !slot.applicability.token_metrics;
    if (derivativeNotApplicable) {
      criticalGroupStatus[groupId] = "NOT_APPLICABLE";
      return notApplicableSourceEntry(
        groupId,
        input.derivatives.missingness_reason
      );
    }
    if (tokenNotApplicable) {
      criticalGroupStatus[groupId] = "NOT_APPLICABLE";
      return notApplicableSourceEntry(
        groupId,
        input.token_metrics.missingness_reason
      );
    }
    criticalGroupStatus[groupId] = "PRESENT";
    const artifact = groupId === "sequential_pre_cutoff_ohlcv"
      ? ohlcvArtifact
      : groupId === "bounded_pre_cutoff_event_search"
        ? eventArtifact
        : contextArtifact;
    return presentSourceEntry(
      groupId,
      artifact,
      input,
      parserConfigSha256
    );
  });

  const ohlcvSha256 = sha256Json(input.ohlcv_rows);
  const applicabilityPayload = {
    frozen_at: slot.external_context_profile_frozen_at,
    derivatives: slot.applicability.derivatives,
    token_metrics: slot.applicability.token_metrics,
    event_search: true
  };
  const indicators = computeMarketIndicatorsR34(input.ohlcv_rows, [1, 5, 20]);
  const articles = input.event_search.articles.map((article, index) => {
    const artifact = artifactByPath.get(articlePaths[index]);
    return {
      source_id: article.source_id,
      provider: article.provider,
      first_published_at: article.first_published_at,
      updated_at: article.updated_at,
      artifact_path: artifact.path,
      raw_artifact_sha256: artifact.sha256
    };
  });
  const scheduledEvents = input.event_search.scheduled_events.map(
    (event, index) => {
      const artifact = artifactByPath.get(eventPaths[index]);
      return {
        source_id: event.source_id,
        provider: event.provider,
        event_identity: event.event_identity,
        scheduled_at: event.scheduled_at,
        known_as_of: event.known_as_of,
        artifact_path: artifact.path,
        raw_artifact_sha256: artifact.sha256
      };
    }
  );
  const token = input.token_metrics.applicable
    ? {
        applicable: true,
        market_cap: input.token_metrics.market_cap,
        fdv: input.token_metrics.fdv,
        circulating_supply: input.token_metrics.circulating_supply
      }
    : {
        applicable: false,
        market_cap: null,
        fdv: null,
        circulating_supply: null
      };
  const derivatives = input.derivatives.applicable
    ? {
        applicable: true,
        open_interest: input.derivatives.open_interest,
        open_interest_change_percent:
          input.derivatives.open_interest_change_percent,
        funding_rate: input.derivatives.funding_rate,
        spot_perpetual_basis_percent:
          input.derivatives.spot_perpetual_basis_percent,
        liquidations_24h: input.derivatives.liquidations_24h,
        long_short_ratio: input.derivatives.long_short_ratio,
        cvd: input.derivatives.cvd
      }
    : {
        applicable: false,
        open_interest: null,
        open_interest_change_percent: null,
        funding_rate: null,
        spot_perpetual_basis_percent: null,
        liquidations_24h: null,
        long_short_ratio: null,
        cvd: null
      };

  const bundle = {
    schema_version: "visionassist.benchmark.market-evidence-bundle-r34.v1",
    batch_id: "visionassist-r50-operator-demo",
    track_id: "MARKET-R50",
    case_id: slot.case_id,
    capture_mode: "FORWARD_LOCKED_FULL_CONTEXT",
    timing: {
      external_context_profile_frozen_at:
        slot.external_context_profile_frozen_at,
      case_selected_at: slot.selected_at,
      cutoff_at: input.cutoff_at,
      bundle_sealed_at: sealedAt.toISOString(),
      analyst_access_not_before_at: accessAt.toISOString(),
      prior_deadline: input.prior_deadline,
      horizon_start_at: input.horizon_start_at
    },
    instrument: { ...input.instrument },
    horizon: {
      timeframe: input.horizon.timeframe,
      completed_bars: input.horizon.completed_bars,
      labels: ["up", "down", "range"],
      resolution_rule: input.horizon.resolution_rule
    },
    applicability_matrix: {
      ...applicabilityPayload,
      matrix_sha256: sha256Json(applicabilityPayload)
    },
    critical_group_status: criticalGroupStatus,
    source_group_registry: sourceGroupRegistry,
    artifact_manifest: artifactManifest,
    price_and_volume: {
      cutoff_price: input.ohlcv_rows.at(-1).close,
      ...input.price_and_volume,
      ohlcv: {
        timeframe: input.horizon.timeframe,
        required_rows: input.ohlcv_rows.length,
        rows: input.ohlcv_rows,
        artifact_path: rowsPath,
        sha256: ohlcvSha256
      }
    },
    token_metrics: token,
    derivatives,
    deterministic_indicators: {
      formula_manifest_id: "VA-R34-MARKET-INDICATORS-001",
      formula_manifest_sha256: R34_FORMULA_MANIFEST_SHA256,
      computed_from_ohlcv_sha256: ohlcvSha256,
      ...indicators
    },
    events_and_articles: {
      query_policy_sha256: sha256Json({
        query: input.event_search.query,
        providers: input.event_search.providers,
        cutoff_at: input.cutoff_at
      }),
      search_performed_at: input.event_search.search_performed_at,
      search_cutoff_at: input.cutoff_at,
      items: articles,
      scheduled_events: scheduledEvents,
      empty_search_receipt_artifact_path: emptySearchPath
    },
    reference_market_and_regime: {
      regime_definition:
        input.reference_market_and_regime.regime_definition,
      regime_value: input.reference_market_and_regime.regime_value,
      reference_assets:
        input.reference_market_and_regime.reference_assets.map((item) =>
          item.trim()
        )
    },
    leakage_scan: {
      future_market_data: false,
      outcome_material: false,
      ai_assessment: false,
      fusion_output: false,
      baseline_output: false,
      reveal_output: false,
      adjudication_output: false,
      scoring_output: false,
      status: "PASS"
    },
    authority: { ...R50_AUTHORITY }
  };
  writeJson(path.join(caseDirectory, "market_evidence_bundle.json"), bundle);
  try {
    return verifyMarketInputR50(caseDirectory);
  } catch (error) {
    if (error instanceof MarketEvidenceGateError) {
      throw new OperatorCaseR50Error(error.message, {
        code: error.code,
        status: 422,
        violations: error.violations
      });
    }
    throw error;
  }
}

function requireOpenSlot(paths) {
  if (!existsSync(paths.slot)) {
    throw new OperatorCaseR50Error("Open the slot before capture.", {
      code: "SLOT_NOT_OPEN",
      status: 409
    });
  }
  return readJson(paths.slot);
}

function verifyFrozenEvidence(paths) {
  if (!existsSync(paths.evidenceReceipt) || !existsSync(paths.evidence)) {
    throw new OperatorCaseR50Error("Evidence must be frozen first.", {
      code: "EVIDENCE_NOT_FROZEN",
      status: 409
    });
  }
  const receipt = readJson(paths.evidenceReceipt);
  let validation;
  try {
    validation = verifyMarketInputR50(paths.evidence);
  } catch (error) {
    throw new OperatorCaseR50Error(
      "Frozen evidence no longer passes the market evidence gate.",
      {
        code: "EVIDENCE_TAMPERED",
        status: 409,
        violations: error.violations ?? []
      }
    );
  }
  if (
    validation.canonical_bundle_sha256 !==
    receipt.evidence_validation?.canonical_bundle_sha256
  ) {
    throw new OperatorCaseR50Error(
      "Frozen evidence SHA-256 differs from its receipt.",
      { code: "EVIDENCE_TAMPERED", status: 409 }
    );
  }
  return { receipt, validation };
}

function verifyFrozenPrior(paths) {
  if (!existsSync(paths.priorReceipt) || !existsSync(paths.prior)) {
    throw new OperatorCaseR50Error("Human prior must be frozen first.", {
      code: "HUMAN_PRIOR_NOT_FROZEN",
      status: 409
    });
  }
  const prior = readJson(paths.prior);
  const receipt = readJson(paths.priorReceipt);
  if (
    sha256Json(prior) !== receipt.human_prior_sha256 ||
    prior.evidence_bundle_sha256 !== receipt.evidence_bundle_sha256
  ) {
    throw new OperatorCaseR50Error(
      "Frozen human prior differs from its receipt.",
      { code: "HUMAN_PRIOR_TAMPERED", status: 409 }
    );
  }
  return { prior, receipt };
}

export function previewEvidenceR50(storeRoot, caseId, input, { now } = {}) {
  const paths = storePaths(storeRoot, caseId);
  const slot = requireOpenSlot(paths);
  const previewRoot = mkdtempSync(path.join(paths.root, ".preview-"));
  try {
    const candidate = path.join(previewRoot, caseId);
    const receipt = buildCandidate(candidate, slot, input, now);
    return {
      status: "PASS",
      preview_only: true,
      receipt
    };
  } finally {
    rmSync(previewRoot, { recursive: true, force: true });
  }
}

export function freezeEvidenceR50(storeRoot, caseId, input, { now } = {}) {
  const paths = storePaths(storeRoot, caseId);
  const slot = requireOpenSlot(paths);
  if (existsSync(paths.evidence) || existsSync(paths.evidenceReceipt)) {
    throw new OperatorCaseR50Error("Evidence is already frozen.", {
      code: "EVIDENCE_ALREADY_FROZEN",
      status: 409
    });
  }
  const stagingRoot = path.join(
    paths.root,
    `.staging-${caseId}-${randomUUID()}`
  );
  const candidate = path.join(stagingRoot, caseId);
  try {
    const validation = buildCandidate(candidate, slot, input, now);
    mkdirSync(path.dirname(paths.evidence), { recursive: true });
    renameSync(candidate, paths.evidence);
    const receipt = {
      schema_version:
        "visionassist.product.evidence-frozen-receipt.r50.v1",
      phase: "EVIDENCE_FROZEN",
      case_id: caseId,
      frozen_at: validation.canonical_bundle_sha256
        ? readJson(path.join(paths.evidence, "market_evidence_bundle.json"))
          .timing.bundle_sealed_at
        : isoNow(now),
      evidence_validation: validation,
      authority: { ...R50_AUTHORITY }
    };
    receipt.receipt_sha256 = sha256Json(receipt);
    try {
      writeJson(paths.evidenceReceipt, receipt, { exclusive: true });
    } catch (error) {
      rmSync(paths.evidence, { recursive: true, force: true });
      throw error;
    }
    return receipt;
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

export function validateHumanPriorR50(input) {
  const violations = [];
  if (!isObject(input)) {
    return [{
      code: "HUMAN_PRIOR_INCOMPLETE",
      path: "human_prior",
      message: "Human prior must be a JSON object."
    }];
  }
  requireString(input.interpretation, "interpretation", violations);
  if (
    !Array.isArray(input.competing_hypotheses) ||
    input.competing_hypotheses.length < 2
  ) {
    addViolation(
      violations,
      "competing_hypotheses",
      "At least two competing hypotheses are required.",
      "HUMAN_PRIOR_INCOMPLETE"
    );
  } else {
    input.competing_hypotheses.forEach((hypothesis, index) => {
      const base = `competing_hypotheses[${index}]`;
      if (!isObject(hypothesis)) {
        addViolation(
          violations,
          base,
          "Hypothesis must be an object.",
          "HUMAN_PRIOR_INCOMPLETE"
        );
        return;
      }
      for (const key of [
        "statement",
        "evidence",
        "counterevidence",
        "invalidation_condition"
      ]) {
        if (!requireString(hypothesis[key], `${base}.${key}`, violations)) {
          violations.at(-1).code = "HUMAN_PRIOR_INCOMPLETE";
        }
      }
    });
  }
  requireFinite(input.confidence, "confidence", violations, { minimum: 0 });
  if (Number.isFinite(input.confidence) && input.confidence > 1) {
    addViolation(
      violations,
      "confidence",
      "Confidence must be between 0 and 1.",
      "HUMAN_PRIOR_INCOMPLETE"
    );
  }
  const forecast = input.outcome_forecast;
  if (!isObject(forecast) || typeof forecast.abstain !== "boolean") {
    addViolation(
      violations,
      "outcome_forecast",
      "Outcome forecast and abstain boolean are required.",
      "HUMAN_PRIOR_INCOMPLETE"
    );
  } else if (forecast.abstain) {
    if (forecast.probabilities !== null) {
      addViolation(
        violations,
        "outcome_forecast.probabilities",
        "Abstention requires null probabilities.",
        "HUMAN_PRIOR_INCOMPLETE"
      );
    }
    requireString(
      forecast.abstention_reason_code,
      "outcome_forecast.abstention_reason_code",
      violations
    );
    requireString(
      forecast.abstention_reason,
      "outcome_forecast.abstention_reason",
      violations
    );
  } else {
    if (!isObject(forecast.probabilities)) {
      addViolation(
        violations,
        "outcome_forecast.probabilities",
        "up/down/range probabilities are required.",
        "HUMAN_PRIOR_INCOMPLETE"
      );
    } else {
      const values = ["up", "down", "range"].map((label) =>
        forecast.probabilities[label]
      );
      values.forEach((value, index) => {
        const label = ["up", "down", "range"][index];
        requireFinite(
          value,
          `outcome_forecast.probabilities.${label}`,
          violations,
          { minimum: 0 }
        );
        if (Number.isFinite(value) && value > 1) {
          addViolation(
            violations,
            `outcome_forecast.probabilities.${label}`,
            "Probability must be <= 1.",
            "HUMAN_PRIOR_INCOMPLETE"
          );
        }
      });
      if (
        values.every(Number.isFinite) &&
        Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 1e-9
      ) {
        addViolation(
          violations,
          "outcome_forecast.probabilities",
          "Probabilities must sum to 1.",
          "HUMAN_PRIOR_INCOMPLETE"
        );
      }
    }
    if (
      forecast.abstention_reason_code !== null ||
      forecast.abstention_reason !== null
    ) {
      addViolation(
        violations,
        "outcome_forecast",
        "Non-abstaining prior must not carry an abstention reason.",
        "HUMAN_PRIOR_INCOMPLETE"
      );
    }
  }
  if (input.outcome_unseen_attestation !== true) {
    addViolation(
      violations,
      "outcome_unseen_attestation",
      "The human must attest that the outcome is unseen.",
      "HUMAN_PRIOR_INCOMPLETE"
    );
  }
  if (input.ai_unseen_attestation !== true) {
    addViolation(
      violations,
      "ai_unseen_attestation",
      "The human must attest that AI output is unseen.",
      "HUMAN_PRIOR_INCOMPLETE"
    );
  }
  return violations.map((violation) => ({
    ...violation,
    code: violation.code === "MISSING_REQUIRED_CONTEXT"
      ? "HUMAN_PRIOR_INCOMPLETE"
      : violation.code
  }));
}

export function freezeHumanPriorR50(storeRoot, caseId, input, { now } = {}) {
  const paths = storePaths(storeRoot, caseId);
  verifyFrozenEvidence(paths);
  if (existsSync(paths.prior) || existsSync(paths.priorReceipt)) {
    throw new OperatorCaseR50Error("Human prior is already frozen.", {
      code: "HUMAN_PRIOR_ALREADY_FROZEN",
      status: 409
    });
  }
  const violations = validateHumanPriorR50(input);
  if (violations.length > 0) {
    throw new OperatorCaseR50Error(
      `Human prior has ${violations.length} invalid field(s).`,
      {
        code: "HUMAN_PRIOR_INCOMPLETE",
        status: 422,
        violations
      }
    );
  }
  const recordedAt = isoNow(now);
  const bundle = readJson(
    path.join(paths.evidence, "market_evidence_bundle.json")
  );
  const recorded = Date.parse(recordedAt);
  const access = Date.parse(bundle.timing.analyst_access_not_before_at);
  const deadline = Date.parse(bundle.timing.prior_deadline);
  if (recorded < access || recorded > deadline) {
    throw new OperatorCaseR50Error(
      "Human prior was recorded outside the frozen access/deadline window.",
      {
        code: "HUMAN_PRIOR_WINDOW_VIOLATION",
        status: 422,
        violations: [{
          code: "HUMAN_PRIOR_WINDOW_VIOLATION",
          path: "recorded_at",
          message:
            `recorded_at must be between ${bundle.timing.analyst_access_not_before_at} and ${bundle.timing.prior_deadline}.`
        }]
      }
    );
  }
  const probabilityLabels = ["up", "down", "range"];
  const prior = {
    schema_version: "visionassist.product.human-prior.r50.v1",
    case_id: caseId,
    evidence_bundle_sha256: sha256Json(bundle),
    recorded_at: recordedAt,
    interpretation: input.interpretation.trim(),
    competing_hypotheses: input.competing_hypotheses.map(
      (hypothesis, index) => ({
        id: `H${index + 1}`,
        statement: hypothesis.statement.trim(),
        evidence: hypothesis.evidence.trim(),
        counterevidence: hypothesis.counterevidence.trim(),
        invalidation_condition: hypothesis.invalidation_condition.trim()
      })
    ),
    outcome_forecast: input.outcome_forecast.abstain
      ? {
          abstain: true,
          probabilities: null,
          abstention_reason_code:
            input.outcome_forecast.abstention_reason_code.trim(),
          abstention_reason: input.outcome_forecast.abstention_reason.trim()
        }
      : {
          abstain: false,
          probabilities: probabilityLabels.map((label) => ({
            label,
            probability: input.outcome_forecast.probabilities[label]
          })),
          abstention_reason_code: null,
          abstention_reason: null
        },
    confidence: input.confidence,
    outcome_unseen_attestation: true,
    ai_unseen_attestation: true,
    authority: { ...R50_AUTHORITY }
  };
  const priorSha256 = sha256Json(prior);
  const receipt = {
    schema_version: "visionassist.product.human-prior-frozen-receipt.r50.v1",
    phase: "HUMAN_PRIOR_FROZEN",
    case_id: caseId,
    frozen_at: recordedAt,
    evidence_bundle_sha256: prior.evidence_bundle_sha256,
    human_prior_sha256: priorSha256,
    chain_sha256: sha256Json({
      case_id: caseId,
      evidence_bundle_sha256: prior.evidence_bundle_sha256,
      human_prior_sha256: priorSha256,
      frozen_at: recordedAt
    }),
    authority: { ...R50_AUTHORITY }
  };
  writeJson(paths.prior, prior, { exclusive: true });
  try {
    writeJson(paths.priorReceipt, receipt, { exclusive: true });
  } catch (error) {
    rmSync(paths.prior, { force: true });
    throw error;
  }
  return receipt;
}

export function exportAiRunnerPacketR50(storeRoot, caseId) {
  const paths = storePaths(storeRoot, caseId);
  verifyFrozenEvidence(paths);
  verifyFrozenPrior(paths);
  if (existsSync(paths.aiPacket)) {
    return {
      case_id: caseId,
      packet_path: paths.aiPacket,
      packet_sha256: sha256File(paths.aiPacket),
      already_existed: true
    };
  }
  const bundle = readJson(
    path.join(paths.evidence, "market_evidence_bundle.json")
  );
  const validationReceipt = readJson(paths.evidenceReceipt);
  const artifacts = bundle.artifact_manifest.map((artifact) => {
    const artifactPath = path.join(paths.evidence, artifact.path);
    return {
      path: artifact.path,
      media_type: artifact.media_type,
      role: artifact.role,
      sha256: artifact.sha256,
      base64: readFileSync(artifactPath).toString("base64")
    };
  });
  const packet = {
    schema_version: "visionassist.product.ai-runner-packet.r50.v1",
    packet_status: "READY_FOR_SEPARATE_AI_RUNNER",
    case_id: caseId,
    human_prior_included: false,
    evidence_bundle: bundle,
    evidence_validation_receipt: validationReceipt,
    artifacts,
    excluded_material: [
      "human_prior",
      "outcome",
      "future_market_data",
      "ai_assessment",
      "fusion_output",
      "baseline_output",
      "reveal_output",
      "scoring_output"
    ],
    authority: { ...R50_AUTHORITY }
  };
  writeJson(paths.aiPacket, packet, { exclusive: true });
  return {
    case_id: caseId,
    packet_path: paths.aiPacket,
    packet_sha256: sha256File(paths.aiPacket),
    packet_bytes: readFileSync(paths.aiPacket).length,
    already_existed: false
  };
}

export function readAiRunnerPacketR50(storeRoot, caseId) {
  const paths = storePaths(storeRoot, caseId);
  if (!existsSync(paths.aiPacket)) {
    throw new OperatorCaseR50Error("AI-runner packet has not been exported.", {
      code: "AI_PACKET_NOT_EXPORTED",
      status: 404
    });
  }
  return readJson(paths.aiPacket);
}

export function getOperatorCaseStateR50(storeRoot, caseId) {
  const paths = storePaths(storeRoot, caseId);
  const opened = existsSync(paths.slot);
  let evidenceFrozen =
    existsSync(paths.evidence) && existsSync(paths.evidenceReceipt);
  let priorFrozen =
    existsSync(paths.prior) && existsSync(paths.priorReceipt);
  const packetExported = existsSync(paths.aiPacket);
  let integrity = "NOT_APPLICABLE";
  let integrityError = null;
  if (evidenceFrozen) {
    try {
      verifyFrozenEvidence(paths);
      integrity = "PASS";
    } catch (error) {
      integrity = "FAIL";
      integrityError = error.code;
      evidenceFrozen = false;
      priorFrozen = false;
    }
  }
  if (priorFrozen) {
    try {
      verifyFrozenPrior(paths);
    } catch (error) {
      integrity = "FAIL";
      integrityError = error.code;
      priorFrozen = false;
    }
  }
  let phase = "EMPTY";
  if (opened) phase = "CAPTURE_OPEN";
  if (evidenceFrozen) phase = "EVIDENCE_FROZEN";
  if (priorFrozen) phase = "HUMAN_PRIOR_FROZEN";
  if (packetExported && priorFrozen) phase = "AI_PACKET_EXPORTED";
  if (integrity === "FAIL") phase = integrityError;
  const slot = opened ? readJson(paths.slot) : null;
  const evidenceReceipt = evidenceFrozen ? readJson(paths.evidenceReceipt) : null;
  const priorReceipt = priorFrozen ? readJson(paths.priorReceipt) : null;
  return {
    case_id: caseId,
    phase,
    slot,
    evidence_receipt: evidenceReceipt,
    prior_receipt: priorReceipt,
    ai_packet_exported: packetExported,
    integrity,
    integrity_error: integrityError,
    authority: { ...R50_AUTHORITY }
  };
}

export function listOperatorCasesR50(storeRoot) {
  return R50_CASE_IDS.map((caseId) =>
    getOperatorCaseStateR50(storeRoot, caseId)
  );
}

export function buildRuntimeProofReceiptR50({
  storeRoot,
  baseUrl,
  startedAt,
  stoppedAt,
  requestChecks,
  screenshotPath = null,
  testOnly = false
}) {
  const receipt = {
    schema_version: "visionassist.product.runtime-proof.r50.v1",
    base_url: baseUrl,
    loopback_only: true,
    started_at: startedAt,
    stopped_at: stoppedAt,
    case_states: listOperatorCasesR50(storeRoot),
    request_checks: requestChecks,
    screenshot_path: screenshotPath,
    test_only: testOnly,
    human_case_claimed: false,
    vault_accessed: false,
    ai_run_executed: false,
    authority: { ...R50_AUTHORITY }
  };
  return {
    ...receipt,
    receipt_sha256: sha256Text(JSON.stringify(receipt))
  };
}
