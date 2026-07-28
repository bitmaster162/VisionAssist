# VisionAssist Mobile

Flutter client for the optional Stage 1 accessibility adapter.

## Adapter default: `android-pilot`

The mobile build defaults to `android-pilot`; the repository and edge core
default to `intent-r26`. The adapter build exposes only:

- rear-camera preview,
- one large `Опиши` action,
- `/v1/describe`,
- system TTS,
- hazard warning,
- low-confidence warning,
- non-media pilot log lines.

It requests camera permission only. OCR, microphone access, voice commands, and Repeat are disabled.

## Bootstrap and run

```powershell
powershell -ExecutionPolicy Bypass -File ..\..\scripts\bootstrap-mobile.ps1
flutter pub get
adb reverse tcp:8787 tcp:8787
flutter run --dart-define VISIONASSIST_PROFILE=android-pilot --dart-define VISIONASSIST_EDGE_BASE_URL=http://127.0.0.1:8787
```

## Development profile

The existing experimental controls can be exposed only through explicit defines:

```powershell
flutter run `
  --dart-define VISIONASSIST_PROFILE=product-dev `
  --dart-define VISIONASSIST_ENABLE_OCR=true `
  --dart-define VISIONASSIST_ENABLE_VOICE_COMMANDS=true `
  --dart-define VISIONASSIST_ENABLE_REPEAT=true
```

`product-dev` output is not Android pilot evidence.
