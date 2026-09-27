# VisionAssist R50 operator demo

## Product slice

R50 turns the R43 evidence gate into one human-usable local workflow. It does
not add market calls, AI analysis, scoring, or outcome access.

The product has exactly three slots. Each slot advances monotonically:

```text
EMPTY
  -> CAPTURE_OPEN
  -> EVIDENCE_FROZEN
  -> HUMAN_PRIOR_FROZEN
  -> AI_PACKET_EXPORTED
```

Manual file changes after freeze are detected by canonical SHA-256 readback and
return `EVIDENCE_TAMPERED` or `HUMAN_PRIOR_TAMPERED`.

## Capture input

The downloadable JSON template collects:

- cutoff, prior deadline, horizon start, timeframe, and resolution rule;
- instrument and source provenance;
- at least 200 consecutive OHLCV rows;
- volume, turnover, spread, and depth;
- token metrics or a pre-frozen non-applicability reason;
- derivatives, including open interest, or a pre-frozen non-applicability
  reason;
- reference market and regime;
- a bounded pre-cutoff article/event search or an explicit empty-search
  attestation.

The product computes all artifact hashes and deterministic indicators locally.
The R50 identity profile reuses the frozen R34 evidence contract and formula
manifest.

## Human prior

The prior is accepted only after evidence passes and only within the frozen
access/deadline window. It requires:

- an interpretation;
- at least two competing hypotheses;
- evidence, counterevidence, and an invalidation condition for each;
- up/down/range probabilities summing to one, or an explicit abstention;
- confidence;
- outcome-unseen and AI-unseen attestations.

Prior files are stored outside the evidence tree. The AI-runner export reads
only the evidence tree and evidence receipt.

## Runtime and proof boundary

Launch:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-market-case-r50.ps1
```

Open [http://127.0.0.1:8790](http://127.0.0.1:8790).

Automated tests may use deterministic `TEST_ONLY` input to prove mechanics.
Such fixtures are not human priors and must not be counted as benchmark cases.
`PRODUCT_MVP_PASS` requires a real human to freeze one new case from real
pre-cutoff evidence. Until that happens, the honest terminal state is
`HUMAN_GATE_READY`.
