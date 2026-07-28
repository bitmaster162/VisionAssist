# P1 Operator Protocol

## Role separation

- Curator selects cases under the pre-registered sampling protocol.
- Outcome custodian prepares sealed outcomes and cannot be the analyst or adjudicator.
- Human analyst records the human-only and post-AI stages.
- Independent adjudicator performs post-reveal quality and leakage review.

Role IDs are part of every frozen case. The harness rejects conflicting
custodian, analyst, and adjudicator identities.

Role IDs cannot be changed after `CASE_FROZEN`. Bind actual people to the
existing IDs through an external signed or witnessed attestation; do not edit
the case manifests. The current harness validates semantic role separation,
not signatures or real-world operator identity.

## Before case intake

1. Freeze the candidate-pool commitment and sampling protocol before fetching
   any selected market window:

```powershell
node .\tools\benchmark.js register-market-pool
node .\tools\benchmark.js verify-market-pool
node .\tools\benchmark.js verify-market-corpus
```

The public files contain only commitments. The seed and slot-to-source mapping
remain in the custodian vault and must not be available to the analyst.
`verify-market-corpus` is a custodian-side integrity check and must not be run
inside the analyst environment because it reads sealed vault artifacts.

2. Assign deterministic slot IDs without consulting future outcomes.
3. Crop the visual evidence at the declared cutoff.
4. Remove filenames, annotations, metadata, or adjacent panels that reveal the future.
5. Define mutually exclusive outcome labels, horizon, resolution rule, and abstention rule.
6. Place the sealed outcome in a custodian-only vault outside `cases/`.

## Intake and annotation

```powershell
node .\tools\benchmark.js prepare-case <intake> <evidence> <sealed-outcome>
node .\tools\benchmark.js freeze-case <case-dir> <sealed-outcome>
```

The analyst creates a draft outside the case tree:

```powershell
node .\tools\benchmark.js draft-human-prior <case-dir> <draft-output>
```

The draft starts with empty fields and both unseen attestations set to `false`.
After the analyst completes it without AI or outcome access, submit and freeze
it atomically:

```powershell
node .\tools\benchmark.js submit-human-prior <case-dir> <completed-draft>
```

Only after that:

```powershell
node .\tools\benchmark.js run-ai <case-dir>
node .\tools\benchmark.js freeze-stage <case-dir> ai_assessment
```

The analyst receives only the frozen AI assessment, writes
`fusion_revision.json`, and freezes it. The candlestick baseline is generated
independently and frozen next.

## Reveal and review

```powershell
node .\tools\benchmark.js reveal <case-dir> <sealed-outcome>
```

Reveal fails if the outcome hash differs from its precommitment. The independent
adjudicator then freezes `adjudication.json`; the analyst finally records
`post_outcome_review.json`.

## Prohibited

- Selecting cases because their future outcome is interesting.
- Opening the custodian pool, raw 100-bar extracts, or sealed outcomes while
  acting as the human analyst.
- Showing human prior to the AI-only runner.
- Showing AI output to the candle baseline.
- Copying sealed outcomes into the case tree before reveal.
- Editing a frozen artifact.
- Publishing raw evidence without a separate rights and privacy review.
- Converting any forecast into a trade or execution instruction.
