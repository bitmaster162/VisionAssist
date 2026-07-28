# VisionAssist R29 P1 Handoff

Date: `2026-07-27`

Status: `READY_FOR_NEXT_OPERATOR`

## 1. Current canon

VisionAssist is the GPT-S core perception capability:
`VISUAL_SEMANTIC_COGNITION_LAYER`.

The four-stage lineage is:

```text
Assistive vision
  -> chart semantic pivot
  -> Active Inference research architecture
  -> visual-semantic cognition + human-AI fusion
```

Current core runtime: `intent-r26`.

Optional accessibility adapter: `android-pilot`.

Primary gate:
`VISIONASSIST_CHART_INTENT_AND_HUMAN_AI_FUSION_PROOF`.

Canonical identity:
`contracts/lineage-r29/visionassist_lineage.json`.

## 2. Current verified state

- R29 lineage tests: `5/5 PASS`.
- Benchmark harness tests: `25/25 PASS`.
- Edge/runtime tests: `30/30 PASS`.
- Preserved R26 source tests: `10/10 PASS`.
- Market cases: `60/60 CASE_FROZEN`.
- Market split: `45 development + 15 blinded holdout`.
- Market evidence assets: `60 unique`.
- Synthetic visual-control cases: `15/15 CASE_FROZEN`.
- Visual split: `10 development + 5 blinded holdout`.
- Visual evidence assets: `15 unique`.
- Complete roster: `75/75 CASE_FROZEN`.
- Complete split: `55 development + 20 blinded holdout`.
- Human-prior draft/submission tooling: fail-closed tests pass.
- Five-case batch preparation smoke test: `5/5` incomplete drafts generated
  outside the repository with both unseen attestations still `false`.
- Human prior, AI assessment, fusion, baseline, reveal, and adjudication:
  not started.
- Official score: unavailable and must remain unavailable.

## 3. Evidence locations

- Lineage contract: `contracts/lineage-r29/visionassist_lineage.json`
- R29 sources: `docs/research/lineage-r29/`
- Operating model: `docs/visionassist-operating-model.md`
- Release profiles: `docs/contracts/release-profiles.json`
- Intent contract: `contracts/intent-r26/`
- Benchmark: `benchmarks/chart-intent-r26/`
- Market public commitment: `benchmarks/chart-intent-r26/sampling/market-candidate-pool.commitment.json`
- Visual protocol: `benchmarks/chart-intent-r26/sampling/visual-sampling-protocol-v1.json`
- Visual public commitment: `benchmarks/chart-intent-r26/sampling/visual-candidate-pool.commitment.json`
- Visual geometry QA: `benchmarks/chart-intent-r26/sampling/visual-evidence-qa.json`
- Human-prior capture guide: `docs/human-prior-capture.md`
- First analyst batch: `benchmarks/chart-intent-r26/proof/human-prior-batch-001.json`
- Operator-binding template: `benchmarks/chart-intent-r26/templates/operator-binding.example.json`
- Market public receipts: `benchmarks/chart-intent-r26/sampling/frozen-case-receipts/`
- Custodian vault: `benchmarks/chart-intent-r26/outcome-vault/`
- Full verifier: `scripts/verify-p1.ps1`

## 4. Non-negotiable boundaries

- Do not reveal any sealed outcome before prior, AI, fusion, and baseline freeze.
- Do not expose custodian seeds or slot-to-source mappings to analysts.
- Do not show human prior to the AI-only runner.
- Do not show AI or human records to the candlestick baseline.
- Do not edit frozen case artifacts.
- Do not claim calibration, accuracy, uplift, generality, or production value.
- Do not add trade, execution, order, broker, capital, or navigation authority.
- Preserve `DIAGNOSTIC_ONLY / NO_ACTION / HOLD / DENY / can_trade=false`.

## 5. Known evidence limitations

- Market custody is local and procedural, not independently controlled.
- Stage 1 SensorBridge is historical scaffold evidence, not device proof.
- Stage 3 Active Inference is research architecture, not a completed runtime.
- The market corpus is retrospective, although selection and reveal are
  commitment-gated.
- The non-market corpus is a deterministic synthetic control and does not
  establish natural-scene generality or production value.
- Visual geometry QA is `USABLE_WITH_LIMITATION`: `VIS-001` and `VIS-006`
  show 5 of 6 generated trail points; `VIS-011` shows 4 of 6 because of frame
  clipping. Frozen evidence was not rewritten.
- `cases/` and `outcome-vault/` are intentionally git-ignored. A handoff that
  moves machines must transfer them through a controlled channel and re-run
  the full verifier.
- No human annotation evidence exists.

## 6. Completed continuation

`VIS-001..015` were built and frozen as a pre-registered synthetic non-market
visual-intent control corpus:

- 10 development cases,
- 5 blinded holdout cases,
- visible state only in the case image,
- deterministic future simulation held in the custodian vault,
- three balanced latent outcomes,
- public hash receipts,
- explicit `SYNTHETIC_NON_MARKET_CONTROL` boundary.

Synthetic cases can close the contract roster but cannot establish natural
scene generality.

Visual candidate-pool commitment:

```text
a3177212076b3f65ef5fab13769d4b9f7b355c27efbc23e92d277d626496b7dc
```

## 7. Next bounded continuation

Run blind human-prior capture only:

1. Bind real, separated operators to the role IDs already frozen in each case
   through external attestations. Do not edit a frozen role ID.
2. Give the analyst access to case evidence and outcome definition, never the
   custodian vault.
3. Generate the five case-specific drafts in `human-prior-batch-001`.
4. A real human analyst completes and submits each draft.
5. Verify every receipt stops at `HUMAN_PRIOR_FROZEN`.
6. Do not run AI, fusion, baseline, reveal, or scoring in the same step.

The safest first batch is five development cases. Stop on any role collision,
outcome exposure, invalid receipt, or analyst access to vault material.

## 8. Reproduction

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-p1.ps1
```

Expected corpus status:

```text
CASE_FROZEN 75
```
