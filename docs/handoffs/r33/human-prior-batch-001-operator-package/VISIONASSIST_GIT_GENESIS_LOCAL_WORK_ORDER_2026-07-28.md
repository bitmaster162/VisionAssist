# VisionAssist — local Git genesis work order

Status: `READY_FOR_LOCAL_EXECUTION`  
Target: `<VISIONASSIST_REPO_ROOT>`  
Expected pre-state: `master / UNBORN_NO_COMMITS / HEAD unavailable`  
Execution boundary: Git baseline only; no push, deployment, runtime or benchmark-stage execution.

## 1. Role boundary

Run through a local Git operator. The operator must not open or scan:

```text
benchmarks/chart-intent-r26/cases/
benchmarks/chart-intent-r26/outcome-vault/
```

This work order does not authorize `verify-custody`, `verify-p1.ps1`, AI, fusion, candlestick baseline, reveal, adjudication or scoring. Custody verification remains a separate custodian action and must not be performed by Human operator in the analyst role.

## 2. Fail-closed preflight

Open PowerShell and run:

```powershell
$ProjectRoot = '<VISIONASSIST_REPO_ROOT>'
$ResolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot -ErrorAction Stop).Path
Set-Location -LiteralPath $ResolvedRoot

$GitRoot = (git rev-parse --show-toplevel 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $GitRoot -ne $ResolvedRoot) {
  throw "STOP ROOT_MISMATCH: expected=$ResolvedRoot observed=$GitRoot"
}

$Branch = (git symbolic-ref --short HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $Branch -ne 'master') {
  throw "STOP BRANCH_MISMATCH: expected=master observed=$Branch"
}

git rev-parse --verify HEAD 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  throw 'STOP HEAD_ALREADY_EXISTS: re-audit as an existing repository'
}
```

Stop if the exact root or branch differs, `.git` is absent/corrupt, or a HEAD has appeared since R33.

## 3. Required `.gitignore` boundary

Preserve existing rules and ensure this bounded block exists before inventory:

```gitignore
# BEGIN VISIONASSIST_GENESIS_SAFETY
.env
.env.*
!.env.example
secrets/
**/secrets/
benchmarks/chart-intent-r26/cases/
benchmarks/chart-intent-r26/outcome-vault/
node_modules/
**/node_modules/
.venv/
**/.venv/
__pycache__/
**/__pycache__/
dist/
**/dist/
build/
**/build/
coverage/
**/coverage/
*.log
*.db
*.sqlite
*.sqlite3
*.dump
*.pem
*.key
*.p12
*.pfx
id_rsa
id_rsa.*
id_ed25519
id_ed25519.*
.codex/
.gemini/
.claude/
.cursor/
# END VISIONASSIST_GENESIS_SAFETY
```

Do not replace unrelated `.gitignore` content.

Confirm only the custody directory paths are ignored; do not enumerate their contents:

```powershell
git check-ignore -q -- 'benchmarks/chart-intent-r26/cases/'
if ($LASTEXITCODE -ne 0) { throw 'STOP CASES_NOT_IGNORED' }

git check-ignore -q -- 'benchmarks/chart-intent-r26/outcome-vault/'
if ($LASTEXITCODE -ne 0) { throw 'STOP OUTCOME_VAULT_NOT_IGNORED' }
```

## 4. Candidate inventory and secret stop

Build an external inventory without reading ignored trees:

```powershell
$Candidates = @(
  git ls-files
  git ls-files --others --exclude-standard
) | Where-Object { $_ } | Sort-Object -Unique

$CustodyPattern = '^benchmarks/chart-intent-r26/(cases|outcome-vault)/'
$BlockedPathPattern = '(?i)(^|/)(\.env($|\.)|secrets?)(/|$)|(^|/)(id_rsa|id_ed25519)(\.|$)|\.(pem|key|p12|pfx|kdbx|db|sqlite3?|dump)$'

$BlockedPaths = @($Candidates | Where-Object {
  $_ -match $CustodyPattern -or
  (($_ -match $BlockedPathPattern) -and ($_ -notmatch '(?i)(^|/)\.env\.example$'))
})
if ($BlockedPaths.Count -gt 0) {
  $BlockedPaths
  throw 'STOP BLOCKED_PATH_IN_CANDIDATE_SET'
}

$SecretPattern = '(?i)(-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]+|"(api[_-]?key|secret|token|password|private[_-]?key)"\s*:\s*"[^"]{8,}")'
$SecretHits = @(
  foreach ($RelativePath in $Candidates) {
    $FullPath = Join-Path $ResolvedRoot $RelativePath
    if ((Test-Path -LiteralPath $FullPath -PathType Leaf) -and
        (Select-String -LiteralPath $FullPath -Pattern $SecretPattern -Quiet -ErrorAction SilentlyContinue)) {
      $RelativePath
    }
  }
)
if ($SecretHits.Count -gt 0) {
  $SecretHits
  throw 'STOP POSSIBLE_SECRET_CONTENT: review without printing values'
}

$InventoryPath = Join-Path $env:TEMP 'VISIONASSIST_GENESIS_CANDIDATES.txt'
$Candidates | Set-Content -LiteralPath $InventoryPath -Encoding utf8
$InventorySha256 = (Get-FileHash -LiteralPath $InventoryPath -Algorithm SHA256).Hash.ToLowerInvariant()
$InventorySha256
```

The local operator must review this exact inventory. Do not commit unrelated archives, dumps, credentials, private operator material or generated custody artifacts merely to obtain a baseline.

## 5. Stage and commit

Proceed only after the inventory is accepted:

```powershell
git add --all
if ($LASTEXITCODE -ne 0) { throw 'STOP GIT_ADD_FAILED' }

$Staged = @(git diff --cached --name-only --diff-filter=ACMR)
$StageBlocked = @($Staged | Where-Object {
  $_ -match $CustodyPattern -or
  (($_ -match $BlockedPathPattern) -and ($_ -notmatch '(?i)(^|/)\.env\.example$'))
})
if ($StageBlocked.Count -gt 0) {
  $StageBlocked
  throw 'STOP BLOCKED_PATH_STAGED: do not commit'
}

$GitName = (git config --get user.name 2>$null)
$GitEmail = (git config --get user.email 2>$null)
if (-not $GitName -or -not $GitEmail) {
  throw 'STOP GIT_IDENTITY_MISSING: do not invent an identity'
}

git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'STOP STAGED_DIFF_CHECK_FAILED' }

git commit -m 'chore: establish VisionAssist genesis baseline'
if ($LASTEXITCODE -ne 0) { throw 'STOP GENESIS_COMMIT_FAILED' }
```

No `git push` is authorized.

## 6. Required readback

```powershell
$HeadSha = (git rev-parse HEAD).Trim().ToLowerInvariant()
$TreeSha = (git rev-parse 'HEAD^{tree}').Trim().ToLowerInvariant()
$CommitLine = @(git rev-list --parents -n 1 HEAD)
$ParentCount = ($CommitLine[0] -split '\s+').Count - 1
$StatusLines = @(git status --porcelain=v1 --untracked-files=all)
$GitignoreSha256 = (Get-FileHash -LiteralPath '.gitignore' -Algorithm SHA256).Hash.ToLowerInvariant()

if ($HeadSha -notmatch '^[0-9a-f]{40,64}$') { throw 'STOP INVALID_HEAD_SHA' }
if ($TreeSha -notmatch '^[0-9a-f]{40,64}$') { throw 'STOP INVALID_TREE_SHA' }
if ($ParentCount -ne 0) { throw "STOP NOT_GENESIS parent_count=$ParentCount" }
if ($StatusLines.Count -ne 0) {
  $StatusLines
  throw 'STOP DIRTY_AFTER_GENESIS'
}

[ordered]@{
  project_root = $ResolvedRoot
  branch = $Branch
  head_sha = $HeadSha
  tree_sha = $TreeSha
  parent_count = $ParentCount
  inventory_sha256 = $InventorySha256
  gitignore_sha256 = $GitignoreSha256
  status = 'CLEAN'
} | ConvertTo-Json
```

PASS существует только после получения реальных `head_sha`, `tree_sha`, `parent_count=0` и `status=CLEAN`. До readback статус остаётся `BLOCKED`, а commit hash нельзя придумывать.

## 7. Stop conditions

Остановиться без commit, если:

- root/branch/pre-state отличаются;
- nested/parent repository делает scope неоднозначным;
- custody path не ignored или попал в candidates/staging;
- найден возможный secret, credential, private key, `.env`, database или dump;
- inventory не просмотрен;
- Git identity отсутствует;
- staging или commit завершились ошибкой;
- post-commit status не clean;
- требуется push, runtime change или доступ к vault.

Authority неизменна: `DIAGNOSTIC_ONLY / NO_ACTION / HOLD / DENY / can_trade=false`.
