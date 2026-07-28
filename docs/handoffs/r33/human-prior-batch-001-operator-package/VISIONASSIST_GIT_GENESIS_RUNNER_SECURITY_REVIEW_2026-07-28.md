# VisionAssist Git genesis runner — security review

Status: `SPECIFICATION_ONLY / NOT_EXECUTED`  
Target: `<VISIONASSIST_REPO_ROOT>`  
Expected pre-state: `master / UNBORN_HEAD_NO_REFS`

## Release boundary

This review covers only:

- `Invoke-VisionAssistGitGenesis.ps1`;
- `Test-VisionAssistGitGenesisReadback.ps1`;
- `VISIONASSIST_GIT_GENESIS_RUNNER_INSTRUCTIONS_2026-07-28.md`.

It supersedes the older inline
`VISIONASSIST_GIT_GENESIS_LOCAL_WORK_ORDER_2026-07-28.md`. The reviewed
package was not run against the target repository because the canonical
Windows project root is unavailable in this environment.

## Closed findings

1. Both scripts require independently supplied frozen SHA-256 values. The
   genesis runner also rechecks its bytes before staging, before commit and
   during final readback.
2. The approved inventory binds every one-handle raw file snapshot to its Git
   blob object ID. Staging stops unless every staged blob ID equals the
   approved raw snapshot's computed object ID.
3. The planned tree is not taken from a later mutable index snapshot. A
   run-scoped external index is reconstructed from the exact canonical staged
   manifest, read back, and used to create the planned tree.
4. The independent verifier rejects receipt-controlled UNC/network, project,
   custody or unexpected evidence paths before opening them.
5. The verifier validates its external output boundary before creating a
   directory and performs a fresh no-transform attribute gate before
   worktree-sensitive Git checks.
6. Inventory/opaque approvals and the approved tree are compared to the
   observed receipt and repository state.
7. The readback JSON is fully written to a temporary external file first.
   HEAD/ref and frozen executable hashes are then rechecked immediately before
   atomic publication.

## Static evidence

- Tree-sitter PowerShell parsing: `0` error nodes for both scripts.
- Git plumbing fixture: `update-index --index-info -z` reconstructed the exact
  `(mode, blob, stage, path)` entry in an external index and `write-tree`
  produced the expected tree from that index.
- Forbidden-action scan: no push, deployment, runtime, benchmark, AI, fusion,
  market-baseline, reveal, adjudication, scoring or trading invocation.
- Independent review verdict: `ACCEPT` for both frozen scripts.

These checks do not replace the mandatory local Windows PowerShell 5.1 parser
gate. Neither script was executed against the target repository here.

## Frozen files

```text
Invoke-VisionAssistGitGenesis.ps1  83abdb644e368d704939d8b053919f04a4fb83b8a3381e869793f53ef00d4592
Test-VisionAssistGitGenesisReadback.ps1  7d934819d0daf13a756c31235c7cccd1ce6d77e250866573c0f2d587ccc0822e
VISIONASSIST_GIT_GENESIS_RUNNER_INSTRUCTIONS_2026-07-28.md  8274b96ed98cf7b87f57b994c53e81b8b90e80a877094e2dca749d6e58495c63
```

## Authority

```text
DIAGNOSTIC_ONLY
NO_ACTION
HOLD / DENY
can_trade=false
```
