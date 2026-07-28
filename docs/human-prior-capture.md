# Blind Human-Prior Capture

Scope: first five development cases only. This step must stop at
`HUMAN_PRIOR_FROZEN`.

Prerequisite handoff:
`docs/handoffs/VISIONASSIST_R33_ACCEPTED_HANDOFF_2026-07-28.md`.

Before analyst access, the custodian runs:

```powershell
node .\benchmarks\chart-intent-r26\tools\benchmark.js verify-custody
```

The analyst must not receive the custody snapshot command environment because
verification reads the private vault.

## Role binding

Frozen case manifests already contain role IDs. Do not edit those IDs. Bind a
real operator to each existing role ID through a signed or witnessed external
attestation based on
`benchmarks/chart-intent-r26/templates/operator-binding.example.json`.

Store completed bindings outside the repository. A binding is organizational
evidence; the current harness does not verify signatures or real-world
identity. If one person would be both analyst and custodian or adjudicator,
stop. Do not alter the frozen cases to conceal the collision.

## Batch

`human-prior-batch-001` contains:

- `MKT-001..003`,
- `VIS-001..002`.

The batch is fixed in
`benchmarks/chart-intent-r26/proof/human-prior-batch-001.json`.

## Prepare drafts

Use an analyst-only directory that is not under `cases/` or `outcome-vault/`:

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\scripts\prepare-human-prior-batch-001.ps1 `
  -AnalystWorkRoot C:\visionassist-analyst\batch-001
```

Each generated draft is intentionally invalid. The analyst must manually fill:

- UTC `recorded_at`,
- interpretation,
- competing hypotheses,
- one probability per frozen outcome label, summing to `1`,
- confidence in `[0,1]`,
- abstention and reason when evidence is insufficient,
- both unseen attestations only if they are actually true.

## Submit one case

```powershell
node .\benchmarks\chart-intent-r26\tools\benchmark.js `
  submit-human-prior `
  .\benchmarks\chart-intent-r26\cases\MKT-001 `
  C:\visionassist-analyst\batch-001\MKT-001.human-prior.json
```

Submission validates the completed draft before copying it into the case.
Freeze is atomic: validation or chain failure removes the copied artifact.

After each submission:

```powershell
node .\benchmarks\chart-intent-r26\tools\benchmark.js `
  verify .\benchmarks\chart-intent-r26\cases\MKT-001
```

Expected phase: `HUMAN_PRIOR_FROZEN`.

## Stop conditions

- The analyst saw any vault or future artifact.
- Either unseen attestation cannot honestly be set to `true`.
- Actual operators cannot be separated.
- Evidence hash differs from the batch manifest.
- A case is not exactly at `CASE_FROZEN`.
- Any submission or receipt verification fails.

Do not run AI, fusion, baseline, reveal, adjudication, or scoring in this step.
