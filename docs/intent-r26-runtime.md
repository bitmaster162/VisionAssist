# VisionAssist Intent R26 Runtime

Status: implemented diagnostic module and R29 core-default runtime. Predictive
value and human-AI uplift remain gated by the P1 benchmark.

Portfolio identity:

- current canon: `VISUAL_SEMANTIC_COGNITION_LAYER`,
- runtime role: `CORE_PERCEPTION_RUNTIME`,
- accessibility: separate optional `android-pilot` adapter.

Source contract:

- archive SHA-256: `9963d1172cc37932935a1d5df153c09e1d98521a6fcc935caea214780bf1f3f5`
- canonical contract: `contracts/intent-r26`
- original proof: `10/10` Python tests

## What it does

Intent R26 converts visual evidence plus an optional human prior into a validated record:

```text
image + source identity + human prior
  -> visual observations
  -> at least two competing hypotheses
  -> evidence and counterevidence
  -> uncertainty and alternatives
  -> invalidation conditions
  -> NO_ACTION / HOLD / DENY
```

It is diagnostic cognition, not a trading or execution engine.

## Run

In `services/edge/.env`:

```text
VISIONASSIST_PROFILE=intent-r26
HOST=127.0.0.1
OPENAI_API_KEY=...
OPENAI_INTENT_MODEL=gpt-4o-mini
```

Start from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-intent-r26.ps1
```

Open:

```text
http://127.0.0.1:8787/intent-r26
```

The console accepts an image, source metadata, operator goal, prior, and confidence. It renders observations, competing hypotheses, counterevidence, invalidation conditions, uncertainty, and effect permissions.

Without `OPENAI_API_KEY`, the console and canonical sample validation still
work, while image analysis fails closed with `503`.

## API

### `GET /v1/intent/example`

Returns the canonical example and its validation receipt.

### `POST /v1/intent/validate`

Request:

```json
{
  "record": {
    "schema_version": "visionassist.intent.v1"
  }
}
```

Response for a valid record:

```json
{
  "valid": true,
  "fusion_status": "HUMAN_AI",
  "hypothesis_count": 2,
  "decision_status": "DIAGNOSTIC_ONLY",
  "execution_permission": "HOLD",
  "capital_permission": "DENY",
  "can_trade": false
}
```

Invalid records fail with `422 intent_contract_error`.

### `POST /v1/intent/analyze`

Request:

```json
{
  "image": "BASE64_IMAGE",
  "image_mime_type": "image/png",
  "locale": "ru-RU",
  "source": {
    "source_id": "chart-001",
    "modality": "chart_image",
    "captured_at": "2026-07-27T00:00:00Z"
  },
  "human_context": {
    "present": true,
    "operator_goal": "понять давление без торгового сигнала",
    "operator_prior": "возможный сбор ликвидности",
    "operator_confidence": 0.45,
    "notes_sha256": null
  }
}
```

The model output is passed through the canonical validator. Server-controlled fields overwrite model output:

- `schema_version`
- `module_identity`
- `source`
- `human_context`
- `fusion_status`
- `decision_status=DIAGNOSTIC_ONLY`
- `action_code=NO_ACTION`
- `execution_permission=HOLD`
- `capital_permission=DENY`
- `can_trade=false`

Requests use `store: false`. The edge does not persist images or records.
The default bind address is local-only (`127.0.0.1`). Do not change it to
`0.0.0.0` without adding authentication, HTTPS, request quotas, and an explicit
deployment privacy review.

## Offline CLI

Validate the canonical record:

```powershell
Set-Location .\services\edge
npm run validate:intent
```

Validate another JSON file:

```powershell
node .\tools\validate-intent-record.js C:\path\record.json
```

## Evidence status

Verified:

- canonical archive identity recorded,
- JS validator parity with the supplied Python proof plus strict structural checks,
- valid and invalid contract behavior,
- fail-closed effect permissions,
- `intent-r26` runtime profile,
- API validation smoke test,
- mocked end-to-end Responses request and safety-envelope test,
- Intent Console static delivery,
- Android pilot remains separately gated.

Not yet verified:

- a live OpenAI image analysis with a configured API key,
- the 60-case blinded R26 benchmark,
- calibration or human-AI uplift claims.
