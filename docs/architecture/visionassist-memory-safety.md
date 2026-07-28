# VisionAssist Memory and Safety Architecture

Status: future product architecture for the optional accessibility adapter.
Only the Describe safety contract is active when `android-pilot` is explicitly
selected; it is not part of the current R29 core profile.

The canonical profile boundary is
[release-profiles.json](../contracts/release-profiles.json).

## 1. Architectural intent

This document turns the product ideas into implementation boundaries for the current repo.

Current repo mapping:

- `apps/mobile` owns capture, TTS, ASR, local interaction, and later on-device OCR.
- `services/edge` owns cloud VLM calls, OCR fallback, structured response shaping, and Realtime token minting.
- future `memory` and `safety` modules can begin inside `services/edge` and later split out if load or policy complexity grows.

## 2. Safety output contract

`POST /v1/describe` should always return a structured object that can drive voice UX safely.

Required fields:

- `summary`: immediate spoken answer.
- `confidence`: global confidence from `0.0` to `1.0`.
- `follow_up_prompt`: one useful next step.
- `needs_human_review`: explicit escalation bit.
- `hazards`: prioritized hazard list.

Interpretation rules:

- `confidence < 0.55` -> recommend human confirmation.
- any hazard with `conf >= 0.7` -> interrupt normal narration with a warning.
- scene suggests danger, medical risk, payment risk, or identity ambiguity -> `needs_human_review = true`.
- no response should imply exact navigation precision that the system does not have.

## 3. Human-in-the-loop triggers

Human escalation is justified when:

- the model is uncertain and the user may act physically on the answer,
- the user is asking about money, medication, legal paperwork, or identity,
- the scene contains suspicious content such as phishing prompts or fake support screens,
- the system repeatedly fails to classify a critical object,
- the user explicitly asks for a helper or family member.

Future edge endpoint:

```text
POST /v1/hitl/session
```

Suggested payload:

```json
{
  "reason": "low_confidence_scene",
  "scene_summary": "Possibly an open stair edge in front of the user.",
  "confidence": 0.41,
  "user_locale": "ru-RU"
}
```

## 4. Memory model

### 4.1 `VA.HomeMap`

Purpose:

- rough room graph,
- landmark memory,
- repeated hazard memory,
- later SLAM-backed hints.

Proposed shape:

```json
{
  "home_id": "home-default",
  "rooms": [
    {
      "id": "hallway",
      "label": "Коридор",
      "landmarks": ["входная дверь", "полка", "порог"],
      "hazards": ["низкий порог у двери"]
    }
  ],
  "links": [
    {
      "from": "hallway",
      "to": "kitchen",
      "hint": "кухня слева от коридора"
    }
  ]
}
```

### 4.2 `VA.Items`

Purpose:

- teachable object memory for personal belongings,
- repeated product recognition,
- medication and document shortcuts.

Proposed shape:

```json
{
  "item_id": "item-red-mug",
  "label": "Красная кружка",
  "aliases": ["моя кружка", "любимая кружка"],
  "category": "kitchen",
  "last_seen_hint": "на кухонной полке справа",
  "sensitive": false
}
```

### 4.3 `VA.Routines`

Purpose:

- repeated flows such as tea, medication check, leaving home, screen help.

Proposed shape:

```json
{
  "routine_id": "leave-home",
  "label": "Выйти из квартиры",
  "steps": [
    "Проверить ключи",
    "Проверить телефон",
    "Проверить порог у двери"
  ],
  "safety_checks": [
    "не оставлена ли плита включенной"
  ]
}
```

## 5. Scam and suspicious-content safety

Future safety classifier responsibilities:

- mark suspicious URLs, fake support numbers, payment urgency language, or login prompts,
- warn when OCR extracts credential requests,
- never read highly sensitive credentials aloud by default,
- prefer "проверь на официальном сайте" over any direct risky instruction.

Future endpoint:

```text
POST /v1/safety/analyze
```

## 6. Edge vs on-device split

On-device first:

- camera preview,
- voice input,
- system TTS,
- later native OCR and basic obstacle heuristics,
- local caches and private memory if possible.

Edge:

- heavy VLM scene interpretation,
- cloud OCR fallback,
- structured safety shaping,
- Realtime token minting,
- later HITL brokerage and sync.

This split preserves speed and privacy while keeping the current repo implementable.

## 7. Privacy defaults

- no intentional raw image persistence by app or edge,
- no intentional raw audio persistence by app or edge,
- cloud retention controls must be disclosed and verified separately,
- explicit consent before saving known faces or sensitive objects,
- wipeable local buffers,
- clear user controls for memory deletion and sync,
- institution mode should support auditable privacy logs without storing raw media.

## 8. Accessibility requirements

- large tap targets,
- screen-reader labels for every control,
- audio plus haptic status feedback,
- concise corrective messages,
- calm but clearly distinct urgent warnings,
- support for system accessibility services on iOS and Android.

## 9. Technical decisions to preserve

- structured outputs instead of free-form prose,
- confidence surfaced all the way to the client,
- one follow-up prompt instead of verbose descriptions,
- human review as a first-class outcome,
- memory as optional, explicit, privacy-bounded enrichment.
