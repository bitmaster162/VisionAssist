# VisionAssist Optional Android Adapter Pilot Readiness Pass

Portfolio status: parked Stage 1 accessibility adapter evidence. This pilot
does not control the current VisionAssist identity or qualify the R29 core.

Profile: `android-pilot`

Only this flow is admitted:

```text
camera capture -> /v1/describe -> TTS summary
               -> hazard warning -> low-confidence warning
```

## 1. Exact setup

Prerequisites:

- Windows development machine,
- Node 18+,
- Flutter SDK,
- Android SDK and `adb`,
- one physical Android phone with USB debugging,
- OpenAI API key on edge only.

From the repository root:

```powershell
Copy-Item .\services\edge\.env.example .\services\edge\.env
```

Set `OPENAI_API_KEY` and explicitly set
`VISIONASSIST_PROFILE=android-pilot`.

Start edge:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-edge.ps1
```

Verify health:

```text
GET http://127.0.0.1:8787/v1/health
profile = android-pilot
capabilities.describe = true
capabilities.ocr = false
capabilities.realtime = false
```

Prepare Android:

```powershell
flutter --version
flutter doctor
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-mobile.ps1 -Profile android-pilot
Set-Location .\apps\mobile
flutter pub get
adb devices
adb reverse tcp:8787 tcp:8787
```

Run:

```powershell
flutter run `
  --dart-define VISIONASSIST_PROFILE=android-pilot `
  --dart-define VISIONASSIST_EDGE_BASE_URL=http://127.0.0.1:8787
```

Grant camera permission only. Point at a simple indoor scene and press `Опиши`.

## 2. Already pilot-ready in code

- `android-pilot` is the fail-closed default on edge and mobile.
- Edge exposes health and Describe while rejecting OCR and Realtime.
- The Describe response contains summary, confidence, human-review flag, and hazards.
- Mobile shows one primary action and requests only camera permission.
- TTS summary, hazard warning, and low-confidence warning are implemented.
- Edge and mobile logs include the same `X-Request-Id`.
- Logs contain latency, status, hazard count, review flag, and error only.
- Tester script, evidence CSV, and privacy note exist.

## 3. Real-device blockers

- Flutter and Android SDK availability must be verified on this machine.
- Android native folders must be generated.
- No physical-device build or install is recorded.
- No five-run repeatability evidence is recorded.
- No safe/hazard/ambiguous scene evidence is recorded.

Prepared source is not device proof.

## 4. Tester script

Use
[tester-script.md](tester-script.md).

It covers:

- safe room,
- doorway or low threshold,
- ambiguous/dim scene,
- five-run repeatability,
- explicit unsafe-output failure conditions.

## 5. Evidence log

Use
[evidence-log-template.csv](evidence-log-template.csv).

The operator correlates Flutter and edge logs using `request_id` and records client latency separately from edge latency.

## 6. Privacy note

Use
[privacy-note.md](privacy-note.md).

The pilot stores no raw image in its evidence pack, requests no microphone permission, and excludes sensitive scenes.

## 7. Minimal instrumentation

Mobile JSON line:

```json
{
  "event": "describe_pilot_mobile",
  "profile": "android-pilot",
  "request_id": "uuid",
  "latency_ms": 1400,
  "status_code": 200,
  "hazards_count": 1,
  "needs_human_review": false,
  "error": null
}
```

Edge JSON line:

```json
{
  "event": "describe_pilot",
  "profile": "android-pilot",
  "request_id": "uuid",
  "latency_ms": 1100,
  "status_code": 200,
  "hazards_count": 1,
  "needs_human_review": false,
  "error": null
}
```

No analytics service, user identity, cross-session telemetry, or media retention is added.

## 8. Single safest next implementation step

Bootstrap `android-pilot`, build it on one physical Android phone, and complete the first correlated Describe run.

This closes the only meaningful readiness gap without admitting another capability.
