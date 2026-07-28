# Run the Optional Android Adapter on One Device

This guide runs only the explicitly selected `android-pilot` accessibility
adapter. The edge repository default is the `intent-r26` core profile.

## 1. Configure edge

```powershell
Copy-Item .\services\edge\.env.example .\services\edge\.env
```

Set `OPENAI_API_KEY` and explicitly select the adapter:

```text
VISIONASSIST_PROFILE=android-pilot
```

Start edge:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-edge.ps1
```

Verify `GET http://127.0.0.1:8787/v1/health` returns:

```json
{
  "ok": true,
  "profile": "android-pilot",
  "capabilities": {
    "describe": true,
    "ocr": false,
    "realtime": false
  }
}
```

## 2. Verify Android tooling

```powershell
flutter --version
flutter doctor
adb devices
```

The physical Android phone must have Developer Options and USB debugging enabled.

## 3. Bootstrap the pilot

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap-mobile.ps1 -Profile android-pilot
Set-Location .\apps\mobile
flutter pub get
```

The pilot bootstrap generates Android only and declares only Internet and camera permissions.

## 4. Connect phone to local edge

```powershell
adb reverse tcp:8787 tcp:8787
```

## 5. Run

```powershell
flutter run `
  --dart-define VISIONASSIST_PROFILE=android-pilot `
  --dart-define VISIONASSIST_EDGE_BASE_URL=http://127.0.0.1:8787
```

Grant camera permission. The pilot should not request microphone or speech-recognition permission.

## 6. Verify the bounded slice

- only `Опиши` is visible,
- one press captures one image,
- summary is spoken,
- likely hazards produce a warning,
- low confidence produces a caution,
- Flutter and edge terminals emit matching `request_id` values,
- no raw image is written to the evidence log.

Use the
[tester script](pilot/tester-script.md)
and
[evidence log](pilot/evidence-log-template.csv).
