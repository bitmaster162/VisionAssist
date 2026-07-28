# VisionAssist

VisionAssist is the GPT-S core perception capability: a visual-semantic
cognition layer for evidence-grounded observations, competing intent
hypotheses, counterevidence, uncertainty, invalidation, and explicit human-AI
revision.

The R29 lineage preserves four stages:

```text
Assistive vision
  -> chart semantic pivot
  -> Active Inference research architecture
  -> current visual-semantic cognition canon
```

Accessibility is preserved as the optional `android-pilot` adapter. It is the
historical origin, not the current module identity. The machine-readable canon
is [VisionAssist Lineage R29](contracts/lineage-r29/visionassist_lineage.json).

## Current P1

`VISIONASSIST_CHART_INTENT_AND_HUMAN_AI_FUSION_PROOF`

```text
60 frozen market chart cases + 15 non-market visual cases
  -> human-only prior
  -> AI-only intent assessment
  -> human+AI revision
  -> outcome reveal
  -> blinded scoring
```

The offline harness, phase gates, scorer, and proof checklist are implemented
under `benchmarks/chart-intent-r26`. The complete 75-case corpus is frozen at
`CASE_FROZEN`: 60 market cases plus 15 deterministic synthetic visual-control
cases under separate pre-registered commitments. Human, AI, fusion, baseline,
reveal, and adjudication records are not yet frozen. No calibration,
human-AI uplift, natural-scene generality, or production-value claim exists.

R33 handoff intake is bound to the exact R29 handoff. A local custody snapshot
now commits the ignored `cases/` and `outcome-vault/` trees without publishing
their inventory. Git identity, custody transfer, independent custody, and
human operator identity remain unbound.

## Runtime profiles

### `intent-r26` - core default

```text
image + human prior -> observations -> competing hypotheses
                    -> counterevidence -> invalidation
                    -> NO_ACTION / HOLD / DENY
```

Start the bounded runtime:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-intent-r26.ps1
```

Then open:

```text
http://127.0.0.1:8787/intent-r26
```

See the [Intent R26 runtime guide](docs/intent-r26-runtime.md).

### `android-pilot` - optional accessibility adapter

```text
camera capture -> /v1/describe -> TTS summary
               -> hazard warning -> low-confidence warning
```

The adapter remains bounded and parked behind its own device-evidence gate.

### `product-dev`

Enables the prepared Describe, Intent R26, OCR, and Realtime development routes together. It is not evidence that every capability is pilot-ready.

## Repository

```text
.
|-- apps/mobile/           Android assistive client
|-- apps/intent-console/   R26 visual diagnostic console
|-- benchmarks/            P1 blinded proof harness
|-- contracts/lineage-r29/ canonical identity and portfolio contract
|-- contracts/intent-r26/  canonical schema, example, provenance
|-- services/edge/         profile-gated Node gateway
|-- docs/pilot/            Android proof pack
|-- docs/research/         benchmark and source-proof materials
`-- scripts/               startup/bootstrap helpers
```

Canonical boundaries:

- [Operating model](docs/visionassist-operating-model.md)
- [Lineage contract](contracts/lineage-r29/visionassist_lineage.json)
- [Release profiles](docs/contracts/release-profiles.json)
- [R33 accepted handoff](docs/handoffs/VISIONASSIST_R33_ACCEPTED_HANDOFF_2026-07-28.md)

## Verification

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-p1.ps1
```

The Intent module is implemented and offline-testable. A live model-backed image run still requires `OPENAI_API_KEY`.
