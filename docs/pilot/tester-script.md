# VisionAssist Pilot Tester Script

Use this script only for the bounded Android Describe flow.

## Before starting

- Confirm edge is running.
- Confirm `/v1/health` reports `profile: android-pilot`.
- Confirm the app launches on the Android phone.
- Confirm speaker volume is sufficient to hear TTS clearly.
- Confirm the tester knows this is not a navigation tool.
- Confirm the app requested camera permission only.

## Test scenes

Run the scenes in this order.

### Scene 1: simple safe scene

Setup:

- indoor room
- no obvious close hazard
- one or two large objects visible

Action:

- point phone forward
- press `Опиши`

Pass if:

- app speaks a short scene summary
- summary is broadly correct
- no false hazard warning is spoken

### Scene 2: doorway or threshold scene

Setup:

- closed door
- visible threshold, mat, or low obstacle near the door

Action:

- point phone forward
- press `Опиши`

Pass if:

- app identifies the main scene reasonably
- app gives a short warning if hazard confidence is high enough
- warning is understandable and not verbose

### Scene 3: ambiguous scene

Setup:

- dimmer lighting or partially obstructed frame

Action:

- point phone forward
- press `Опиши`

Pass if:

- app does not pretend certainty
- app explicitly signals uncertainty or recommends caution

## Repeatability check

- Repeat Scene 1 five times.
- Count as pass only if the app completes all five runs without code changes or app reinstall.

## Failure conditions

Mark as fail if any of the following occurs:

- camera capture fails
- app crashes or hangs
- no TTS audio is heard
- response is empty
- obvious hazard is missed in the threshold test
- low-confidence scene is described with unjustified certainty
- output is confusing enough that a tester cannot tell what action to take

## After each run

- record one row in the evidence log
- copy the matching `request_id` from the Flutter and edge log lines
- record client and edge latency separately
- note whether output was correct, partly correct, or wrong
- note whether any output felt unsafe or misleading
