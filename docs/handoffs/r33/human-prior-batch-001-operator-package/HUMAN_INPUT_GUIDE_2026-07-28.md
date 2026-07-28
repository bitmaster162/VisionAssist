# VisionAssist batch-001 — human input

Status: `READY_FOR_HUMAN_INPUT_PREP_ONLY`  
Case state changed: `false`  
`DIAGNOSTIC_ONLY / NO_ACTION / HOLD / DENY / can_trade=false`

## Перед заполнением

Не продолжать к submit, пока:

1. локальный custodian не выполнил `verify-custody`;
2. реальные analyst/custodian/adjudicator не разделены;
3. два operator bindings не заполнены и не подтверждены;
4. для persistent project write не создан проверяемый Git baseline.

AI, fusion, baseline, reveal, adjudication и scoring запрещены.

## Как заполнить каждый файл

Нужно вручную указать:

- `recorded_at` — текущее UTC-время;
- `interpretation` — что видно и какой исход вероятнее;
- `competing_hypotheses` — минимум одна альтернативная версия;
- три probabilities, суммарно ровно `1`;
- `confidence` от `0` до `1`;
- `abstain=true` и причину только если evidence нельзя проверить;
- обе unseen attestations — `true` только если outcome и AI действительно не были показаны.

## MKT-001

- Evidence: [source.png](RESTRICTED_SOURCE_REFERENCE)
- Labels: `up`, `down`, `range`
- Horizon: следующие 20 завершённых свечей
- Resolution: сравнить close 20-й свечи с cutoff close; `up/down` требуют движения не меньше `max(0.5 × visible ATR14, 0.2% cutoff close)`, иначе `range`.
- Abstain: только если extract неполный, непоследовательный, non-finite или изображение нельзя проверить.

## MKT-002

- Evidence: [source.png](RESTRICTED_SOURCE_REFERENCE)
- Labels и правила: те же, что для `MKT-001`.

## MKT-003

- Evidence: [source.png](RESTRICTED_SOURCE_REFERENCE)
- Labels и правила: те же, что для `MKT-001`.

## VIS-001

- Evidence: [source.png](RESTRICTED_SOURCE_REFERENCE)
- Labels: `left_target`, `right_target`, `hold_position`
- Horizon: следующие 20 deterministic simulation steps
- Resolution: выбрать latent policy, к которой относится финальная позиция агента.
- Abstain: только если generated evidence, future frame, trace или commitment не проходят проверку. Future frame и trace analyst при этом не показываются.

## VIS-002

- Evidence: [source.png](RESTRICTED_SOURCE_REFERENCE)
- Labels и правила: те же, что для `VIS-001`.

## После ручного заполнения

Не отправлять файлы в case directories автоматически. Сначала повторно проверить:

- Git baseline;
- custody receipt;
- operator bindings;
- `CASE_FROZEN`;
- evidence hashes;
- отсутствие future artifacts.

Только после PASS разрешён поочерёдный `submit-human-prior`, case-specific `verify` и остановка каждого case на `HUMAN_PRIOR_FROZEN`.
