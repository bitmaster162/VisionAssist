# P1 Artifact Contract

The executable source of truth is `src/contract.js`. This document defines the
operator-facing fields.

## `case.json`

- `case_id`: deterministic slot `MKT-001..060` or `VIS-001..015`.
- `domain`, `split`, and `modality`: must match the slot roster.
- `sampling`: candidate, protocol, source family, stratum, timeframe, and a
  true attestation that selection occurred without outcome access.
- `evidence.asset_path`: relative path contained inside the case directory.
- `evidence.sha256`: byte hash of the frozen visual asset.
- `outcome_definition.labels`: mutually exclusive forecast labels.
- `outcome_definition.horizon`: fixed future observation window.
- `outcome_definition.resolution_rule`: deterministic label resolution.
- `roles`: curator, outcome custodian, analyst, independent adjudicator.
- `outcome_commitment_sha256`: canonical JSON hash of the sealed outcome.
- `authority`: fixed `DIAGNOSTIC_ONLY / NO_ACTION / HOLD / DENY`.

## `human_prior.json`

Recorded before AI output and outcome reveal:

- interpretation and human hypotheses,
- full probability distribution,
- abstention decision,
- confidence,
- `outcome_unseen_attestation=true`,
- `ai_unseen_attestation=true`.

## `ai_assessment.json`

Recorded without human prior, baseline output, or outcome:

- valid `visionassist.intent.v1` record,
- at least two competing hypotheses,
- full consequence probability distribution,
- `human_context.present=false`,
- three blind attestations set to `true`.

## `fusion_revision.json`

Recorded after the analyst sees AI output but before outcome reveal:

- revised interpretation,
- every AI hypothesis explicitly adopted or rejected,
- any new human hypothesis,
- revised full probability distribution,
- change rationale and confidence.

## `baseline_forecast.json`

For market cases, contains the frozen candlestick classifier distribution. It
must remain blind to human and AI records. For non-market cases:

```json
{
  "applicable": false,
  "classifier_id": null,
  "classifier_version": null,
  "outcome_forecast": null
}
```

## Sealed `outcome.json`

Created by the outcome custodian before annotation and stored outside `cases/`.
It includes the resolved label, summary, observation window,
`should_abstain`, and evidence references. The reveal command copies it into
the case only after all pre-outcome stages are frozen.

## `adjudication.json`

Independent post-reveal review:

- supported and unsupported observation IDs,
- reference alternatives and covered AI hypothesis IDs,
- counterevidence and invalidation rubric scores,
- explicit hindsight leakage flags.

## `post_outcome_review.json`

Preserves the frozen fusion top-1 label and records whether a miss was
acknowledged, the corrected interpretation, error tags, and correction quality.
