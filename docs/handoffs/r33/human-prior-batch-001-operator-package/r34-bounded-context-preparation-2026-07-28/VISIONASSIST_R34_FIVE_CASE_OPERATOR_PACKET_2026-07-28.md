# VisionAssist R34 — five-case blind human-prior operator packet

Date: `2026-07-28`  
Status: `PREPARATION_ONLY / EXECUTION_BLOCKED`  
Mode: `DIAGNOSTIC_ONLY`  
Action: `NO_ACTION`  
Execution: `HOLD`  
Capital: `DENY`  
`can_trade=false`

## 1. Decision and scope correction

The original mixed batch cannot be used as written.

`MKT-001..003` expose only a rendered chart image and an outcome definition.
Their public evidence folders contain exactly one `source.png` each. Symbol,
absolute price, market cap/FDV, supply, open interest, funding, basis,
liquidations, order flow and pre-cutoff event context are absent. Producing
market probabilities from those inputs would measure a narrow visual-pattern
guess, not Human operator's market-decision prior.

Therefore:

- `MKT-001..003` remain unchanged at `CASE_FROZEN` and receive `HOLD`;
- no human prior is submitted for those IDs;
- replacement market slots are `MKT-R34-001..003`;
- `VIS-001..002` remain a separate synthetic visual-control track;
- the five slots are operated as two isolated sub-batches, never as one mixed
  evidence claim or one aggregate score.

The replacement market slots do not yet exist as frozen cases. This packet is
an operational umbrella over two non-comparable tracks:

- `MARKET-R34-DEV-001`;
- `VISUAL-CONTROL-R34`.

It is not permission to create, submit or score a case. The earlier phrase
“full context” is narrowed here to `BOUNDED_R34_REQUIRED_CONTEXT`; it does not
claim that every possible market variable is captured.

## 2. Fixed five-slot program

| Slot | Track | Current state | Permitted next state |
| --- | --- | --- | --- |
| `MKT-R34-001` | market bounded R34 context | `SLOT_RESERVED_NO_CASE` | `CASE_FROZEN` only after evidence gate PASS and separate human authorization |
| `MKT-R34-002` | market bounded R34 context | `SLOT_RESERVED_NO_CASE` | `CASE_FROZEN` only after evidence gate PASS and separate human authorization |
| `MKT-R34-003` | market bounded R34 context | `SLOT_RESERVED_NO_CASE` | `CASE_FROZEN` only after evidence gate PASS and separate human authorization |
| `VIS-001` | synthetic non-market visual control | `CASE_FROZEN` | `HUMAN_PRIOR_FROZEN` after separate visual preflight |
| `VIS-002` | synthetic non-market visual control | `CASE_FROZEN` | `HUMAN_PRIOR_FROZEN` after separate visual preflight |

No result from the visual track may be described as market evidence. No
market result may be pooled with the visual control into an accuracy, uplift,
calibration, generality or production claim.

## 3. Role separation

### Batch coordinator

- maintains the two track manifests and external batch receipts;
- verifies hashes, chronology, phase and authority;
- gives the analyst only the track-specific allowed inputs;
- stops the affected track on the first failed gate;
- never interprets sealed outcomes for the analyst.

### Case selector

- freezes the three development slots before capture;
- cannot be the analyst, evidence curator, outcome custodian or adjudicator;
- cannot inspect future outcomes when selecting instrument or timeframe.

### Market evidence custodian

- captures the forward-locked pre-cutoff market snapshot;
- freezes source artifacts, provenance, applicability and missingness receipts;
- computes deterministic indicators from committed OHLCV;
- cannot select the case, fill the human prior, verify its own bundle or
  adjudicate it.

### Outcome custodian

- controls sealed future outcome material;
- cannot act as human analyst or adjudicator;
- does not disclose future bars, outcome labels, simulation traces, seeds or
  lookup mappings.

### Human analyst

- intended operator pseudonym: `HUMAN_OPERATOR-001`;
- market scope: `MKT-R34-001..003` only after new frozen role bindings exist;
- visual scope: `VIS-001..002`;
- records each prior before case-specific AI access and before the relevant
  deadline;
- may abstain when the allowed evidence is insufficient.

The previous market binding targets `r26-human-analyst-001` and
`MKT-001..003`; it does not automatically bind replacement R34 cases. New
market role IDs and a new external binding are mandatory after those case
manifests are frozen.

The same human may be analyst for MARKET and VISUAL through two separate
bindings, but that does not create five independent analysts. The existing
VISUAL chat attestation is historical evidence only; blindness and role
separation must be recertified for the current run.

### Independent verifier

- is not the evidence curator or case selector;
- verifies source bytes, chronology, bundle canonicalization, validator
  execution receipt and Drive/local readback;
- does not see or reveal the sealed outcome.

### Adjudicator

Inactive in this phase. Must not be the analyst or outcome custodian.

### Inactive roles

AI-only runner, fusion operator, candlestick baseline runner, reveal operator
and scoring operator receive no inputs and run no command.

## 4. Allowed analyst inputs

### Market bounded-context track

For each `MKT-R34-*` case the analyst may receive only after a real
deterministic PASS:

- the frozen case and outcome contract;
- canonical `market_evidence_bundle.json`;
- only the raw pre-cutoff artifacts named in that bundle;
- deterministic renders made from those same committed bytes;
- exact `analyst_input_manifest.json` with one SHA-256 per delivered file;
- blank R34 prior;
- the exact operator-binding ID.

The bundle must reference a normative, pre-capture
`R34_CRYPTO_PERP_CONTEXT_PROFILE.json`. That profile freezes required versus
optional groups, units, provider/query roster, formula/config hashes,
timeframe set, applicability, source freshness policy and resolution rule.
Without an approved profile hash, bundle PASS is impossible.

The required bounded context is:

1. Identity and horizon:
   - symbol, venue and asset class;
   - timeframe;
   - cutoff price and cutoff timestamp;
   - prior deadline and later horizon start;
   - completed-bar horizon, labels and resolution rule.
2. Price and liquidity:
   - consecutive pre-cutoff OHLCV;
   - spot volume, turnover, spread and depth;
   - market cap, FDV and circulating supply when applicable.
3. Derivatives:
   - OI level and pre-cutoff changes;
   - funding;
   - spot/perpetual basis;
   - liquidations;
   - long/short ratio and CVD/order flow according to the frozen profile.
4. Deterministic indicators derived only from the committed OHLCV:
   - ATR(14) and ATR%;
   - RSI(14);
   - AO with a frozen formula;
   - EMA(20), EMA(50), EMA(200) and price distances when the frozen lookback
     is sufficient;
   - VWAP;
   - frozen returns, volume change and volatility regime.
5. Pre-cutoff context:
   - reference-market and regime snapshot;
   - headlines, articles and scheduled events published before cutoff;
   - `first_published_at`, `updated_at`, captured pre-cutoff bytes and content
     hash for each article;
   - an explicit empty-search receipt when no relevant event was found.
6. Provenance for every source group:
   - provider or source;
   - source object/endpoint and exact query;
   - units and `data_as_of`;
   - observed/captured timestamp;
   - raw artifact SHA-256;
   - successful raw readback SHA-256;
   - parser code SHA-256 and config SHA-256;
   - formula manifest SHA-256 where derived;
   - freshness result;
   - applicability and missingness result.
7. Blank market human-prior draft and the analyst's frozen role ID.

For the first R34 batch, select only crypto assets with both liquid spot and
perpetual markets and with all critical groups available. OHLCV, cutoff price,
volume/liquidity, market cap/FDV/supply, OI, funding, basis and liquidations
are critical. A missing or stale critical group rejects the candidate before
freeze. `not_applicable` is allowed only when the pre-capture profile declared
it. Post-hoc `unavailable` cannot rescue a candidate. Optional search fields
may use a bounded empty-search receipt, which proves only that the declared
query returned no result.

Historical fallback is prohibited for the first R34 batch. Obscuring symbol
or date does not reliably prevent lookup through returns, headlines, OI,
events or other fingerprints.

The required chronology is checked from external receipts:

```text
context-profile-freeze receipt created_at <= case_selected_at
case_selected_at <= case-selection-freeze receipt created_at
case-selection-freeze receipt created_at
  <= min(source retrieved_at, bounded-search performed_at)
max(source data_as_of/retrieved_at,
    article first_published_at/updated_at,
    scheduled-event known_as_of,
    bounded-search performed_at) <= cutoff_at
cutoff_at <= bundle_sealed_at
bundle_sealed_at < analyst_first_access_at
analyst_first_access_at <= trusted_prior_submit_at
trusted_prior_submit_at <= prior_deadline
prior_deadline < horizon_start_at
```

The analyst must have no browser, live feed, alerts or other unmanifested
market access between `analyst_first_access_at` and
`trusted_prior_submit_at`. A timestamp typed inside `human_prior.json` does
not prove this chronology.

### Synthetic visual-control track

For `VIS-001..002` the analyst may receive only:

1. the frozen `source.png`;
2. case ID and frozen visual analyst role ID;
3. the visual labels, horizon, resolution and abstention rule;
4. a blank v1 visual human-prior draft.

Those drawings are intentional for the non-market visual-control task. They
must not be presented as enough information for a market decision.

## 5. Forbidden inputs

The analyst must not receive:

- sealed outcome or future bars/frames;
- `outcome-vault/`, seeds, simulation trace or latent-policy mapping;
- slot-to-source lookup keys for a masked historical case;
- post-cutoff article or materially updated post-cutoff text;
- live price, browser, alerts, messages or other unmanifested market data
  between analyst access and prior commit;
- outcome-derived commentary or retrospective summary;
- case-specific AI assessment;
- baseline, fusion, reveal, adjudication or scoring output;
- another analyst's prior;
- credentials, private exchange data or trading authority.

Reveal is embargoed across the entire five-slot program until every prior that
is allowed to proceed has been frozen or its track has reached a terminal
HOLD. A neighboring case cannot reveal while another prior remains open.

## 6. `human_prior.json` structures

### Market R34 draft

The proposed market schema is
`visionassist.benchmark.human-prior.r34.v1`. It is not executable until
the schema and validator are implemented and tested.

Required fields:

```json
{
  "schema_version": "visionassist.benchmark.human-prior.r34.v1",
  "batch_id": "visionassist-r34-development-001",
  "track_id": "MARKET-R34-DEV-001",
  "case_id": "MKT-R34-001",
  "analyst_id": "<frozen market analyst role ID>",
  "operator_binding_id": "<run-specific binding ID>",
  "recorded_at": "<ISO-8601 UTC>",
  "evidence_binding": {
    "capture_mode": "FORWARD_LOCKED_BOUNDED_CONTEXT",
    "case_selection_freeze_receipt_sha256": "<64 lowercase hex>",
    "case_manifest_sha256": "<64 lowercase hex>",
    "market_evidence_bundle_sha256": "<64 lowercase hex>",
    "analyst_input_manifest_sha256": "<64 lowercase hex>",
    "analyst_input_delivery_receipt_sha256": "<64 lowercase hex>",
    "pre_submit_receipt_head_sha256": "<64 lowercase hex>",
    "cutoff_at": "<ISO-8601 UTC>",
    "prior_deadline": "<ISO-8601 UTC>",
    "horizon_start_at": "<ISO-8601 UTC>"
  },
  "interpretation": "<human interpretation>",
  "key_evidence_used": ["<bundle field or source ID>"],
  "competing_hypotheses": ["<at least one alternative>"],
  "outcome_forecast": {
    "probabilities": [
      {"label": "up", "probability": 0.0},
      {"label": "down", "probability": 0.0},
      {"label": "range", "probability": 0.0}
    ],
    "abstain": false,
    "abstention_reason_code": null,
    "abstention_reason": null
  },
  "confidence": 0.0,
  "attestations": {
    "human_authored": true,
    "only_manifested_inputs_seen": true,
    "outcome_unseen": true,
    "case_specific_ai_unseen": true,
    "post_cutoff_market_data_unseen": true
  },
  "authority": {
    "decision_status": "DIAGNOSTIC_ONLY",
    "action_code": "NO_ACTION",
    "execution_permission": "HOLD",
    "capital_permission": "DENY",
    "can_trade": false
  }
}
```

If `abstain=false`, the three probabilities are finite, lie in `[0,1]`, sum
to `1`, and `confidence` is finite in `[0,1]`.

If `abstain=true`, `probabilities=null` and `confidence=null`; code and
free-text reason are required. Frozen codes are:

- `INSUFFICIENT_DECISION_CONTEXT`;
- `EVIDENCE_CONTRADICTION`;
- `BLINDNESS_UNCERTAIN`;
- `OTHER_DECLARED`.

A structurally missing, stale, contradictory or invalid bundle is a pre-submit
STOP, not analyst abstention. `recorded_at` is only an analyst assertion;
deadline acceptance uses the external trusted submit receipt bound to the
artifact hash.

### Visual v1

The existing frozen visual cases use
`visionassist.benchmark.human-prior.v1`:

```json
{
  "schema_version": "visionassist.benchmark.human-prior.v1",
  "case_id": "VIS-001",
  "analyst_id": "r29-visual-analyst-001",
  "recorded_at": "<ISO-8601 UTC>",
  "interpretation": "<human interpretation>",
  "competing_hypotheses": ["<at least one alternative>"],
  "outcome_forecast": {
    "probabilities": [
      {"label": "left_target", "probability": 0.0},
      {"label": "right_target", "probability": 0.0},
      {"label": "hold_position", "probability": 0.0}
    ],
    "abstain": false,
    "abstention_reason": null
  },
  "confidence": 0.0,
  "outcome_unseen_attestation": true,
  "ai_unseen_attestation": true
}
```

For the visual v1 schema, probabilities must always be finite, each in
`[0,1]`, contain every frozen label exactly once and sum to `1` within the
implemented tolerance. Confidence must be finite and in `[0,1]`. Its exact
frozen top-level key set cannot be extended. Input hashes, run-specific
blindness attestations and authority therefore remain in external delivery
and binding receipts.

## 7. Receipt order

Every receipt must satisfy the draft external receipt contract. The receipt's
`batch_id` must match its track mapping. Each chain is scoped independently by
`(track_id, batch_id, case_id, attempt_id)` and runs the full track-specific
order once for that case attempt. Its first receipt has
`previous_external_receipt_sha256=null`; every receipt binds the SHA-256 of
this sealed preparation-package manifest, and each later receipt binds the
previous receipt in the same case attempt. Cross-case and cross-attempt links
are forbidden. Receipt payload keys are exact, not extensible.

### Market replacement case

For each `MKT-R34-*` slot:

1. Read back the package manifest and prove the legacy frozen cases unchanged.
2. Freeze and hash the context profile, role map, source/query registry,
   formulas and resolution rule.
3. Before any capture, write `case_selection_freeze` binding the selector,
   instrument, venue, asset class, timeframe, capture mode, applicability
   matrix, cutoff, prior deadline, later horizon start, selection rule and
   profile hash.
4. Verify outcome custody without exposing future material to the selector,
   evidence curator or analyst.
5. Capture every raw source and complete every bounded search by cutoff; then
   write a source-capture receipt.
6. Build and canonically seal `market_evidence_bundle.json`.
7. Recompute indicators and run the deterministic evidence gate.
8. Preserve a validator execution receipt binding repository HEAD, tool hash,
   exact command, run ID, start/end times, exit code, stdout/stderr hashes,
   profile hash and bundle hash.
9. Obtain independent byte/readback verification.
10. Only after actual PASS, obtain separate human authorization to freeze this
   case.
11. Freeze the case manifest and create receipt chain entry `0`:
   - `kind=case`;
   - exact case manifest SHA-256;
   - exact market evidence bundle SHA-256;
   - exact source-capture receipt SHA-256;
   - authority boundary.
12. Read back the frozen case and initial chain head; prove that no human
    prior or later-stage artifact exists.
13. Freeze the run-specific operator binding and role/blindness
    recertification.
14. Write an exact analyst-input manifest listing every byte that may be
    exposed.
15. Deliver only that allowlist and write a delivery receipt binding the
    manifest hash and actual first-access timestamp.
16. Keep the analyst away from browser, live feed, alerts and other
    unmanifested post-cutoff information until the prior receipt commits.
17. Obtain the completed human prior before `prior_deadline` and before
    `horizon_start_at`.
18. Validate it, freeze it atomically and append chain entry `1`:
   - `kind=human_prior`;
   - `previous_chain_sha256` equals entry `0`;
   - artifact SHA-256 equals the frozen human-prior bytes.
19. Perform a read-only case verification and append the external market batch
    receipt.
20. Stop at `HUMAN_PRIOR_FROZEN`.

### Visual case

For each existing visual case:

1. Read back the visual-only selection manifest.
2. Verify custody without exposing the vault to the analyst.
3. Freeze the run-specific operator binding.
4. Freshly recertify role separation and blindness in an external receipt.
5. Read and preserve the existing pre-submit receipt.
6. Require `phase=CASE_FROZEN`, `chain.length=1`,
   `chain[0].kind=case` and the committed evidence hash.
7. Write an exact input manifest and delivery receipt for the image, outcome
   definition and blank draft exposed.
8. Validate and submit one manually completed visual prior.
9. Require `phase=HUMAN_PRIOR_FROZEN`, `chain.length=2`,
   `chain[1].kind=human_prior` and a valid previous-chain link.
10. Perform a read-only case verification and append the external visual batch
   receipt.
11. Stop at `HUMAN_PRIOR_FROZEN`.

Market and visual receipts remain separate. No combined outcome or score
receipt is created.

## 8. Verifiable stop conditions

Stop the affected track before any submission when at least one condition is
true:

1. No verified Git baseline exists before persistent benchmark implementation.
2. Market schema or deterministic validator is absent or untested.
3. The normative context profile is absent, unhashed or issued after capture.
4. Instrument, venue, asset class, timeframe, capture mode, applicability,
   cutoff, deadlines or horizon were not sealed in a case-selection receipt
   before the first source retrieval or bounded search, or any of those fields
   drifts in the source capture, bundle, case manifest or prior binding.
5. A market slot lacks a complete, pre-cutoff evidence bundle and a real
   validator PASS/readback.
6. A critical source group is missing or stale; post-hoc `unavailable` is
   forbidden.
7. OHLCV is non-finite, duplicated, non-consecutive, partially open,
   timezone-ambiguous or too short for the frozen formulas.
8. An indicator cannot be reproduced exactly from the committed OHLCV and
   formula version.
9. Any market source has `data_as_of` or `retrieved_at` after cutoff; any
   article was first published or materially updated after cutoff; or any
   bounded event search ran or scheduled-event fact became known after
   cutoff. Control-plane timestamps for sealing, delivery and trusted
   submission may occur after cutoff only in the frozen chronology.
10. Source identity, query, units, raw readback, parser/config hash or canonical
   output hash is missing.
11. `prior_deadline` or `horizon_start_at` was not frozen before analyst
   access, or the prior misses the deadline.
12. The analyst sees any live/post-cutoff information not named in the input
   manifest before the prior receipt commits.
13. A historical or masked case is used in the first R34 market batch.
14. Evidence, manifest, source receipt, validator receipt or chain hash
   differs.
15. Analyst equals selector, evidence curator, outcome custodian, adjudicator
   or verifier; or the verifier equals evidence curator.
16. A replacement market role binding is missing or targets old case IDs.
17. The analyst saw outcome, future, AI, baseline, fusion, reveal,
    adjudication or scoring material.
18. A market and visual result is combined into one manifest, join, metric,
    evidence or scoring claim.
19. A MARKET case consists only of a PNG, or a VISUAL case contains symbol,
    OHLCV, market labels or enters a market metric.
20. An unknown field, sidecar or neighboring artifact is outside the
    allowlist.
21. Draft schema, labels, probabilities, confidence, abstention or
    attestations fail validation.
22. The required MARKET authority block or an external receipt authority block
    is absent or differs from
    `DIAGNOSTIC_ONLY / NO_ACTION / HOLD / DENY / can_trade=false`, or any
    artifact contains a trading instruction outside that frozen authority
    block (order side, entry, position size, leverage or broker command).
    The frozen VISUAL v1 prior is exempt from an internal authority block;
    its authority is enforced by external receipts.

On stop:

- do not repair a frozen artifact manually;
- do not submit a partial prior;
- preserve receipts and error output;
- do not run later stages;
- return the condition to Human operator for a separate decision.

## 9. Operator checklist

### Common preflight

- [ ] Exact source handoffs and package hashes verified.
- [ ] Git baseline/HEAD verified before implementation.
- [ ] Selector, analyst, evidence custodian, outcome custodian, verifier and
      adjudicator satisfy the role map.
- [ ] Analyst has no vault, future, AI or outcome-derived access.
- [ ] Track-specific manifest selected; no mixed-batch receipt.
- [ ] Authority equals `DIAGNOSTIC_ONLY / NO_ACTION / HOLD / DENY`.
- [ ] `can_trade=false`.

### Market preparation — repeat for three replacement slots

- [ ] Slot still has no frozen case or prior.
- [ ] `FORWARD_LOCKED_BOUNDED_CONTEXT` and no-live-lookup boundary fixed
      before capture.
- [ ] Normative context profile frozen and hashed before capture.
- [ ] Applicability matrix fixed before capture.
- [ ] Cutoff, prior deadline and later horizon start fixed.
- [ ] Case-selection receipt matches bundle, case and prior identity/timing
      fields exactly.
- [ ] All raw sources captured and hashed.
- [ ] Complete evidence bundle built.
- [ ] Indicators reproduced deterministically.
- [ ] Chronology, provenance, missingness and leakage gates PASS.
- [ ] Validator execution receipt and independent readback PASS.
- [ ] Separate human case-freeze authorization recorded after PASS.
- [ ] New case manifest and role IDs frozen without editing R29 cases.
- [ ] New external operator binding verified.
- [ ] Exact analyst-input receipt created.
- [ ] Human prior completed before deadline.
- [ ] One atomic submit and one read-only verify.
- [ ] Case stops at `HUMAN_PRIOR_FROZEN`.

### Visual preparation — repeat for two cases

- [ ] Separate visual-only manifest verified.
- [ ] Existing case and receipt hashes match.
- [ ] Run-specific visual blindness and role separation recertified.
- [ ] Analyst sees only the frozen image, outcome definition and blank draft.
- [ ] Human prior manually completed.
- [ ] One atomic submit and one read-only verify.
- [ ] Case stops at `HUMAN_PRIOR_FROZEN`.
- [ ] No market claim is made from the result.

### Terminal check

- [ ] Three market and two visual human priors are frozen only if their
      independent gates passed.
- [ ] Old `MKT-001..003` remain unchanged at `CASE_FROZEN`.
- [ ] No AI, fusion, baseline, reveal, adjudication or scoring ran.
- [ ] Official score remains unavailable.
- [ ] Market and visual receipts and claims remain separate.
- [ ] `can_trade=false`.

## 10. Current terminal state

```text
MKT-001..003=HOLD_UNCHANGED
MKT-R34-001..003=SLOT_RESERVED_NO_CASE
VIS-001..002=HOLD_PENDING_SEPARATE_PREFLIGHT
MARKET_R34_IMPLEMENTATION=BLOCKED_BY_GIT_BASELINE_PROFILE_AND_VALIDATOR
AI_RUN=false
FUSION_RUN=false
BASELINE_RUN=false
REVEAL_RUN=false
ADJUDICATION_RUN=false
SCORING_RUN=false
can_trade=false
```

## 11. Sources

- [R29 handoff](RESTRICTED_SOURCE_REFERENCE)
- [R33 accepted handoff](RESTRICTED_SOURCE_REFERENCE)
- [R34 market evidence revision](RESTRICTED_SOURCE_REFERENCE)
- [Original batch manifest](RESTRICTED_SOURCE_REFERENCE)
- [Original operator packet](RESTRICTED_SOURCE_REFERENCE)
