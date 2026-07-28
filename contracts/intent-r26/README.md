# VisionAssist Intent R26 Contract

This is the canonical runtime contract imported from
`VISIONASSIST_INTENT_CONTRACT_R26_PROOF.zip`.

Under
[`visionassist.lineage.r29`](../lineage-r29/visionassist_lineage.json),
this contract implements the current core-perception runtime. It does not erase
the historical accessibility lineage or prove the Active Inference research
architecture complete.

It defines a visual-semantic diagnostic record that:

- separates observations from hypotheses,
- requires at least two competing hypotheses,
- requires evidence, counterevidence, uncertainty, and invalidation,
- binds optional human context to the fusion status,
- denies trading, execution, and capital authority.

Canonical files:

- `visionassist_intent_record_v1.json` - strict local validation contract.
- `chart_intent_record.json` - valid reference record.
- `provenance.json` - source archive and receipt identity.

Runtime implementation:

- `services/edge/src/intent-contract.js`
- `services/edge/src/intent-schema.js` - derived Responses-compatible schema.
- `POST /v1/intent/validate`
- `POST /v1/intent/analyze`
