# SegmentBook VisionAssist v1

Status: Stage 1 assistive product shell and optional accessibility-adapter
north star. It is preserved lineage, not the current VisionAssist identity or
primary evidence gate.

Canonical delivery boundaries are defined in
[visionassist-operating-model.md](visionassist-operating-model.md)
and
[contracts/release-profiles.json](contracts/release-profiles.json).

The mobile adapter defaults to `android-pilot` and implements only the Describe
flow. The repository core defaults to `intent-r26` under the R29 lineage
contract. Capabilities below apply only to a future accessibility product and
are admitted one at a time after separate adapter evidence.

## 1. Accessibility adapter purpose

The optional VisionAssist mobile adapter serves blind and low-vision users. It acts as:

- eyes: camera-driven perception of the scene, text, and interfaces,
- voice: calm spoken guidance with minimal friction,
- meaning filter: only the most relevant information first,
- safety layer: the system prefers uncertainty over dangerous confidence.

Core goals:

- give quick, useful understanding of the environment,
- reduce overload by speaking only what matters,
- learn the user's space, objects, and routines over time,
- keep base accessibility open while monetizing added comfort and collaboration.

## 2. Primary users

- Blind and low-vision users at home, outdoors, in stores, and in front of screens.
- Elderly users and people under cognitive load who need text reading or interface explanation.
- Family members or assistants who need a structured, safer way to help remotely.

## 3. Product principles

- Safety first, then convenience.
- Short summary first, details only on demand.
- One hand, no visual targeting, low cognitive load.
- No fabricated certainty.
- No face recognition by default.
- No hidden storage of photos or audio.
- Human escalation is a feature, not a failure.

## 4. Core capabilities

### 4.1 Scene understanding

- "What is in front of me?"
- Identify key objects and rough relative positions.
- Warn only about meaningful hazards.
- Offer one follow-up prompt instead of a verbose monologue.

### 4.2 Text reading

- OCR for labels, medicine, receipts, signage, and screens.
- Summarize the important parts first: name, dosage, warning, expiration, price, due date.
- Guide the user while aligning the camera.

### 4.3 Interface guidance

- Find a named button or UI element.
- Describe location in simple spatial terms.
- Guide the finger step by step.
- Confirm whether the user is on the right target.

### 4.4 Hazard awareness

- Warn about stairs, thresholds, open doors, vehicles, curbs, and close obstacles.
- Never position the app as a full navigation replacement for a cane, guide dog, or trained helper.

### 4.5 Personal memory

- Remember spaces, objects, routines, and user preferences.
- Help with recurring tasks such as leaving the house, making tea, or checking medicine.

### 4.6 Scam and suspicious-content awareness

- Warn about phishing-like screens, suspicious payment requests, fake support prompts, and risky URLs.
- Never push the user toward questionable services or unverified actions.

## 5. Interaction model

Inputs:

- back camera,
- microphone,
- one large primary button,
- long-press and a minimal set of hardware-safe commands.

Outputs:

- system TTS,
- short text for low-vision users,
- simple correction prompts,
- earcons and haptics for state changes,
- optional human escalation.

Response style:

- important first,
- neutral language,
- short sentences,
- calm warnings,
- explicit uncertainty when confidence is low.

## 6. Safety contract

The assistant must:

- avoid risky instructions when confidence is low,
- recommend human confirmation for ambiguous or high-risk situations,
- separate routine information from urgent warnings,
- refuse dangerous certainty in navigation, medicine, payments, or identity claims,
- preserve privacy by default.

The assistant must not:

- invent emotions, intentions, or identities,
- claim GPS-grade or SLAM-grade precision before it exists,
- expose strangers' private information,
- store raw media without explicit consent.

## 7. Product modules

- `VA.MobileClient`: camera, mic, controls, TTS, voice commands, haptics.
- `VA.Backend.Core`: OCR, VLM orchestration, response shaping, confidence handling.
- `VA.UserMemory`: `HomeMap`, `Items`, `Routines`, preferences, and privacy-aware history.
- `VA.SafetyFilter`: hazardous-action prevention, scam checks, confidence gates.
- `VA.VoiceLayer`: speech style, pacing, urgency control, repeat behavior.
- `VA.HITL`: human-in-the-loop escalation for low-confidence or critical scenarios.

## 8. Integration with GPT-S:CORE

VisionAssist can stay a distinct product while reusing cross-system ideas:

- `CORE`: reasoning and dialogue.
- `MEMORY`: user-specific recall with privacy boundaries.
- `VIRUS` or attention logic: focus only on salient parts of the scene.
- `SCAMHUNTER`: suspicious-content warnings and safer browsing guidance.
- `TRADING` risk philosophy: protection first, convenience second.

## 9. Strategic differentiators

Compared with existing assistive products, VisionAssist should differentiate through:

- low-latency edge-first perception,
- stronger privacy defaults,
- integrated memory for home, objects, and routines,
- structured safety outputs with confidence and human-review flags,
- future SLAM and predictive indoor/outdoor guidance,
- family and caregiver support without turning the product into a surveillance tool.

## 10. Monetization stance

Base accessibility should stay free or institutionally covered.

Paid layers can include:

- premium voices and speed profiles,
- more languages,
- synced memories across devices,
- family collaboration,
- higher-end cloud reasoning for difficult scenes,
- institution-ready deployment and compliance tooling.

This keeps monetization additive instead of gating core dignity.

## 11. Out of scope for v1

- unrestricted stranger face identification,
- emotionally speculative descriptions,
- autonomous safety-critical navigation promises,
- hidden background recording,
- premium-only access to essential accessibility functions.
