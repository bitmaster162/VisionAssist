# VisionAssist Bounded MVP Pack

Status: preserved bounded MVP for the optional Stage 1 accessibility adapter.
It is not the current core P1. The current primary gate is the Chart Intent and
Human-AI Fusion benchmark defined by Lineage R29.

## 1. Exact MVP problem statement

VisionAssist MVP solves one narrow problem:

> A blind or low-vision user can point a phone camera at the space directly ahead, press one large button, and hear a short, safe spoken description of what is in front of them, including an explicit warning if the model detects a likely nearby hazard or if confidence is low.

Boundaries:

- single-device mobile flow,
- single primary task: scene description,
- Russian-first voice output,
- indoor or simple static scenes only,
- no claim of navigation precision,
- no persistent memory required.

## 2. One primary user flow

### Flow: "Что передо мной?"

1. User opens the app.
2. User points the rear camera at the area in front of them.
3. User presses the single large `Опиши` button.
4. App captures one still image.
5. Image is sent to `POST /v1/describe`.
6. Edge returns:
   - `summary`
   - `confidence`
   - `follow_up_prompt`
   - `needs_human_review`
   - `hazards`
7. App speaks the `summary`.
8. If any hazard has `conf >= 0.7`, app interrupts with a short warning.
9. If `needs_human_review = true`, app explicitly says confidence is insufficient for a safety-critical decision.

This is the only flow that needs to work for the MVP.

## 3. What already exists in docs/code

### In docs

- Unified operating model and evidence gates: [docs/visionassist-operating-model.md](visionassist-operating-model.md)
- Machine-readable release profiles: [docs/contracts/release-profiles.json](contracts/release-profiles.json)
- Product scope and safety framing: [docs/segmentbook-visionassist-v1.md](segmentbook-visionassist-v1.md)
- Memory and safety architecture: [docs/architecture/visionassist-memory-safety.md](architecture/visionassist-memory-safety.md)
- MVP roadmap: [docs/mvp-backlog.md](mvp-backlog.md)
- Device run notes: [docs/run-on-device.md](run-on-device.md)

### In code

- Edge service with Describe enabled and prepared OCR/Realtime routes disabled by the pilot profile:
  [services/edge/src/server.js](../services/edge/src/server.js)
- Fail-closed runtime capability profiles:
  [services/edge/src/capabilities.js](../services/edge/src/capabilities.js)
- Structured scene response contract with `confidence`, `follow_up_prompt`, and `needs_human_review`:
  [services/edge/src/schema.js](../services/edge/src/schema.js)
- OpenAI response shaping for scene description:
  [services/edge/src/openai.js](../services/edge/src/openai.js)
- Mobile home screen defaulting to one visible `Опиши` action:
  [apps/mobile/lib/features/home/home_screen.dart](../apps/mobile/lib/features/home/home_screen.dart)
- Mobile models for scene and OCR payloads:
  [apps/mobile/lib/models/vision_models.dart](../apps/mobile/lib/models/vision_models.dart)
- TTS queueing:
  [apps/mobile/lib/services/narrator_service.dart](../apps/mobile/lib/services/narrator_service.dart)
- Edge API client:
  [apps/mobile/lib/services/vision_api.dart](../apps/mobile/lib/services/vision_api.dart)
- Correlated request ID plus bounded edge/mobile latency and error logs.
- Tester script, evidence template, and privacy note.

## 4. What is missing

- Flutter SDK is not installed in the current environment, so the mobile app is not compiled yet.
- Native Android folders still need bootstrapping through Flutter.
- No verified end-to-end device run has been recorded for the current mobile shell.
- No pilot-ready Android build artifact exists yet.
- No earcons/haptics are implemented yet.
- No explicit capture-quality guidance exists yet for failed scene captures.
- No user test results exist yet.

## 5. One technical slice to build first

Build this first:

> End-to-end Android `Опиши` slice: camera capture -> `/v1/describe` -> TTS summary -> hazard warning -> low-confidence warning.

Reason:

- It matches the narrowest useful product outcome.
- The current codebase is already closest to this slice.
- It proves the core value without dragging OCR, memory, Realtime, or SLAM into the first pilot.
- It is the fastest path to a credible demo on a real phone.

Definition of done:

- Runs on one Android device.
- User can launch app and press `Опиши`.
- Spoken response returns in a reasonable demo window.
- Hazard warning interrupts normal narration.
- Low confidence is surfaced explicitly.

## 6. One demo scenario

### Demo: doorway in an apartment

Setup:

- User stands in a hallway.
- Camera points at a closed door with a visible low threshold or mat.

Expected behavior:

1. User presses `Опиши`.
2. App says something like: "Перед вами дверь."
3. If hazard is detected, app adds: "Внимание. Низкий порог прямо перед вами."
4. If confidence is low, app says it is not fully certain and recommends checking with a person nearby for safety.

Why this scenario:

- simple and repeatable,
- indoor lighting is controllable,
- easy to verify correctness,
- demonstrates both description and safety behavior.

## 7. One proof-pack checklist for a pilot

The MVP is pilot-ready only if this checklist is complete:

- One target device is selected and documented.
- Edge service runs with production-like config from `.env`.
- Mobile app installs and launches on the target device.
- `Опиши` flow works five times in a row without manual code changes.
- At least one safe scene and one hazard scene are demonstrated.
- Low-confidence wording is verified in at least one ambiguous scene.
- App, edge, and pilot records do not intentionally persist raw media.
- Provider processing and retention limits are disclosed to the tester.
- A one-page tester script exists with:
  - start steps
  - test scene list
  - what counts as pass/fail
- A one-page privacy note exists for pilot participants.
- A simple evidence log exists:
  - date
  - device
  - scene
  - response time
  - correct / partly correct / wrong
  - any unsafe or confusing output

## 8. What must be explicitly excluded from MVP

- OCR as a primary promise
- screen-reading mode
- button-finding or interface guidance
- HomeMap, Items, Routines, or any persistent memory
- face recognition or person identification
- suspicious-content or scam detection
- family access or human escalation workflow implementation
- Realtime voice session
- SLAM, routing, or navigation claims
- outdoor mobility guidance beyond very simple descriptive warnings
- offline-first guarantees
- premium tiers, billing, or monetization mechanics
- chart-intent, market reasoning, trading diagnostics, or human-AI fusion benchmarks

If any of the above is added, scope is no longer bounded.
