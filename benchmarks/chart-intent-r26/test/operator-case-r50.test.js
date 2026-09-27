import assert from "node:assert/strict";
import { once } from "node:events";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createOperatorServerR50 } from "../../../apps/market-case-capture/server.js";
import {
  OperatorCaseR50Error,
  createCaptureTemplateR50,
  exportAiRunnerPacketR50,
  freezeEvidenceR50,
  freezeHumanPriorR50,
  getOperatorCaseStateR50,
  previewEvidenceR50,
  readAiRunnerPacketR50,
  startOperatorCaseR50,
  validateHumanPriorR50
} from "../src/operator-case-r50.js";

const SELECTED_AT = "2026-07-29T00:00:00.000Z";
const CUTOFF_AT = "2026-07-29T00:10:00.000Z";
const FREEZE_AT = "2026-07-29T00:11:00.000Z";
const PRIOR_AT = "2026-07-29T00:12:00.000Z";

function withStore(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), "visionassist-r50-test-"));
  return Promise.resolve()
    .then(() => run(root))
    .finally(() => rmSync(root, { recursive: true, force: true }));
}

function createRows() {
  const last = Date.parse("2026-07-29T00:00:00.000Z");
  const first = last - (219 * 60 * 60 * 1000);
  return Array.from({ length: 220 }, (_, index) => {
    const baseline = 120 + (index * 0.05) + Math.sin(index / 8);
    const open = baseline + (Math.sin(index / 4) * 0.15);
    const close = baseline + (Math.cos(index / 5) * 0.2);
    return {
      timestamp: new Date(first + (index * 60 * 60 * 1000)).toISOString(),
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.45,
      close,
      volume: 5000 + (index * 7)
    };
  });
}

function validCapture(caseId = "MKT-R50-001") {
  return {
    case_id: caseId,
    cutoff_at: CUTOFF_AT,
    prior_deadline: "2026-07-29T00:20:00.000Z",
    horizon_start_at: "2026-07-29T00:30:00.000Z",
    instrument: {
      symbol: "TEST-USD",
      venue: "LOCAL_TEST_VENUE",
      asset_class: "crypto",
      quote_currency: "USD",
      market_type: "perpetual"
    },
    horizon: {
      timeframe: "1h",
      completed_bars: 20,
      resolution_rule: "Test-only close-to-close three-label rule."
    },
    provenance: {
      provider: "LOCAL_TEST_PROVIDER",
      data_as_of: "2026-07-29T00:09:00.000Z",
      retrieved_at: "2026-07-29T00:09:30.000Z",
      source_url: "https://example.invalid/test-only"
    },
    price_and_volume: {
      spot_volume: 1_000_000,
      perpetual_volume: 2_000_000,
      turnover: 3_000_000,
      spread_bps: 1.8,
      depth_quote: 400_000
    },
    ohlcv_rows: createRows(),
    token_metrics: {
      applicable: true,
      market_cap: 9_000_000_000,
      fdv: 10_000_000_000,
      circulating_supply: 90_000_000,
      missingness_reason: null
    },
    derivatives: {
      applicable: true,
      open_interest: 800_000_000,
      open_interest_change_percent: 1.1,
      funding_rate: 0.0001,
      spot_perpetual_basis_percent: 0.04,
      liquidations_24h: 2_000_000,
      long_short_ratio: 1.03,
      cvd: -10_000,
      missingness_reason: null
    },
    reference_market_and_regime: {
      regime_definition: "Test-only deterministic regime.",
      regime_value: "BALANCED",
      reference_assets: ["TEST-INDEX"]
    },
    event_search: {
      search_performed_at: "2026-07-29T00:09:40.000Z",
      query: "test-only bounded pre-cutoff search",
      providers: ["LOCAL_TEST_PROVIDER"],
      articles: [],
      scheduled_events: [],
      empty_search_attestation: true
    }
  };
}

function validPrior() {
  return {
    interpretation: "Test-only ambiguous pressure; no action signal.",
    competing_hypotheses: [
      {
        statement: "Pressure may resolve upward.",
        evidence: "Close remains above the slow reference.",
        counterevidence: "Volume expansion is absent.",
        invalidation_condition: "Close loses the reference with rising volume."
      },
      {
        statement: "Pressure may remain range-bound.",
        evidence: "Returns compress across recent windows.",
        counterevidence: "Open interest is expanding.",
        invalidation_condition: "Range breaks with confirmed turnover."
      }
    ],
    outcome_forecast: {
      abstain: false,
      probabilities: {
        up: 0.4,
        down: 0.25,
        range: 0.35
      },
      abstention_reason_code: null,
      abstention_reason: null
    },
    confidence: 0.55,
    outcome_unseen_attestation: true,
    ai_unseen_attestation: true
  };
}

function openSlot(root, caseId = "MKT-R50-001") {
  return startOperatorCaseR50(root, caseId, {
    derivatives: true,
    token_metrics: true,
    event_search: true
  }, {
    now: SELECTED_AT
  });
}

test("capture template is empty, bounded and not freezable", () =>
  withStore((root) => {
    openSlot(root);
    const template = createCaptureTemplateR50(root, "MKT-R50-001");
    assert.equal(template.case_id, "MKT-R50-001");
    assert.equal(template.cutoff_at, null);
    assert.deepEqual(template.ohlcv_rows, []);
    assert.equal(template.derivatives.applicable, true);
    assert.equal(template.token_metrics.applicable, true);
  }));

test("preview reports exact missing evidence paths", () =>
  withStore((root) => {
    openSlot(root);
    assert.throws(
      () => previewEvidenceR50(root, "MKT-R50-001", {
        case_id: "MKT-R50-001"
      }, {
        now: FREEZE_AT
      }),
      (error) => {
        assert.ok(error instanceof OperatorCaseR50Error);
        assert.equal(error.code, "CAPTURE_INCOMPLETE");
        assert.ok(error.violations.some((item) => item.path === "ohlcv_rows"));
        assert.ok(error.violations.some((item) => item.path === "cutoff_at"));
        return true;
      }
    );
  }));

test("valid evidence previews and freezes through the R50 identity profile", () =>
  withStore((root) => {
    openSlot(root);
    const preview = previewEvidenceR50(
      root,
      "MKT-R50-001",
      validCapture(),
      { now: FREEZE_AT }
    );
    assert.equal(preview.status, "PASS");
    assert.equal(preview.receipt.case_id, "MKT-R50-001");
    assert.equal(preview.receipt.market_evidence_status, "PASS");

    const receipt = freezeEvidenceR50(
      root,
      "MKT-R50-001",
      validCapture(),
      { now: FREEZE_AT }
    );
    assert.equal(receipt.phase, "EVIDENCE_FROZEN");
    assert.equal(receipt.evidence_validation.case_phase, "CASE_FROZEN");
    assert.equal(receipt.authority.can_trade, false);
    assert.equal(
      getOperatorCaseStateR50(root, "MKT-R50-001").phase,
      "EVIDENCE_FROZEN"
    );
  }));

test("human prior requires two hypotheses and freezes inside the deadline", () =>
  withStore((root) => {
    openSlot(root);
    freezeEvidenceR50(root, "MKT-R50-001", validCapture(), {
      now: FREEZE_AT
    });
    const invalid = validPrior();
    invalid.competing_hypotheses = invalid.competing_hypotheses.slice(0, 1);
    assert.ok(
      validateHumanPriorR50(invalid).some(
        (item) => item.path === "competing_hypotheses"
      )
    );
    const receipt = freezeHumanPriorR50(
      root,
      "MKT-R50-001",
      validPrior(),
      { now: PRIOR_AT }
    );
    assert.equal(receipt.phase, "HUMAN_PRIOR_FROZEN");
    assert.equal(receipt.authority.can_trade, false);
    assert.equal(
      getOperatorCaseStateR50(root, "MKT-R50-001").phase,
      "HUMAN_PRIOR_FROZEN"
    );
  }));

test("AI-runner packet excludes the human prior and all outcome stages", () =>
  withStore((root) => {
    openSlot(root);
    freezeEvidenceR50(root, "MKT-R50-001", validCapture(), {
      now: FREEZE_AT
    });
    freezeHumanPriorR50(root, "MKT-R50-001", validPrior(), {
      now: PRIOR_AT
    });
    const exported = exportAiRunnerPacketR50(root, "MKT-R50-001");
    assert.equal(exported.already_existed, false);
    const packet = readAiRunnerPacketR50(root, "MKT-R50-001");
    assert.equal(packet.human_prior_included, false);
    assert.equal("human_prior" in packet, false);
    assert.equal("outcome" in packet, false);
    assert.equal("ai_assessment" in packet, false);
    assert.ok(packet.artifacts.length >= 3);
    assert.equal(packet.authority.can_trade, false);
  }));

test("post-freeze evidence tampering blocks prior and changes visible phase", () =>
  withStore((root) => {
    openSlot(root);
    freezeEvidenceR50(root, "MKT-R50-001", validCapture(), {
      now: FREEZE_AT
    });
    const contextPath = path.join(
      root,
      "evidence",
      "MKT-R50-001",
      "artifacts",
      "market-context.json"
    );
    const context = JSON.parse(readFileSync(contextPath, "utf8"));
    context.price_and_volume.turnover += 1;
    writeFileSync(contextPath, `${JSON.stringify(context, null, 2)}\n`);
    assert.equal(
      getOperatorCaseStateR50(root, "MKT-R50-001").phase,
      "EVIDENCE_TAMPERED"
    );
    assert.throws(
      () => freezeHumanPriorR50(
        root,
        "MKT-R50-001",
        validPrior(),
        { now: PRIOR_AT }
      ),
      (error) => error.code === "EVIDENCE_TAMPERED"
    );
  }));

test("prior outside the frozen deadline fails closed", () =>
  withStore((root) => {
    openSlot(root);
    freezeEvidenceR50(root, "MKT-R50-001", validCapture(), {
      now: FREEZE_AT
    });
    assert.throws(
      () => freezeHumanPriorR50(
        root,
        "MKT-R50-001",
        validPrior(),
        { now: "2026-07-29T00:21:00.000Z" }
      ),
      (error) => error.code === "HUMAN_PRIOR_WINDOW_VIOLATION"
    );
  }));

test("loopback runtime serves UI, reports missing fields and blocks vault routes", () =>
  withStore(async (root) => {
    const server = createOperatorServerR50({
      storeRoot: root,
      logger: () => {}
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const page = await fetch(base);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /Forward\s*Desk/);

      const status = await fetch(`${base}/api/status`).then((item) => item.json());
      assert.equal(status.runtime, "LOCAL_LOOPBACK_ONLY");
      assert.equal(status.cases.length, 3);
      assert.equal(status.authority.can_trade, false);

      const opened = await fetch(`${base}/api/cases/MKT-R50-001/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicability: {
            derivatives: true,
            token_metrics: true,
            event_search: true
          }
        })
      });
      assert.equal(opened.status, 201);

      const template = await fetch(
        `${base}/api/cases/MKT-R50-001/template`
      ).then((item) => item.json());
      assert.equal(template.template_status, "INCOMPLETE_NOT_FREEZABLE");

      const validation = await fetch(
        `${base}/api/cases/MKT-R50-001/evidence/validate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            capture: {
              case_id: "MKT-R50-001"
            }
          })
        }
      );
      assert.equal(validation.status, 200);
      const failure = await validation.json();
      assert.equal(failure.status, "FAIL");
      assert.ok(failure.violations.some((item) => item.path === "ohlcv_rows"));

      const blocked = await fetch(`${base}/api/outcome-vault`);
      assert.equal(blocked.status, 403);
      assert.equal((await blocked.json()).error, "PRODUCT_BOUNDARY_BLOCK");
    } finally {
      server.close();
      await once(server, "close");
    }
  }));
