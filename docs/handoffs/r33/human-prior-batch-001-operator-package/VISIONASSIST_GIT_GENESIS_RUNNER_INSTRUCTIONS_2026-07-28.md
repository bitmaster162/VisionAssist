# VisionAssist Git genesis runner

Status: `REQUIRES_WINDOWS_POWERSHELL_5_1_PARSER_GATE_BEFORE_EXECUTION`  
Target: `<VISIONASSIST_REPO_ROOT>`  
Runner: `Invoke-VisionAssistGitGenesis.ps1`  
Read-only verifier: `Test-VisionAssistGitGenesisReadback.ps1`

This runner package supersedes
`VISIONASSIST_GIT_GENESIS_LOCAL_WORK_ORDER_2026-07-28.md` and
`VISIONASSIST_GIT_GENESIS_OPERATOR_PACKAGE_MANIFEST_2026-07-28.json`.
Do not execute the older inline `git add` / `git commit` work order.

Download both scripts into a trusted local directory outside the VisionAssist
project root and outside a cloud-synced/reparse-point path. Do not edit them
between phases.

## Phase 0 — Windows PowerShell 5.1 parser gate

Run this in `powershell.exe` 5.1, not PowerShell 7:

```powershell
if (
  $PSVersionTable.PSVersion.Major -ne 5 -or
  $PSVersionTable.PSVersion.Minor -lt 1
) {
  throw 'STOP: Windows PowerShell 5.1 is required for the release gate'
}

$expectedSha256 = @{
  '.\Invoke-VisionAssistGitGenesis.ps1' = '83abdb644e368d704939d8b053919f04a4fb83b8a3381e869793f53ef00d4592'
  '.\Test-VisionAssistGitGenesisReadback.ps1' = '7d934819d0daf13a756c31235c7cccd1ce6d77e250866573c0f2d587ccc0822e'
}

foreach ($script in $expectedSha256.Keys) {
  $actualSha256 = (
    Get-FileHash -LiteralPath $script -Algorithm SHA256
  ).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $expectedSha256[$script]) {
    throw "STOP: frozen SHA-256 mismatch for $script"
  }

  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    (Resolve-Path $script),
    [ref]$tokens,
    [ref]$errors
  ) | Out-Null
  if ($errors.Count -ne 0) {
    $errors | Format-List
    throw "STOP: parser errors in $script"
  }
}
```

Stop on any parser error. This package was statically reviewed in a Linux
workspace, but neither script was parsed or executed under Windows PowerShell
5.1 here.

## Phase 1 — Prepare

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\Invoke-VisionAssistGitGenesis.ps1 `
  -ExpectedRunnerSha256 83abdb644e368d704939d8b053919f04a4fb83b8a3381e869793f53ef00d4592 `
  -Mode Prepare
```

This phase:

- verifies the exact root, `refs/heads/master`, unborn `HEAD`, Git identity and repository boundaries;
- appends the exact final safety block to `.gitignore` when absent;
- does not stage or commit;
- writes an external readable inventory and its canonical SHA-256 under `%TEMP%\VisionAssistGitGenesis`.

Review the printed inventory. Stop if any file is unrelated, private,
generated, or unexpected. Do not inspect `cases/` or `outcome-vault/`.

If Phase 1 reports opaque binaries, review only their approved non-custody
source and purpose, then retain the exact `OPAQUE_SHA256`. Hash approval proves
byte equality, not that the verifier understood opaque content. The runner
still applies its ASCII secret-signature scan to every candidate byte stream.
If safe human review is not possible, stop. Omit the opaque parameter only
when the reported opaque count is zero.

## Phase 2 — Stage

Use only the exact inventory hash printed by Phase 1:

```powershell
powershell -ExecutionPolicy Bypass -File .\Invoke-VisionAssistGitGenesis.ps1 `
  -ExpectedRunnerSha256 83abdb644e368d704939d8b053919f04a4fb83b8a3381e869793f53ef00d4592 `
  -Mode Stage `
  -ApproveInventorySha256 <INVENTORY_SHA256> `
  -ApproveOpaqueInventorySha256 <OPAQUE_SHA256>
```

When the opaque count is zero, remove the final
`-ApproveOpaqueInventorySha256` line.

This phase:

- stages only the approved NUL-delimited pathspec;
- disables fsmonitor and runner-relevant hooks for mutations;
- stops on any content-transform attribute, unsafe mode, path drift, byte
  drift, secret-pattern hit or staged-scope mismatch;
- computes each approved raw snapshot's Git blob ID and requires it to equal
  the staged blob ID;
- reconstructs an external run-scoped index from the exact staged manifest,
  requires its manifest readback to match, and derives the planned tree only
  from that external index;
- writes a staging receipt with the exact manifest-bound planned tree SHA;
- does not create a commit or branch ref. As with normal Git staging, approved
  blobs/tree objects may already exist in `.git/objects`.

Review the printed staged-manifest TSV as well as the staging receipt. Confirm
every `(mode, blob ID, path)` row is in scope, then retain the exact
`planned_tree_sha`.

## Phase 3 — Commit

Use the same inventory hash and the exact tree hash printed by Phase 2:

```powershell
powershell -ExecutionPolicy Bypass -File .\Invoke-VisionAssistGitGenesis.ps1 `
  -ExpectedRunnerSha256 83abdb644e368d704939d8b053919f04a4fb83b8a3381e869793f53ef00d4592 `
  -Mode Commit `
  -ApproveInventorySha256 <INVENTORY_SHA256> `
  -ApproveOpaqueInventorySha256 <OPAQUE_SHA256> `
  -ApproveTreeSha <PLANNED_TREE_SHA>
```

When the opaque count is zero, remove the
`-ApproveOpaqueInventorySha256` line.

This phase creates a root commit object from the exact approved tree, with no
parent argument, then conditionally installs `refs/heads/master` only if that
ref is still missing. It does not let a moving index choose the committed tree.
It then reads back:

- exact `HEAD` and tree object types;
- `parent_count=0`;
- exact raw commit message body;
- exact `refs/heads/master`;
- committed path set equal to staged path set;
- final worktree status `CLEAN`.

The runner contains no push, deployment, runtime, benchmark, custody, AI, fusion, market-baseline, reveal, adjudication, scoring or trading command.

## Phase 4 — separate read-only readback

Use the exact receipt path and SHA-256 printed by Phase 3:

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\Test-VisionAssistGitGenesisReadback.ps1 `
  -ReceiptPath '<FULL_RECEIPT_PATH>' `
  -ExpectedReceiptSha256 <RECEIPT_SHA256> `
  -ExpectedGenesisRunnerSha256 83abdb644e368d704939d8b053919f04a4fb83b8a3381e869793f53ef00d4592 `
  -ExpectedReadbackRunnerSha256 7d934819d0daf13a756c31235c7cccd1ce6d77e250866573c0f2d587ccc0822e
```

Do not move, edit, or clean the `%TEMP%\VisionAssistGitGenesis` evidence files
between Commit and readback; the verifier binds the canonical staged manifest
referenced by the source receipt.

The verifier performs no repository mutation. It binds the source
receipt/sidecar, exact root/ref/HEAD/tree, raw zero-parent commit, reconstructed
tree and index manifests, approval equality, committed and worktree
`.gitignore`, a fresh no-transform attribute gate, tracked and untracked
cleanliness, and final HEAD stability. It writes the candidate JSON to an
external temporary file, rechecks HEAD/ref and both frozen script hashes, then
atomically publishes a separate unsigned readback receipt under
`%TEMP%\VisionAssistGitGenesisReadback`.

Return both receipt pairs:

- `VISIONASSIST_GIT_BASELINE_RECEIPT_*.json` plus `.sha256`;
- `VISIONASSIST_GIT_BASELINE_READBACK_*.json` plus `.sha256`.

## Stop and recovery rules

- On any `STOP ...` before commit: do not improvise and do not run Commit.
- If a later run reports `HEAD_ALREADY_EXISTS` or `RECONCILE_EXISTING_HEAD_BEFORE_RETRY`: do not amend, reset, recommit or push. Preserve the repository and request readback/reconciliation.
- If `COMMIT_CREATED_POSTCHECK_FAILED` appears: the Git effect may already exist. Do not retry Commit.
- If `COMMIT_OBJECT_CREATED_REF_NOT_INSTALLED` appears, a dangling object may
  exist but no runner-installed branch ref was recorded. Do not prune, retry,
  reset, or install the ref manually; request reconciliation.
- If the read-only verifier stops, preserve both the repository and source
  receipt. Do not rerun Commit.

Both generated receipts are local unsigned reports, not proof of an independent
human identity. Until the separate readback is externally accepted:

```text
DIAGNOSTIC_ONLY
domain NO_ACTION
HOLD / DENY
can_trade=false
```
