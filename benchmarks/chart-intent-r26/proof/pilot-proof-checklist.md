# P1 Proof-Pack Checklist

Status values: `MISSING`, `PREPARED`, `FROZEN`, `VERIFIED`.

| Evidence | Required status |
|---|---|
| Benchmark manifest hash | VERIFIED |
| Deterministic 75-slot roster | VERIFIED |
| Pre-registered sampling protocol and candidate pool commitment | VERIFIED |
| 60 market case manifests and assets | FROZEN |
| 15 non-market case manifests and assets | FROZEN |
| 75 sealed outcome commitments | VERIFIED |
| 75 human priors frozen before AI | VERIFIED |
| 75 AI-only assessments with valid Intent R26 records | VERIFIED |
| 75 post-AI human revisions | VERIFIED |
| Market candle baseline outputs | VERIFIED |
| 75 verified outcome reveals | VERIFIED |
| 75 independent adjudications | VERIFIED |
| Post-outcome reviews for every fusion miss | VERIFIED |
| Full and holdout scorecards | VERIFIED |
| Hindsight leakage audit | VERIFIED |
| Raw case media publication | FORBIDDEN |

Release remains `HOLD` if any required row is incomplete, any receipt chain is
invalid, any outcome hash mismatches its commitment, or any record grants action
authority.

Current checkpoint: both pool commitments and all 75 case packages are frozen
and locally verified. Human priors, AI assessments, fusion revisions, baseline
records, reveals, adjudications, post-outcome reviews, and scorecards remain
missing, so release remains `HOLD`. The 15 non-market packages are synthetic
controls, not natural-scene evidence.
