# VisionAssist Intent Contract R26 Proof

Status: preserved source proof and parity suite.

This package was integrated from `VISIONASSIST_INTENT_CONTRACT_R26_PROOF.zip`.

It is the source proof for the active Intent R26 runtime. The canonical runtime contract now lives in `contracts/intent-r26`.

## Run

From this directory:

```powershell
python -m unittest discover -s tests
```

Expected result:

```text
10 tests passing
```

## Runtime linkage

- canonical contract: `contracts/intent-r26`
- JavaScript validator: `services/edge/src/intent-contract.js`
- runtime guide: `docs/intent-r26-runtime.md`

The Android Describe flow remains a separate profile. Intent R26 still grants no trading, execution, or capital authority.
