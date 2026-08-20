# VisionAssist P0 Shadow Trade Export R1

Status: CANDIDATE BRANCH ONLY / DIAGNOSTIC / NO ACTION

Baseline: `cdbc9a3cbc07cd17f31c41d481550939706dbb60` from `agent/trading-agent-visual-perception-v1`.

## Purpose

Export an already validated `visionassist.market_observation.v1` into a compact `tradingos.visual_market_evidence.v1` record for the TradingOS P0 shadow pipeline.

The adapter preserves visible observations, detector evidence, counterevidence, uncertainty, alternative explanations, source/image identity and market context. It rejects missing provided context and any widened execution safety state.

Fixed output safety:

```text
mode=SHADOW
execution_authority=NONE
can_trade=false
capital_permission=DENY
orders_allowed=false
signals_allowed=false
```

VisionAssist remains a perception/evidence producer. It does not produce an order, signal or execution permission.
