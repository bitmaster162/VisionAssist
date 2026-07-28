# R34 market evidence gate

`verify-market-input-r34` is a read-only, fail-closed gate for candidate
`FORWARD_LOCKED_FULL_CONTEXT` market evidence. It validates evidence quality
only. It does not create a human prior, call a model, reveal an outcome, score a
case, trade, or grant execution authority.

## Candidate directory

```text
MKT-R34-nnn/
  market_evidence_bundle.json
  artifacts/
    ...
```

Every sidecar must appear exactly once in `artifact_manifest` with a matching
SHA-256. Absolute paths, traversal, symbolic links, unmanifested files, and
future/outcome/AI/fusion/reveal/scoring sidecars fail closed.

## Command

```powershell
node .\benchmarks\chart-intent-r26\tools\benchmark.js `
  verify-market-input-r34 `
  <candidate-directory>
```

A pass returns:

```text
market_evidence_status=PASS
capture_mode=FORWARD_LOCKED_FULL_CONTEXT
case_phase=CASE_FROZEN
can_trade=false
```

The receipt binds the canonical bundle SHA-256 and frozen indicator-formula
manifest. The validator independently reproduces ATR(14), ATR%, RSI(14),
EMA(20/50/200), distances to EMA, VWAP, frozen returns, volume change, and
volatility regime from at least 200 consecutive pre-cutoff OHLCV rows.

## Fail-closed codes

- `MISSING_REQUIRED_CONTEXT`
- `POST_CUTOFF_DATA`
- `UNVERIFIED_AVAILABILITY`
- `SERIES_GAP`
- `DERIVED_MISMATCH`
- `HASH_MISMATCH`
- `BLIND_MODE_VIOLATION`
- `AUTHORITY_VIOLATION`

`INSUFFICIENT_DECISION_CONTEXT` belongs to the separate R34 human-prior schema.
It is an honest analyst abstention after a complete evidence bundle passes; it
must not be used to excuse a missing, stale, hash-mismatched, or leaked bundle.

## Templates

`templates/r34/replacements/MKT-R34-001..003.json` are replacement capture
templates only. They remain `INCOMPLETE_NOT_FREEZABLE` and contain no
observation, human prior, AI/fusion output, or outcome. The synthetic non-market
control stays isolated in `templates/r34/visual-only-manifest.json`.
