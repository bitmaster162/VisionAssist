# VisionAssist Pilot Privacy Note

This pilot is limited to one bounded app behavior:

- capture one image from the phone camera
- send it to the VisionAssist edge service for scene description
- speak back a short result

For this pilot:

- the app is not intended to identify strangers
- the app is not intended to provide navigation guarantees
- the pilot build requests camera permission only
- microphone, speech recognition, OCR, memory, and Realtime are disabled
- the app and edge do not intentionally persist the captured image
- the image is sent to the configured OpenAI Responses API with `store: false`
- `store: false` disables Responses application-state storage, but it is not a Zero Data Retention guarantee
- OpenAI abuse-monitoring retention may still apply according to the API project policy
- pixel-level face blurring is not implemented in this pilot
- test participants should avoid capturing unnecessary personal or sensitive material

Pilot participants should be told:

- this is an experimental assistive prototype
- outputs may be wrong or uncertain
- the app must not be used as the only safety tool for mobility
- if the output affects safety, the user should confirm with a trusted person or another mobility aid

Operational privacy rules for the pilot:

- do not retain test photos unless a participant explicitly agrees
- do not describe the pilot as face-blurring or fully local
- do not collect names, faces, passwords, payment details, or unrelated personal documents as pilot material
- record only the minimum pilot evidence needed:
  - request ID
  - scene type
  - client and edge latency
  - correctness
  - whether the output was unsafe or confusing

If a tester accidentally captures sensitive content:

- stop the run
- do not reuse the image
- do not place the image in pilot records
- log only that the run was excluded for privacy reasons

Current provider data-control reference:

- https://developers.openai.com/api/docs/guides/your-data#default-usage-policies-by-endpoint
