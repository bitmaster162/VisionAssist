# VisionAssist R34 — market evidence revision

Дата решения: `2026-07-28`  
Design audit: `REVISE`  
Implementation: `UNIMPLEMENTED / BLOCKED_BY_GIT_BASELINE`  
Authority: `DIAGNOSTIC_ONLY / NO_ACTION / HOLD / DENY / can_trade=false`

## 1. Причина revision

`MKT-001..003` дают analyst только chart image и outcome definition. Этого достаточно для узкого visual-pattern baseline, но недостаточно для осмысленного market-decision prior по стандарту Роберта. Принуждение к вероятностям создало бы шум, а не доказательство качества решения.

Frozen cases не редактируются. Для market track создаются replacement IDs `MKT-R34-001..003`. `VIS-001..002` выводятся в отдельный non-market visual track.

## 2. Рекомендуемый capture mode

Основной режим R34: `FORWARD_LOCKED_FULL_CONTEXT`.

1. Custodian фиксирует полный market snapshot в реальном времени.
2. В момент capture будущих 20 completed bars ещё не существует.
3. До передачи evidence фиксируются `prior_deadline` и более поздний `horizon_start_at`.
4. Analyst работает только с frozen snapshot и фиксирует prior не позднее `prior_deadline`, до `horizon_start_at` и до любого case-specific AI output.
5. Outcome определяется только после завершения frozen horizon.

Это позволяет показать analyst реальные symbol, venue, цену, timestamp, новости и derivatives context без исторического lookup будущего outcome.

Historical fallback: `HISTORICAL_MASKED`. В нём скрываются symbol, абсолютная дата, venue и source lookup keys, а числовые ряды масштабируются без изменения returns и относительной структуры. Unmasked historical case получает `HOLD`, если невозможность outcome lookup не доказана изолированной offline-средой. В одном batch нельзя смешивать forward и historical modes.

## 3. Обязательный `market_evidence_bundle.json`

Для каждого нового market case должен существовать отдельный immutable bundle со следующими группами.

### Identity и horizon

- `case_id`;
- `capture_mode`;
- `instrument.symbol`, `instrument.venue`, `instrument.asset_class`;
- `cutoff_at`;
- `prior_deadline`;
- `horizon_start_at`;
- `timeframe`;
- `horizon.completed_bars`;
- frozen labels и resolution rule.

### Price и volume

- cutoff price;
- последовательный pre-cutoff OHLCV window;
- spot volume и источник;
- spread, depth и turnover;
- market cap, FDV и circulating supply, если применимо;
- явный `not_applicable` или `unavailable` с причиной вместо выдуманного значения.

### Derivatives context

Для инструмента с derivatives:

- open interest и pre-cutoff change;
- funding rate;
- spot/perpetual basis;
- liquidations;
- long/short ratio и CVD/order-flow, если источник доступен.

Для spot-only инструмента весь блок получает `applicable=false` с provenance; поля нельзя молча опускать.

### Deterministic indicators

Минимальный frozen набор, вычисленный только из pre-cutoff OHLCV:

- ATR(14);
- ATR% и frozen return windows;
- RSI(14);
- EMA(20), EMA(50), EMA(200) и расстояния до них, если хватает истории;
- VWAP;
- volume change и volatility regime.

Формулы, lookback, units и missing-data rule фиксируются в manifest. LLM не вычисляет и не дополняет эти значения.

### Event и article context

- опубликованные до cutoff headlines/articles;
- source, `published_at`, capture timestamp и content hash;
- известные scheduled events;
- market-regime и reference-market context;
- явный empty search receipt, если релевантных событий не найдено.

Нельзя включать обновлённый после cutoff текст, outcome commentary или retrospective summary.

### Provenance и authority

Каждая source group содержит:

- provider/source;
- observed/captured timestamp;
- raw artifact SHA-256;
- parser/transform version;
- freshness result;
- missingness result.

`not_applicable` разрешается только frozen applicability matrix, выпущенной до case generation. Отсутствующий required input нельзя превращать в `unavailable` постфактум: такой candidate case исключается до freeze.

Authority остаётся строго:

```text
decision_status=DIAGNOSTIC_ONLY
action_code=NO_ACTION
execution_permission=HOLD
capital_permission=DENY
can_trade=false
```

## 4. Deterministic evidence gate

Gate обязан завершаться fail-closed до `CASE_FROZEN`, если:

1. любой input timestamp позже cutoff;
2. OHLCV непоследователен, non-finite или не покрывает lookback;
3. обязательный source group отсутствует без явного unavailable/not-applicable receipt;
4. indicator не воспроизводится из committed OHLCV и frozen formula;
5. source hash, parser version или bundle commitment не совпадает;
6. article/event был опубликован или materially updated после cutoff;
7. live-forward prior записан после `prior_deadline` или не раньше `horizon_start_at`;
8. historical case допускает analyst lookup будущего outcome;
9. bundle содержит AI, baseline, fusion, reveal, outcome или scoring material;
10. любой authority flag отличается от frozen boundary.

Gate не оценивает направление рынка и не создаёт probabilities. Он проверяет только completeness, chronology, provenance, reproducibility и leakage boundary.

R34 human-prior schema должна разрешать честный abstain с reason code `INSUFFICIENT_DECISION_CONTEXT`; это отдельное основание от повреждённого или неполного render.

## 5. Минимальное implementation change

После появления проверяемого Git baseline:

1. добавить schema для `market_evidence_bundle.json`;
2. добавить deterministic validator в существующий benchmark harness;
3. добавить bundle commitment в initial case receipt;
4. запретить `CASE_FROZEN`, если evidence gate не прошёл;
5. добавить отдельный manifest для visual-only track;
6. выпустить новые operator bindings для replacement case IDs;
7. добавить `INSUFFICIENT_DECISION_CONTEXT` в frozen abstention vocabulary;
8. не изменять R29 frozen cases и receipts.

До Git baseline это остаётся спецификацией, а не заявленной реализацией.

## 6. Целевой executable check

Команда ниже является обязательным contract для реализации R34, но сейчас ещё не существует:

```powershell
node .\benchmarks\chart-intent-r26\tools\benchmark.js `
  verify-market-input-r34 `
  .\benchmarks\chart-intent-r26\candidate-cases\<CASE-ID>
```

PASS требует exit code `0` и receipt с:

- `market_evidence_status=PASS`;
- canonical bundle SHA-256;
- cutoff chronology PASS;
- provenance PASS;
- indicator reproducibility PASS;
- leakage scan PASS;
- frozen authority boundary;
- `case_phase=CASE_FROZEN`.

Обязательные negative fixtures должны возвращать non-zero для:

- missing OI without explicit not-applicable/unavailable receipt;
- post-cutoff article;
- modified OHLCV;
- indicator mismatch;
- outcome/future artifact;
- `can_trade=true`.

Fail receipt использует один или несколько кодов:

`MISSING_REQUIRED_CONTEXT`, `POST_CUTOFF_DATA`, `UNVERIFIED_AVAILABILITY`, `SERIES_GAP`, `DERIVED_MISMATCH`, `HASH_MISMATCH`, `BLIND_MODE_VIOLATION`, `AUTHORITY_VIOLATION`.

## 7. Stop conditions

Остановить R34 preparation, если:

- Git baseline/HEAD отсутствует или dirty state неоднозначен;
- невозможно получить полный pre-cutoff snapshot с provenance;
- capture mode не определён до case generation;
- `prior_deadline` и `horizon_start_at` не зафиксированы до передачи evidence;
- prior не успевает быть frozen до `horizon_start_at`;
- analyst получил case-specific AI или outcome-derived material;
- leakage-safe historical custody не доказана;
- validator ещё не реализован и не протестирован;
- требуется ручное изменение frozen artifact или receipt.

## 8. Текущий terminal state

- `MKT-001..003`: `HOLD`, human priors отсутствуют.
- `VIS-001..002`: `HOLD` до отдельного visual-only manifest.
- Mixed batch-001: `STOPPED_BEFORE_FIRST_SUBMISSION_SCOPE_OBJECTION`.
- R34 market track: `REVISE / UNIMPLEMENTED`.
- AI, fusion, baseline, reveal, adjudication и scoring: не запускались.
- `can_trade=false`.
