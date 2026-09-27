import {
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import {
  R34_CRITICAL_GROUPS,
  R34_FORMULA_MANIFEST_SHA256,
  computeMarketIndicatorsR34
} from "../src/market-evidence-r34.js";
import {
  readJson,
  sha256File,
  sha256Json
} from "../src/canonical-json.js";

const AUTHORITY = Object.freeze({
  decision_status: "DIAGNOSTIC_ONLY",
  action_code: "NO_ACTION",
  execution_permission: "HOLD",
  capital_permission: "DENY",
  can_trade: false
});

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const CUTOFF = "2026-07-28T08:00:00.000Z";

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createRows() {
  const cutoff = Date.parse(CUTOFF);
  const first = cutoff - (219 * 60 * 60 * 1000);
  return Array.from({ length: 220 }, (_, index) => {
    const baseline = 100 + (index * 0.08) + (Math.sin(index / 7) * 1.5);
    const open = baseline + (Math.sin(index / 3) * 0.2);
    const close = baseline + (Math.cos(index / 5) * 0.25);
    return {
      timestamp: new Date(first + (index * 60 * 60 * 1000)).toISOString(),
      open,
      high: Math.max(open, close) + 0.75,
      low: Math.min(open, close) - 0.65,
      close,
      volume: 1_000 + (index * 3) + ((index % 9) * 11)
    };
  });
}

function artifactRecord(caseDirectory, relativePath, mediaType, role) {
  return {
    path: relativePath,
    sha256: sha256File(path.join(caseDirectory, relativePath)),
    media_type: mediaType,
    role
  };
}

function sourceEntry(groupId, artifact) {
  return {
    group_id: groupId,
    provider: "SYNTHETIC_R34_TEST_PROVIDER",
    data_as_of: "2026-07-28T07:55:00.000Z",
    retrieved_at: "2026-07-28T07:58:00.000Z",
    artifact_path: artifact.path,
    raw_artifact_sha256: artifact.sha256,
    raw_readback_sha256: artifact.sha256,
    parser_version: "r34-test-parser-v1",
    parser_code_sha256: HASH_A,
    parser_config_sha256: HASH_B,
    freshness_status: "PASS",
    missingness_status: "PRESENT",
    missingness_reason: null
  };
}

export function createMarketEvidenceFixture(root, {
  caseId = "MKT-R34-001"
} = {}) {
  const caseDirectory = path.join(root, caseId);
  const rows = createRows();
  const contextArtifact = {
    provider: "SYNTHETIC_R34_TEST_PROVIDER",
    observed_at: "2026-07-28T07:55:00.000Z",
    note: "Deterministic validator fixture. Not benchmark evidence."
  };
  const articleArtifact = {
    headline: "Pre-cutoff synthetic context item",
    captured_at: "2026-07-28T07:31:00.000Z"
  };
  const eventArtifact = {
    event: "Scheduled synthetic release",
    known_as_of: "2026-07-28T07:00:00.000Z"
  };

  writeJson(path.join(caseDirectory, "artifacts", "ohlcv.json"), rows);
  writeJson(
    path.join(caseDirectory, "artifacts", "context.json"),
    contextArtifact
  );
  writeJson(
    path.join(caseDirectory, "artifacts", "article.json"),
    articleArtifact
  );
  writeJson(
    path.join(caseDirectory, "artifacts", "event.json"),
    eventArtifact
  );

  const artifactManifest = [
    artifactRecord(
      caseDirectory,
      "artifacts/ohlcv.json",
      "application/json",
      "SEQUENTIAL_PRE_CUTOFF_OHLCV"
    ),
    artifactRecord(
      caseDirectory,
      "artifacts/context.json",
      "application/json",
      "MARKET_CONTEXT"
    ),
    artifactRecord(
      caseDirectory,
      "artifacts/article.json",
      "application/json",
      "PRE_CUTOFF_ARTICLE"
    ),
    artifactRecord(
      caseDirectory,
      "artifacts/event.json",
      "application/json",
      "PRE_CUTOFF_EVENT_RECEIPT"
    )
  ];
  const artifactsByRole = new Map(
    artifactManifest.map((artifact) => [artifact.role, artifact])
  );
  const context = artifactsByRole.get("MARKET_CONTEXT");
  const ohlcvArtifact = artifactsByRole.get("SEQUENTIAL_PRE_CUTOFF_OHLCV");
  const article = artifactsByRole.get("PRE_CUTOFF_ARTICLE");
  const event = artifactsByRole.get("PRE_CUTOFF_EVENT_RECEIPT");
  const criticalGroupStatus = Object.fromEntries(
    R34_CRITICAL_GROUPS.map((groupId) => [groupId, "PRESENT"])
  );
  const sourceGroupRegistry = R34_CRITICAL_GROUPS.map((groupId) =>
    sourceEntry(
      groupId,
      groupId === "sequential_pre_cutoff_ohlcv"
        ? ohlcvArtifact
        : groupId === "bounded_pre_cutoff_event_search"
          ? article
          : context
    )
  );
  const ohlcvSha256 = sha256Json(rows);
  const indicators = computeMarketIndicatorsR34(rows, [1, 5, 20]);
  const applicabilityPayload = {
    frozen_at: "2026-07-27T00:00:00.000Z",
    derivatives: true,
    token_metrics: true,
    event_search: true
  };

  const bundle = {
    schema_version: "visionassist.benchmark.market-evidence-bundle-r34.v1",
    batch_id: "visionassist-r34-development-001",
    track_id: "MARKET-R34",
    case_id: caseId,
    capture_mode: "FORWARD_LOCKED_FULL_CONTEXT",
    timing: {
      external_context_profile_frozen_at: "2026-07-27T00:00:00.000Z",
      case_selected_at: "2026-07-28T07:00:00.000Z",
      cutoff_at: CUTOFF,
      bundle_sealed_at: "2026-07-28T08:05:00.000Z",
      analyst_access_not_before_at: "2026-07-28T08:10:00.000Z",
      prior_deadline: "2026-07-28T08:50:00.000Z",
      horizon_start_at: "2026-07-28T09:00:00.000Z"
    },
    instrument: {
      symbol: "SYNTH-PERP",
      venue: "SYNTHETIC_TEST_VENUE",
      asset_class: "crypto",
      quote_currency: "USD",
      market_type: "perpetual"
    },
    horizon: {
      timeframe: "1h",
      completed_bars: 20,
      labels: ["up", "down", "range"],
      resolution_rule: "Frozen synthetic test rule; no real market outcome."
    },
    applicability_matrix: {
      ...applicabilityPayload,
      matrix_sha256: sha256Json(applicabilityPayload)
    },
    critical_group_status: criticalGroupStatus,
    source_group_registry: sourceGroupRegistry,
    artifact_manifest: artifactManifest,
    price_and_volume: {
      cutoff_price: rows.at(-1).close,
      spot_volume: 1_250_000,
      perpetual_volume: 2_500_000,
      turnover: 3_750_000,
      spread_bps: 2.5,
      depth_quote: 500_000,
      ohlcv: {
        timeframe: "1h",
        required_rows: rows.length,
        rows,
        artifact_path: ohlcvArtifact.path,
        sha256: ohlcvSha256
      }
    },
    token_metrics: {
      applicable: true,
      market_cap: 10_000_000_000,
      fdv: 12_000_000_000,
      circulating_supply: 100_000_000
    },
    derivatives: {
      applicable: true,
      open_interest: 900_000_000,
      open_interest_change_percent: 1.25,
      funding_rate: 0.0001,
      spot_perpetual_basis_percent: 0.05,
      liquidations_24h: 2_500_000,
      long_short_ratio: 1.02,
      cvd: -12_500
    },
    deterministic_indicators: {
      formula_manifest_id: "VA-R34-MARKET-INDICATORS-001",
      formula_manifest_sha256: R34_FORMULA_MANIFEST_SHA256,
      computed_from_ohlcv_sha256: ohlcvSha256,
      ...indicators
    },
    events_and_articles: {
      query_policy_sha256: HASH_C,
      search_performed_at: "2026-07-28T07:55:00.000Z",
      search_cutoff_at: CUTOFF,
      items: [
        {
          source_id: "article-001",
          provider: "SYNTHETIC_R34_TEST_PROVIDER",
          first_published_at: "2026-07-28T07:00:00.000Z",
          updated_at: "2026-07-28T07:30:00.000Z",
          artifact_path: article.path,
          raw_artifact_sha256: article.sha256
        }
      ],
      scheduled_events: [
        {
          source_id: "event-001",
          provider: "SYNTHETIC_R34_TEST_PROVIDER",
          event_identity: "synthetic-release-001",
          scheduled_at: "2026-07-29T12:00:00.000Z",
          known_as_of: "2026-07-28T07:00:00.000Z",
          artifact_path: event.path,
          raw_artifact_sha256: event.sha256
        }
      ],
      empty_search_receipt_artifact_path: null
    },
    reference_market_and_regime: {
      regime_definition: "Synthetic deterministic fixture regime.",
      regime_value: "BALANCED",
      reference_assets: ["SYNTH-INDEX"]
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
    authority: { ...AUTHORITY }
  };

  const bundlePath = path.join(caseDirectory, "market_evidence_bundle.json");
  writeJson(bundlePath, bundle);
  return { caseDirectory, bundlePath, bundle };
}

function resolveMutationTarget(bundle, segments) {
  let target = bundle;
  for (const segment of segments.slice(0, -1)) {
    target = target[segment];
  }
  return { target, key: segments.at(-1) };
}

export function applyNegativeFixture(fixture, mutation) {
  if (mutation.operation === "write_file") {
    writeJson(
      path.join(fixture.caseDirectory, mutation.relative_path),
      mutation.value
    );
    return;
  }

  const bundle = readJson(fixture.bundlePath);
  const { target, key } = resolveMutationTarget(bundle, mutation.path);
  if (mutation.operation === "delete") {
    delete target[key];
  } else if (mutation.operation === "set") {
    target[key] = mutation.value;
  } else if (mutation.operation === "increment") {
    target[key] += mutation.value;
  } else {
    throw new TypeError(`Unknown fixture operation ${mutation.operation}.`);
  }
  writeJson(fixture.bundlePath, bundle);
}

export function readNegativeFixtures() {
  return JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/market-evidence-r34/negative-fixtures.json",
        import.meta.url
      ),
      "utf8"
    )
  );
}
