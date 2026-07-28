# VisionAssist P1 Benchmark

Benchmark ID:
`VISIONASSIST_CHART_INTENT_AND_HUMAN_AI_FUSION_PROOF`

R29 portfolio role: primary evidence gate for the current
visual-semantic-cognition core.

Status: harness implemented; the complete 75-case corpus is frozen at
`CASE_FROZEN`: 60 market cases and 15 deterministic synthetic visual-control
cases. Annotation progress remains `0/75`, so official scoring is unavailable.

## Fixed scope

- 60 market chart cases.
- 15 non-market visual cases.
- 55 development slots.
- 20 blinded holdout slots.
- Candlestick classifier is a comparator only.
- No trade, execution, capital, Android, OCR, memory, or navigation authority.

## Blind sequence

```text
case evidence + sealed outcome commitment
  -> human prior freeze
  -> AI-only assessment freeze
  -> post-AI human revision freeze
  -> baseline freeze
  -> outcome reveal
  -> adjudication
  -> post-outcome correction review
  -> scoring
```

The AI-only assessment must use `human_context.present=false`. Human prior,
baseline output, and the sealed outcome must not be included in its prompt.

## Case directory

```text
cases/MKT-001/
|-- evidence/
|   `-- chart.png
|-- case.json
|-- human_prior.json
|-- ai_assessment.json
|-- fusion_revision.json
|-- baseline_forecast.json
|-- outcome.json                 # appears only after reveal
|-- adjudication.json
|-- post_outcome_review.json
`-- receipt.json
```

The precommitted outcome lives outside `cases/`, under custodian control. Only
its canonical JSON SHA-256 appears in `case.json` before reveal.

## Commands

```powershell
Set-Location .\benchmarks\chart-intent-r26

node .\tools\benchmark.js register-market-pool
node .\tools\benchmark.js verify-market-pool
node .\tools\benchmark.js verify-market-corpus
node .\tools\benchmark.js bootstrap-market-case MKT-001
node .\tools\benchmark.js publish-market-case-receipt MKT-001
node .\tools\benchmark.js register-visual-pool
node .\tools\benchmark.js verify-visual-pool
node .\tools\benchmark.js verify-visual-corpus
node .\tools\benchmark.js bootstrap-visual-case VIS-001
node .\tools\benchmark.js snapshot-custody
node .\tools\benchmark.js verify-custody
node .\tools\benchmark.js status
node .\tools\benchmark.js draft-human-prior .\cases\MKT-001 C:\analyst-work\MKT-001.human-prior.json
node .\tools\benchmark.js submit-human-prior .\cases\MKT-001 C:\analyst-work\MKT-001.human-prior.json
node .\tools\benchmark.js prepare-case .\intake\MKT-001.json C:\evidence\MKT-001.png C:\outcome-vault\MKT-001.json
node .\tools\benchmark.js freeze-case .\cases\MKT-001 C:\outcome-vault\MKT-001.json
node .\tools\benchmark.js freeze-stage .\cases\MKT-001 human_prior
node .\tools\benchmark.js run-ai .\cases\MKT-001
node .\tools\benchmark.js freeze-stage .\cases\MKT-001 ai_assessment
node .\tools\benchmark.js freeze-stage .\cases\MKT-001 fusion_revision
node .\tools\benchmark.js freeze-stage .\cases\MKT-001 baseline_forecast
node .\tools\benchmark.js reveal .\cases\MKT-001 C:\outcome-vault\MKT-001.json
node .\tools\benchmark.js freeze-stage .\cases\MKT-001 adjudication
node .\tools\benchmark.js freeze-stage .\cases\MKT-001 post_outcome_review
node .\tools\benchmark.js verify .\cases\MKT-001
node .\tools\benchmark.js score .\cases --output .\proof\scorecard.json
```

`register-market-pool` creates a public protocol and commitment under
`sampling/`. The seed and full slot-to-source mapping remain under the ignored
custodian vault. `bootstrap-market-case` verifies that commitment, downloads
exactly 100 consecutive bars, renders only the first 80, seals the next-20-bar
outcome outside `cases/`, and stops at `CASE_FROZEN`.

The visual protocol pre-registers all 5 layout x 3 latent-policy strata and
assigns them to opaque slots through a committed hidden seed. Its 15 images are
deterministic synthetic controls, not natural scenes. The future 20 simulation
steps, latent policy, and outcome remain in the custodian vault. Geometry QA is
`USABLE_WITH_LIMITATION`: 12 cases show all six generated trail points;
`VIS-001` and `VIS-006` show five, while `VIS-011` shows four because the
remaining points cross the frame edge. Frozen case evidence is not rewritten.

The hidden local vault is procedural separation, not independent custody.
Analysts must not have vault access. A real pilot still requires separately
identified operators or an external custodian.

`snapshot-custody` writes aggregate tree commitments only. It does not publish
the private inventory and cannot prove transfer, independent control, trusted
time, or Git identity.

## Evidence boundary

The local receipt is tamper-evident because each phase commits canonical JSON
hashes into a chain. It is not a trusted timestamp or independent witness.
External signing or a write-once registry is required before making strong
anti-tamper claims.

Corpus completeness alone is not a benchmark result. No performance claim is
valid until the 20 holdout cases remain blind through fusion freeze and the
final scorecard is generated from all verified case packages.
