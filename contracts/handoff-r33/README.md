# VisionAssist R33 Handoff Intake Contract

This contract binds the R33 intake to the exact frozen R29 P1 handoff while
preserving its evidence ceiling.

It proves:

- the declared `5640`-byte handoff and SHA-256 match the repository file,
- the two intake sources are preserved or reversibly newline-normalized,
- JSON and Markdown intake records agree,
- the observed Git repository had no `HEAD` or tree at intake,
- no custody, human annotation, score, execution, or capital authority is
  promoted by intake.

Run:

```powershell
node --test .\contracts\handoff-r33\test\handoff.test.mjs
```
