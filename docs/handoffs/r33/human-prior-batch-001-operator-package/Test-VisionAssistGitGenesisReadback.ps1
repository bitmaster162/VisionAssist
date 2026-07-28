[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ReceiptPath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{64}$')]
    [string]$ExpectedReceiptSha256,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{64}$')]
    [string]$ExpectedGenesisRunnerSha256,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{64}$')]
    [string]$ExpectedReadbackRunnerSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedRoot = '<VISIONASSIST_REPO_ROOT>'
$ExpectedBranch = 'master'
$ExpectedHeadReference = 'refs/heads/master'
$ExpectedCommitMessage = 'chore: establish VisionAssist genesis baseline'
$RunId = [Guid]::NewGuid().ToString('D')
$StartedAt = [DateTime]::UtcNow.ToString('o')
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$StrictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
$MaximumReceiptBytes = 2097152
$MaximumCandidateBytes = 268435456

$CustodyPattern = '(?i)^benchmarks/chart-intent-r26/(cases|outcome-vault)(/|$)'
$EnvPathPattern = '(?i)(^|/)\.env(?:\.[^/]*)?($|/)'
$BlockedPathPattern = '(?i)(^|/)(\.npmrc|\.pypirc|\.netrc|credentials?(?:\.[^/]*)?|service-account(?:\.[^/]*)?|kubeconfig|id_rsa(?:\.[^/]*)?|id_ed25519(?:\.[^/]*)?)(/|$)|(^|/)secrets?(/|$)|\.(pem|key|p12|pfx|kdbx|jks|keystore|ovpn|db|sqlite|sqlite3|dump|bak|zip|7z|rar|tar|tgz|gz|bz2|xz|exe|dll|dylib|so|msi|iso)$'
$DotEnvExamplePattern = '(?i)(^|/)\.env\.example$'
$SafetyBlockLines = @(
    '# BEGIN VISIONASSIST_GENESIS_SAFETY',
    '.env',
    '.env.*',
    '!.env.example',
    'secrets/',
    '**/secrets/',
    'benchmarks/chart-intent-r26/cases/',
    'benchmarks/chart-intent-r26/outcome-vault/',
    'node_modules/',
    '**/node_modules/',
    '.venv/',
    '**/.venv/',
    '__pycache__/',
    '**/__pycache__/',
    'dist/',
    '**/dist/',
    'build/',
    '**/build/',
    'coverage/',
    '**/coverage/',
    '*.log',
    '*.db',
    '*.sqlite',
    '*.sqlite3',
    '*.dump',
    '*.pem',
    '*.key',
    '*.p12',
    '*.pfx',
    'id_rsa',
    'id_rsa.*',
    'id_ed25519',
    'id_ed25519.*',
    '.codex/',
    '.gemini/',
    '.claude/',
    '.cursor/',
    '# END VISIONASSIST_GENESIS_SAFETY'
)
$SafetyBlockNormalized = $SafetyBlockLines -join "`n"

function Get-NormalizedFullPath {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    $Resolved = (Resolve-Path -LiteralPath $LiteralPath -ErrorAction Stop).Path
    return [IO.Path]::GetFullPath($Resolved).TrimEnd([char[]]@(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ))
}

function Test-IsSameOrUnderRoot {
    param(
        [Parameter(Mandatory = $true)][string]$FullPath,
        [Parameter(Mandatory = $true)][string]$Root
    )

    $NormalizedPath = $FullPath.TrimEnd([char[]]@(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ))
    $NormalizedRoot = $Root.TrimEnd([char[]]@(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ))
    if (
        [StringComparer]::OrdinalIgnoreCase.Equals(
            $NormalizedPath,
            $NormalizedRoot
        )
    ) {
        return $true
    }
    $RootPrefix = $NormalizedRoot + [IO.Path]::DirectorySeparatorChar
    return $NormalizedPath.StartsWith(
        $RootPrefix,
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Get-LexicalLocalDriveFullPath {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if ([string]::IsNullOrWhiteSpace($LiteralPath)) {
        throw "STOP $($Label)_PATH_EMPTY"
    }
    if (
        $LiteralPath -match '^(\\\\|//|\\\\\?|\\\\\.|\\\?\?)' -or
        $LiteralPath -notmatch '^[A-Za-z]:[\\/]' -or
        $LiteralPath.Substring(2).IndexOf(':') -ge 0 -or
        $LiteralPath -match '[\x00-\x1F\x7F]'
    ) {
        throw "STOP $($Label)_PATH_NOT_PLAIN_LOCAL_DRIVE_ABSOLUTE"
    }

    try {
        $LexicalFullPath = [IO.Path]::GetFullPath(
            $LiteralPath.Replace('/', [IO.Path]::DirectorySeparatorChar)
        )
    }
    catch {
        throw "STOP $($Label)_PATH_LEXICAL_NORMALIZATION_FAILED"
    }
    if (
        $LexicalFullPath -notmatch '^[A-Za-z]:\\' -or
        $LexicalFullPath.Substring(2).IndexOf(':') -ge 0
    ) {
        throw "STOP $($Label)_PATH_NOT_PLAIN_LOCAL_DRIVE_ABSOLUTE"
    }

    $DriveRoot = [IO.Path]::GetPathRoot($LexicalFullPath)
    try {
        $Drive = New-Object System.IO.DriveInfo -ArgumentList $DriveRoot
    }
    catch {
        throw "STOP $($Label)_DRIVE_CLASSIFICATION_FAILED"
    }
    if ($Drive.DriveType -ne [IO.DriveType]::Fixed) {
        throw "STOP $($Label)_DRIVE_NOT_FIXED_LOCAL"
    }

    if (
        -not [StringComparer]::OrdinalIgnoreCase.Equals(
            $LexicalFullPath,
            $DriveRoot
        )
    ) {
        $LexicalFullPath = $LexicalFullPath.TrimEnd([char[]]@(
            [IO.Path]::DirectorySeparatorChar,
            [IO.Path]::AltDirectorySeparatorChar
        ))
    }
    return $LexicalFullPath
}

function Assert-LexicallyOutsideProjectRoot {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$LexicalProjectRoot,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $LexicalFullPath = Get-LexicalLocalDriveFullPath `
        -LiteralPath $LiteralPath `
        -Label $Label
    if (
        Test-IsSameOrUnderRoot `
            -FullPath $LexicalFullPath `
            -Root $LexicalProjectRoot
    ) {
        throw "STOP $($Label)_PATH_INSIDE_OR_EQUAL_TO_PROJECT_ROOT"
    }
    return $LexicalFullPath
}

function Assert-NoReparseBelowBoundary {
    param(
        [Parameter(Mandatory = $true)][string]$FullPath,
        [Parameter(Mandatory = $true)][string]$Boundary,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )

    $CurrentPath = [IO.Path]::GetFullPath($FullPath)
    $CurrentVolumeRoot = [IO.Path]::GetPathRoot($CurrentPath)
    if (
        -not [StringComparer]::OrdinalIgnoreCase.Equals(
            $CurrentPath,
            $CurrentVolumeRoot
        )
    ) {
        $CurrentPath = $CurrentPath.TrimEnd([char[]]@(
            [IO.Path]::DirectorySeparatorChar,
            [IO.Path]::AltDirectorySeparatorChar
        ))
    }
    $NormalizedBoundary = [IO.Path]::GetFullPath($Boundary)
    $BoundaryVolumeRoot = [IO.Path]::GetPathRoot($NormalizedBoundary)
    if (
        -not [StringComparer]::OrdinalIgnoreCase.Equals(
            $NormalizedBoundary,
            $BoundaryVolumeRoot
        )
    ) {
        $NormalizedBoundary = $NormalizedBoundary.TrimEnd([char[]]@(
            [IO.Path]::DirectorySeparatorChar,
            [IO.Path]::AltDirectorySeparatorChar
        ))
    }

    while ($true) {
        if (-not (Test-Path -LiteralPath $CurrentPath)) {
            throw $FailureCode
        }
        $Item = Get-Item -LiteralPath $CurrentPath -Force -ErrorAction Stop
        if (
            (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) -or
            (
                $Item.PSObject.Properties.Name -contains 'LinkType' -and
                $Item.LinkType
            )
        ) {
            throw $FailureCode
        }
        if (
            [StringComparer]::OrdinalIgnoreCase.Equals(
                $CurrentPath,
                $NormalizedBoundary
            )
        ) {
            break
        }
        $Parent = [IO.Directory]::GetParent($CurrentPath)
        if (-not $Parent) {
            throw $FailureCode
        }
        $CurrentPath = [IO.Path]::GetFullPath($Parent.FullName)
        $ParentVolumeRoot = [IO.Path]::GetPathRoot($CurrentPath)
        if (
            -not [StringComparer]::OrdinalIgnoreCase.Equals(
                $CurrentPath,
                $ParentVolumeRoot
            )
        ) {
            $CurrentPath = $CurrentPath.TrimEnd([char[]]@(
                [IO.Path]::DirectorySeparatorChar,
                [IO.Path]::AltDirectorySeparatorChar
            ))
        }
    }
}

function Get-Sha256HexFromBytes {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)

    $Hasher = [Security.Cryptography.SHA256]::Create()
    try {
        return [BitConverter]::ToString(
            $Hasher.ComputeHash($Bytes)
        ).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $Hasher.Dispose()
    }
}

function Get-GitBlobObjectIdFromBytes {
    param(
        [Parameter(Mandatory = $true)][byte[]]$Bytes,
        [Parameter(Mandatory = $true)][string]$ObjectFormat
    )

    $Hasher = if ($ObjectFormat -eq 'sha1') {
        [Security.Cryptography.SHA1]::Create()
    }
    elseif ($ObjectFormat -eq 'sha256') {
        [Security.Cryptography.SHA256]::Create()
    }
    else {
        throw "STOP UNSUPPORTED_GIT_OBJECT_FORMAT: $ObjectFormat"
    }
    try {
        $HeaderBytes = $StrictUtf8.GetBytes(
            'blob ' + ([string]$Bytes.LongLength) + [char]0
        )
        $null = $Hasher.TransformBlock(
            $HeaderBytes,
            0,
            $HeaderBytes.Length,
            $HeaderBytes,
            0
        )
        if ($Bytes.Length -gt 0) {
            $null = $Hasher.TransformBlock(
                $Bytes,
                0,
                $Bytes.Length,
                $Bytes,
                0
            )
        }
        [byte[]]$EmptyBytes = @()
        $null = $Hasher.TransformFinalBlock($EmptyBytes, 0, 0)
        return [BitConverter]::ToString(
            $Hasher.Hash
        ).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $Hasher.Dispose()
    }
}

function Read-FileSnapshot {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][int64]$MaximumBytes
    )

    $LexicalFullPath = Get-LexicalLocalDriveFullPath `
        -LiteralPath $Path `
        -Label 'SNAPSHOT'
    if (-not (Test-Path -LiteralPath $LexicalFullPath -PathType Leaf)) {
        throw 'STOP SNAPSHOT_PATH_NOT_REGULAR_FILE_BEFORE_RESOLVE'
    }
    Assert-NoReparseBelowBoundary `
        -FullPath $LexicalFullPath `
        -Boundary ([IO.Path]::GetPathRoot($LexicalFullPath)) `
        -FailureCode 'STOP SNAPSHOT_PATH_OR_ANCESTOR_IS_REPARSE_BEFORE_RESOLVE'
    $FullPath = Get-NormalizedFullPath -LiteralPath $LexicalFullPath
    if (
        -not [StringComparer]::OrdinalIgnoreCase.Equals(
            $FullPath,
            $LexicalFullPath
        )
    ) {
        throw 'STOP SNAPSHOT_PATH_CHANGED_DURING_RESOLVE'
    }
    Assert-NoReparseBelowBoundary `
        -FullPath $FullPath `
        -Boundary ([IO.Path]::GetPathRoot($FullPath)) `
        -FailureCode 'STOP SNAPSHOT_PATH_OR_ANCESTOR_IS_REPARSE_OR_LINK'

    $Stream = [IO.File]::Open(
        $FullPath,
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        [IO.FileShare]::Read
    )
    try {
        $Length = $Stream.Length
        if ($Length -lt 0 -or $Length -gt $MaximumBytes) {
            throw 'STOP SNAPSHOT_FILE_SIZE_OUT_OF_RANGE'
        }
        [byte[]]$Bytes = [Array]::CreateInstance([byte], [int]$Length)
        $Offset = 0
        while ($Offset -lt $Bytes.Length) {
            $ReadCount = $Stream.Read(
                $Bytes,
                $Offset,
                $Bytes.Length - $Offset
            )
            if ($ReadCount -le 0) {
                throw 'STOP SNAPSHOT_SHORT_READ'
            }
            $Offset += $ReadCount
        }
        if ($Stream.ReadByte() -ne -1) {
            throw 'STOP SNAPSHOT_FILE_GREW_DURING_READ'
        }
    }
    finally {
        $Stream.Dispose()
    }

    $SnapshotSha256 = Get-Sha256HexFromBytes -Bytes $Bytes
    return [ordered]@{
        path = $FullPath
        bytes = $Bytes
        length = $Bytes.Length
        sha256 = $SnapshotSha256
    }
}

function Write-BytesAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][byte[]]$Bytes
    )

    if (Test-Path -LiteralPath $Path) {
        throw 'STOP READBACK_OUTPUT_ALREADY_EXISTS'
    }
    $TemporaryPath = $Path + '.' + $RunId + '.tmp'
    $Stream = [IO.File]::Open(
        $TemporaryPath,
        [IO.FileMode]::CreateNew,
        [IO.FileAccess]::Write,
        [IO.FileShare]::None
    )
    try {
        $Stream.Write($Bytes, 0, $Bytes.Length)
        $Stream.Flush($true)
    }
    finally {
        $Stream.Dispose()
    }
    [IO.File]::Move($TemporaryPath, $Path)
}

function Write-JsonTemporary {
    param(
        [Parameter(Mandatory = $true)]$Value,
        [Parameter(Mandatory = $true)][string]$TemporaryPath
    )

    if (Test-Path -LiteralPath $TemporaryPath) {
        throw 'STOP READBACK_TEMPORARY_OUTPUT_ALREADY_EXISTS'
    }
    $Json = $Value | ConvertTo-Json -Depth 12
    $Bytes = $Utf8NoBom.GetBytes($Json + [Environment]::NewLine)
    $Stream = [IO.File]::Open(
        $TemporaryPath,
        [IO.FileMode]::CreateNew,
        [IO.FileAccess]::Write,
        [IO.FileShare]::None
    )
    try {
        $Stream.Write($Bytes, 0, $Bytes.Length)
        $Stream.Flush($true)
    }
    finally {
        $Stream.Dispose()
    }
}

function Invoke-GitBinary {
    param(
        [Parameter(Mandatory = $true)][string]$Arguments,
        [int[]]$AllowedExitCodes = @(0),
        [byte[]]$StandardInputBytes = $null
    )

    $StartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $StartInfo.FileName = $GitExecutable
    $StartInfo.Arguments = (
        '--no-pager --no-optional-locks --no-replace-objects ' +
        $Arguments
    )
    $StartInfo.WorkingDirectory = $ResolvedRoot
    $StartInfo.UseShellExecute = $false
    $StartInfo.RedirectStandardOutput = $true
    $StartInfo.RedirectStandardError = $true
    $StartInfo.RedirectStandardInput = $null -ne $StandardInputBytes
    $StartInfo.CreateNoWindow = $true
    $StartInfo.EnvironmentVariables['GIT_OPTIONAL_LOCKS'] = '0'
    $StartInfo.EnvironmentVariables['GIT_NO_LAZY_FETCH'] = '1'
    $StartInfo.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
    $StartInfo.EnvironmentVariables['GIT_CONFIG_NOSYSTEM'] = '1'
    $StartInfo.EnvironmentVariables['GIT_CONFIG_GLOBAL'] = 'NUL'
    $StartInfo.EnvironmentVariables['GIT_ATTR_NOSYSTEM'] = '1'
    $StartInfo.EnvironmentVariables['GIT_PAGER'] = 'cat'
    $StartInfo.EnvironmentVariables['GIT_NO_REPLACE_OBJECTS'] = '1'

    $Process = New-Object System.Diagnostics.Process
    $Process.StartInfo = $StartInfo
    if (-not $Process.Start()) {
        throw 'STOP READBACK_GIT_PROCESS_START_FAILED'
    }
    $Output = New-Object IO.MemoryStream
    $OutputTask = $Process.StandardOutput.BaseStream.CopyToAsync($Output)
    $ErrorTask = $Process.StandardError.ReadToEndAsync()
    if ($null -ne $StandardInputBytes) {
        $InputTask = $Process.StandardInput.BaseStream.WriteAsync(
            $StandardInputBytes,
            0,
            $StandardInputBytes.Length
        )
        $InputTask.Wait()
        $Process.StandardInput.BaseStream.Flush()
        $Process.StandardInput.Close()
    }
    $Process.WaitForExit()
    $OutputTask.Wait()
    $StandardError = $ErrorTask.Result
    $ExitCode = $Process.ExitCode
    $Process.Dispose()

    if ($AllowedExitCodes -notcontains $ExitCode) {
        throw "STOP READBACK_GIT_COMMAND_FAILED: exit=$ExitCode"
    }
    if ($StandardError -and $StandardError.Trim().Length -gt 0) {
        throw 'STOP READBACK_GIT_COMMAND_REPORTED_STDERR'
    }
    return [ordered]@{
        bytes = $Output.ToArray()
        exit_code = $ExitCode
    }
}

function ConvertFrom-NulPathBytes {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)

    if ($Bytes.Length -eq 0) {
        return @()
    }
    $Text = $StrictUtf8.GetString($Bytes)
    if ($Text[$Text.Length - 1] -ne [char]0) {
        throw 'STOP READBACK_NUL_STREAM_NOT_TERMINATED'
    }
    $Parts = $Text.Split([char]0)
    if ($Parts[$Parts.Count - 1] -ne '') {
        throw 'STOP READBACK_NUL_STREAM_PARSE_FAILED'
    }
    return @($Parts[0..($Parts.Count - 2)])
}

function ConvertTo-NulPathBytes {
    param([Parameter(Mandatory = $true)][string[]]$Paths)

    $Buffer = New-Object IO.MemoryStream
    try {
        foreach ($RelativePath in $Paths) {
            $PathBytes = $StrictUtf8.GetBytes($RelativePath)
            $Buffer.Write($PathBytes, 0, $PathBytes.Length)
            $Buffer.WriteByte(0)
        }
        return ,([byte[]]$Buffer.ToArray())
    }
    finally {
        $Buffer.Dispose()
    }
}

function Assert-GitObjectId {
    param(
        [Parameter(Mandatory = $true)][string]$ObjectId,
        [Parameter(Mandatory = $true)][string]$ObjectFormat,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $ExpectedLength = if ($ObjectFormat -eq 'sha1') { 40 } else { 64 }
    if (
        $ObjectId.Length -ne $ExpectedLength -or
        $ObjectId -notmatch '^[0-9a-f]+$'
    ) {
        throw "STOP INVALID_$($Label)_OBJECT_ID"
    }
}

function Assert-CommittedPathSafe {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    if (
        $RelativePath -match '(^|/)\.\.(/|$)' -or
        $RelativePath -match '^[A-Za-z]:' -or
        $RelativePath -match '^/' -or
        $RelativePath -match "[`r`n`t]"
    ) {
        throw 'STOP MALFORMED_OR_ESCAPING_COMMITTED_PATH'
    }
    if (
        $RelativePath -match $CustodyPattern -or
        $RelativePath -match $BlockedPathPattern -or
        (
            ($RelativePath -match $EnvPathPattern) -and
            ($RelativePath -notmatch $DotEnvExamplePattern)
        )
    ) {
        throw 'STOP BLOCKED_OR_CUSTODY_PATH_IN_COMMITTED_TREE'
    }
}

function Get-CanonicalStagedManifestSummary {
    param(
        [Parameter(Mandatory = $true)][byte[]]$Bytes,
        [Parameter(Mandatory = $true)][string]$ObjectFormat
    )

    $Fields = @(ConvertFrom-NulPathBytes -Bytes $Bytes)
    if (
        $Fields.Count -lt 4 -or
        (($Fields.Count - 4) % 3) -ne 0
    ) {
        throw 'STOP CANONICAL_STAGED_MANIFEST_FRAMING_INVALID'
    }
    if (
        $Fields[0] -ne 'visionassist.git-genesis-staged-manifest.v1' -or
        -not [StringComparer]::OrdinalIgnoreCase.Equals(
            $Fields[1],
            $ResolvedRoot
        ) -or
        $Fields[2] -ne $ExpectedBranch -or
        $Fields[3] -ne $ObjectFormat
    ) {
        throw 'STOP CANONICAL_STAGED_MANIFEST_HEADER_MISMATCH'
    }

    $PathSet = New-Object `
        'System.Collections.Generic.HashSet[string]' `
        ([StringComparer]::Ordinal)
    $CaseFoldedSet = New-Object `
        'System.Collections.Generic.HashSet[string]' `
        ([StringComparer]::OrdinalIgnoreCase)
    for ($Index = 4; $Index -lt $Fields.Count; $Index += 3) {
        $Mode = $Fields[$Index]
        $BlobId = $Fields[$Index + 1].ToLowerInvariant()
        $RelativePath = $Fields[$Index + 2]
        if ($Mode -ne '100644' -and $Mode -ne '100755') {
            throw 'STOP CANONICAL_STAGED_MANIFEST_MODE_UNSAFE'
        }
        Assert-GitObjectId `
            -ObjectId $BlobId `
            -ObjectFormat $ObjectFormat `
            -Label 'CANONICAL_MANIFEST_BLOB'
        Assert-CommittedPathSafe -RelativePath $RelativePath
        if (
            -not $PathSet.Add($RelativePath) -or
            -not $CaseFoldedSet.Add($RelativePath)
        ) {
            throw 'STOP CANONICAL_STAGED_MANIFEST_DUPLICATE_OR_CASE_COLLISION'
        }
    }
    $ManifestSha256 = Get-Sha256HexFromBytes -Bytes $Bytes
    return [ordered]@{
        count = [int](($Fields.Count - 4) / 3)
        sha256 = $ManifestSha256
    }
}

function Get-CommittedManifest {
    param(
        [Parameter(Mandatory = $true)][string]$HeadSha,
        [Parameter(Mandatory = $true)][string]$ObjectFormat
    )

    $TreeResult = Invoke-GitBinary `
        -Arguments (
            "-c core.quotepath=false ls-tree -r -z {0}" -f $HeadSha
        )
    $Records = @(ConvertFrom-NulPathBytes -Bytes $TreeResult.bytes)
    $EntryByPath = New-Object `
        'System.Collections.Generic.Dictionary[string,object]' `
        ([StringComparer]::Ordinal)

    foreach ($Record in $Records) {
        $TabIndex = $Record.IndexOf([char]9)
        if ($TabIndex -lt 1) {
            throw 'STOP MALFORMED_COMMITTED_TREE_RECORD'
        }
        $Metadata = $Record.Substring(0, $TabIndex)
        $RelativePath = $Record.Substring($TabIndex + 1)
        Assert-CommittedPathSafe -RelativePath $RelativePath
        $Parts = @($Metadata -split ' ')
        if ($Parts.Count -ne 3) {
            throw 'STOP MALFORMED_COMMITTED_TREE_METADATA'
        }
        $Mode = $Parts[0]
        $ObjectType = $Parts[1]
        $BlobId = $Parts[2].ToLowerInvariant()
        if (
            ($Mode -ne '100644' -and $Mode -ne '100755') -or
            $ObjectType -ne 'blob'
        ) {
            throw 'STOP UNSAFE_MODE_OR_TYPE_IN_COMMITTED_TREE'
        }
        Assert-GitObjectId `
            -ObjectId $BlobId `
            -ObjectFormat $ObjectFormat `
            -Label 'COMMITTED_BLOB'
        if ($EntryByPath.ContainsKey($RelativePath)) {
            throw 'STOP DUPLICATE_COMMITTED_PATH'
        }
        $EntryByPath.Add(
            $RelativePath,
            [ordered]@{
                mode = $Mode
                blob_id = $BlobId
            }
        )
    }

    $Paths = [string[]]@($EntryByPath.Keys)
    [Array]::Sort($Paths, [StringComparer]::Ordinal)
    $CaseFolded = New-Object `
        'System.Collections.Generic.HashSet[string]' `
        ([StringComparer]::OrdinalIgnoreCase)
    $Canonical = New-Object IO.MemoryStream
    foreach ($Header in @(
        'visionassist.git-genesis-staged-manifest.v1',
        $ResolvedRoot,
        $ExpectedBranch,
        $ObjectFormat
    )) {
        $HeaderBytes = $StrictUtf8.GetBytes($Header)
        $Canonical.Write($HeaderBytes, 0, $HeaderBytes.Length)
        $Canonical.WriteByte(0)
    }
    foreach ($Path in $Paths) {
        if (-not $CaseFolded.Add($Path)) {
            throw 'STOP CASE_COLLIDING_COMMITTED_PATHS'
        }
        $Entry = $EntryByPath[$Path]
        foreach ($Field in @($Entry.mode, $Entry.blob_id, $Path)) {
            $FieldBytes = $StrictUtf8.GetBytes([string]$Field)
            $Canonical.Write($FieldBytes, 0, $FieldBytes.Length)
            $Canonical.WriteByte(0)
        }
    }
    $CanonicalBytes = $Canonical.ToArray()
    $Canonical.Dispose()

    return [ordered]@{
        count = $Paths.Count
        sha256 = Get-Sha256HexFromBytes -Bytes $CanonicalBytes
        custody_or_blocked_path_count = 0
    }
}

function Get-IndexManifest {
    param([Parameter(Mandatory = $true)][string]$ObjectFormat)

    $IndexResult = Invoke-GitBinary `
        -Arguments (
            '-c core.fsmonitor=false -c core.excludesFile=NUL ' +
            '-c core.quotepath=false ls-files --stage -z'
        )
    $Records = @(ConvertFrom-NulPathBytes -Bytes $IndexResult.bytes)
    $EntryByPath = New-Object `
        'System.Collections.Generic.Dictionary[string,object]' `
        ([StringComparer]::Ordinal)

    foreach ($Record in $Records) {
        $TabIndex = $Record.IndexOf([char]9)
        if ($TabIndex -lt 1) {
            throw 'STOP MALFORMED_READBACK_INDEX_RECORD'
        }
        $Metadata = $Record.Substring(0, $TabIndex)
        $RelativePath = $Record.Substring($TabIndex + 1)
        Assert-CommittedPathSafe -RelativePath $RelativePath
        $Parts = @($Metadata -split ' ')
        if ($Parts.Count -ne 3) {
            throw 'STOP MALFORMED_READBACK_INDEX_METADATA'
        }
        $Mode = $Parts[0]
        $BlobId = $Parts[1].ToLowerInvariant()
        $Stage = $Parts[2]
        if (
            ($Mode -ne '100644' -and $Mode -ne '100755') -or
            $Stage -ne '0'
        ) {
            throw 'STOP UNSAFE_MODE_OR_NONZERO_READBACK_INDEX_STAGE'
        }
        Assert-GitObjectId `
            -ObjectId $BlobId `
            -ObjectFormat $ObjectFormat `
            -Label 'INDEX_BLOB'
        if ($EntryByPath.ContainsKey($RelativePath)) {
            throw 'STOP DUPLICATE_READBACK_INDEX_PATH'
        }
        $EntryByPath.Add(
            $RelativePath,
            [ordered]@{
                mode = $Mode
                blob_id = $BlobId
            }
        )
    }

    $Paths = [string[]]@($EntryByPath.Keys)
    [Array]::Sort($Paths, [StringComparer]::Ordinal)
    $CaseFolded = New-Object `
        'System.Collections.Generic.HashSet[string]' `
        ([StringComparer]::OrdinalIgnoreCase)
    $Canonical = New-Object IO.MemoryStream
    foreach ($Header in @(
        'visionassist.git-genesis-staged-manifest.v1',
        $ResolvedRoot,
        $ExpectedBranch,
        $ObjectFormat
    )) {
        $HeaderBytes = $StrictUtf8.GetBytes($Header)
        $Canonical.Write($HeaderBytes, 0, $HeaderBytes.Length)
        $Canonical.WriteByte(0)
    }
    foreach ($Path in $Paths) {
        if (-not $CaseFolded.Add($Path)) {
            throw 'STOP CASE_COLLIDING_READBACK_INDEX_PATHS'
        }
        $Entry = $EntryByPath[$Path]
        foreach ($Field in @($Entry.mode, $Entry.blob_id, $Path)) {
            $FieldBytes = $StrictUtf8.GetBytes([string]$Field)
            $Canonical.Write($FieldBytes, 0, $FieldBytes.Length)
            $Canonical.WriteByte(0)
        }
    }
    $CanonicalBytes = $Canonical.ToArray()
    $Canonical.Dispose()

    return [ordered]@{
        count = $Paths.Count
        sha256 = Get-Sha256HexFromBytes -Bytes $CanonicalBytes
        paths = $Paths
        entries_by_path = $EntryByPath
    }
}

function Assert-RawWorktreeBlobsEqualIndex {
    param(
        [Parameter(Mandatory = $true)]$IndexManifest,
        [Parameter(Mandatory = $true)][string]$ObjectFormat,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )

    foreach ($RelativePath in $IndexManifest.paths) {
        if (-not $IndexManifest.entries_by_path.ContainsKey($RelativePath)) {
            throw $FailureCode
        }
        $PlatformRelativePath = $RelativePath.Replace(
            '/',
            [IO.Path]::DirectorySeparatorChar
        )
        $FullPath = [IO.Path]::GetFullPath(
            (Join-Path $ResolvedRoot $PlatformRelativePath)
        )
        if (
            -not (
                Test-IsSameOrUnderRoot `
                    -FullPath $FullPath `
                    -Root $ResolvedRoot
            ) -or
            [StringComparer]::OrdinalIgnoreCase.Equals(
                $FullPath,
                $ResolvedRoot
            )
        ) {
            throw $FailureCode
        }
        Assert-NoReparseBelowBoundary `
            -FullPath $FullPath `
            -Boundary $ResolvedRoot `
            -FailureCode $FailureCode
        $Snapshot = Read-FileSnapshot `
            -Path $FullPath `
            -MaximumBytes $MaximumCandidateBytes
        $RawBlobId = Get-GitBlobObjectIdFromBytes `
            -Bytes $Snapshot.bytes `
            -ObjectFormat $ObjectFormat
        if (
            -not [StringComparer]::Ordinal.Equals(
                $RawBlobId,
                [string](
                    $IndexManifest.entries_by_path[$RelativePath].blob_id
                )
            )
        ) {
            throw $FailureCode
        }
    }
    return $IndexManifest.paths.Count
}

function Assert-FreshTransformAttributesUnassigned {
    param(
        [Parameter(Mandatory = $true)][string[]]$Paths,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )

    if ($Paths.Count -eq 0) {
        throw $FailureCode
    }
    $AttributeNames = [string[]]@(
        'filter',
        'text',
        'crlf',
        'eol',
        'working-tree-encoding',
        'ident'
    )
    $AttributeResult = Invoke-GitBinary `
        -Arguments (
            '-c core.fsmonitor=false -c core.excludesFile=NUL ' +
            '-c core.quotepath=false -c core.autocrlf=false ' +
            'check-attr -z --stdin ' +
            ($AttributeNames -join ' ')
        ) `
        -StandardInputBytes (ConvertTo-NulPathBytes -Paths $Paths)
    $Fields = @(ConvertFrom-NulPathBytes -Bytes $AttributeResult.bytes)
    $ExpectedFieldCount = $Paths.Count * $AttributeNames.Count * 3
    if ($Fields.Count -ne $ExpectedFieldCount) {
        throw $FailureCode
    }

    $ExpectedPaths = New-Object `
        'System.Collections.Generic.HashSet[string]' `
        ([StringComparer]::Ordinal)
    foreach ($Path in $Paths) {
        if (-not $ExpectedPaths.Add($Path)) {
            throw $FailureCode
        }
    }
    $ExpectedAttributes = New-Object `
        'System.Collections.Generic.HashSet[string]' `
        ([StringComparer]::Ordinal)
    foreach ($AttributeName in $AttributeNames) {
        [void]$ExpectedAttributes.Add($AttributeName)
    }
    $ObservedPairs = New-Object `
        'System.Collections.Generic.HashSet[string]' `
        ([StringComparer]::Ordinal)

    for ($Index = 0; $Index -lt $Fields.Count; $Index += 3) {
        $ObservedPath = $Fields[$Index]
        $ObservedAttribute = $Fields[$Index + 1]
        $ObservedValue = $Fields[$Index + 2]
        $PairKey = $ObservedPath + [char]0 + $ObservedAttribute
        if (
            -not $ExpectedPaths.Contains($ObservedPath) -or
            -not $ExpectedAttributes.Contains($ObservedAttribute) -or
            -not $ObservedPairs.Add($PairKey) -or
            (
                $ObservedValue -ne 'unspecified' -and
                $ObservedValue -ne 'unset'
            )
        ) {
            throw $FailureCode
        }
    }
    if ($ObservedPairs.Count -ne ($Paths.Count * $AttributeNames.Count)) {
        throw $FailureCode
    }
}

if (-not $PSCommandPath) {
    throw 'STOP READBACK_SCRIPT_PATH_UNAVAILABLE'
}

$ForbiddenGitEnvironmentVariables = @(
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_COMMON_DIR',
    'GIT_CONFIG',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_SYSTEM',
    'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_NOSYSTEM',
    'GIT_CEILING_DIRECTORIES',
    'GIT_EXEC_PATH',
    'GIT_EXTERNAL_DIFF',
    'GIT_DIFF_OPTS',
    'GIT_PAGER',
    'GIT_ATTR_NOSYSTEM',
    'GIT_NAMESPACE',
    'GIT_REPLACE_REF_BASE',
    'GIT_SHALLOW_FILE'
)
foreach ($VariableName in $ForbiddenGitEnvironmentVariables) {
    $Variable = Get-Item `
        -LiteralPath "Env:$VariableName" `
        -ErrorAction SilentlyContinue
    if ($Variable -and ([string]$Variable.Value).Length -gt 0) {
        throw "STOP READBACK_GIT_ENVIRONMENT_OVERRIDE_PRESENT: $VariableName"
    }
}
$DynamicGitOverrides = @(
    Get-ChildItem Env: |
        Where-Object {
            $_.Name -match '^GIT_CONFIG_(KEY|VALUE)_[0-9]+$' -or
            $_.Name -match '^GIT_TRACE'
        }
)
if ($DynamicGitOverrides.Count -gt 0) {
    throw 'STOP READBACK_DYNAMIC_CONFIG_OR_TRACE_ENVIRONMENT_PRESENT'
}

$ApprovedReceiptHash = $ExpectedReceiptSha256.ToLowerInvariant()
$ApprovedGenesisRunnerHash = (
    $ExpectedGenesisRunnerSha256.ToLowerInvariant()
)
$ApprovedReadbackRunnerHash = (
    $ExpectedReadbackRunnerSha256.ToLowerInvariant()
)
$LexicalExpectedRoot = Get-LexicalLocalDriveFullPath `
    -LiteralPath $ExpectedRoot `
    -Label 'PROJECT_ROOT'
$LexicalTempRoot = Assert-LexicallyOutsideProjectRoot `
    -LiteralPath $env:TEMP `
    -LexicalProjectRoot $LexicalExpectedRoot `
    -Label 'READBACK_TEMP_ROOT'
$LexicalEvidenceDirectory = Assert-LexicallyOutsideProjectRoot `
    -LiteralPath (Join-Path $LexicalTempRoot 'VisionAssistGitGenesis') `
    -LexicalProjectRoot $LexicalExpectedRoot `
    -Label 'GENESIS_EVIDENCE_DIRECTORY'
if (
    -not (
        Test-Path `
            -LiteralPath $LexicalEvidenceDirectory `
            -PathType Container
    )
) {
    throw 'STOP GENESIS_EVIDENCE_DIRECTORY_UNAVAILABLE'
}
Assert-NoReparseBelowBoundary `
    -FullPath $LexicalEvidenceDirectory `
    -Boundary ([IO.Path]::GetPathRoot($LexicalEvidenceDirectory)) `
    -FailureCode 'STOP GENESIS_EVIDENCE_DIRECTORY_IS_REPARSE_OR_LINK'
$LexicalReceiptPath = Assert-LexicallyOutsideProjectRoot `
    -LiteralPath $ReceiptPath `
    -LexicalProjectRoot $LexicalExpectedRoot `
    -Label 'SOURCE_RECEIPT'
if (
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
        [IO.Path]::GetDirectoryName($LexicalReceiptPath),
        $LexicalEvidenceDirectory
    ) -or
    [IO.Path]::GetFileName($LexicalReceiptPath) -notmatch
        '^VISIONASSIST_GIT_BASELINE_RECEIPT_2026-07-28_[0-9a-fA-F-]{36}\.json$'
) {
    throw 'STOP SOURCE_RECEIPT_NOT_DIRECT_EXPECTED_EVIDENCE_FILE'
}
$LexicalScriptPath = Assert-LexicallyOutsideProjectRoot `
    -LiteralPath $PSCommandPath `
    -LexicalProjectRoot $LexicalExpectedRoot `
    -Label 'READBACK_SCRIPT'
if (
    -not [StringComparer]::Ordinal.Equals(
        [IO.Path]::GetFileName($LexicalScriptPath),
        'Test-VisionAssistGitGenesisReadback.ps1'
    )
) {
    throw 'STOP READBACK_SCRIPT_FILENAME_MISMATCH'
}
foreach ($PreResolveLeafPath in @(
    $LexicalReceiptPath,
    $LexicalScriptPath
)) {
    if (-not (Test-Path -LiteralPath $PreResolveLeafPath -PathType Leaf)) {
        throw 'STOP PRE_RESOLVE_REQUIRED_LEAF_UNAVAILABLE'
    }
    Assert-NoReparseBelowBoundary `
        -FullPath $PreResolveLeafPath `
        -Boundary ([IO.Path]::GetPathRoot($PreResolveLeafPath)) `
        -FailureCode 'STOP PRE_RESOLVE_LEAF_OR_ANCESTOR_IS_REPARSE_OR_LINK'
}

$ResolvedRoot = Get-NormalizedFullPath -LiteralPath $LexicalExpectedRoot
$ResolvedEvidenceDirectory = Get-NormalizedFullPath `
    -LiteralPath $LexicalEvidenceDirectory
$ResolvedReceiptPath = Get-NormalizedFullPath `
    -LiteralPath $LexicalReceiptPath
$ScriptFullPath = Get-NormalizedFullPath -LiteralPath $LexicalScriptPath
if (
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
        [IO.Path]::GetDirectoryName($ResolvedReceiptPath),
        $ResolvedEvidenceDirectory
    )
) {
    throw 'STOP SOURCE_RECEIPT_RESOLVED_OUTSIDE_EXPECTED_EVIDENCE_DIRECTORY'
}
if (
    Test-IsSameOrUnderRoot `
        -FullPath $ResolvedReceiptPath `
        -Root $ResolvedRoot
) {
    throw 'STOP SOURCE_RECEIPT_INSIDE_PROJECT_ROOT'
}
if (
    Test-IsSameOrUnderRoot `
        -FullPath $ScriptFullPath `
        -Root $ResolvedRoot
) {
    throw 'STOP READBACK_SCRIPT_INSIDE_PROJECT_ROOT'
}
Assert-NoReparseBelowBoundary `
    -FullPath $ScriptFullPath `
    -Boundary ([IO.Path]::GetPathRoot($ScriptFullPath)) `
    -FailureCode 'STOP READBACK_SCRIPT_PATH_OR_ANCESTOR_IS_REPARSE_OR_LINK'
Assert-NoReparseBelowBoundary `
    -FullPath $ResolvedRoot `
    -Boundary ([IO.Path]::GetPathRoot($ResolvedRoot)) `
    -FailureCode 'STOP PROJECT_ROOT_OR_ANCESTOR_IS_REPARSE_OR_LINK'
$ReadbackRunnerSnapshot = Read-FileSnapshot `
    -Path $ScriptFullPath `
    -MaximumBytes 4194304
$ReadbackRunnerSha256 = $ReadbackRunnerSnapshot.sha256
if ($ReadbackRunnerSha256 -ne $ApprovedReadbackRunnerHash) {
    throw 'STOP READBACK_RUNNER_SHA256_DIFFERS_FROM_FROZEN_APPROVAL'
}

$SourceReceiptSnapshot = Read-FileSnapshot `
    -Path $ResolvedReceiptPath `
    -MaximumBytes $MaximumReceiptBytes
if ($SourceReceiptSnapshot.sha256 -ne $ApprovedReceiptHash) {
    throw 'STOP SOURCE_RECEIPT_SHA256_MISMATCH'
}
try {
    $SourceReceiptText = $StrictUtf8.GetString($SourceReceiptSnapshot.bytes)
    $SourceReceipt = $SourceReceiptText | ConvertFrom-Json
}
catch {
    throw 'STOP SOURCE_RECEIPT_IS_NOT_STRICT_UTF8_JSON'
}

$SidecarPath = $ResolvedReceiptPath + '.sha256'
$SidecarSnapshot = Read-FileSnapshot `
    -Path $SidecarPath `
    -MaximumBytes 4096
$SidecarText = $StrictUtf8.GetString($SidecarSnapshot.bytes)
$ExpectedSidecarLine = (
    $ApprovedReceiptHash +
    '  ' +
    [IO.Path]::GetFileName($ResolvedReceiptPath)
)
if (
    $SidecarText -ne ($ExpectedSidecarLine + "`n") -and
    $SidecarText -ne ($ExpectedSidecarLine + "`r`n")
) {
    throw 'STOP SOURCE_RECEIPT_SIDECAR_MISMATCH'
}

if (
    $SourceReceipt.schema_version -ne 'visionassist.git-baseline-receipt.v1' -or
    $SourceReceipt.terminal_status -ne
        'LOCAL_EXECUTION_REPORTED_PENDING_INDEPENDENT_READBACK'
) {
    throw 'STOP SOURCE_RECEIPT_SCHEMA_OR_TERMINAL_STATUS_MISMATCH'
}
if (
    -not ($SourceReceipt.authority.can_trade -is [bool]) -or
    $SourceReceipt.authority.can_trade
) {
    throw 'STOP SOURCE_RECEIPT_CAN_TRADE_NOT_EXACT_FALSE'
}
if (
    -not ($SourceReceipt.execution_provenance.independent_readback -is [bool]) -or
    $SourceReceipt.execution_provenance.independent_readback -or
    $SourceReceipt.execution_provenance.capture_class -ne
        'LOCAL_UNSIGNED_SELF_REPORT'
) {
    throw 'STOP SOURCE_RECEIPT_PROVENANCE_CLASS_MISMATCH'
}
if (
    $SourceReceipt.authority.decision_status -ne 'DIAGNOSTIC_ONLY' -or
    $SourceReceipt.authority.domain_action_code -ne 'NO_ACTION' -or
    $SourceReceipt.authority.execution_permission -ne 'HOLD' -or
    $SourceReceipt.authority.capital_permission -ne 'DENY'
) {
    throw 'STOP SOURCE_RECEIPT_AUTHORITY_MISMATCH'
}
if (
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
        [string]$SourceReceipt.project_root,
        $ResolvedRoot
    ) -or
    $SourceReceipt.branch -ne $ExpectedBranch -or
    $SourceReceipt.commit.message -ne $ExpectedCommitMessage -or
    [int]$SourceReceipt.commit.parent_count -ne 0 -or
    $SourceReceipt.commit.creation_method -ne
        'commit-tree_then_conditional_update-ref' -or
    $SourceReceipt.commit.identity_source -ne
        'existing_git_config_pinned_in_commit_tree_process'
) {
    throw 'STOP SOURCE_RECEIPT_SCOPE_MISMATCH'
}
foreach ($SourceHash in @(
    [string]$SourceReceipt.commit.head_sha,
    [string]$SourceReceipt.commit.tree_sha,
    [string]$SourceReceipt.scope.approved_tree_sha,
    [string]$SourceReceipt.scope.inventory_sha256,
    [string]$SourceReceipt.scope.inventory_approval_sha256,
    [string]$SourceReceipt.scope.opaque_inventory_sha256,
    [string]$SourceReceipt.scope.staged_manifest_sha256,
    [string]$SourceReceipt.scope.gitignore_sha256,
    [string]$SourceReceipt.scope.committed_gitignore_sha256,
    [string]$SourceReceipt.execution_provenance.runner_sha256,
    [string]$SourceReceipt.execution_provenance.git_executable_sha256
)) {
    if ($SourceHash -notmatch '^[0-9a-f]+$') {
        throw 'STOP SOURCE_RECEIPT_HASH_FIELD_MALFORMED'
    }
}
foreach ($SourceSha256 in @(
    [string]$SourceReceipt.scope.inventory_sha256,
    [string]$SourceReceipt.scope.inventory_approval_sha256,
    [string]$SourceReceipt.scope.opaque_inventory_sha256,
    [string]$SourceReceipt.scope.staged_manifest_sha256,
    [string]$SourceReceipt.scope.gitignore_sha256,
    [string]$SourceReceipt.scope.committed_gitignore_sha256,
    [string]$SourceReceipt.execution_provenance.runner_sha256,
    [string]$SourceReceipt.execution_provenance.git_executable_sha256
)) {
    if ($SourceSha256.Length -ne 64) {
        throw 'STOP SOURCE_RECEIPT_SHA256_FIELD_LENGTH_INVALID'
    }
}
if (
    -not [StringComparer]::Ordinal.Equals(
        [string]$SourceReceipt.scope.inventory_sha256,
        [string]$SourceReceipt.scope.inventory_approval_sha256
    )
) {
    throw 'STOP SOURCE_RECEIPT_INVENTORY_APPROVAL_MISMATCH'
}
$OpaqueBinaryCount = [int]$SourceReceipt.scope.opaque_binary_count
$OpaqueApprovalHash = [string](
    $SourceReceipt.scope.opaque_inventory_approval_sha256
)
if ($OpaqueBinaryCount -lt 0) {
    throw 'STOP SOURCE_RECEIPT_OPAQUE_BINARY_COUNT_INVALID'
}
if (
    ($OpaqueBinaryCount -gt 0 -and (
        $OpaqueApprovalHash -notmatch '^[0-9a-f]{64}$' -or
        -not [StringComparer]::Ordinal.Equals(
            $OpaqueApprovalHash,
            [string]$SourceReceipt.scope.opaque_inventory_sha256
        )
    )) -or
    ($OpaqueBinaryCount -eq 0 -and $OpaqueApprovalHash.Length -gt 0 -and (
        $OpaqueApprovalHash -notmatch '^[0-9a-f]{64}$' -or
        -not [StringComparer]::Ordinal.Equals(
            $OpaqueApprovalHash,
            [string]$SourceReceipt.scope.opaque_inventory_sha256
        )
    ))
) {
    throw 'STOP SOURCE_RECEIPT_OPAQUE_INVENTORY_APPROVAL_MISMATCH'
}
if (
    -not [StringComparer]::Ordinal.Equals(
        [string]$SourceReceipt.execution_provenance.runner_sha256,
        $ApprovedGenesisRunnerHash
    ) -or
    -not [StringComparer]::Ordinal.Equals(
        [string]$SourceReceipt.execution_provenance.expected_runner_sha256,
        $ApprovedGenesisRunnerHash
    )
) {
    throw 'STOP SOURCE_GENESIS_RUNNER_SHA256_DIFFERS_FROM_FROZEN_APPROVAL'
}
foreach ($RequiredSourceCheck in @(
    $SourceReceipt.checks.inventory_hash_approval_matched,
    $SourceReceipt.checks.opaque_binary_hash_approval_matched,
    $SourceReceipt.checks.approved_raw_blob_ids_equal_staged_blob_ids,
    $SourceReceipt.checks.planned_tree_derived_from_external_exact_manifest_index,
    $SourceReceipt.checks.immediate_staged_manifest_equals_approved_staged_manifest,
    $SourceReceipt.checks.approved_tree_equals_committed_tree,
    $SourceReceipt.checks.runner_frozen_sha256_gate_matched,
    $SourceReceipt.checks.final_raw_inventory_hash_equals_approved_inventory
)) {
    if (-not ($RequiredSourceCheck -is [bool]) -or -not $RequiredSourceCheck) {
        throw 'STOP SOURCE_RECEIPT_REQUIRED_TRUE_CHECK_MISSING_OR_FALSE'
    }
}
if (
    [int]$SourceReceipt.scope.staged_file_count -le 0 -or
    [int]$SourceReceipt.scope.committed_file_count -ne
        [int]$SourceReceipt.scope.staged_file_count
) {
    throw 'STOP SOURCE_RECEIPT_FILE_COUNTS_INVALID'
}

$LexicalReceiptGitExecutable = Assert-LexicallyOutsideProjectRoot `
    -LiteralPath ([string]$SourceReceipt.execution_provenance.git_executable) `
    -LexicalProjectRoot $LexicalExpectedRoot `
    -Label 'SOURCE_RECEIPT_GIT_EXECUTABLE'
if (
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
        [IO.Path]::GetFileName($LexicalReceiptGitExecutable),
        'git.exe'
    )
) {
    throw 'STOP SOURCE_RECEIPT_GIT_EXECUTABLE_FILENAME_MISMATCH'
}
$GitExecutableSnapshot = Read-FileSnapshot `
    -Path $LexicalReceiptGitExecutable `
    -MaximumBytes $MaximumCandidateBytes
$ExactGitCommand = Get-Command `
    -Name $GitExecutableSnapshot.path `
    -CommandType Application `
    -ErrorAction Stop
$GitExecutable = Get-LexicalLocalDriveFullPath `
    -LiteralPath $ExactGitCommand.Source `
    -Label 'EXACT_GIT_EXECUTABLE'
if (
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
        $GitExecutable,
        $GitExecutableSnapshot.path
    )
) {
    throw 'STOP EXACT_GIT_COMMAND_RESOLUTION_MISMATCH'
}
Assert-NoReparseBelowBoundary `
    -FullPath $GitExecutable `
    -Boundary ([IO.Path]::GetPathRoot($GitExecutable)) `
    -FailureCode 'STOP READBACK_GIT_EXECUTABLE_PATH_OR_ANCESTOR_IS_REPARSE_OR_LINK'
$GitExecutableSha256 = $GitExecutableSnapshot.sha256
if (
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
        $GitExecutable,
        $GitExecutableSnapshot.path
    ) -or
    $GitExecutableSha256 -ne
        [string]$SourceReceipt.execution_provenance.git_executable_sha256
) {
    throw 'STOP READBACK_GIT_EXECUTABLE_DIFFERS_FROM_SOURCE_RECEIPT'
}

$LexicalSourceRunnerPath = Assert-LexicallyOutsideProjectRoot `
    -LiteralPath ([string]$SourceReceipt.execution_provenance.runner_path) `
    -LexicalProjectRoot $LexicalExpectedRoot `
    -Label 'SOURCE_GENESIS_RUNNER'
if (
    -not [StringComparer]::Ordinal.Equals(
        [IO.Path]::GetFileName($LexicalSourceRunnerPath),
        'Invoke-VisionAssistGitGenesis.ps1'
    ) -or
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
        [IO.Path]::GetDirectoryName($LexicalSourceRunnerPath),
        [IO.Path]::GetDirectoryName($LexicalScriptPath)
    )
) {
    throw 'STOP SOURCE_GENESIS_RUNNER_NOT_EXPECTED_SIBLING_SCRIPT'
}
$SourceRunnerSnapshot = Read-FileSnapshot `
    -Path $LexicalSourceRunnerPath `
    -MaximumBytes 4194304
if (
    Test-IsSameOrUnderRoot `
        -FullPath $SourceRunnerSnapshot.path `
        -Root $ResolvedRoot
) {
    throw 'STOP SOURCE_RUNNER_INSIDE_PROJECT_ROOT'
}
if (
    $SourceRunnerSnapshot.sha256 -ne $ApprovedGenesisRunnerHash -or
    $SourceRunnerSnapshot.sha256 -ne
        [string]$SourceReceipt.execution_provenance.runner_sha256
) {
    throw 'STOP SOURCE_RUNNER_HASH_MISMATCH'
}

$PreGitDirectory = Join-Path $ResolvedRoot '.git'
if (-not (Test-Path -LiteralPath $PreGitDirectory -PathType Container)) {
    throw 'STOP READBACK_NONSTANDARD_GIT_DIRECTORY_BEFORE_GIT_EXECUTION'
}
Assert-NoReparseBelowBoundary `
    -FullPath $PreGitDirectory `
    -Boundary $ResolvedRoot `
    -FailureCode 'STOP READBACK_GIT_DIRECTORY_IS_REPARSE_BEFORE_GIT_EXECUTION'
$GitConfigPath = Join-Path $PreGitDirectory 'config'
if (-not (Test-Path -LiteralPath $GitConfigPath -PathType Leaf)) {
    throw 'STOP READBACK_LOCAL_GIT_CONFIG_UNAVAILABLE'
}
$GitConfigSnapshot = Read-FileSnapshot `
    -Path $GitConfigPath `
    -MaximumBytes 2097152
$BytePreservingEncoding = [Text.Encoding]::GetEncoding(28591)
$GitConfigByteText = $BytePreservingEncoding.GetString(
    $GitConfigSnapshot.bytes
)
if ($GitConfigByteText -match '(?i)\[\s*include(?:if)?\b') {
    throw 'STOP READBACK_LOCAL_GIT_CONFIG_INCLUDE_PRESENT_BEFORE_GIT_EXECUTION'
}
if (
    $GitConfigByteText -match '(?im)^\s*worktreeConfig\s*=' -or
    $GitConfigByteText -match '(?im)^\s*attributesFile\s*='
) {
    throw 'STOP READBACK_UNSAFE_LOCAL_CONFIG_BEFORE_GIT_EXECUTION'
}
$WorktreeConfigPath = Join-Path $PreGitDirectory 'config.worktree'
if (Test-Path -LiteralPath $WorktreeConfigPath) {
    throw 'STOP READBACK_CONFIG_WORKTREE_PRESENT'
}

Set-Location -LiteralPath $ResolvedRoot
$GitRootResult = Invoke-GitBinary -Arguments 'rev-parse --show-toplevel'
$GitRoot = Get-NormalizedFullPath -LiteralPath (
    $StrictUtf8.GetString($GitRootResult.bytes).Trim()
)
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($GitRoot, $ResolvedRoot)) {
    throw 'STOP READBACK_GIT_ROOT_MISMATCH'
}
$ExpectedGitDirectory = Join-Path $ResolvedRoot '.git'
if (-not (Test-Path -LiteralPath $ExpectedGitDirectory -PathType Container)) {
    throw 'STOP READBACK_NONSTANDARD_GIT_DIRECTORY'
}
Assert-NoReparseBelowBoundary `
    -FullPath $ExpectedGitDirectory `
    -Boundary $ResolvedRoot `
    -FailureCode 'STOP READBACK_GIT_DIRECTORY_IS_REPARSE_OR_LINK'

$AbsoluteGitDirectoryResult = Invoke-GitBinary `
    -Arguments 'rev-parse --absolute-git-dir'
$AbsoluteGitDirectory = [IO.Path]::GetFullPath(
    $StrictUtf8.GetString($AbsoluteGitDirectoryResult.bytes).Trim().Replace(
        '/',
        [IO.Path]::DirectorySeparatorChar
    )
).TrimEnd([char[]]@(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
))
if (
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
        $AbsoluteGitDirectory,
        $ExpectedGitDirectory
    )
) {
    throw 'STOP READBACK_GIT_DIRECTORY_MISMATCH'
}
$GitCommonDirectoryResult = Invoke-GitBinary `
    -Arguments 'rev-parse --git-common-dir'
$GitCommonDirectoryRaw = $StrictUtf8.GetString(
    $GitCommonDirectoryResult.bytes
).Trim()
if ([IO.Path]::IsPathRooted($GitCommonDirectoryRaw)) {
    $GitCommonDirectory = [IO.Path]::GetFullPath($GitCommonDirectoryRaw)
}
else {
    $GitCommonDirectory = [IO.Path]::GetFullPath(
        (Join-Path $ResolvedRoot $GitCommonDirectoryRaw)
    )
}
$GitCommonDirectory = $GitCommonDirectory.TrimEnd([char[]]@(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
))
if (
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
        $GitCommonDirectory,
        $ExpectedGitDirectory
    )
) {
    throw 'STOP READBACK_LINKED_WORKTREE_OR_EXTERNAL_COMMON_DIRECTORY'
}
$BareResult = Invoke-GitBinary `
    -Arguments 'rev-parse --is-bare-repository'
if ($StrictUtf8.GetString($BareResult.bytes).Trim() -ne 'false') {
    throw 'STOP READBACK_BARE_REPOSITORY'
}
$LocalConfigNamesResult = Invoke-GitBinary `
    -Arguments 'config --local --no-includes --name-only --list'
$LocalConfigNames = @(
    $StrictUtf8.GetString($LocalConfigNamesResult.bytes).Split(
        [char[]]@([char]13, [char]10),
        [StringSplitOptions]::RemoveEmptyEntries
    )
)
$LocalIncludeNames = @(
    $LocalConfigNames |
        Where-Object { $_ -match '(?i)^include(?:if)?\.' }
)
if ($LocalIncludeNames.Count -gt 0) {
    throw 'STOP READBACK_LOCAL_GIT_CONFIG_INCLUDE_PRESENT'
}
$PartialCloneNames = @(
    $LocalConfigNames |
        Where-Object {
            $_ -match '(?i)^remote\..*\.promisor$' -or
            $_ -match '(?i)^extensions\.partialclone$'
        }
)
if ($PartialCloneNames.Count -gt 0) {
    throw 'STOP READBACK_PARTIAL_CLONE_OR_PROMISOR_CONFIG_PRESENT'
}
$LocalAttributesResult = Invoke-GitBinary `
    -Arguments 'config --local --no-includes --get core.attributesFile' `
    -AllowedExitCodes @(0, 1)
if (
    $LocalAttributesResult.exit_code -eq 0 -and
    $StrictUtf8.GetString($LocalAttributesResult.bytes).Trim().Length -gt 0
) {
    throw 'STOP READBACK_EXTERNAL_ATTRIBUTES_FILE_CONFIGURED'
}
$RepositoryAttributesPath = Join-Path $ExpectedGitDirectory 'info\attributes'
if (Test-Path -LiteralPath $RepositoryAttributesPath) {
    if (
        -not (
            Test-Path `
                -LiteralPath $RepositoryAttributesPath `
                -PathType Leaf
        )
    ) {
        throw 'STOP READBACK_REPOSITORY_ATTRIBUTES_PATH_TYPE_UNSAFE'
    }
    Assert-NoReparseBelowBoundary `
        -FullPath $RepositoryAttributesPath `
        -Boundary $ExpectedGitDirectory `
        -FailureCode 'STOP READBACK_REPOSITORY_ATTRIBUTES_IS_REPARSE_OR_LINK'
}

foreach ($MetadataPath in @(
    (Join-Path $ExpectedGitDirectory 'shallow'),
    (Join-Path $ExpectedGitDirectory 'info\grafts'),
    (Join-Path $ExpectedGitDirectory 'objects\info\alternates')
)) {
    if (Test-Path -LiteralPath $MetadataPath) {
        if (-not (Test-Path -LiteralPath $MetadataPath -PathType Leaf)) {
            throw 'STOP READBACK_UNSAFE_GIT_METADATA_PATH_TYPE'
        }
        Assert-NoReparseBelowBoundary `
            -FullPath $MetadataPath `
            -Boundary $ExpectedGitDirectory `
            -FailureCode 'STOP READBACK_GIT_METADATA_IS_REPARSE_OR_LINK'
        if ((Get-Item -LiteralPath $MetadataPath -Force).Length -gt 0) {
            throw 'STOP READBACK_SHALLOW_GRAFT_OR_ALTERNATE_METADATA_PRESENT'
        }
    }
}

$ObjectFormatResult = Invoke-GitBinary `
    -Arguments 'rev-parse --show-object-format'
$ObjectFormat = $StrictUtf8.GetString(
    $ObjectFormatResult.bytes
).Trim().ToLowerInvariant()
if ($ObjectFormat -ne 'sha1' -and $ObjectFormat -ne 'sha256') {
    throw 'STOP READBACK_OBJECT_FORMAT_UNAVAILABLE'
}
if (
    $ObjectFormat -ne
        [string]$SourceReceipt.execution_provenance.git_object_format
) {
    throw 'STOP READBACK_OBJECT_FORMAT_DIFFERS_FROM_SOURCE_RECEIPT'
}
Assert-GitObjectId `
    -ObjectId (([string]$SourceReceipt.commit.head_sha).ToLowerInvariant()) `
    -ObjectFormat $ObjectFormat `
    -Label 'SOURCE_HEAD'
Assert-GitObjectId `
    -ObjectId (([string]$SourceReceipt.commit.tree_sha).ToLowerInvariant()) `
    -ObjectFormat $ObjectFormat `
    -Label 'SOURCE_TREE'
Assert-GitObjectId `
    -ObjectId (([string]$SourceReceipt.scope.approved_tree_sha).ToLowerInvariant()) `
    -ObjectFormat $ObjectFormat `
    -Label 'SOURCE_APPROVED_TREE'
if (
    -not [StringComparer]::Ordinal.Equals(
        ([string]$SourceReceipt.scope.approved_tree_sha).ToLowerInvariant(),
        ([string]$SourceReceipt.commit.tree_sha).ToLowerInvariant()
    )
) {
    throw 'STOP SOURCE_RECEIPT_APPROVED_TREE_DIFFERS_FROM_COMMIT_TREE'
}
$HeadResult = Invoke-GitBinary `
    -Arguments 'rev-parse --verify HEAD^{commit}'
$HeadSha = $StrictUtf8.GetString($HeadResult.bytes).Trim().ToLowerInvariant()
Assert-GitObjectId -ObjectId $HeadSha -ObjectFormat $ObjectFormat -Label 'HEAD'
if ($HeadSha -ne ([string]$SourceReceipt.commit.head_sha).ToLowerInvariant()) {
    throw 'STOP READBACK_HEAD_DIFFERS_FROM_SOURCE_RECEIPT'
}
$HeadReferenceResult = Invoke-GitBinary -Arguments 'symbolic-ref HEAD'
$HeadReference = $StrictUtf8.GetString($HeadReferenceResult.bytes).Trim()
if ($HeadReference -ne $ExpectedHeadReference) {
    throw 'STOP READBACK_HEAD_REFERENCE_MISMATCH'
}

$RefResult = Invoke-GitBinary `
    -Arguments 'for-each-ref --format=%(refname):%(objectname)'
$RefLines = @(
    $StrictUtf8.GetString($RefResult.bytes).Split(
        [char[]]@([char]13, [char]10),
        [StringSplitOptions]::RemoveEmptyEntries
    )
)
if (
    $RefLines.Count -ne 1 -or
    $RefLines[0] -ne ($ExpectedHeadReference + ':' + $HeadSha)
) {
    throw 'STOP READBACK_REF_SET_NOT_EXACTLY_MASTER_HEAD'
}

$RawCommitResult = Invoke-GitBinary `
    -Arguments ("--no-replace-objects cat-file commit {0}" -f $HeadSha)
$RawCommitText = $StrictUtf8.GetString($RawCommitResult.bytes)
$HeaderEnd = $RawCommitText.IndexOf("`n`n", [StringComparison]::Ordinal)
if ($HeaderEnd -lt 1) {
    throw 'STOP READBACK_RAW_COMMIT_HEADER_TERMINATOR_MISSING'
}
$HeaderLines = @(
    $RawCommitText.Substring(0, $HeaderEnd).Split([char]10)
)
$TreeHeaders = @($HeaderLines | Where-Object { $_.StartsWith('tree ') })
$ParentHeaders = @(
    $HeaderLines | Where-Object { $_.StartsWith('parent ') }
)
if ($TreeHeaders.Count -ne 1 -or $ParentHeaders.Count -ne 0) {
    throw 'STOP READBACK_RAW_COMMIT_NOT_EXACT_GENESIS'
}
$TreeSha = $TreeHeaders[0].Substring(5).Trim().ToLowerInvariant()
Assert-GitObjectId -ObjectId $TreeSha -ObjectFormat $ObjectFormat -Label 'TREE'
if ($TreeSha -ne ([string]$SourceReceipt.commit.tree_sha).ToLowerInvariant()) {
    throw 'STOP READBACK_TREE_DIFFERS_FROM_SOURCE_RECEIPT'
}
$RawMessageBody = $RawCommitText.Substring($HeaderEnd + 2)
if ($RawMessageBody -ne ($ExpectedCommitMessage + "`n")) {
    throw 'STOP READBACK_RAW_COMMIT_MESSAGE_MISMATCH'
}
$RawMessage = $ExpectedCommitMessage
$TreeTypeResult = Invoke-GitBinary `
    -Arguments ("--no-replace-objects cat-file -t {0}" -f $TreeSha)
if ($StrictUtf8.GetString($TreeTypeResult.bytes).Trim() -ne 'tree') {
    throw 'STOP READBACK_TREE_OBJECT_TYPE_MISMATCH'
}

$LexicalCanonicalManifestPath = Assert-LexicallyOutsideProjectRoot `
    -LiteralPath ([string]$SourceReceipt.scope.staged_manifest_canonical_path) `
    -LexicalProjectRoot $LexicalExpectedRoot `
    -Label 'CANONICAL_STAGED_MANIFEST'
if (
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
        [IO.Path]::GetDirectoryName($LexicalCanonicalManifestPath),
        $LexicalEvidenceDirectory
    ) -or
    [IO.Path]::GetFileName($LexicalCanonicalManifestPath) -notmatch
        '^VISIONASSIST_GENESIS_STAGED_MANIFEST_[0-9a-fA-F-]{36}\.tsv\.nul$'
) {
    throw 'STOP CANONICAL_STAGED_MANIFEST_NOT_DIRECT_EXPECTED_EVIDENCE_FILE'
}
$CanonicalManifestSnapshot = Read-FileSnapshot `
    -Path $LexicalCanonicalManifestPath `
    -MaximumBytes 67108864
if (
    Test-IsSameOrUnderRoot `
        -FullPath $CanonicalManifestSnapshot.path `
        -Root $ResolvedRoot
) {
    throw 'STOP CANONICAL_STAGED_MANIFEST_INSIDE_PROJECT_ROOT'
}
if (
    -not [StringComparer]::OrdinalIgnoreCase.Equals(
        [IO.Path]::GetDirectoryName($CanonicalManifestSnapshot.path),
        $ResolvedEvidenceDirectory
    )
) {
    throw 'STOP CANONICAL_STAGED_MANIFEST_RESOLVED_OUTSIDE_EVIDENCE_DIRECTORY'
}
$CanonicalManifestSummary = Get-CanonicalStagedManifestSummary `
    -Bytes $CanonicalManifestSnapshot.bytes `
    -ObjectFormat $ObjectFormat
if (
    $CanonicalManifestSummary.sha256 -ne
        [string]$SourceReceipt.scope.staged_manifest_sha256 -or
    $CanonicalManifestSummary.count -ne
        [int]$SourceReceipt.scope.staged_file_count
) {
    throw 'STOP CANONICAL_STAGED_MANIFEST_SOURCE_MISMATCH'
}

$CommittedManifest = Get-CommittedManifest `
    -HeadSha $HeadSha `
    -ObjectFormat $ObjectFormat
if (
    $CommittedManifest.sha256 -ne $CanonicalManifestSummary.sha256 -or
    $CommittedManifest.count -ne
        $CanonicalManifestSummary.count -or
    $CommittedManifest.count -ne
        [int]$SourceReceipt.scope.committed_file_count
) {
    throw 'STOP READBACK_COMMITTED_MANIFEST_MISMATCH'
}
$IndexManifest = Get-IndexManifest -ObjectFormat $ObjectFormat
if (
    $IndexManifest.sha256 -ne $CommittedManifest.sha256 -or
    $IndexManifest.count -ne $CommittedManifest.count
) {
    throw 'STOP READBACK_INDEX_MANIFEST_DIFFERS_FROM_COMMITTED_TREE'
}
$RawWorktreeVerifiedFileCount = Assert-RawWorktreeBlobsEqualIndex `
    -IndexManifest $IndexManifest `
    -ObjectFormat $ObjectFormat `
    -FailureCode 'STOP READBACK_RAW_WORKTREE_BLOB_DIFFERS_FROM_INDEX'
if ($RawWorktreeVerifiedFileCount -ne $IndexManifest.count) {
    throw 'STOP READBACK_RAW_WORKTREE_VERIFIED_COUNT_MISMATCH'
}

$GitignoreResult = Invoke-GitBinary `
    -Arguments ("--no-replace-objects cat-file blob {0}:.gitignore" -f $HeadSha)
$CommittedGitignoreSha256 = Get-Sha256HexFromBytes `
    -Bytes $GitignoreResult.bytes
if (
    $CommittedGitignoreSha256 -ne
        [string]$SourceReceipt.scope.gitignore_sha256 -or
    $CommittedGitignoreSha256 -ne
        [string]$SourceReceipt.scope.committed_gitignore_sha256
) {
    throw 'STOP READBACK_GITIGNORE_HASH_MISMATCH'
}
try {
    $CommittedGitignoreText = $StrictUtf8.GetString($GitignoreResult.bytes)
}
catch {
    throw 'STOP READBACK_COMMITTED_GITIGNORE_NOT_STRICT_UTF8'
}
$NormalizedGitignore = $CommittedGitignoreText.Replace(
    "`r`n",
    "`n"
).Replace("`r", "`n")
$SafetyMatch = [regex]::Match(
    $NormalizedGitignore,
    '(?s)# BEGIN VISIONASSIST_GENESIS_SAFETY\n.*?# END VISIONASSIST_GENESIS_SAFETY'
)
if (
    -not $SafetyMatch.Success -or
    $SafetyMatch.Value.Trim() -ne $SafetyBlockNormalized -or
    $NormalizedGitignore.Substring(
        $SafetyMatch.Index + $SafetyMatch.Length
    ).Trim().Length -ne 0
) {
    throw 'STOP READBACK_COMMITTED_GITIGNORE_SAFETY_BLOCK_MISMATCH'
}
if (
    ([regex]::Matches(
        $NormalizedGitignore,
        '(?m)^# BEGIN VISIONASSIST_GENESIS_SAFETY$'
    )).Count -ne 1 -or
    ([regex]::Matches(
        $NormalizedGitignore,
        '(?m)^# END VISIONASSIST_GENESIS_SAFETY$'
    )).Count -ne 1
) {
    throw 'STOP READBACK_COMMITTED_GITIGNORE_MARKER_COUNT_MISMATCH'
}

$WorktreeGitignorePath = Join-Path $ResolvedRoot '.gitignore'
$WorktreeGitignoreSnapshot = Read-FileSnapshot `
    -Path $WorktreeGitignorePath `
    -MaximumBytes 2097152
if ($WorktreeGitignoreSnapshot.sha256 -ne $CommittedGitignoreSha256) {
    throw 'STOP READBACK_WORKTREE_GITIGNORE_DIFFERS_FROM_COMMITTED_BLOB'
}
$RepositoryExcludePath = Join-Path $ExpectedGitDirectory 'info\exclude'
if (Test-Path -LiteralPath $RepositoryExcludePath) {
    if (-not (Test-Path -LiteralPath $RepositoryExcludePath -PathType Leaf)) {
        throw 'STOP READBACK_REPOSITORY_EXCLUDE_PATH_TYPE_UNSAFE'
    }
    Assert-NoReparseBelowBoundary `
        -FullPath $RepositoryExcludePath `
        -Boundary $ExpectedGitDirectory `
        -FailureCode 'STOP READBACK_REPOSITORY_EXCLUDE_IS_REPARSE_OR_LINK'
    $RepositoryExcludeSnapshot = Read-FileSnapshot `
        -Path $RepositoryExcludePath `
        -MaximumBytes 2097152
    try {
        $RepositoryExcludeText = $StrictUtf8.GetString(
            $RepositoryExcludeSnapshot.bytes
        )
    }
    catch {
        throw 'STOP READBACK_REPOSITORY_EXCLUDE_NOT_STRICT_UTF8'
    }
    $ActiveRepositoryExcludes = @(
        $RepositoryExcludeText.Split(
            [char[]]@([char]13, [char]10),
            [StringSplitOptions]::RemoveEmptyEntries
        ) |
            Where-Object {
                $_.Trim().Length -gt 0 -and -not $_.StartsWith('#')
            }
    )
    if ($ActiveRepositoryExcludes.Count -gt 0) {
        throw 'STOP READBACK_ACTIVE_REPOSITORY_EXCLUDE_RULES'
    }
}
foreach ($CustodySentinel in @(
    'benchmarks/chart-intent-r26/cases/__VISIONASSIST_IGNORE_PROBE__',
    'benchmarks/chart-intent-r26/outcome-vault/__VISIONASSIST_IGNORE_PROBE__'
)) {
    $IgnoreProbeResult = Invoke-GitBinary `
        -Arguments (
            "-c core.fsmonitor=false -c core.excludesFile=NUL check-ignore --no-index -q -- {0}" -f
            $CustodySentinel
        ) `
        -AllowedExitCodes @(0, 1)
    if ($IgnoreProbeResult.exit_code -ne 0) {
        throw 'STOP READBACK_CUSTODY_SENTINEL_NOT_IGNORED'
    }
}

$CachedDiffResult = Invoke-GitBinary `
    -Arguments (
        "-c core.fsmonitor=false -c core.autocrlf=false diff --cached --quiet --no-ext-diff --no-textconv {0} --" -f
        $HeadSha
    ) `
    -AllowedExitCodes @(0, 1)
if ($CachedDiffResult.exit_code -ne 0) {
    throw 'STOP READBACK_INDEX_DIFFERS_FROM_HEAD'
}
Assert-FreshTransformAttributesUnassigned `
    -Paths ([string[]]@($IndexManifest.paths)) `
    -FailureCode 'STOP READBACK_TRANSFORM_ATTRIBUTE_ASSIGNED_BEFORE_DIFF_FILES'
$WorktreeDiffResult = Invoke-GitBinary `
    -Arguments (
        '-c core.fsmonitor=false -c core.autocrlf=false ' +
        'diff-files --quiet ' +
        '--no-ext-diff --no-textconv --'
    ) `
    -AllowedExitCodes @(0, 1)
if ($WorktreeDiffResult.exit_code -ne 0) {
    throw 'STOP READBACK_TRACKED_WORKTREE_DIFFERS_FROM_INDEX'
}
$UntrackedResult = Invoke-GitBinary `
    -Arguments (
        '-c core.fsmonitor=false -c core.excludesFile=NUL ' +
        '-c core.quotepath=false ls-files --others --exclude-standard -z'
    )
if ($UntrackedResult.bytes.Length -ne 0) {
    throw 'STOP READBACK_NONIGNORED_UNTRACKED_PATHS_PRESENT'
}
Assert-FreshTransformAttributesUnassigned `
    -Paths ([string[]]@($IndexManifest.paths)) `
    -FailureCode 'STOP READBACK_TRANSFORM_ATTRIBUTE_ASSIGNED_BEFORE_STATUS'
$StatusResult = Invoke-GitBinary `
    -Arguments (
        '-c core.fsmonitor=false -c core.excludesFile=NUL ' +
        '-c core.autocrlf=false ' +
        'status --porcelain=v1 -z --untracked-files=all'
    )
if ($StatusResult.bytes.Length -ne 0) {
    throw 'STOP READBACK_WORKTREE_NOT_CLEAN'
}
$FinalHeadResult = Invoke-GitBinary `
    -Arguments 'rev-parse --verify HEAD^{commit}'
$FinalHeadSha = $StrictUtf8.GetString(
    $FinalHeadResult.bytes
).Trim().ToLowerInvariant()
if ($FinalHeadSha -ne $HeadSha) {
    throw 'STOP READBACK_HEAD_MOVED_DURING_VALIDATION'
}
$FinalHeadReferenceResult = Invoke-GitBinary -Arguments 'symbolic-ref HEAD'
$FinalHeadReference = $StrictUtf8.GetString(
    $FinalHeadReferenceResult.bytes
).Trim()
if ($FinalHeadReference -ne $HeadReference) {
    throw 'STOP READBACK_HEAD_REFERENCE_MOVED_DURING_VALIDATION'
}

$LexicalOutputDirectory = Assert-LexicallyOutsideProjectRoot `
    -LiteralPath (Join-Path $LexicalTempRoot 'VisionAssistGitGenesisReadback') `
    -LexicalProjectRoot $LexicalExpectedRoot `
    -Label 'READBACK_OUTPUT_DIRECTORY'
$OutputParent = [IO.Directory]::GetParent($LexicalOutputDirectory)
if (
    -not $OutputParent -or
    -not (Test-Path -LiteralPath $OutputParent.FullName -PathType Container)
) {
    throw 'STOP READBACK_OUTPUT_PARENT_UNAVAILABLE'
}
Assert-NoReparseBelowBoundary `
    -FullPath $OutputParent.FullName `
    -Boundary ([IO.Path]::GetPathRoot($OutputParent.FullName)) `
    -FailureCode 'STOP READBACK_OUTPUT_PARENT_OR_ANCESTOR_IS_REPARSE_OR_LINK'
if (Test-Path -LiteralPath $LexicalOutputDirectory) {
    if (
        -not (
            Test-Path `
                -LiteralPath $LexicalOutputDirectory `
                -PathType Container
        )
    ) {
        throw 'STOP READBACK_OUTPUT_PATH_EXISTS_AND_IS_NOT_DIRECTORY'
    }
    Assert-NoReparseBelowBoundary `
        -FullPath $LexicalOutputDirectory `
        -Boundary ([IO.Path]::GetPathRoot($LexicalOutputDirectory)) `
        -FailureCode 'STOP READBACK_OUTPUT_DIRECTORY_IS_REPARSE_OR_LINK'
}
else {
    New-Item `
        -ItemType Directory `
        -Path $LexicalOutputDirectory `
        -ErrorAction Stop | Out-Null
}
$ResolvedOutputDirectory = Get-NormalizedFullPath `
    -LiteralPath $LexicalOutputDirectory
if (
    Test-IsSameOrUnderRoot `
        -FullPath $ResolvedOutputDirectory `
        -Root $ResolvedRoot
) {
    throw 'STOP READBACK_OUTPUT_DIRECTORY_INSIDE_PROJECT_ROOT'
}
Assert-NoReparseBelowBoundary `
    -FullPath $ResolvedOutputDirectory `
    -Boundary ([IO.Path]::GetPathRoot($ResolvedOutputDirectory)) `
    -FailureCode 'STOP READBACK_OUTPUT_DIRECTORY_IS_REPARSE_OR_LINK'

$ReadbackReceiptPath = Join-Path $ResolvedOutputDirectory (
    'VISIONASSIST_GIT_BASELINE_READBACK_' + $RunId + '.json'
)
$ReadbackReceipt = [ordered]@{
    schema_version = 'visionassist.git-baseline-readback.v1'
    readback_id = (
        'VA-GIT-READBACK-' +
        [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
    )
    run_id = $RunId
    started_at = $StartedAt
    recorded_at = [DateTime]::UtcNow.ToString('o')
    source_receipt = [ordered]@{
        path = $ResolvedReceiptPath
        sha256 = $SourceReceiptSnapshot.sha256
        sidecar_sha256 = $SidecarSnapshot.sha256
        receipt_id = $SourceReceipt.receipt_id
        staged_manifest_canonical_path = $CanonicalManifestSnapshot.path
        staged_manifest_sha256 = $CanonicalManifestSummary.sha256
    }
    readback = [ordered]@{
        project_root = $ResolvedRoot
        branch = $ExpectedBranch
        head_reference = $HeadReference
        head_sha = $HeadSha
        tree_sha = $TreeSha
        raw_parent_count = 0
        raw_message = $RawMessage
        committed_manifest_sha256 = $CommittedManifest.sha256
        index_manifest_sha256 = $IndexManifest.sha256
        committed_file_count = $CommittedManifest.count
        committed_gitignore_sha256 = $CommittedGitignoreSha256
        inventory_approval_equal_to_inventory = $true
        opaque_inventory_approval_equal_when_required = $true
        approved_tree_equal_to_raw_commit_tree = $true
        exact_ref_set_verified = $true
        index_equal_to_committed_tree = $true
        raw_worktree_blob_ids_equal_index = $true
        raw_worktree_verified_file_count = $RawWorktreeVerifiedFileCount
        tracked_worktree_equal_to_index = $true
        transform_attributes_unassigned_before_worktree_checks = $true
        nonignored_untracked_path_count = 0
        worktree_status = 'CLEAN'
        head_stable_through_final_check = $true
        head_stable_before_receipt_publication = $true
    }
    provenance = [ordered]@{
        readback_runner_path = $ScriptFullPath
        readback_runner_sha256 = $ReadbackRunnerSha256
        expected_readback_runner_sha256 = $ApprovedReadbackRunnerHash
        expected_genesis_runner_sha256 = $ApprovedGenesisRunnerHash
        source_runner_sha256 = $SourceRunnerSnapshot.sha256
        source_runner_sha256_verified = $true
        git_executable = $GitExecutable
        git_executable_sha256 = $GitExecutableSha256
        source_runner_hash_stable_before_publication = $true
        readback_runner_hash_stable_before_publication = $true
        git_executable_hash_stable_before_publication = $true
        executable_hashes_rechecked_after_final_git_calls = $true
        capture_class = 'SEPARATE_SCRIPT_SAME_HOST_UNSIGNED_READBACK'
    }
    custody_boundary = [ordered]@{
        committed_tree_custody_prefix_count = 0
        custody_file_blob_content_read_by_readback = $false
        custody_path_metadata_boolean_checks_performed = $true
        indirect_alias_or_git_config_custody_reads = 'UNVERIFIED'
        verify_custody_run_by_readback = $false
    }
    external_actions = [ordered]@{
        repository_mutation_invoked_by_readback = $false
        push_invoked_by_readback = $false
        deployment_invoked_by_readback = $false
        product_runtime_command_invoked_by_readback = $false
        ai_invoked_by_readback = $false
        fusion_invoked_by_readback = $false
        market_baseline_invoked_by_readback = $false
        reveal_invoked_by_readback = $false
        adjudication_invoked_by_readback = $false
        scoring_invoked_by_readback = $false
        trading_invoked_by_readback = $false
    }
    authority = [ordered]@{
        decision_status = 'DIAGNOSTIC_ONLY'
        domain_action_code = 'NO_ACTION'
        execution_permission = 'HOLD'
        capital_permission = 'DENY'
        can_trade = $false
    }
    terminal_status = 'LOCAL_READBACK_MATCH_PENDING_EXTERNAL_ACCEPTANCE'
}
$ReadbackReceiptTemporaryPath = (
    $ReadbackReceiptPath + '.unpublished.tmp'
)
if (Test-Path -LiteralPath $ReadbackReceiptPath) {
    throw 'STOP READBACK_OUTPUT_ALREADY_EXISTS'
}
Write-JsonTemporary `
    -Value $ReadbackReceipt `
    -TemporaryPath $ReadbackReceiptTemporaryPath
$TemporaryReceiptSnapshot = Read-FileSnapshot `
    -Path $ReadbackReceiptTemporaryPath `
    -MaximumBytes $MaximumReceiptBytes

$PublishSourceRunnerSnapshot = Read-FileSnapshot `
    -Path $SourceRunnerSnapshot.path `
    -MaximumBytes 4194304
$PublishReadbackRunnerSnapshot = Read-FileSnapshot `
    -Path $ScriptFullPath `
    -MaximumBytes 4194304
$PublishGitExecutableSnapshot = Read-FileSnapshot `
    -Path $GitExecutable `
    -MaximumBytes $MaximumCandidateBytes
$PublishGitExecutableSha256 = $PublishGitExecutableSnapshot.sha256
if (
    $PublishSourceRunnerSnapshot.sha256 -ne $ApprovedGenesisRunnerHash -or
    $PublishSourceRunnerSnapshot.sha256 -ne $SourceRunnerSnapshot.sha256 -or
    $PublishReadbackRunnerSnapshot.sha256 -ne $ApprovedReadbackRunnerHash -or
    $PublishReadbackRunnerSnapshot.sha256 -ne $ReadbackRunnerSha256 -or
    $PublishGitExecutableSha256 -ne $GitExecutableSha256
) {
    throw 'STOP GENESIS_RUNNER_READBACK_RUNNER_OR_GIT_CHANGED_BEFORE_PUBLICATION'
}
$PublishHeadResult = Invoke-GitBinary `
    -Arguments 'rev-parse --verify HEAD^{commit}'
$PublishHeadSha = $StrictUtf8.GetString(
    $PublishHeadResult.bytes
).Trim().ToLowerInvariant()
$PublishReferenceResult = Invoke-GitBinary -Arguments 'symbolic-ref HEAD'
$PublishReference = $StrictUtf8.GetString(
    $PublishReferenceResult.bytes
).Trim()
$PublishRefSetResult = Invoke-GitBinary `
    -Arguments 'for-each-ref --format=%(refname):%(objectname)'
$PublishRefLines = @(
    $StrictUtf8.GetString($PublishRefSetResult.bytes).Split(
        [char[]]@([char]13, [char]10),
        [StringSplitOptions]::RemoveEmptyEntries
    )
)
if (
    $PublishHeadSha -ne $HeadSha -or
    $PublishReference -ne $HeadReference -or
    $PublishRefLines.Count -ne 1 -or
    $PublishRefLines[0] -ne ($ExpectedHeadReference + ':' + $HeadSha)
) {
    throw 'STOP READBACK_HEAD_MOVED_BEFORE_RECEIPT_PUBLICATION'
}
$PostRefSourceRunnerSnapshot = Read-FileSnapshot `
    -Path $SourceRunnerSnapshot.path `
    -MaximumBytes 4194304
$PostRefReadbackRunnerSnapshot = Read-FileSnapshot `
    -Path $ScriptFullPath `
    -MaximumBytes 4194304
$PostRefGitExecutableSnapshot = Read-FileSnapshot `
    -Path $GitExecutable `
    -MaximumBytes $MaximumCandidateBytes
if (
    $PostRefSourceRunnerSnapshot.sha256 -ne $ApprovedGenesisRunnerHash -or
    $PostRefSourceRunnerSnapshot.sha256 -ne
        $PublishSourceRunnerSnapshot.sha256 -or
    $PostRefReadbackRunnerSnapshot.sha256 -ne $ApprovedReadbackRunnerHash -or
    $PostRefReadbackRunnerSnapshot.sha256 -ne
        $PublishReadbackRunnerSnapshot.sha256 -or
    $PostRefGitExecutableSnapshot.sha256 -ne $GitExecutableSha256 -or
    $PostRefGitExecutableSnapshot.sha256 -ne
        $PublishGitExecutableSnapshot.sha256
) {
    throw 'STOP EXECUTABLE_HASH_CHANGED_AFTER_FINAL_GIT_READBACK'
}
if (Test-Path -LiteralPath $ReadbackReceiptPath) {
    throw 'STOP READBACK_OUTPUT_APPEARED_BEFORE_PUBLICATION'
}
[IO.File]::Move(
    $ReadbackReceiptTemporaryPath,
    $ReadbackReceiptPath
)
$PublishedReceiptSnapshot = Read-FileSnapshot `
    -Path $ReadbackReceiptPath `
    -MaximumBytes $MaximumReceiptBytes
$ReadbackReceiptSha256 = $PublishedReceiptSnapshot.sha256
if ($ReadbackReceiptSha256 -ne $TemporaryReceiptSnapshot.sha256) {
    throw 'STOP READBACK_RECEIPT_CHANGED_DURING_PUBLICATION'
}
try {
    $PublishedReceipt = (
        $StrictUtf8.GetString($PublishedReceiptSnapshot.bytes) |
            ConvertFrom-Json
    )
}
catch {
    throw 'STOP PUBLISHED_READBACK_RECEIPT_IS_NOT_STRICT_UTF8_JSON'
}
if (
    $PublishedReceipt.readback.head_sha -ne $HeadSha -or
    $PublishedReceipt.readback.tree_sha -ne $TreeSha -or
    [int]$PublishedReceipt.readback.raw_parent_count -ne 0 -or
    $PublishedReceipt.authority.can_trade -ne $false -or
    $PublishedReceipt.terminal_status -ne
        'LOCAL_READBACK_MATCH_PENDING_EXTERNAL_ACCEPTANCE'
) {
    throw 'STOP PUBLISHED_READBACK_RECEIPT_CONTENT_MISMATCH'
}
$ReadbackSidecarPath = $ReadbackReceiptPath + '.sha256'
$ReadbackSidecarBytes = $Utf8NoBom.GetBytes(
    $ReadbackReceiptSha256 +
    '  ' +
    [IO.Path]::GetFileName($ReadbackReceiptPath) +
    [Environment]::NewLine
)
Write-BytesAtomic `
    -Path $ReadbackSidecarPath `
    -Bytes $ReadbackSidecarBytes

Write-Host 'READBACK MATCHED; THIS SCRIPT INVOKED NO REPOSITORY MUTATION.'
Write-Host "HEAD: $HeadSha"
Write-Host "TREE: $TreeSha"
Write-Host 'PARENTS: 0'
Write-Host 'STATUS: CLEAN'
Write-Host "Readback receipt: $ReadbackReceiptPath"
Write-Host "Readback receipt SHA-256: $ReadbackReceiptSha256"
