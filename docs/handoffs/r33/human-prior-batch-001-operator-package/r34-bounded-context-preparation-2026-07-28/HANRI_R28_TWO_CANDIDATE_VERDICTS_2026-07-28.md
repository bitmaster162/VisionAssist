# HANRI R28 — verdicts for the two pending candidate IDs

Date: `2026-07-28`  
Mode: `REVIEW_ONLY`  
Self-application: `false`  
`can_trade=false`

## Finding

The two cards are one semantic decision represented by two legacy Candidate
IDs. No materially different evidence or scope is presented for the second
ID. Byte-for-byte equality of the underlying raw per-candidate evidence is not
proven because that individual raw provenance is not exposed in the reviewed
human surfaces.

Evidence:

- the current Drive readback is run
  `20260728T085659Z_d745f170`, modified
  `2026-07-28T08:57:04.751Z`;
- `latest_human_digest.md` gives both IDs the same title, severity, rationale,
  minimal change, executable check and adversarial status;
- `HANRI_DECISIONS_DEDUPED.md` records `raw_cards=2` and
  `unique_decisions=1`;
- the existing Human operator decision receipt binds both IDs to
  `semantic_group_id=hanri:causal_spine_gap:pre_fix`;
- that receipt assigns one canonical candidate and one duplicate-only
  reference;
- the staged closeout work order describes both cards as residual pre-fix
  identities and permits exactly one executable governance change;
- no distinct presented evidence, affected frontier, target component or
  executable scope was found for the second ID.

The different Candidate IDs preserve provenance. They do not establish two
independent confirmations.

Evidence class: `SOURCE_BACKED_CLAIM`  
Freshness: `CURRENT_AS_OF_2026-07-28_DRIVE_READBACK`  
Confidence: `HIGH`

## Verdict 1

Candidate: `C-23d1b14c602d7564762c`  
Verdict: `ACCEPT`  
Role: `CANONICAL_CANDIDATE`

Reason:

The causal-spine rule is material and falsifiable. An archive summary that
jumps from origin directly to current state can erase the correction or pivot
that created the proof-first control. Exactly one canonical decision should
represent that rule.

Minimal change:

1. Register this ID as the single canonical decision unit without creating a
   new patch: the current causal-spine status is already reported complete.
2. Preserve the rule that a causal cycle requires:
   - origin;
   - material correction or pivot;
   - current physical state.
3. When a frontier is genuinely exhausted or unavailable, preserve an
   explicit missing/exhausted status with provenance.
4. Keep the cycle at `CAUSAL_SPINE_INCOMPLETE` while any required frontier is
   neither present nor explicitly exhausted with provenance.

Executable check:

Run four isolated fixtures:

1. origin missing;
2. correction/pivot missing;
3. current state missing;
4. all three frontiers present with provenance.

Fixtures 1–3 must remain `CAUSAL_SPINE_INCOMPLETE`. Fixture 4 may pass this
gate. The semantic group must emit exactly one executable decision, create
zero source/runtime changes and gain no deployment or trading authority.

## Verdict 2

Candidate: `C-537663b99e7ff9c862a5`  
Verdict: `REJECT`  
Role: `DUPLICATE_ONLY`

Reason:

The evidence and scope are the same as the canonical card. Accepting it as a
second decision would permit duplicate patch, receipt or downstream action and
would falsely resemble independent evidence.

Minimal change:

1. Preserve the card for audit.
2. Add `duplicate_of=C-23d1b14c602d7564762c`.
3. Bind it to the same semantic group.
4. Prohibit a separate patch, action or executable receipt.

Executable check:

Regenerate the decision view without applying changes. It must report:

```text
raw_cards=2
unique_decisions=1
executable_decisions=1
duplicate_references=1
```

No downstream plan may contain a second executable action for
`C-537663b99e7ff9c862a5`.

An additional negative control must prove that a genuinely new evidence
identity is not incorrectly suppressed as this stale pre-fix duplicate group.

## Application boundary

These verdicts match the mapping stored in the existing Human operator decision
receipt. The receipt's bytes and content exist, but its captured authorization
phrase `Го оба` does not explicitly name both Candidate IDs and the exact
`ACCEPT`/`REJECT` mapping. Therefore this review does not treat registration
authority as proven and does not register the receipt, modify HANRI, refresh
runtime state or apply a patch.

```text
self_application=false
capital_permission=DENY
can_trade=false
```

## Sources

- [latest_human_digest.md](RESTRICTED_SOURCE_REFERENCE)
- [HANRI_DECISIONS_DEDUPED.md](RESTRICTED_SOURCE_REFERENCE)
- [HANRI_R28_HUMAN_OPERATOR_DECISION_2026-07-28.json](RESTRICTED_SOURCE_REFERENCE)
- [Staged closeout work order](RESTRICTED_SOURCE_REFERENCE)
