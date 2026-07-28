# VisionAssist Chart-Intent and Human-AI Fusion Proof

Priority: `P1`

R29 portfolio role: `PRIMARY_EVIDENCE_GATE` for the current core-perception
canon. The accessibility adapter has a separate evidence boundary.

Benchmark ID:
`VISIONASSIST_CHART_INTENT_AND_HUMAN_AI_FUSION_PROOF`

Status: corpus `75/75 CASE_FROZEN`; annotation cycle not started; official
score unavailable.

## Proof question

Does an evidence-grounded AI assessment improve a human's calibrated
interpretation of a frozen visual case without hindsight leakage or action
authority?

## Frozen corpus

- 60 market chart cases.
- 15 non-market visual cases.
- 55 development cases.
- 20 blinded holdout cases.

The current repository contains all 75 frozen slots. The 60 market cases have
public hash receipts: 45 development and 15 blinded holdout. The 15
non-market cases are deterministic synthetic visual controls: 10 development
and 5 blinded holdout. They close the procedural roster but do not establish
natural-scene generality or production value.

Visual geometry QA is `USABLE_WITH_LIMITATION`: 12 of 15 cases show all six
generated history points, while three contain edge clipping and show four or
five. The evidence remains frozen and the limitation is disclosed rather than
corrected after commitment.

## Per-case order

1. Curator freezes visual evidence and outcome definition.
2. Outcome custodian commits the sealed outcome SHA-256 outside the case tree.
3. Human analyst freezes a prior before seeing AI or outcome.
4. AI freezes surface observations, at least two competing hypotheses, and an
   outcome distribution without seeing human prior, baseline, or outcome.
5. Human sees AI output and freezes a revised interpretation and distribution.
6. Candlestick baseline freezes independently for market cases only.
7. Outcome is revealed only if its canonical hash matches the commitment.
8. Independent adjudicator scores diagnostic quality and leakage.
9. Human records post-outcome correction for the frozen fusion forecast.

## Required metrics

- evidence grounding,
- multiclass Brier calibration,
- alternative-hypothesis coverage,
- counterevidence quality,
- invalidation quality,
- abstention quality,
- human-only accuracy,
- AI-only accuracy,
- human+AI accuracy,
- hindsight leakage,
- correction after outcome reveal.

Exact formulas and rubrics:
[metric-contract.md](../../benchmarks/chart-intent-r26/docs/metric-contract.md).

## Executable package

- [benchmark README](../../benchmarks/chart-intent-r26/README.md)
- [artifact contract](../../benchmarks/chart-intent-r26/docs/artifact-contract.md)
- [proof checklist](../../benchmarks/chart-intent-r26/proof/pilot-proof-checklist.md)

```powershell
Set-Location .\benchmarks\chart-intent-r26
npm test
npm run status
```

## Boundary

The candlestick classifier is a comparator only. It cannot influence the AI
assessment and grants no action authority. Benchmark code does not enter
`android-pilot`, `/v1/describe`, OCR, memory, navigation, Realtime, or billing.

Passing harness tests proves lifecycle and scoring behavior only. It does not
prove calibration, generalization, human uplift, or trading profitability.
