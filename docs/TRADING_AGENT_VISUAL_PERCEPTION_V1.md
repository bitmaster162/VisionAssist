# Trading Agent Visual Perception V1

`visionassist.market_observation.v1` is a deterministic trading-agent adapter over the existing `visionassist.intent.v1` visual-semantic cognition contract.

Endpoints:

- `POST /v1/market/observe` — analyze a chart/dashboard image through the existing intent model, bind the decoded image SHA-256 and caller-provided market context, then return a market observation record.
- `POST /v1/market/validate` — validate a market observation without model inference.

The adapter deliberately does **not** infer symbol, venue, or timeframe from the current generic intent record. Unprovided market context remains `UNKNOWN` and downgrades quality to `REVISE` rather than inventing values.

The adapter preserves visible observations, competing hypotheses, evidence refs, counterevidence, invalidation conditions, uncertainties, and alternatives from the proven intent contract.

Safety remains server-controlled:

- `decision_status=DIAGNOSTIC_ONLY`
- `action_code=NO_ACTION`
- `execution_permission=HOLD`
- `capital_permission=DENY`
- `can_trade=false`

This milestone does not implement order execution, credentials, R:R policy, SensorBridge, R57 benchmark restart, OCR expansion, or deployment.

## Scene graph v1

The first market scene graph is deterministic and evidence-grounded. It creates only generic observation and hypothesis nodes from the already validated intent record, then derives `SUPPORTS` / `CONTRADICTS` edges only when evidence references overlap or an observation is explicitly named as counterevidence.

This milestone deliberately does not claim liquidity, SFP, CHoCH, BOS, Fibonacci, or Elliott-wave nodes yet. Those semantic detector types require a later detector contract with explicit visual evidence and may return UNKNOWN/ABSTAIN.
