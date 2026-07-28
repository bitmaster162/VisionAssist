# VisionAssist R29 — операторский пакет blind human-prior batch-001

Дата: `2026-07-27`  
Scope: только `MKT-001`, `MKT-002`, `MKT-003`, `VIS-001`, `VIS-002`  
Старт: `CASE_FROZEN`  
Допустимый terminal state: `HUMAN_PRIOR_FROZEN` для каждого из пяти кейсов  
Режим: `DIAGNOSTIC_ONLY`  
Действие: `NO_ACTION`  
Execution: `HOLD`  
Capital: `DENY`  
`can_trade=false`

## 1. Что разрешено в этом батче

Только blind capture, validation, atomic freeze и case-specific receipt verification человеческого prior.

Запрещено запускать или подготавливать как часть этого шага:

- AI assessment;
- fusion/revision;
- candlestick baseline;
- outcome reveal;
- adjudication;
- scoring или official score;
- торговое, навигационное, брокерское или capital действие.

Пакет не содержит human judgments и не поддерживает claims об accuracy, calibration, uplift, generality или production value.

## 2. Фиксированный состав батча

| Case | Domain | Frozen analyst role | Outcome labels | Evidence SHA-256 |
| --- | --- | --- | --- | --- |
| `MKT-001` | market | `r26-human-analyst-001` | `up`, `down`, `range` | `c33abfec8d3ebc475af24c33395857406d8d80c4462929b9f475d9015740f79d` |
| `MKT-002` | market | `r26-human-analyst-001` | `up`, `down`, `range` | `e67380837d6348d251385bd6e8086a86765d2b35b145009f35401c79cd67fd55` |
| `MKT-003` | market | `r26-human-analyst-001` | `up`, `down`, `range` | `6bcc6c16812f9ebd2abece30cea8b241dd3709f3bbc32f01f50dd6b1be7f0140` |
| `VIS-001` | non-market visual | `r29-visual-analyst-001` | `left_target`, `right_target`, `hold_position` | `6c9cf92879ae46abe2d3b16e464475ea7e2e28d7a382deda3723373ef98a4dd5` |
| `VIS-002` | non-market visual | `r29-visual-analyst-001` | `left_target`, `right_target`, `hold_position` | `acfc2a17b3194a57e1338fb3e434c2f2f8ed137daf4738b948d648b81ec7bfc1` |

Состав нельзя менять по результату просмотра outcome или latent data.

## 3. Разделение ролей

### Batch operator / curator

- сверяет batch manifest, case phase, role ID и evidence hash;
- готовит пустые drafts в analyst-only директории;
- не открывает outcome vault и не сообщает analyst никаких future данных;
- после заполнения выполняет только `submit-human-prior` и case-specific `verify`;
- прекращает весь батч при первом stop condition.

### Human analyst — market

- внешне привязан к `r26-human-analyst-001`;
- scope: `MKT-001..003`;
- видит только допустимые analyst inputs;
- вручную формирует prior до любого AI access.

### Human analyst — visual

- внешне привязан к `r29-visual-analyst-001`;
- scope: `VIS-001..002`;
- видит только допустимые analyst inputs;
- вручную формирует prior до любого AI access.

### Outcome custodian

- единственный владелец sealed outcomes, seeds и vault material;
- не является analyst или adjudicator;
- не участвует в интерпретации и не передаёт analyst outcome-derived hints.

### Adjudicator

- не является analyst или custodian;
- в этом батче не активируется и не получает human-prior для adjudication.

### Неактивные роли

AI-only runner, fusion operator, baseline runner, reveal operator и scoring operator не запускаются и не получают inputs.

Для каждого frozen analyst role создаётся отдельный `operator-binding` вне публичного repository. Все четыре attestations должны быть правдивыми и равны `true`; подпись или witnessed reference сохраняется внешне. Harness проверяет структуру, но не доказывает реальную личность или подпись, поэтому binding остаётся организационным evidence.

## 4. Допустимые и запрещённые входы

Analyst может получить только:

1. case evidence asset;
2. case outcome definition: labels, horizon, resolution rule, abstention rule;
3. blank case-specific human-prior draft;
4. собственный frozen analyst role ID и case ID.

Analyst не должен получать:

- `outcome-vault/`;
- sealed outcome или outcome label;
- custodian seed;
- future frame;
- simulation trace;
- slot-to-source mapping;
- slot-to-latent-policy mapping;
- AI assessment;
- baseline output;
- fusion record;
- чужой или ранее заполненный human prior;
- scoring или adjudication material.

Draft directory должна находиться вне `cases/` и `outcome-vault/`, например:

```text
C:\visionassist-analyst\batch-001
```

## 5. Внешний operator-binding

Для market и visual cohort используются два binding-файла следующей формы:

```json
{
  "schema_version": "visionassist.benchmark.operator-binding.v1",
  "benchmark_id": "VISIONASSIST_CHART_INTENT_AND_HUMAN_AI_FUSION_PROOF",
  "binding_id": "<unique-binding-id>",
  "frozen_role_id": "<r26-human-analyst-001 | r29-visual-analyst-001>",
  "role": "human_analyst",
  "operator_pseudonym": "<controlled-pseudonym>",
  "cohort_scope": ["<fixed case IDs for this role>"],
  "attested_at": "<ISO-8601 UTC timestamp>",
  "attestations": {
    "is_not_outcome_custodian": true,
    "is_not_adjudicator": true,
    "had_no_outcome_vault_access": true,
    "will_record_prior_before_ai_access": true
  },
  "attestation_method": "<signed-or-witnessed-method>",
  "signature_ref": "RESTRICTED_ATTESTATION_REFERENCE",
  "storage_boundary": "Store outside the public repository."
}
```

Не редактировать frozen role IDs в case manifests.

## 6. Структура `human_prior.json`

Точный набор ключей:

```json
{
  "schema_version": "visionassist.benchmark.human-prior.v1",
  "case_id": "<case ID>",
  "analyst_id": "<frozen analyst role ID>",
  "recorded_at": "2026-07-27T00:00:00Z",
  "interpretation": "<non-empty human interpretation>",
  "competing_hypotheses": [
    "<at least one non-empty alternative>"
  ],
  "outcome_forecast": {
    "probabilities": [
      {
        "label": "<frozen label 1>",
        "probability": 0.0
      },
      {
        "label": "<frozen label 2>",
        "probability": 0.0
      },
      {
        "label": "<frozen label 3>",
        "probability": 0.0
      }
    ],
    "abstain": false,
    "abstention_reason": null
  },
  "confidence": 0.0,
  "outcome_unseen_attestation": true,
  "ai_unseen_attestation": true
}
```

Валидационные условия:

- дополнительных или отсутствующих top-level keys быть не должно;
- `case_id` и `analyst_id` должны точно совпадать с frozen case manifest;
- `recorded_at` — реальный ISO-8601 UTC timestamp момента фиксации;
- `interpretation` — непустая строка;
- `competing_hypotheses` — минимум одна непустая строка;
- каждая frozen label встречается ровно один раз;
- каждая probability конечна и лежит в `[0,1]`;
- сумма probabilities равна `1` с допуском `1e-9`;
- `confidence` конечна и лежит в `[0,1]`;
- если `abstain=false`, `abstention_reason=null`;
- если `abstain=true`, `abstention_reason` — непустая строка;
- обе unseen attestations можно ставить `true` только если они фактически истинны.

## 7. Порядок фиксации receipts

Обрабатывать кейсы последовательно в фиксированном порядке:

`MKT-001 -> MKT-002 -> MKT-003 -> VIS-001 -> VIS-002`.

Для каждого кейса:

1. Прочитать и сохранить pre-submit `receipt.json`.
2. Проверить:
   - `phase=CASE_FROZEN`;
   - `chain.length=1`;
   - `chain[0].sequence=0`;
   - `chain[0].kind=case`;
   - `receipt.evidence_sha256` совпадает с batch manifest.
3. Сгенерировать blank draft вне case/vault.
4. Передать analyst только разрешённые inputs.
5. Получить вручную заполненный draft и проверить binding/attestations.
6. Выполнить один `submit-human-prior`.
7. Submission валидирует draft, копирует его как `human_prior.json` и атомарно добавляет receipt entry. При validation/chain failure скопированный artifact должен быть удалён.
8. Немедленно выполнить case-specific `verify`.
9. Прочитать post-submit `receipt.json` и проверить:
   - `phase=HUMAN_PRIOR_FROZEN`;
   - `chain.length=2`;
   - `chain[1].sequence=1`;
   - `chain[1].kind=human_prior`;
   - `chain[1].previous_chain_sha256 == chain[0].chain_sha256`;
   - `chain[1].artifact_sha256` совпадает с canonical SHA-256 frozen `human_prior.json`;
   - `chain[1].chain_sha256` проходит verifier;
   - future artifacts отсутствуют.
10. Зафиксировать внешний batch receipt: case ID, pre-chain SHA, post-chain SHA, frozen timestamp, verifier result и operator pseudonym.
11. Только после PASS переходить к следующему кейсу.

Команды:

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\scripts\prepare-human-prior-batch-001.ps1 `
  -AnalystWorkRoot C:\visionassist-analyst\batch-001
```

```powershell
node .\benchmarks\chart-intent-r26\tools\benchmark.js `
  submit-human-prior `
  .\benchmarks\chart-intent-r26\cases\<CASE-ID> `
  C:\visionassist-analyst\batch-001\<CASE-ID>.human-prior.json
```

```powershell
node .\benchmarks\chart-intent-r26\tools\benchmark.js `
  verify .\benchmarks\chart-intent-r26\cases\<CASE-ID>
```

Не выполнять `verify-p1.ps1` с прежним ожиданием `CASE_FROZEN 75` после частичного human-prior freeze, если verifier contract для mixed phases отдельно не подтверждён.

## 8. Проверяемые stop conditions

Остановить весь батч и не переходить к следующему кейсу, если выполнено хотя бы одно:

1. Analyst видел или мог видеть vault, sealed outcome, future artifact, AI output, baseline output, simulation trace или запрещённое mapping.
2. Любая unseen attestation не может быть честно установлена в `true`.
3. Реальные operator roles не разделены: analyst совпадает с custodian или adjudicator; custodian совпадает с adjudicator.
4. Binding отсутствует, scope/role ID не совпадает или подпись/witness evidence не определена.
5. Case не находится ровно в `CASE_FROZEN`.
6. Evidence SHA-256 или case/receipt commitment не совпадает.
7. Frozen case manifest, evidence или исходный receipt изменился после preflight.
8. Draft находится внутри case directory или outcome vault.
9. `human_prior.json` уже существует до submit.
10. Существует любой future artifact: `ai_assessment.json`, `fusion_revision.json`, `baseline_forecast.json`, `outcome.json`, `adjudication.json` или `post_outcome_review.json`.
11. Draft не проходит точную schema validation.
12. Submit, atomic freeze, receipt chain или case-specific verify завершился ошибкой.
13. Post-submit phase отличается от `HUMAN_PRIOR_FROZEN` или receipt содержит более двух chain entries.
14. Любой authority flag отличается от:
    - `decision_status=DIAGNOSTIC_ONLY`;
    - `action_code=NO_ACTION`;
    - `execution_permission=HOLD`;
    - `capital_permission=DENY`;
    - `can_trade=false`.
15. Появляется просьба запустить AI, fusion, baseline, reveal, adjudication или scoring в рамках этого батча.

После stop:

- не исправлять frozen artifacts вручную;
- не сбрасывать receipt;
- не продолжать оставшиеся кейсы;
- сохранить доступные pre/post receipts и error output;
- передать инцидент Роберту для отдельного решения.

## 9. Пошаговый чеклист оператора

### Preflight

- [ ] Подтверждён exact batch из пяти development cases.
- [ ] Подтверждены два frozen analyst role IDs.
- [ ] Подготовлены два внешних signed/witnessed bindings.
- [ ] Custodian, analyst и adjudicator реально разделены.
- [ ] У analyst нет vault/future/AI/baseline access.
- [ ] Все пять cases имеют `phase=CASE_FROZEN`.
- [ ] Все пять evidence SHA-256 совпадают с batch manifest.
- [ ] Future artifacts отсутствуют.
- [ ] AnalystWorkRoot находится вне repository cases и vault.
- [ ] Authority boundary неизменна; `can_trade=false`.

### Capture — повторить для каждого case

- [ ] Зафиксирован pre-submit receipt.
- [ ] Создан только blank incomplete draft.
- [ ] Analyst получил только разрешённые inputs.
- [ ] Draft заполнен реальным человеком.
- [ ] Timestamp и обе attestations подтверждены.
- [ ] Labels, probabilities, sum, confidence и abstention logic валидны.
- [ ] Выполнен один submit.
- [ ] Выполнен case-specific verify.
- [ ] Post-receipt имеет `HUMAN_PRIOR_FROZEN`, chain length `2`.
- [ ] Внешний batch receipt дополнен.
- [ ] Нет later-stage artifacts.

### Terminal check

- [ ] Ровно пять cases достигли `HUMAN_PRIOR_FROZEN`.
- [ ] Ни один другой case не изменён.
- [ ] AI/fusion/baseline/reveal/adjudication/scoring не запускались.
- [ ] Official score остаётся unavailable.
- [ ] `DIAGNOSTIC_ONLY / NO_ACTION / HOLD / DENY / can_trade=false`.

## 10. Источники

- [VISIONASSIST_R29_P1_HANDOFF_2026-07-27.md](RESTRICTED_SOURCE_REFERENCE)
- [human-prior-capture.md](RESTRICTED_SOURCE_REFERENCE)
- [human-prior-batch-001.json](RESTRICTED_SOURCE_REFERENCE)
- [operator-binding.example.json](RESTRICTED_SOURCE_REFERENCE)

