# P1 Metric Contract

All probability labels and resolution rules are frozen in `case.json` before
human or AI annotation. Every forecast must assign a probability to every label
and the probabilities must sum to exactly `1`.

## Forecast metrics

### Multiclass Brier score

For case `i` with labels `k`:

```text
Brier_i = sum_k (p_ik - y_ik)^2
```

`y_ik` is `1` for the revealed label and `0` otherwise. Lower is better. The
scorecard reports the mean separately for human-only, AI-only, human+AI, and the
market-only candlestick baseline.

### Accuracy

Top-1 is the label with highest probability. Exact probability ties are broken
by ascending label ID. A forecast with `abstain=true` is not counted as a
correct top-1 prediction.

The scorecard reports:

- `human_only_accuracy`
- `ai_only_accuracy`
- `human_ai_accuracy`
- market-only baseline accuracy

### Abstention quality

Each sealed outcome includes `should_abstain`, resolved using the rule frozen in
`case.outcome_definition.should_abstain_rule`.

```text
abstention_quality = correct abstain decisions / case count
```

This is reported per human-only, AI-only, human+AI, and applicable baseline.
Brier is still calculated for abstained cases so blanket abstention cannot hide
poor calibration.

## Diagnostic quality metrics

These are independently adjudicated after outcome reveal.

### Evidence grounding

Every AI surface observation is classified exactly once as supported or
unsupported.

```text
evidence_grounding = supported observations / all AI observations
```

### Alternative-hypothesis coverage

The adjudicator defines the materially plausible reference alternatives and
links each covered alternative to one or more frozen AI hypothesis IDs.

```text
coverage = covered reference alternatives / all reference alternatives
```

### Counterevidence quality

Independent rubric, normalized from `0..4` to `0..1`:

| Score | Definition |
|---:|---|
| 0 | Missing, irrelevant, or circular. |
| 1 | Generic objection without a concrete evidence link. |
| 2 | Plausible counterevidence, but incomplete or weakly linked. |
| 3 | Concrete counterevidence linked to the case and its likely impact. |
| 4 | Multiple concrete disconfirming signals with calibrated impact on hypotheses. |

### Invalidation quality

Independent rubric, normalized from `0..4` to `0..1`:

| Score | Definition |
|---:|---|
| 0 | Hypothesis is not falsifiable. |
| 1 | Vague invalidation with no observable condition. |
| 2 | Observable condition, but threshold or horizon is missing. |
| 3 | Clear observable condition with threshold or horizon. |
| 4 | Multiple discriminative, pre-specified conditions that separate hypotheses. |

## Leakage and correction

### Hindsight leakage

Structural leakage blocks scoring when a future-stage file appears early, a
frozen artifact changes, or the outcome hash differs from its precommitment.

Manual leakage rate:

```text
leakage flags / (case count * 3 pre-outcome stages)
```

The three reviewed stages are human prior, AI assessment, and fusion revision.
The target is zero.

### Correction after outcome reveal

For fusion top-1 misses:

```text
correction rate = acknowledged misses / all fusion misses
```

Acknowledged corrections also receive a `0..4` quality score, normalized to
`0..1`. Correct original forecasts are excluded from this denominator.

## Release gates

The harness only returns `READY_FOR_INDEPENDENT_REVIEW` when:

- all 75 cases and all 20 blinded holdout cases are complete,
- holdout leakage flags are zero,
- holdout fusion accuracy is not below human-only accuracy,
- holdout fusion Brier is not worse than human-only Brier,
- blinded market holdout fusion Brier beats the candlestick baseline.

These gates permit independent review. They do not prove production value,
causal understanding, trading profitability, or action authority.
