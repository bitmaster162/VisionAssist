# VisionAssist R50 Forward Desk

Forward Desk is a loopback-only operator product for three new market-case
slots:

- `MKT-R50-001`
- `MKT-R50-002`
- `MKT-R50-003`

It does not expose the frozen 75-case corpus or outcome vault.

## Launch

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-market-case-r50.ps1
```

The script checks the R50 disk, Node-memory, Node-count, and MAWorld/R49B writer
gates before binding `127.0.0.1:8790`. Data is stored by default in:

```text
%LOCALAPPDATA%\VisionAssist\R50-Operator
```

Use a disposable data root for a rehearsal:

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\scripts\start-market-case-r50.ps1 `
  -DataDir "$env:TEMP\VisionAssist-R50-Rehearsal"
```

Stop the launcher with `Ctrl+C`; it tears down the hidden Node process.

## Operator flow

1. Select one of the three slots and freeze derivatives/token applicability.
2. Load the empty capture template, insert real pre-cutoff source data, and run
   evidence validation.
3. Freeze evidence only after the R43-derived validator returns `PASS`.
4. Record the human prior before its deadline, including at least two competing
   hypotheses, confidence, counterevidence, and invalidation conditions.
5. Attest that outcome and AI output are unseen, then create the immutable
   `HUMAN_PRIOR_FROZEN` receipt.
6. Export the separate AI-runner packet. Export does not run a model.

## Product boundary

The runtime returns `403 PRODUCT_BOUNDARY_BLOCK` for outcome-vault, outcome,
future, AI-run, fusion, baseline, reveal, and scoring routes. It is
`NO_ACTION / HOLD / DENY / can_trade=false`.

No API key, wallet, order route, public bind, or capital permission is present.
