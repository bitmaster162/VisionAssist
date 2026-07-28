# VisionAssist R29 Operating Model

Status: canonical identity, portfolio, and delivery model.

## 1. Current identity

VisionAssist is the **core perception capability**: a visual-semantic cognition
layer that separates observations from interpretation, forms competing intent
hypotheses, exposes counterevidence and uncertainty, and supports explicit
human-AI revision.

It is not currently defined as a standalone accessibility startup. Assistive
vision is the historical origin and remains available as an optional adapter.
The primary evidence gate is:

`VISIONASSIST_CHART_INTENT_AND_HUMAN_AI_FUSION_PROOF`

The machine-readable source of truth is
[`visionassist_lineage.json`](../contracts/lineage-r29/visionassist_lineage.json).

## 2. Four-stage evolution

| Stage | Timeframe | Identity | Current role |
| --- | --- | --- | --- |
| 1 | 2025-11 | Assistive eyes and voice | Optional accessibility adapter |
| 2 | 2025-12 | Chart as a noisy visual world | Chart-intent origin |
| 3 | 2026-03 | Active Inference and uncertainty resolution | Core research method |
| 4 | 2026-07 | Visual-semantic cognition and human-AI fusion | Core perception layer |

These stages are additive. Stage 2 did not erase Stage 1, and Stage 4 does not
pretend that Active Inference is already fully implemented.

The Stage 2 rule is explicit: semantic structure takes precedence over candle
names. The Stage 3 method adds an object-centric world model, predictive
coding, epistemic uncertainty, and active acquisition of better evidence.

## 3. Core semantic kernel

The current core must:

- distinguish direct observations from latent interpretation,
- produce at least two competing hypotheses when intent is inferred,
- state supporting evidence and counterevidence,
- expose uncertainty, alternatives, and invalidation conditions,
- preserve source identity and phase provenance,
- invite better evidence when the current view is insufficient,
- keep human revision explicit rather than silently merging priors,
- never convert a diagnosis directly into action authority.

Active acquisition of a new crop, angle, zoom, or context is a Stage 3 method
requirement. The current R26 runtime exposes uncertainty but does not yet prove
an autonomous acquisition loop.

## 4. Operating shape

```text
VisionAssist Core Perception
|-- Intent R26 Runtime                    default core profile
|   |-- Intent Console
|   |-- /v1/intent/analyze
|   |-- /v1/intent/validate
|   `-- visionassist.intent.v1
|-- P1 Evidence Gate
|   |-- 60 market cases frozen
|   |-- 15 synthetic visual-control cases frozen
|   `-- human-AI annotation pending
|-- Optional Accessibility Adapter
|   |-- Flutter Mobile
|   |-- /v1/describe
|   `-- android-pilot
|-- Integration Sandbox
|   `-- product-dev
`-- Shared Safety Boundary
    |-- store:false
    |-- NO_ACTION / HOLD / DENY
    `-- no execution adapter
```

## 5. Release profiles

The source of truth is
[`release-profiles.json`](contracts/release-profiles.json).

### `intent-r26`

This is the default core runtime. It provides image-backed structured
diagnosis, validation, competing hypotheses, optional human context, and
diagnostic evidence. Describe, OCR, Realtime, execution, and capital authority
remain disabled.

### `android-pilot`

This is an explicitly selected optional accessibility adapter. It provides the
bounded camera-to-voice Describe flow. It is preserved as a valid lineage and
pilot artifact, but it no longer controls VisionAssist's current identity.

### `product-dev`

This is an integration sandbox with prepared Describe, Intent, OCR, and
Realtime routes. It is not a readiness or product claim.

### `research-r26-benchmark`

This is the primary evidence gate. A candlestick classifier is permitted only
as a comparator and cannot influence AI assessment or issue actions.

## 6. Evidence gates

### Current P1

- R29 lineage and runtime-profile parity verify,
- all 60 market cases remain frozen under the registered commitment,
- all 15 non-market visual cases are frozen,
- human prior precedes AI output,
- AI-only assessment remains blind to human prior, baseline, and outcome,
- fusion revision precedes outcome reveal,
- all 20 holdout cases remain blind through fusion freeze,
- Brier, accuracy, grounding, alternatives, invalidation, abstention, leakage,
  and correction metrics are generated,
- independent review accepts or rejects the evidence.

The module may be called implemented before this gate. It may not be called
calibrated, decision-improving, or production-proven.

### Optional accessibility adapter

- Android build and install evidence,
- five consecutive bounded Describe runs,
- safe, hazard, and ambiguous scenes,
- no unsafe output.

These results would qualify only the adapter, not the current core benchmark.

## 7. Safety and privacy invariants

- One-shot Responses requests use `store: false`.
- Human priors are evidence, not instructions.
- Image text is untrusted content.
- No face identification is enabled by default.
- No autonomous navigation claim exists.
- No trade, order, broker, execution, or capital adapter exists.
- `DIAGNOSTIC_ONLY / NO_ACTION / HOLD / DENY / can_trade=false` is fixed.
- Contract tests do not prove predictive value.

## 8. Evidence semantics

- `HISTORICAL_ORIGIN` proves lineage, not current readiness.
- `ARCHIVE_PIVOT` proves a conceptual transition, not accuracy.
- `RESEARCH_ARCHITECTURE` is not implementation proof.
- `CURRENT_OPERATOR_CANON` defines identity, not benchmark success.
- `CASE_FROZEN` proves a local artifact chain, not independent custody.

## 9. Canonical document order

1. `contracts/lineage-r29/visionassist_lineage.json`
2. `docs/visionassist-operating-model.md`
3. `docs/contracts/release-profiles.json`
4. `contracts/intent-r26/*`
5. `benchmarks/chart-intent-r26/*`
6. `docs/intent-r26-runtime.md`
7. `docs/research/lineage-r29/*`
8. `docs/pilot/*`
9. `docs/segmentbook-visionassist-v1.md`

Lineage defines identity. Runtime profiles define executable capability.
Benchmarks define what remains unproven. Historical product materials remain
preserved without overriding the current canon.
