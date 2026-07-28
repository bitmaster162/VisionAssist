# VisionAssist Edge

Zero-dependency Node 22 gateway with fail-closed release profiles.

## Core default: `intent-r26`

Enabled:

- `GET /v1/health`
- `GET /intent-r26`
- `GET /v1/intent/example`
- `POST /v1/intent/validate`
- `POST /v1/intent/analyze`

Disabled with `404 capability_disabled`:

- `POST /v1/describe`
- `POST /v1/ocr`
- `POST /v1/realtime/client-secret`
- `POST /v1/realtime-session`

Every response includes `X-Request-Id`. One-shot model requests use
`store:false`.

## Start

```powershell
Copy-Item .env.example .env
node .\src\server.js
```

Keep:

```text
VISIONASSIST_PROFILE=intent-r26
```

## Health contract

`GET /v1/health` returns the active profile, capability flags, and enabled models.

## Optional accessibility adapter

Select the bounded camera-to-voice adapter explicitly:

```text
VISIONASSIST_PROFILE=android-pilot
```

It enables `POST /v1/describe` and disables Intent, OCR, and Realtime.

## Development profile

Prepared Describe, Intent, OCR, and Realtime routes can be enabled together:

```text
VISIONASSIST_PROFILE=product-dev
```

This profile is not part of the bounded Android pilot.

## Intent R26 validation

Validate the canonical record without an API call:

```powershell
npm run validate:intent
```

Intent R26 has no trade, execution, order, broker, position, or capital endpoint.

## Tests

```powershell
npm test
```

The test suite verifies the R29 core default, explicit adapter selection, and
alignment with `docs/contracts/release-profiles.json`.
