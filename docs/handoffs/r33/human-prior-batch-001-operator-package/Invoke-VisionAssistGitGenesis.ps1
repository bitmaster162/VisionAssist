[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{64}$')]
    [string]$ExpectedRunnerSha256,

    [ValidateSet('Prepare', 'Stage', 'Commit')]
    [string]$Mode = 'Prepare',

    [ValidatePattern('^[0-9a-fA-F]{64}$')]
    [string]$ApproveInventorySha256,

    [ValidatePattern('^[0-9a-fA-F]{64}$')]
    [string]$ApproveOpaqueInventorySha256,

    [ValidatePattern('^[0-9a-fA-F]{40}$|^[0-9a-fA-F]{64}$')]
    [string]$ApproveTreeSha
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedRoot = '<VISIONASSIST_REPO_ROOT>'
$ExpectedBranch = 'master'
$AuthorizationId = 'VA-GIT-GENESIS-20260727T191910Z'
$CommitMessage = 'chore: establish VisionAssist genesis baseline'
$ReceiptDirectory = Join-Path $env:TEMP 'VisionAssistGitGenesis'
$RunId = [Guid]::NewGuid().ToString('D')
$StartedAt = [DateTime]::UtcNow.ToString('o')
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$StrictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
$BytePreservingEncoding = [Text.Encoding]::GetEncoding(28591)
$MaximumCandidateBytes = 268435456

$CustodyPattern = '(?i)^benchmarks/chart-intent-r26/(cases|outcome-vault)(/|$)'
$EnvPathPattern = '(?i)(^|/)\.env(?:\.[^/]*)?($|/)'
$BlockedPathPattern = '(?i)(^|/)(\.npmrc|\.pypirc|\.netrc|credentials?(?:\.[^/]*)?|service-account(?:\.[^/]*)?|kubeconfig|id_rsa(?:\.[^/]*)?|id_ed25519(?:\.[^/]*)?)(/|$)|(^|/)secrets?(/|$)|\.(pem|key|p12|pfx|kdbx|jks|keystore|ovpn|db|sqlite|sqlite3|dump|bak|zip|7z|rar|tar|tgz|gz|bz2|xz|exe|dll|dylib|so|msi|iso)$'
$DotEnvExamplePattern = '(?i)(^|/)\.env\.example$'
$TextSecretPattern = '(?i)(-----BEGIN [A-Z ]*PRIVATE KEY-----|(AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|(sk|rk)_(live|test)_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]+|"(api[_-]?key|secret|token|password|private[_-]?key)"\s*:\s*"[^"]{8,}")'
$GitSecretPattern = '(-----BEGIN [A-Z ]*PRIVATE KEY-----|(AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|(sk|rk)_(live|test)_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]+|"(api[_-]?key|secret|token|password|private[_-]?key)"[[:space:]]*:[[:space:]]*"[^"]{8,}")'

$OpaqueBinaryExtensions = @(
    '.bmp', '.doc', '.docx', '.eot', '.gif', '.ico', '.jpeg', '.jpg',
    '.mov', '.mp3', '.mp4', '.otf', '.pdf', '.png', '.ppt', '.pptx',
    '.tif', '.tiff', '.ttf', '.wav', '.webm', '.webp', '.woff', '.woff2',
    '.xls', '.xlsx'
)

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
$SecretPolicyHasher = [Security.Cryptography.SHA256]::Create()
try {
    $SecretPolicyBytes = $StrictUtf8.GetBytes(
        $CustodyPattern + "`n" +
        $EnvPathPattern + "`n" +
        $BlockedPathPattern + "`n" +
        $DotEnvExamplePattern + "`n" +
        ($OpaqueBinaryExtensions -join "`n") + "`n" +
        ([string]$MaximumCandidateBytes) + "`n" +
        'byte-preserving-secret-scan=iso-8859-1' + "`n" +
        $TextSecretPattern + "`n" +
        $GitSecretPattern + "`n" +
        $SafetyBlockNormalized
    )
    $SecretPolicySha256 = [BitConverter]::ToString(
        $SecretPolicyHasher.ComputeHash($SecretPolicyBytes)
    ).Replace('-', '').ToLowerInvariant()
}
finally {
    $SecretPolicyHasher.Dispose()
}

function Get-NormalizedFullPath {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    $Resolved = (Resolve-Path -LiteralPath $LiteralPath -ErrorAction Stop).Path
    return [IO.Path]::GetFullPath($Resolved).TrimEnd([char[]]@(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ))
}

function Test-IsUnderRoot {
    param(
        [Parameter(Mandatory = $true)][string]$FullPath,
        [Parameter(Mandatory = $true)][string]$Root
    )

    $RootPrefix = $Root.TrimEnd([char[]]@(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )) + [IO.Path]::DirectorySeparatorChar

    return $FullPath.StartsWith(
        $RootPrefix,
        [StringComparison]::OrdinalIgnoreCase
    )
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
    if ([StringComparer]::OrdinalIgnoreCase.Equals($NormalizedPath, $NormalizedRoot)) {
        return $true
    }
    return Test-IsUnderRoot -FullPath $NormalizedPath -Root $NormalizedRoot
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
        $CurrentItem = Get-Item -LiteralPath $CurrentPath -Force -ErrorAction Stop
        if (
            (($CurrentItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) -or
            ($CurrentItem.PSObject.Properties.Name -contains 'LinkType' -and $CurrentItem.LinkType)
        ) {
            throw $FailureCode
        }

        if ([StringComparer]::OrdinalIgnoreCase.Equals($CurrentPath, $NormalizedBoundary)) {
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

function Write-JsonFile {
    param(
        [Parameter(Mandatory = $true)]$Value,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $Json = $Value | ConvertTo-Json -Depth 12
    Write-BytesAtomic `
        -Path $Path `
        -Bytes ($Utf8NoBom.GetBytes($Json + [Environment]::NewLine))
}

function Write-BytesAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][byte[]]$Bytes
    )

    if (Test-Path -LiteralPath $Path) {
        throw "STOP OUTPUT_ARTIFACT_ALREADY_EXISTS: $([IO.Path]::GetFileName($Path))"
    }
    $TemporaryPath = $Path + '.' + $RunId + '.tmp'
    if (Test-Path -LiteralPath $TemporaryPath) {
        throw 'STOP OUTPUT_TEMPORARY_ARTIFACT_ALREADY_EXISTS'
    }

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

function ConvertTo-Utf8LineFileBytes {
    param([Parameter(Mandatory = $true)]$Lines)

    $LineArray = @($Lines)
    if ($LineArray.Count -eq 0) {
        return ,([byte[]]@())
    }
    $EncodedLines = $Utf8NoBom.GetBytes(
        ($LineArray -join [Environment]::NewLine) +
        [Environment]::NewLine
    )
    return ,([byte[]]$EncodedLines)
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

function Invoke-GitBinary {
    param(
        [Parameter(Mandatory = $true)][string]$Arguments,
        [int[]]$AllowedExitCodes = @(0),
        [byte[]]$StandardInputBytes = $null,
        [switch]$AllowStandardError,
        [hashtable]$EnvironmentOverrides = $null
    )

    $StartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $StartInfo.FileName = $GitExecutable
    $StartInfo.Arguments = '--no-pager --no-replace-objects ' + $Arguments
    $StartInfo.WorkingDirectory = $ResolvedRoot
    $StartInfo.UseShellExecute = $false
    $StartInfo.RedirectStandardOutput = $true
    $StartInfo.RedirectStandardError = $true
    $StartInfo.RedirectStandardInput = $null -ne $StandardInputBytes
    $StartInfo.CreateNoWindow = $true
    $StartInfo.EnvironmentVariables['GIT_CONFIG_NOSYSTEM'] = '1'
    $StartInfo.EnvironmentVariables['GIT_CONFIG_GLOBAL'] = 'NUL'
    $StartInfo.EnvironmentVariables['GIT_ATTR_NOSYSTEM'] = '1'
    $StartInfo.EnvironmentVariables['GIT_PAGER'] = 'cat'
    $StartInfo.EnvironmentVariables['GIT_NO_REPLACE_OBJECTS'] = '1'
    $StartInfo.EnvironmentVariables['GIT_NO_LAZY_FETCH'] = '1'
    $StartInfo.EnvironmentVariables['GIT_TERMINAL_PROMPT'] = '0'
    if ($EnvironmentOverrides) {
        foreach ($EnvironmentName in $EnvironmentOverrides.Keys) {
            $StartInfo.EnvironmentVariables[[string]$EnvironmentName] = (
                [string]$EnvironmentOverrides[$EnvironmentName]
            )
        }
    }

    $Process = New-Object System.Diagnostics.Process
    $Process.StartInfo = $StartInfo
    if (-not $Process.Start()) {
        throw 'STOP GIT_PROCESS_START_FAILED'
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
        throw "STOP GIT_BINARY_COMMAND_FAILED: exit=$ExitCode"
    }
    if (
        -not $AllowStandardError -and
        $StandardError -and
        $StandardError.Trim().Length -gt 0
    ) {
        throw 'STOP GIT_BINARY_COMMAND_REPORTED_STDERR'
    }

    return [ordered]@{
        bytes = $Output.ToArray()
        exit_code = $ExitCode
        stderr_present = [bool]($StandardError -and $StandardError.Trim().Length -gt 0)
    }
}

function ConvertFrom-NulPathBytes {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)

    if ($Bytes.Length -eq 0) {
        return @()
    }

    $Text = $StrictUtf8.GetString($Bytes)
    if ($Text[$Text.Length - 1] -ne [char]0) {
        throw 'STOP GIT_NUL_PATH_STREAM_NOT_TERMINATED'
    }

    $Parts = $Text.Split([char]0)
    if ($Parts[$Parts.Count - 1] -ne '') {
        throw 'STOP GIT_NUL_PATH_STREAM_PARSE_FAILED'
    }
    if ($Parts.Count -eq 1) {
        return @()
    }

    return @($Parts[0..($Parts.Count - 2)])
}

function Get-OrdinalUnique {
    param([Parameter(Mandatory = $true)][string[]]$Values)

    $Set = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($Value in $Values) {
        if ($Value -and -not $Set.Add($Value)) {
            continue
        }
    }
    $Result = [string[]]@($Set)
    [Array]::Sort($Result, [StringComparer]::Ordinal)
    return @($Result)
}

function Assert-ExactOrderedPathSet {
    param(
        [Parameter(Mandatory = $true)][string[]]$Expected,
        [Parameter(Mandatory = $true)][string[]]$Observed,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )

    if ($Expected.Count -ne $Observed.Count) {
        throw $FailureCode
    }
    for ($Index = 0; $Index -lt $Expected.Count; $Index++) {
        if (-not [StringComparer]::Ordinal.Equals($Expected[$Index], $Observed[$Index])) {
            throw $FailureCode
        }
    }
}

function Get-CandidatePaths {
    $TrackedResult = Invoke-GitBinary `
        -Arguments '-c core.fsmonitor=false -c core.excludesFile=NUL -c core.quotepath=false ls-files -z'
    $UntrackedResult = Invoke-GitBinary `
        -Arguments '-c core.fsmonitor=false -c core.excludesFile=NUL -c core.quotepath=false ls-files --others --exclude-standard -z'

    $Tracked = @(ConvertFrom-NulPathBytes -Bytes $TrackedResult.bytes)
    $Untracked = @(ConvertFrom-NulPathBytes -Bytes $UntrackedResult.bytes)
    return @(Get-OrdinalUnique -Values ([string[]]@($Tracked + $Untracked)))
}

function Assert-CandidatePathsSafe {
    param([Parameter(Mandatory = $true)][string[]]$Paths)

    $Malformed = @(
        $Paths | Where-Object {
            $_ -match '(^|/)\.\.(/|$)' -or
            $_ -match '^[A-Za-z]:' -or
            $_ -match '^/' -or
            $_ -match "[`r`n`t]"
        }
    )
    if ($Malformed.Count -gt 0) {
        throw "STOP MALFORMED_OR_ESCAPING_CANDIDATE_PATH: count=$($Malformed.Count)"
    }

    $CaseFoldedSet = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($RelativePath in $Paths) {
        if (-not $CaseFoldedSet.Add($RelativePath)) {
            throw 'STOP CASE_COLLIDING_CANDIDATE_PATHS'
        }
    }

    $Blocked = @(
        $Paths | Where-Object {
            $_ -match $CustodyPattern -or
            $_ -match $BlockedPathPattern -or
            (($_ -match $EnvPathPattern) -and ($_ -notmatch $DotEnvExamplePattern))
        }
    )
    if ($Blocked.Count -gt 0) {
        throw "STOP BLOCKED_PATH_IN_CANDIDATE_SET: count=$($Blocked.Count)"
    }
}

function Write-NulPathspec {
    param(
        [Parameter(Mandatory = $true)][string[]]$Paths,
        [Parameter(Mandatory = $true)][string]$Path
    )

    Write-BytesAtomic `
        -Path $Path `
        -Bytes (ConvertTo-NulPathBytes -Paths $Paths)
}

function ConvertTo-NulPathBytes {
    param([Parameter(Mandatory = $true)][string[]]$Paths)

    $Buffer = New-Object IO.MemoryStream
    foreach ($RelativePath in $Paths) {
        $Bytes = $StrictUtf8.GetBytes($RelativePath)
        $Buffer.Write($Bytes, 0, $Bytes.Length)
        $Buffer.WriteByte(0)
    }
    $Result = $Buffer.ToArray()
    $Buffer.Dispose()
    return ,([byte[]]$Result)
}

function Assert-GitObjectId {
    param(
        [Parameter(Mandatory = $true)][string]$ObjectId,
        [Parameter(Mandatory = $true)][string]$ObjectFormat,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $ExpectedLength = if ($ObjectFormat -eq 'sha1') {
        40
    }
    elseif ($ObjectFormat -eq 'sha256') {
        64
    }
    else {
        throw "STOP UNSUPPORTED_GIT_OBJECT_FORMAT: $ObjectFormat"
    }

    if ($ObjectId.Length -ne $ExpectedLength -or $ObjectId -notmatch '^[0-9a-f]+$') {
        throw "STOP INVALID_$($Label)_OBJECT_ID"
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

function Assert-CandidateAttributesDoNotTransform {
    param(
        [Parameter(Mandatory = $true)][string[]]$Paths,
        [Parameter(Mandatory = $true)][string]$FailureCodePrefix
    )

    $AttributeNames = @(
        'filter',
        'text',
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
    $AttributeFields = @(
        ConvertFrom-NulPathBytes -Bytes $AttributeResult.bytes
    )
    $ExpectedFieldCount = $Paths.Count * $AttributeNames.Count * 3
    if ($AttributeFields.Count -ne $ExpectedFieldCount) {
        throw ($FailureCodePrefix + '_MALFORMED_ATTRIBUTE_OUTPUT')
    }

    $ExpectedKeys = New-Object `
        'System.Collections.Generic.HashSet[string]' `
        ([StringComparer]::Ordinal)
    foreach ($RelativePath in $Paths) {
        foreach ($AttributeName in $AttributeNames) {
            $ExpectedKeys.Add(
                $RelativePath + [char]0 + $AttributeName
            ) | Out-Null
        }
    }

    for ($FieldIndex = 0; $FieldIndex -lt $AttributeFields.Count; $FieldIndex += 3) {
        $AttributePath = $AttributeFields[$FieldIndex]
        $AttributeName = $AttributeFields[$FieldIndex + 1]
        $AttributeValue = $AttributeFields[$FieldIndex + 2]
        $AttributeKey = $AttributePath + [char]0 + $AttributeName
        if (-not $ExpectedKeys.Remove($AttributeKey)) {
            throw ($FailureCodePrefix + '_UNEXPECTED_OR_DUPLICATE_ATTRIBUTE')
        }
        if (
            $AttributeValue -ne 'unspecified' -and
            $AttributeValue -ne 'unset'
        ) {
            throw ($FailureCodePrefix + '_TRANSFORM_ATTRIBUTE_ASSIGNED')
        }
    }
    if ($ExpectedKeys.Count -ne 0) {
        throw ($FailureCodePrefix + '_ATTRIBUTE_RESULT_INCOMPLETE')
    }
}

function Get-Inventory {
    param(
        [Parameter(Mandatory = $true)][string[]]$Paths,
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$OutputPath
    )

    $ReadableLines = New-Object System.Collections.Generic.List[string]
    $CanonicalBytes = New-Object IO.MemoryStream
    $Opaque = New-Object System.Collections.Generic.List[string]
    $OpaqueReadableLines = New-Object System.Collections.Generic.List[string]
    $OpaqueCanonicalBytes = New-Object IO.MemoryStream
    $SecretHits = New-Object System.Collections.Generic.List[string]
    $GitBlobIdsByPath = New-Object `
        'System.Collections.Generic.Dictionary[string,string]' `
        ([StringComparer]::Ordinal)

    foreach ($HeaderField in @(
        'visionassist.git-genesis-inventory.v4',
        $Root,
        $ExpectedBranch,
        $CommitMessage,
        $SecretPolicySha256,
        $RunnerSha256,
        $ObjectFormat
    )) {
        $HeaderBytes = $StrictUtf8.GetBytes($HeaderField)
        $CanonicalBytes.Write($HeaderBytes, 0, $HeaderBytes.Length)
        $CanonicalBytes.WriteByte(0)
    }
    foreach ($OpaqueHeaderField in @(
        'visionassist.git-genesis-opaque-inventory.v2',
        $Root,
        $ExpectedBranch,
        $RunnerSha256,
        $ObjectFormat
    )) {
        $OpaqueHeaderBytes = $StrictUtf8.GetBytes($OpaqueHeaderField)
        $OpaqueCanonicalBytes.Write(
            $OpaqueHeaderBytes,
            0,
            $OpaqueHeaderBytes.Length
        )
        $OpaqueCanonicalBytes.WriteByte(0)
    }

    foreach ($RelativePath in $Paths) {
        if ($RelativePath -match $CustodyPattern) {
            throw 'STOP CUSTODY_PATH_REACHED_DURING_INVENTORY'
        }

        $PlatformRelativePath = $RelativePath.Replace(
            '/',
            [IO.Path]::DirectorySeparatorChar
        )
        $FullPath = [IO.Path]::GetFullPath((Join-Path $Root $PlatformRelativePath))
        if (-not (Test-IsUnderRoot -FullPath $FullPath -Root $Root)) {
            throw "STOP CANDIDATE_ESCAPES_ROOT: $RelativePath"
        }
        if (-not (Test-Path -LiteralPath $FullPath -PathType Leaf)) {
            throw "STOP CANDIDATE_NOT_A_REGULAR_FILE: $RelativePath"
        }
        Assert-NoReparseBelowBoundary `
            -FullPath $FullPath `
            -Boundary $Root `
            -FailureCode "STOP CANDIDATE_OR_ANCESTOR_IS_REPARSE_POINT: $RelativePath"

        $Item = Get-Item -LiteralPath $FullPath -Force
        if (
            $Item.PSIsContainer -or
            ($Item.PSObject.Properties.Name -contains 'LinkType' -and $Item.LinkType)
        ) {
            throw "STOP LINK_OR_NONREGULAR_CANDIDATE: $RelativePath"
        }
        $CandidateStream = [IO.File]::Open(
            $FullPath,
            [IO.FileMode]::Open,
            [IO.FileAccess]::Read,
            [IO.FileShare]::Read
        )
        try {
            Assert-NoReparseBelowBoundary `
                -FullPath $FullPath `
                -Boundary $Root `
                -FailureCode "STOP CANDIDATE_OR_ANCESTOR_CHANGED_TO_REPARSE_POINT: $RelativePath"
            $PostOpenItem = Get-Item -LiteralPath $FullPath -Force
            if (
                $PostOpenItem.PSIsContainer -or
                (
                    $PostOpenItem.PSObject.Properties.Name -contains 'LinkType' -and
                    $PostOpenItem.LinkType
                )
            ) {
                throw "STOP LINK_OR_NONREGULAR_CANDIDATE_AFTER_OPEN: $RelativePath"
            }

            $Length = $CandidateStream.Length
            if ($Length -lt 0 -or $Length -gt $MaximumCandidateBytes) {
                throw "STOP CANDIDATE_EXCEEDS_SINGLE_SNAPSHOT_LIMIT: $RelativePath"
            }
            if ([int64]$PostOpenItem.Length -ne $Length) {
                throw "STOP CANDIDATE_METADATA_CHANGED_DURING_OPEN: $RelativePath"
            }

            [byte[]]$CandidateBytes = [Array]::CreateInstance(
                [byte],
                [int]$Length
            )
            $Offset = 0
            while ($Offset -lt $CandidateBytes.Length) {
                $ReadCount = $CandidateStream.Read(
                    $CandidateBytes,
                    $Offset,
                    $CandidateBytes.Length - $Offset
                )
                if ($ReadCount -le 0) {
                    throw "STOP CANDIDATE_SHORT_READ: $RelativePath"
                }
                $Offset += $ReadCount
            }
            if ($CandidateStream.ReadByte() -ne -1) {
                throw "STOP CANDIDATE_GREW_DURING_READ: $RelativePath"
            }

            $Hash = Get-Sha256HexFromBytes -Bytes $CandidateBytes
            $GitBlobId = Get-GitBlobObjectIdFromBytes `
                -Bytes $CandidateBytes `
                -ObjectFormat $ObjectFormat
            Assert-GitObjectId `
                -ObjectId $GitBlobId `
                -ObjectFormat $ObjectFormat `
                -Label 'INVENTORY_BLOB'
            if ($GitBlobIdsByPath.ContainsKey($RelativePath)) {
                throw 'STOP DUPLICATE_PATH_DURING_INVENTORY'
            }
            $GitBlobIdsByPath.Add($RelativePath, $GitBlobId)
            $ReadableLines.Add(
                ("{0}`t{1}`t{2}`t{3}" -f
                    $Hash,
                    $GitBlobId,
                    $Length,
                    $RelativePath
                )
            )
            foreach ($Field in @(
                $Hash,
                $GitBlobId,
                ([string]$Length),
                $RelativePath
            )) {
                $FieldBytes = $StrictUtf8.GetBytes($Field)
                $CanonicalBytes.Write($FieldBytes, 0, $FieldBytes.Length)
                $CanonicalBytes.WriteByte(0)
            }

            $BytePreservingText = $BytePreservingEncoding.GetString(
                $CandidateBytes
            )
            if ($BytePreservingText -match $TextSecretPattern) {
                $SecretHits.Add($RelativePath)
            }

            $Extension = [IO.Path]::GetExtension($FullPath).ToLowerInvariant()
            $IsOpaque = $OpaqueBinaryExtensions -contains $Extension
            if (-not $IsOpaque) {
                try {
                    $StrictText = $StrictUtf8.GetString($CandidateBytes)
                    if ($StrictText.IndexOf([char]0) -ge 0) {
                        $IsOpaque = $true
                    }
                }
                catch {
                    $IsOpaque = $true
                }
            }

            if ($IsOpaque) {
                $Opaque.Add($RelativePath)
                $OpaqueReadableLines.Add(
                    ("{0}`t{1}`t{2}`t{3}" -f
                        $Hash,
                        $GitBlobId,
                        $Length,
                        $RelativePath
                    )
                )
                foreach ($OpaqueField in @(
                    $Hash,
                    $GitBlobId,
                    ([string]$Length),
                    $RelativePath
                )) {
                    $OpaqueFieldBytes = $StrictUtf8.GetBytes($OpaqueField)
                    $OpaqueCanonicalBytes.Write(
                        $OpaqueFieldBytes,
                        0,
                        $OpaqueFieldBytes.Length
                    )
                    $OpaqueCanonicalBytes.WriteByte(0)
                }
            }
        }
        finally {
            $CandidateStream.Dispose()
        }
    }

    if ($SecretHits.Count -gt 0) {
        throw "STOP POSSIBLE_SECRET_CONTENT: count=$($SecretHits.Count); paths_and_values_not_printed"
    }

    Write-BytesAtomic `
        -Path $OutputPath `
        -Bytes (ConvertTo-Utf8LineFileBytes -Lines $ReadableLines)
    $CanonicalPath = $OutputPath + '.nul'
    $CanonicalOutputBytes = $CanonicalBytes.ToArray()
    $CanonicalBytes.Dispose()
    Write-BytesAtomic -Path $CanonicalPath -Bytes $CanonicalOutputBytes
    $InventoryHash = (Get-FileHash -LiteralPath $CanonicalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $OpaqueReadablePath = $OutputPath + '.opaque.tsv'
    $OpaqueCanonicalPath = $OutputPath + '.opaque.nul'
    Write-BytesAtomic `
        -Path $OpaqueReadablePath `
        -Bytes (ConvertTo-Utf8LineFileBytes -Lines $OpaqueReadableLines)
    $OpaqueCanonicalOutputBytes = $OpaqueCanonicalBytes.ToArray()
    $OpaqueCanonicalBytes.Dispose()
    Write-BytesAtomic `
        -Path $OpaqueCanonicalPath `
        -Bytes $OpaqueCanonicalOutputBytes
    $OpaqueInventoryHash = (Get-FileHash -LiteralPath $OpaqueCanonicalPath -Algorithm SHA256).Hash.ToLowerInvariant()

    return [ordered]@{
        sha256 = $InventoryHash
        canonical_path = $CanonicalPath
        readable_path = $OutputPath
        candidate_count = $Paths.Count
        opaque_binary_count = $Opaque.Count
        opaque_binary_paths = @($Opaque)
        opaque_readable_path = $OpaqueReadablePath
        opaque_canonical_path = $OpaqueCanonicalPath
        opaque_sha256 = $OpaqueInventoryHash
        git_blob_ids_by_path = $GitBlobIdsByPath
        ascii_secret_signature_scan_passed = $true
        maximum_candidate_bytes = $MaximumCandidateBytes
        snapshot_read_mode = 'ONE_OPEN_HANDLE_FILESHARE_READ'
    }
}

function Get-StagedManifest {
    param(
        [Parameter(Mandatory = $true)][string]$OutputPath,
        [string]$IndexFile
    )

    $IndexEnvironment = $null
    if ($IndexFile) {
        $IndexEnvironment = @{
            GIT_INDEX_FILE = $IndexFile
        }
    }
    $StageResult = Invoke-GitBinary `
        -Arguments '-c core.fsmonitor=false -c core.excludesFile=NUL -c core.quotepath=false ls-files --stage -z' `
        -EnvironmentOverrides $IndexEnvironment
    $Records = @(ConvertFrom-NulPathBytes -Bytes $StageResult.bytes)
    $ReadableLines = New-Object System.Collections.Generic.List[string]
    $CanonicalBytes = New-Object IO.MemoryStream
    $Paths = New-Object System.Collections.Generic.List[string]
    $ModesByPath = New-Object `
        'System.Collections.Generic.Dictionary[string,string]' `
        ([StringComparer]::Ordinal)
    $BlobIdsByPath = New-Object `
        'System.Collections.Generic.Dictionary[string,string]' `
        ([StringComparer]::Ordinal)

    foreach ($HeaderField in @(
        'visionassist.git-genesis-staged-manifest.v1',
        $ResolvedRoot,
        $ExpectedBranch,
        $ObjectFormat
    )) {
        $HeaderBytes = $StrictUtf8.GetBytes($HeaderField)
        $CanonicalBytes.Write($HeaderBytes, 0, $HeaderBytes.Length)
        $CanonicalBytes.WriteByte(0)
    }

    foreach ($Record in $Records) {
        $TabIndex = $Record.IndexOf([char]9)
        if ($TabIndex -lt 1) {
            throw 'STOP MALFORMED_STAGED_INDEX_RECORD'
        }
        $Metadata = $Record.Substring(0, $TabIndex)
        $RelativePath = $Record.Substring($TabIndex + 1)
        if (
            $RelativePath -match '(^|/)\.\.(/|$)' -or
            $RelativePath -match '^[A-Za-z]:' -or
            $RelativePath -match '^/' -or
            $RelativePath -match "[`r`n`t]"
        ) {
            throw 'STOP MALFORMED_OR_ESCAPING_PATH_REACHED_DURING_STAGED_MANIFEST'
        }
        if (
            $RelativePath -match $CustodyPattern -or
            $RelativePath -match $BlockedPathPattern -or
            (
                ($RelativePath -match $EnvPathPattern) -and
                ($RelativePath -notmatch $DotEnvExamplePattern)
            )
        ) {
            throw 'STOP BLOCKED_PATH_REACHED_DURING_STAGED_MANIFEST'
        }
        $MetadataParts = @($Metadata -split ' ')
        if ($MetadataParts.Count -ne 3) {
            throw 'STOP MALFORMED_STAGED_INDEX_METADATA'
        }

        $Mode = $MetadataParts[0]
        $BlobId = $MetadataParts[1].ToLowerInvariant()
        $StageNumber = $MetadataParts[2]
        if ($StageNumber -ne '0') {
            throw 'STOP NONZERO_INDEX_STAGE'
        }
        if ($Mode -eq '120000') {
            throw 'STOP SYMLINK_STAGED'
        }
        if ($Mode -eq '160000') {
            throw 'STOP GITLINK_OR_SUBMODULE_STAGED'
        }
        if ($Mode -ne '100644' -and $Mode -ne '100755') {
            throw "STOP UNSUPPORTED_STAGED_MODE: $Mode"
        }
        Assert-GitObjectId -ObjectId $BlobId -ObjectFormat $ObjectFormat -Label 'BLOB'

        if (
            $ModesByPath.ContainsKey($RelativePath) -or
            $BlobIdsByPath.ContainsKey($RelativePath)
        ) {
            throw 'STOP DUPLICATE_STAGED_PATH'
        }
        $ModesByPath.Add($RelativePath, $Mode)
        $BlobIdsByPath.Add($RelativePath, $BlobId)
        $Paths.Add($RelativePath)
        $ReadableLines.Add(("{0}`t{1}`t{2}" -f $Mode, $BlobId, $RelativePath))
        foreach ($Field in @($Mode, $BlobId, $RelativePath)) {
            $FieldBytes = $StrictUtf8.GetBytes($Field)
            $CanonicalBytes.Write($FieldBytes, 0, $FieldBytes.Length)
            $CanonicalBytes.WriteByte(0)
        }
    }

    $SortedPaths = @(Get-OrdinalUnique -Values ([string[]]@($Paths)))
    if ($SortedPaths.Count -ne $Paths.Count) {
        throw 'STOP DUPLICATE_STAGED_PATH'
    }
    Write-BytesAtomic `
        -Path $OutputPath `
        -Bytes (ConvertTo-Utf8LineFileBytes -Lines $ReadableLines)
    $CanonicalPath = $OutputPath + '.nul'
    $CanonicalOutputBytes = $CanonicalBytes.ToArray()
    $CanonicalBytes.Dispose()
    Write-BytesAtomic -Path $CanonicalPath -Bytes $CanonicalOutputBytes

    return [ordered]@{
        readable_path = $OutputPath
        canonical_path = $CanonicalPath
        sha256 = (Get-FileHash -LiteralPath $CanonicalPath -Algorithm SHA256).Hash.ToLowerInvariant()
        count = $Paths.Count
        paths = $SortedPaths
        modes_by_path = $ModesByPath
        blob_ids_by_path = $BlobIdsByPath
    }
}

function ConvertTo-IndexInfoBytes {
    param([Parameter(Mandatory = $true)]$Manifest)

    $Buffer = New-Object IO.MemoryStream
    foreach ($RelativePath in $Manifest.paths) {
        if (
            -not $Manifest.modes_by_path.ContainsKey($RelativePath) -or
            -not $Manifest.blob_ids_by_path.ContainsKey($RelativePath)
        ) {
            throw 'STOP EXACT_MANIFEST_ENTRY_MISSING'
        }
        $Record = (
            $Manifest.modes_by_path[$RelativePath] + ' ' +
            $Manifest.blob_ids_by_path[$RelativePath] + ' 0' +
            [char]9 +
            $RelativePath
        )
        $RecordBytes = $StrictUtf8.GetBytes($Record)
        $Buffer.Write($RecordBytes, 0, $RecordBytes.Length)
        $Buffer.WriteByte(0)
    }
    $Result = $Buffer.ToArray()
    $Buffer.Dispose()
    return ,([byte[]]$Result)
}

function Get-TreeFromExactStagedManifest {
    param(
        [Parameter(Mandatory = $true)]$Manifest,
        [Parameter(Mandatory = $true)][string]$VerificationIndexPath,
        [Parameter(Mandatory = $true)][string]$VerificationManifestPath
    )

    if (Test-Path -LiteralPath $VerificationIndexPath) {
        throw 'STOP VERIFICATION_INDEX_ALREADY_EXISTS'
    }
    $IndexEnvironment = @{
        GIT_INDEX_FILE = $VerificationIndexPath
    }
    $IndexInfoBytes = ConvertTo-IndexInfoBytes -Manifest $Manifest
    $UpdateResult = Invoke-GitBinary `
        -Arguments '-c core.splitIndex=false update-index --index-version=2 -z --index-info' `
        -StandardInputBytes $IndexInfoBytes `
        -EnvironmentOverrides $IndexEnvironment
    if ($UpdateResult.bytes.Length -ne 0) {
        throw 'STOP VERIFICATION_INDEX_BUILD_REPORTED_OUTPUT'
    }
    if (-not (Test-Path -LiteralPath $VerificationIndexPath -PathType Leaf)) {
        throw 'STOP VERIFICATION_INDEX_NOT_CREATED_AS_REGULAR_FILE'
    }
    Assert-NoReparseBelowBoundary `
        -FullPath $VerificationIndexPath `
        -Boundary $ResolvedReceiptDirectory `
        -FailureCode 'STOP VERIFICATION_INDEX_IS_REPARSE_OR_ESCAPED'

    $VerificationManifest = Get-StagedManifest `
        -OutputPath $VerificationManifestPath `
        -IndexFile $VerificationIndexPath
    if ($VerificationManifest.sha256 -ne $Manifest.sha256) {
        throw 'STOP EXACT_MANIFEST_RECONSTRUCTION_MISMATCH'
    }
    Assert-ExactOrderedPathSet `
        -Expected $Manifest.paths `
        -Observed $VerificationManifest.paths `
        -FailureCode 'STOP EXACT_MANIFEST_RECONSTRUCTION_PATH_MISMATCH'

    $TreeResult = Invoke-GitBinary `
        -Arguments '-c core.splitIndex=false write-tree' `
        -EnvironmentOverrides $IndexEnvironment
    $TreeSha = $StrictUtf8.GetString(
        $TreeResult.bytes
    ).Trim().ToLowerInvariant()
    Assert-GitObjectId `
        -ObjectId $TreeSha `
        -ObjectFormat $ObjectFormat `
        -Label 'EXACT_MANIFEST_TREE'

    return [ordered]@{
        tree_sha = $TreeSha
        verification_index_path = $VerificationIndexPath
        verification_manifest = $VerificationManifest
        index_info_sha256 = (
            Get-Sha256HexFromBytes -Bytes $IndexInfoBytes
        )
    }
}

if (-not $PSCommandPath) {
    throw 'STOP SCRIPT_PATH_UNAVAILABLE: run with powershell -File'
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
    'GIT_OPTIONAL_LOCKS',
    'GIT_NO_REPLACE_OBJECTS',
    'GIT_NO_LAZY_FETCH',
    'GIT_TERMINAL_PROMPT',
    'GIT_ATTR_NOSYSTEM',
    'GIT_NAMESPACE',
    'GIT_REPLACE_REF_BASE',
    'GIT_SHALLOW_FILE',
    'GIT_AUTHOR_NAME',
    'GIT_AUTHOR_EMAIL',
    'GIT_AUTHOR_DATE',
    'GIT_COMMITTER_NAME',
    'GIT_COMMITTER_EMAIL',
    'GIT_COMMITTER_DATE'
)
foreach ($VariableName in $ForbiddenGitEnvironmentVariables) {
    $Variable = Get-Item -LiteralPath "Env:$VariableName" -ErrorAction SilentlyContinue
    if ($Variable -and ([string]$Variable.Value).Length -gt 0) {
        throw "STOP GIT_ENVIRONMENT_OVERRIDE_PRESENT: $VariableName"
    }
}
$DynamicGitConfigOverrides = @(
    Get-ChildItem Env: |
        Where-Object {
            $_.Name -match '^GIT_CONFIG_(KEY|VALUE)_[0-9]+$' -or
            $_.Name -match '^GIT_TRACE'
        }
)
if ($DynamicGitConfigOverrides.Count -gt 0) {
    throw 'STOP DYNAMIC_GIT_CONFIG_OR_TRACE_OVERRIDE_PRESENT'
}

$GitExecutable = (Get-Command git -CommandType Application -ErrorAction Stop).Source
$GitExecutableSha256 = (Get-FileHash -LiteralPath $GitExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
$GitVersion = ([string](& $GitExecutable --version)).Trim()
if ($LASTEXITCODE -ne 0) {
    throw 'STOP GIT_VERSION_READ_FAILED'
}

$ResolvedRoot = Get-NormalizedFullPath -LiteralPath $ExpectedRoot
Set-Location -LiteralPath $ResolvedRoot

$GitRootRaw = (& $GitExecutable rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $GitRootRaw) {
    throw 'STOP GIT_ROOT_UNAVAILABLE'
}
$GitRoot = [IO.Path]::GetFullPath(
    ([string]$GitRootRaw).Trim().Replace('/', [IO.Path]::DirectorySeparatorChar)
).TrimEnd([char[]]@(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
))
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($GitRoot, $ResolvedRoot)) {
    throw "STOP ROOT_MISMATCH: expected=$ResolvedRoot observed=$GitRoot"
}

$ExpectedGitDirectory = Join-Path $ResolvedRoot '.git'
if (-not (Test-Path -LiteralPath $ExpectedGitDirectory -PathType Container)) {
    throw 'STOP LINKED_OR_NONSTANDARD_GIT_DIRECTORY'
}
Assert-NoReparseBelowBoundary `
    -FullPath $ExpectedGitDirectory `
    -Boundary $ResolvedRoot `
    -FailureCode 'STOP GIT_DIRECTORY_OR_ANCESTOR_IS_REPARSE_POINT'

$GitDirectoryRaw = ([string](& $GitExecutable rev-parse --absolute-git-dir 2>$null)).Trim()
if ($LASTEXITCODE -ne 0 -or -not $GitDirectoryRaw) {
    throw 'STOP GIT_DIRECTORY_READ_FAILED'
}
$GitDirectory = [IO.Path]::GetFullPath(
    $GitDirectoryRaw.Replace('/', [IO.Path]::DirectorySeparatorChar)
).TrimEnd([char[]]@(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
))
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($GitDirectory, $ExpectedGitDirectory)) {
    throw "STOP GIT_DIRECTORY_MISMATCH: expected=$ExpectedGitDirectory observed=$GitDirectory"
}

$GitCommonDirectoryRaw = ([string](& $GitExecutable rev-parse --git-common-dir 2>$null)).Trim()
if ($LASTEXITCODE -ne 0 -or -not $GitCommonDirectoryRaw) {
    throw 'STOP GIT_COMMON_DIRECTORY_READ_FAILED'
}
if ([IO.Path]::IsPathRooted($GitCommonDirectoryRaw)) {
    $GitCommonDirectory = [IO.Path]::GetFullPath($GitCommonDirectoryRaw)
}
else {
    $GitCommonDirectory = [IO.Path]::GetFullPath((Join-Path $ResolvedRoot $GitCommonDirectoryRaw))
}
$GitCommonDirectory = $GitCommonDirectory.TrimEnd([char[]]@(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
))
if (-not [StringComparer]::OrdinalIgnoreCase.Equals($GitCommonDirectory, $ExpectedGitDirectory)) {
    throw 'STOP LINKED_WORKTREE_OR_EXTERNAL_COMMON_GIT_DIRECTORY'
}

$IsBare = ([string](& $GitExecutable rev-parse --is-bare-repository 2>$null)).Trim()
if ($LASTEXITCODE -ne 0 -or $IsBare -ne 'false') {
    throw 'STOP BARE_OR_UNREADABLE_REPOSITORY'
}

$HeadReference = ([string](& $GitExecutable symbolic-ref HEAD 2>$null)).Trim()
if ($LASTEXITCODE -ne 0 -or $HeadReference -ne 'refs/heads/master') {
    throw "STOP HEAD_REFERENCE_MISMATCH: expected=refs/heads/master observed=$HeadReference"
}
$Branch = ([string](& $GitExecutable symbolic-ref --short HEAD 2>$null)).Trim()
if ($LASTEXITCODE -ne 0 -or $Branch -ne $ExpectedBranch) {
    throw "STOP BRANCH_MISMATCH: expected=$ExpectedBranch observed=$Branch"
}

& $GitExecutable rev-parse --verify HEAD 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    throw 'STOP HEAD_ALREADY_EXISTS: re-audit as an existing repository'
}
$HeadProbeExit = $LASTEXITCODE
if ($HeadProbeExit -ne 1 -and $HeadProbeExit -ne 128) {
    throw "STOP AMBIGUOUS_HEAD_PROBE: exit=$HeadProbeExit"
}

$ExistingRefsResult = Invoke-GitBinary `
    -Arguments 'for-each-ref --format=%(refname)'
$ExistingRefs = @(
    $StrictUtf8.GetString($ExistingRefsResult.bytes).Split(
        [char[]]@([char]13, [char]10),
        [StringSplitOptions]::RemoveEmptyEntries
    )
)
if ($ExistingRefs.Count -gt 0) {
    throw 'STOP EXISTING_GIT_REFS_IN_UNBORN_REPOSITORY'
}

$ObjectFormat = ([string](& $GitExecutable rev-parse --show-object-format 2>$null)).Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or ($ObjectFormat -ne 'sha1' -and $ObjectFormat -ne 'sha256')) {
    throw "STOP UNSUPPORTED_OR_UNREADABLE_OBJECT_FORMAT: $ObjectFormat"
}

$LocalConfigNames = @(
    & $GitExecutable `
        config `
        --local `
        --no-includes `
        --name-only `
        --list 2>$null
)
$LocalConfigNamesExit = $LASTEXITCODE
if ($LocalConfigNamesExit -ne 0) {
    throw 'STOP LOCAL_GIT_CONFIG_NAME_SCAN_FAILED'
}
$LocalIncludeDirectives = @(
    $LocalConfigNames |
        Where-Object { $_ -match '(?i)^include(?:if)?\.' }
)
if ($LocalIncludeDirectives.Count -gt 0) {
    throw 'STOP LOCAL_GIT_CONFIG_INCLUDE_PRESENT'
}
$PartialCloneConfig = @(
    $LocalConfigNames |
        Where-Object {
            $_ -match '(?i)^remote\..*\.promisor$' -or
            $_ -match '(?i)^extensions\.partialclone$'
        }
)
if ($PartialCloneConfig.Count -gt 0) {
    throw 'STOP PARTIAL_CLONE_OR_PROMISOR_CONFIG_PRESENT'
}

$RepositoryOperationMarkers = @(
    'BISECT_LOG',
    'CHERRY_PICK_HEAD',
    'MERGE_HEAD',
    'REVERT_HEAD',
    'index.lock',
    'rebase-apply',
    'rebase-merge',
    'sequencer'
)
foreach ($Marker in $RepositoryOperationMarkers) {
    if (Test-Path -LiteralPath (Join-Path $ExpectedGitDirectory $Marker)) {
        throw "STOP IN_PROGRESS_OR_LOCKED_GIT_OPERATION: $Marker"
    }
}

$UnmergedIndexEntries = @(& $GitExecutable ls-files -u 2>$null)
if ($LASTEXITCODE -ne 0) {
    throw 'STOP INDEX_CONFLICT_READ_FAILED'
}
if ($UnmergedIndexEntries.Count -gt 0) {
    throw 'STOP UNMERGED_INDEX_ENTRIES'
}

$AlternatesPath = Join-Path $ExpectedGitDirectory 'objects\info\alternates'
if (Test-Path -LiteralPath $AlternatesPath) {
    if (-not (Test-Path -LiteralPath $AlternatesPath -PathType Leaf)) {
        throw 'STOP GIT_OBJECT_ALTERNATES_PATH_IS_NOT_A_REGULAR_FILE'
    }
    $AlternatesFile = Get-Item -LiteralPath $AlternatesPath -Force
    if ($AlternatesFile.Length -gt 0) {
        throw 'STOP GIT_OBJECT_ALTERNATES_CONFIGURED'
    }
}

$ShallowPath = Join-Path $ExpectedGitDirectory 'shallow'
if (Test-Path -LiteralPath $ShallowPath) {
    if (-not (Test-Path -LiteralPath $ShallowPath -PathType Leaf)) {
        throw 'STOP GIT_SHALLOW_PATH_IS_NOT_A_REGULAR_FILE'
    }
    if ((Get-Item -LiteralPath $ShallowPath -Force).Length -gt 0) {
        throw 'STOP SHALLOW_REPOSITORY_METADATA_PRESENT'
    }
}

$GraftsPath = Join-Path $ExpectedGitDirectory 'info\grafts'
if (Test-Path -LiteralPath $GraftsPath) {
    if (-not (Test-Path -LiteralPath $GraftsPath -PathType Leaf)) {
        throw 'STOP GIT_GRAFTS_PATH_IS_NOT_A_REGULAR_FILE'
    }
    if ((Get-Item -LiteralPath $GraftsPath -Force).Length -gt 0) {
        throw 'STOP GIT_GRAFTS_METADATA_PRESENT'
    }
}

$GitName = ([string](& $GitExecutable config --get user.name 2>$null)).Trim()
if ($LASTEXITCODE -ne 0 -or -not $GitName) {
    throw 'STOP GIT_IDENTITY_NAME_MISSING: do not invent an identity'
}
$GitEmail = ([string](& $GitExecutable config --get user.email 2>$null)).Trim()
if ($LASTEXITCODE -ne 0 -or -not $GitEmail) {
    throw 'STOP GIT_IDENTITY_EMAIL_MISSING: do not invent an identity'
}
if ($GitName -match '[\x00-\x1F\x7F]' -or $GitEmail -match '[\x00-\x1F\x7F]') {
    throw 'STOP GIT_IDENTITY_CONTAINS_CONTROL_CHARACTER'
}

$GlobalExcludesFile = ([string](& $GitExecutable config --get core.excludesFile 2>$null)).Trim()
$GlobalExcludesExit = $LASTEXITCODE
if ($GlobalExcludesExit -eq 0 -and $GlobalExcludesFile) {
    throw 'STOP GLOBAL_GIT_EXCLUDES_FILE_CONFIGURED'
}
if ($GlobalExcludesExit -ne 0 -and $GlobalExcludesExit -ne 1) {
    throw 'STOP GLOBAL_GIT_EXCLUDES_CONFIG_READ_FAILED'
}

$ExternalAttributesFile = ([string](
    & $GitExecutable config --get core.attributesFile 2>$null
)).Trim()
$ExternalAttributesExit = $LASTEXITCODE
if ($ExternalAttributesExit -eq 0 -and $ExternalAttributesFile) {
    throw 'STOP EXTERNAL_GIT_ATTRIBUTES_FILE_CONFIGURED'
}
if ($ExternalAttributesExit -ne 0 -and $ExternalAttributesExit -ne 1) {
    throw 'STOP EXTERNAL_GIT_ATTRIBUTES_CONFIG_READ_FAILED'
}

$RepositoryExcludePath = Join-Path $ExpectedGitDirectory 'info\exclude'
if (Test-Path -LiteralPath $RepositoryExcludePath -PathType Leaf) {
    $ActiveRepositoryExcludes = @(
        Get-Content -LiteralPath $RepositoryExcludePath -ErrorAction Stop |
            Where-Object {
                $_.Trim().Length -gt 0 -and -not $_.StartsWith('#')
            }
    )
    if ($ActiveRepositoryExcludes.Count -gt 0) {
        throw 'STOP ACTIVE_REPOSITORY_INFO_EXCLUDE_RULES'
    }
}

$ScriptFullPath = Get-NormalizedFullPath -LiteralPath $PSCommandPath
if (Test-IsUnderRoot -FullPath $ScriptFullPath -Root $ResolvedRoot) {
    throw 'STOP RUNNER_INSIDE_PROJECT_ROOT: move the runner outside VisionAssist'
}
Assert-NoReparseBelowBoundary `
    -FullPath $ScriptFullPath `
    -Boundary ([IO.Path]::GetPathRoot($ScriptFullPath)) `
    -FailureCode 'STOP RUNNER_PATH_OR_ANCESTOR_IS_REPARSE_OR_LINK'
Assert-NoReparseBelowBoundary `
    -FullPath $GitExecutable `
    -Boundary ([IO.Path]::GetPathRoot($GitExecutable)) `
    -FailureCode 'STOP GIT_EXECUTABLE_PATH_OR_ANCESTOR_IS_REPARSE_OR_LINK'

if (-not [IO.Path]::IsPathRooted($ReceiptDirectory)) {
    throw 'STOP RECEIPT_DIRECTORY_MUST_BE_ABSOLUTE'
}
$ProspectiveReceiptDirectory = [IO.Path]::GetFullPath($ReceiptDirectory)
if (Test-IsSameOrUnderRoot -FullPath $ProspectiveReceiptDirectory -Root $ResolvedRoot) {
    throw 'STOP RECEIPT_DIRECTORY_INSIDE_OR_EQUAL_TO_PROJECT_ROOT'
}
$ReceiptParent = [IO.Directory]::GetParent($ProspectiveReceiptDirectory)
if (-not $ReceiptParent -or -not (Test-Path -LiteralPath $ReceiptParent.FullName -PathType Container)) {
    throw 'STOP RECEIPT_PARENT_DIRECTORY_UNAVAILABLE'
}
$ReceiptVolumeRoot = [IO.Path]::GetPathRoot($ReceiptParent.FullName)
Assert-NoReparseBelowBoundary `
    -FullPath $ReceiptParent.FullName `
    -Boundary $ReceiptVolumeRoot `
    -FailureCode 'STOP RECEIPT_PARENT_OR_ANCESTOR_IS_REPARSE_POINT'
if (-not (Test-Path -LiteralPath $ProspectiveReceiptDirectory)) {
    New-Item -ItemType Directory -Path $ProspectiveReceiptDirectory -ErrorAction Stop | Out-Null
}
$ResolvedReceiptDirectory = Get-NormalizedFullPath -LiteralPath $ProspectiveReceiptDirectory
if (Test-IsSameOrUnderRoot -FullPath $ResolvedReceiptDirectory -Root $ResolvedRoot) {
    throw 'STOP RECEIPT_DIRECTORY_INSIDE_OR_EQUAL_TO_PROJECT_ROOT'
}
Assert-NoReparseBelowBoundary `
    -FullPath $ResolvedReceiptDirectory `
    -Boundary ([IO.Path]::GetPathRoot($ResolvedReceiptDirectory)) `
    -FailureCode 'STOP RECEIPT_DIRECTORY_OR_ANCESTOR_IS_REPARSE_POINT'

$LockPath = Join-Path $ResolvedReceiptDirectory 'VISIONASSIST_GIT_GENESIS.lock'
try {
    $ExecutionLock = [IO.File]::Open(
        $LockPath,
        [IO.FileMode]::OpenOrCreate,
        [IO.FileAccess]::ReadWrite,
        [IO.FileShare]::None
    )
}
catch {
    throw 'STOP ANOTHER_GENESIS_RUNNER_INSTANCE_IS_ACTIVE'
}

$RunnerSha256 = (Get-FileHash -LiteralPath $ScriptFullPath -Algorithm SHA256).Hash.ToLowerInvariant()
$ExpectedRunnerSha256Normalized = $ExpectedRunnerSha256.ToLowerInvariant()
if ($RunnerSha256 -ne $ExpectedRunnerSha256Normalized) {
    throw (
        'STOP RUNNER_FROZEN_SHA256_MISMATCH: expected=' +
        $ExpectedRunnerSha256Normalized +
        ' observed=' +
        $RunnerSha256
    )
}

$GitignorePath = Join-Path $ResolvedRoot '.gitignore'
$GitignoreExistedBefore = Test-Path -LiteralPath $GitignorePath -PathType Leaf
$GitignorePreSha256 = $null
$ExistingGitignoreBytes = [byte[]]@()
if ($GitignoreExistedBefore) {
    $GitignoreItem = Get-Item -LiteralPath $GitignorePath -Force
    if ($GitignoreItem.PSIsContainer -or ($GitignoreItem.PSObject.Properties.Name -contains 'LinkType' -and $GitignoreItem.LinkType)) {
        throw 'STOP GITIGNORE_IS_LINK_OR_NONREGULAR_FILE'
    }
    $GitignorePreSha256 = (Get-FileHash -LiteralPath $GitignorePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $ExistingGitignoreBytes = [IO.File]::ReadAllBytes($GitignorePath)
}

$Utf8BomLength = 0
if ($ExistingGitignoreBytes.Length -ge 4) {
    if (
        ($ExistingGitignoreBytes[0] -eq 0xFF -and $ExistingGitignoreBytes[1] -eq 0xFE) -or
        ($ExistingGitignoreBytes[0] -eq 0xFE -and $ExistingGitignoreBytes[1] -eq 0xFF) -or
        ($ExistingGitignoreBytes[0] -eq 0x00 -and $ExistingGitignoreBytes[1] -eq 0x00 -and $ExistingGitignoreBytes[2] -eq 0xFE -and $ExistingGitignoreBytes[3] -eq 0xFF) -or
        ($ExistingGitignoreBytes[0] -eq 0xFF -and $ExistingGitignoreBytes[1] -eq 0xFE -and $ExistingGitignoreBytes[2] -eq 0x00 -and $ExistingGitignoreBytes[3] -eq 0x00)
    ) {
        throw 'STOP UNSUPPORTED_GITIGNORE_UTF16_OR_UTF32_ENCODING'
    }
}
if (
    $ExistingGitignoreBytes.Length -ge 3 -and
    $ExistingGitignoreBytes[0] -eq 0xEF -and
    $ExistingGitignoreBytes[1] -eq 0xBB -and
    $ExistingGitignoreBytes[2] -eq 0xBF
) {
    $Utf8BomLength = 3
}

try {
    if ($ExistingGitignoreBytes.Length -gt $Utf8BomLength) {
        $ExistingGitignore = $StrictUtf8.GetString(
            $ExistingGitignoreBytes,
            $Utf8BomLength,
            $ExistingGitignoreBytes.Length - $Utf8BomLength
        )
    }
    else {
        $ExistingGitignore = ''
    }
}
catch {
    throw 'STOP GITIGNORE_IS_NOT_STRICT_UTF8'
}

$NormalizedGitignore = $ExistingGitignore.Replace("`r`n", "`n").Replace("`r", "`n")
$BeginMarkerCount = ([regex]::Matches(
    $NormalizedGitignore,
    '(?m)^# BEGIN VISIONASSIST_GENESIS_SAFETY$'
)).Count
$EndMarkerCount = ([regex]::Matches(
    $NormalizedGitignore,
    '(?m)^# END VISIONASSIST_GENESIS_SAFETY$'
)).Count
if ($BeginMarkerCount -ne $EndMarkerCount -or $BeginMarkerCount -gt 1) {
    throw 'STOP PARTIAL_OR_DUPLICATE_GITIGNORE_SAFETY_MARKERS'
}

if ($BeginMarkerCount -eq 1) {
    $SafetyMatch = [regex]::Match(
        $NormalizedGitignore,
        '(?s)# BEGIN VISIONASSIST_GENESIS_SAFETY\n.*?# END VISIONASSIST_GENESIS_SAFETY'
    )
    if (-not $SafetyMatch.Success -or $SafetyMatch.Value.Trim() -ne $SafetyBlockNormalized) {
        throw 'STOP GITIGNORE_SAFETY_BLOCK_DRIFT'
    }
    if ($NormalizedGitignore.Substring($SafetyMatch.Index + $SafetyMatch.Length).Trim().Length -ne 0) {
        throw 'STOP GITIGNORE_SAFETY_BLOCK_MUST_BE_LAST'
    }
}
else {
    $AppendPrefix = ''
    if ($ExistingGitignore.Length -gt 0 -and -not $ExistingGitignore.EndsWith("`n") -and -not $ExistingGitignore.EndsWith("`r")) {
        $AppendPrefix = "`n"
    }
    if ($ExistingGitignore.Length -gt 0) {
        $AppendPrefix += "`n"
    }
    $AppendBytes = $StrictUtf8.GetBytes(
        $AppendPrefix + $SafetyBlockNormalized + "`n"
    )

    if ($GitignoreExistedBefore) {
        $CurrentPreAppendSha256 = (Get-FileHash -LiteralPath $GitignorePath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($CurrentPreAppendSha256 -ne $GitignorePreSha256) {
            throw 'STOP GITIGNORE_CHANGED_BEFORE_APPEND'
        }
        $GitignoreStream = [IO.File]::Open(
            $GitignorePath,
            [IO.FileMode]::Append,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None
        )
        try {
            $GitignoreStream.Write($AppendBytes, 0, $AppendBytes.Length)
            $GitignoreStream.Flush()
        }
        finally {
            $GitignoreStream.Dispose()
        }
    }
    else {
        $NewGitignoreStream = [IO.File]::Open(
            $GitignorePath,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None
        )
        try {
            $NewGitignoreStream.Write(
                $AppendBytes,
                0,
                $AppendBytes.Length
            )
            $NewGitignoreStream.Flush($true)
        }
        finally {
            $NewGitignoreStream.Dispose()
        }
    }
}

$IgnoreProbes = @(
    'benchmarks/chart-intent-r26/cases/__VISIONASSIST_IGNORE_PROBE__',
    'benchmarks/chart-intent-r26/outcome-vault/__VISIONASSIST_IGNORE_PROBE__'
)
foreach ($Probe in $IgnoreProbes) {
    & $GitExecutable `
        -c 'core.fsmonitor=false' `
        -c 'core.excludesFile=NUL' `
        check-ignore `
        --no-index `
        -q `
        -- $Probe
    if ($LASTEXITCODE -ne 0) {
        throw 'STOP CUSTODY_SENTINEL_PATH_NOT_IGNORED'
    }
}

$ConfiguredFilters = @(& $GitExecutable config --get-regexp '^filter\..*\.(clean|process)$' 2>$null)
$FilterConfigExit = $LASTEXITCODE
if ($FilterConfigExit -ne 0 -and $FilterConfigExit -ne 1) {
    throw 'STOP GIT_FILTER_CONFIG_READ_FAILED'
}
$ConfiguredFilterDriverCount = if ($FilterConfigExit -eq 0) {
    $ConfiguredFilters.Count
}
else {
    0
}

$InitialIndexResult = Invoke-GitBinary `
    -Arguments '-c core.fsmonitor=false -c core.excludesFile=NUL -c core.quotepath=false ls-files --cached -z'
$InitialIndexPaths = @(
    ConvertFrom-NulPathBytes -Bytes $InitialIndexResult.bytes
)
if ($Mode -eq 'Prepare' -and $InitialIndexPaths.Count -gt 0) {
    throw 'STOP PREPARE_REQUIRES_EMPTY_PREEXISTING_INDEX'
}

$Candidates = @(Get-CandidatePaths)
if ($Candidates.Count -eq 0) {
    throw 'STOP EMPTY_GENESIS_CANDIDATE_SET'
}
Assert-CandidatePathsSafe -Paths $Candidates
$GitignoreCandidateCount = @(
    $Candidates | Where-Object {
        [StringComparer]::Ordinal.Equals($_, '.gitignore')
    }
).Count
if ($GitignoreCandidateCount -ne 1) {
    throw 'STOP ROOT_GITIGNORE_NOT_EXACTLY_ONCE_IN_CANDIDATE_SET'
}

Assert-CandidateAttributesDoNotTransform `
    -Paths $Candidates `
    -FailureCodePrefix 'STOP INITIAL_CANDIDATE'

$InventoryPath = Join-Path $ResolvedReceiptDirectory (
    'VISIONASSIST_GENESIS_CANDIDATES_' + $RunId + '.tsv'
)
$Inventory = Get-Inventory `
    -Paths $Candidates `
    -Root $ResolvedRoot `
    -OutputPath $InventoryPath

$PreflightRunnerSha256 = (
    Get-FileHash -LiteralPath $ScriptFullPath -Algorithm SHA256
).Hash.ToLowerInvariant()
if (
    $PreflightRunnerSha256 -ne $RunnerSha256 -or
    $PreflightRunnerSha256 -ne $ExpectedRunnerSha256Normalized
) {
    throw 'STOP RUNNER_CHANGED_DURING_PREFLIGHT'
}
$PreflightGitExecutableSha256 = (
    Get-FileHash -LiteralPath $GitExecutable -Algorithm SHA256
).Hash.ToLowerInvariant()
if ($PreflightGitExecutableSha256 -ne $GitExecutableSha256) {
    throw 'STOP GIT_EXECUTABLE_CHANGED_DURING_PREFLIGHT'
}

$GitignoreSha256 = (Get-FileHash -LiteralPath $GitignorePath -Algorithm SHA256).Hash.ToLowerInvariant()
$PreflightPath = Join-Path $ResolvedReceiptDirectory (
    'VISIONASSIST_GIT_GENESIS_PREFLIGHT_' + $RunId + '.json'
)
$PreflightTerminalStatus = if ($Mode -eq 'Prepare') {
    'AWAITING_EXACT_INVENTORY_HASH_APPROVAL'
}
else {
    'PREFLIGHT_RECAPTURED'
}
$Preflight = [ordered]@{
    schema_version = 'visionassist.git-genesis-preflight.v1'
    run_id = $RunId
    recorded_at = [DateTime]::UtcNow.ToString('o')
    mode = $Mode
    authorization_id_claimed = $AuthorizationId
    project_root = $ResolvedRoot
    branch = $Branch
    pre_state = 'UNBORN_HEAD_NO_REFS'
    runner = [ordered]@{
        path = $ScriptFullPath
        sha256 = $RunnerSha256
        expected_sha256 = $ExpectedRunnerSha256Normalized
        git_executable = $GitExecutable
        git_executable_sha256 = $GitExecutableSha256
        git_version = $GitVersion
        git_object_format = $ObjectFormat
    }
    inventory = [ordered]@{
        readable_path = $Inventory.readable_path
        canonical_path = $Inventory.canonical_path
        sha256 = $Inventory.sha256
        candidate_count = $Inventory.candidate_count
        opaque_binary_count = $Inventory.opaque_binary_count
        opaque_binary_paths = $Inventory.opaque_binary_paths
        opaque_readable_path = $Inventory.opaque_readable_path
        opaque_canonical_path = $Inventory.opaque_canonical_path
        opaque_sha256 = $Inventory.opaque_sha256
        secret_policy_sha256 = $SecretPolicySha256
        gitignore_existed_before = $GitignoreExistedBefore
        gitignore_pre_sha256 = $GitignorePreSha256
        gitignore_sha256 = $GitignoreSha256
    }
    checks = [ordered]@{
        exact_root_verified = $true
        branch_verified = $true
        head_absent_verified = $true
        custody_paths_ignored = $true
        blocked_filename_scan_passed = $true
        ascii_secret_signature_scan_passed = (
            $Inventory.ascii_secret_signature_scan_passed
        )
        candidate_snapshot_read_mode = $Inventory.snapshot_read_mode
        maximum_candidate_bytes = $Inventory.maximum_candidate_bytes
        configured_filter_driver_count = $ConfiguredFilterDriverCount
        candidate_transform_attributes_unassigned_or_unset = $true
        runner_frozen_sha256_gate_matched = $true
        runner_hash_stable_through_preflight = $true
        git_executable_hash_stable_through_preflight = $true
        explicit_global_excludes_file_absent = $true
        external_git_attributes_file_absent = $true
        local_git_config_include_absent = $true
        partial_clone_or_promisor_config_absent = $true
        discovery_global_excludes_source_forced_to_NUL = $true
        repository_info_exclude_inactive = $true
        standard_git_directory_verified = $true
        object_alternates_absent = $true
        in_progress_git_operation_absent = $true
    }
    custody_boundary = [ordered]@{
        candidate_content_reads_with_cases_prefix_requested = $false
        candidate_content_reads_with_outcome_vault_prefix_requested = $false
        custody_path_metadata_boolean_checks_performed = $true
        candidate_or_staged_output_custody_names_recorded = $false
        indirect_alias_or_git_config_custody_reads = 'UNVERIFIED'
        verify_custody_run = $false
    }
    authority = [ordered]@{
        git_action = 'GITIGNORE_APPLIED_OR_PRESENT'
        decision_status = 'DIAGNOSTIC_ONLY'
        action_code = 'NO_ACTION'
        execution_permission = 'HOLD'
        capital_permission = 'DENY'
        can_trade = $false
    }
    terminal_status = $PreflightTerminalStatus
}
Write-JsonFile -Value $Preflight -Path $PreflightPath

if ($Mode -eq 'Prepare') {
    Write-Host 'PREPARED; NO COMMIT CREATED.'
    Write-Host "Review inventory: $InventoryPath"
    Write-Host "Inventory SHA-256: $($Inventory.sha256)"
    if ($Inventory.opaque_binary_count -gt 0) {
        Write-Host "Opaque inventory: $($Inventory.opaque_readable_path)"
        Write-Host "Opaque inventory SHA-256: $($Inventory.opaque_sha256)"
        Write-Host 'Stage/Commit also require this exact opaque inventory hash.'
    }
    Write-Host 'Then run Stage with this exact inventory hash.'
    Write-Host "Preflight receipt: $PreflightPath"
    $ExecutionLock.Dispose()
    exit 0
}

if (-not $ApproveInventorySha256) {
    throw 'STOP STAGE_OR_COMMIT_REQUIRES_APPROVED_INVENTORY_SHA256'
}
$ApprovedInventory = $ApproveInventorySha256.ToLowerInvariant()
if ($ApprovedInventory -ne $Inventory.sha256) {
    throw "STOP INVENTORY_APPROVAL_HASH_MISMATCH: approved=$ApprovedInventory observed=$($Inventory.sha256)"
}

$ApprovedOpaqueInventory = $null
if ($Inventory.opaque_binary_count -gt 0) {
    if (-not $ApproveOpaqueInventorySha256) {
        throw 'STOP OPAQUE_BINARY_CANDIDATES_REQUIRE_EXACT_HASH_APPROVAL'
    }
    $ApprovedOpaqueInventory = $ApproveOpaqueInventorySha256.ToLowerInvariant()
    if ($ApprovedOpaqueInventory -ne $Inventory.opaque_sha256) {
        throw 'STOP OPAQUE_INVENTORY_APPROVAL_HASH_MISMATCH'
    }
}
elseif ($ApproveOpaqueInventorySha256) {
    $ApprovedOpaqueInventory = $ApproveOpaqueInventorySha256.ToLowerInvariant()
    if ($ApprovedOpaqueInventory -ne $Inventory.opaque_sha256) {
        throw 'STOP UNEXPECTED_OPAQUE_INVENTORY_HASH_MISMATCH'
    }
}

$ApprovedTreeSha = $null
if ($Mode -eq 'Commit') {
    if (-not $ApproveTreeSha) {
        throw 'STOP COMMIT_REQUIRES_APPROVED_TREE_SHA'
    }
    $ApprovedTreeSha = $ApproveTreeSha.ToLowerInvariant()
    Assert-GitObjectId `
        -ObjectId $ApprovedTreeSha `
        -ObjectFormat $ObjectFormat `
        -Label 'APPROVED_TREE'
}

$EmptyHooksDirectory = Join-Path $ResolvedReceiptDirectory ('empty-hooks-' + $RunId)
if (Test-Path -LiteralPath $EmptyHooksDirectory) {
    throw 'STOP RUN_SCOPED_HOOKS_DIRECTORY_ALREADY_EXISTS'
}
New-Item -ItemType Directory -Path $EmptyHooksDirectory -ErrorAction Stop | Out-Null
Assert-NoReparseBelowBoundary `
    -FullPath $EmptyHooksDirectory `
    -Boundary $ResolvedReceiptDirectory `
    -FailureCode 'STOP RUN_SCOPED_HOOKS_DIRECTORY_IS_REPARSE_POINT'
if (@(Get-ChildItem -LiteralPath $EmptyHooksDirectory -Force -ErrorAction Stop).Count -ne 0) {
    throw 'STOP RUN_SCOPED_HOOKS_DIRECTORY_NOT_EMPTY'
}

$PreAddHeadReference = ([string](& $GitExecutable symbolic-ref HEAD 2>$null)).Trim()
if ($LASTEXITCODE -ne 0 -or $PreAddHeadReference -ne 'refs/heads/master') {
    throw 'STOP HEAD_REFERENCE_CHANGED_BEFORE_STAGE'
}
& $GitExecutable rev-parse --verify HEAD 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    throw 'STOP HEAD_APPEARED_BEFORE_STAGE'
}
if ($LASTEXITCODE -ne 1 -and $LASTEXITCODE -ne 128) {
    throw 'STOP AMBIGUOUS_HEAD_STATE_BEFORE_STAGE'
}

$PreAddGlobalExcludes = ([string](& $GitExecutable config --get core.excludesFile 2>$null)).Trim()
$PreAddGlobalExcludesExit = $LASTEXITCODE
if ($PreAddGlobalExcludesExit -eq 0 -and $PreAddGlobalExcludes) {
    throw 'STOP GLOBAL_EXCLUDES_CHANGED_BEFORE_STAGE'
}
if ($PreAddGlobalExcludesExit -ne 0 -and $PreAddGlobalExcludesExit -ne 1) {
    throw 'STOP GLOBAL_EXCLUDES_RECAPTURE_FAILED'
}
if (Test-Path -LiteralPath $RepositoryExcludePath -PathType Leaf) {
    $PreAddActiveRepositoryExcludes = @(
        Get-Content -LiteralPath $RepositoryExcludePath -ErrorAction Stop |
            Where-Object {
                $_.Trim().Length -gt 0 -and -not $_.StartsWith('#')
            }
    )
    if ($PreAddActiveRepositoryExcludes.Count -gt 0) {
        throw 'STOP REPOSITORY_INFO_EXCLUDE_CHANGED_BEFORE_STAGE'
    }
}
Assert-CandidateAttributesDoNotTransform `
    -Paths $Candidates `
    -FailureCodePrefix 'STOP PREADD_CANDIDATE'

$ApprovedPathspecPath = Join-Path $ResolvedReceiptDirectory (
    'VISIONASSIST_GENESIS_APPROVED_PATHSPEC_' + $RunId + '.nul'
)
Write-NulPathspec -Paths $Candidates -Path $ApprovedPathspecPath
$ApprovedPathspecSha256 = (Get-FileHash -LiteralPath $ApprovedPathspecPath -Algorithm SHA256).Hash.ToLowerInvariant()
$PreStageRunnerSha256 = (
    Get-FileHash -LiteralPath $ScriptFullPath -Algorithm SHA256
).Hash.ToLowerInvariant()
if ($PreStageRunnerSha256 -ne $RunnerSha256) {
    throw 'STOP RUNNER_CHANGED_BEFORE_STAGE'
}
$PreStageGitExecutableSha256 = (
    Get-FileHash -LiteralPath $GitExecutable -Algorithm SHA256
).Hash.ToLowerInvariant()
if ($PreStageGitExecutableSha256 -ne $GitExecutableSha256) {
    throw 'STOP GIT_EXECUTABLE_CHANGED_BEFORE_STAGE'
}

$StageMutationStarted = $false
$CommitAttemptEntered = $false
$CommitCreated = $false
$CommitObjectCreated = $false
$BranchRefCreated = $false
$ProposedCommitSha = $null
$PhaseFailureReceiptPath = Join-Path $ResolvedReceiptDirectory (
    'VISIONASSIST_GIT_GENESIS_PHASE_FAILURE_' + $RunId + '.json'
)
try {
    $StageMutationStarted = $true
    [byte[]]$ApprovedPathspecBytes = [IO.File]::ReadAllBytes(
        $ApprovedPathspecPath
    )
    if (
        (Get-Sha256HexFromBytes -Bytes $ApprovedPathspecBytes) -ne
        $ApprovedPathspecSha256
    ) {
        throw 'STOP APPROVED_PATHSPEC_CHANGED_BEFORE_GIT_ADD'
    }
    $AddResult = Invoke-GitBinary `
        -Arguments (
            '-c core.fsmonitor=false -c core.excludesFile=NUL ' +
            '-c core.autocrlf=false ' +
            '-c core.hooksPath="' + $EmptyHooksDirectory + '" ' +
            '--literal-pathspecs add -A ' +
            '--pathspec-from-file=- --pathspec-file-nul'
        ) `
        -StandardInputBytes $ApprovedPathspecBytes
    if ($AddResult.bytes.Length -ne 0) {
        throw 'STOP GIT_ADD_REPORTED_OUTPUT_OR_WARNING'
    }
    $PostAddPathspecSha256 = (
        Get-FileHash `
            -LiteralPath $ApprovedPathspecPath `
            -Algorithm SHA256
    ).Hash.ToLowerInvariant()
    if ($PostAddPathspecSha256 -ne $ApprovedPathspecSha256) {
        throw 'STOP APPROVED_PATHSPEC_CHANGED_DURING_GIT_ADD'
    }

    $PostStageCandidates = @(Get-CandidatePaths)
    Assert-CandidatePathsSafe -Paths $PostStageCandidates
    $PostStageInventoryPath = Join-Path $ResolvedReceiptDirectory (
        'VISIONASSIST_GENESIS_CANDIDATES_POST_STAGE_' + $RunId + '.tsv'
    )
    $PostStageInventory = Get-Inventory `
        -Paths $PostStageCandidates `
        -Root $ResolvedRoot `
        -OutputPath $PostStageInventoryPath
    if ($PostStageInventory.sha256 -ne $Inventory.sha256) {
        throw "STOP CANDIDATE_BYTES_CHANGED_DURING_STAGE: before=$($Inventory.sha256) after=$($PostStageInventory.sha256)"
    }

    $StagedManifestPath = Join-Path $ResolvedReceiptDirectory (
        'VISIONASSIST_GENESIS_STAGED_MANIFEST_' + $RunId + '.tsv'
    )
    $StagedManifest = Get-StagedManifest -OutputPath $StagedManifestPath
    $Staged = @($StagedManifest.paths)

    Assert-ExactOrderedPathSet `
        -Expected $Candidates `
        -Observed $Staged `
        -FailureCode 'STOP STAGED_SET_DIFFERS_FROM_APPROVED_INVENTORY'
    Assert-CandidatePathsSafe -Paths $Staged
    foreach ($RelativePath in $Candidates) {
        if (
            -not $Inventory.git_blob_ids_by_path.ContainsKey($RelativePath) -or
            -not $StagedManifest.blob_ids_by_path.ContainsKey($RelativePath)
        ) {
            throw 'STOP APPROVED_OR_STAGED_BLOB_BINDING_ENTRY_MISSING'
        }
        if (
            -not [StringComparer]::Ordinal.Equals(
                $Inventory.git_blob_ids_by_path[$RelativePath],
                $StagedManifest.blob_ids_by_path[$RelativePath]
            )
        ) {
            throw 'STOP STAGED_BLOB_DIFFERS_FROM_APPROVED_SNAPSHOT'
        }
    }

& $GitExecutable `
    -c 'core.fsmonitor=false' `
    diff `
    --cached `
    --check `
    --no-ext-diff `
    --no-textconv 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'STOP STAGED_DIFF_CHECK_FAILED'
}

$SecretPatternFile = Join-Path $ResolvedReceiptDirectory (
    'VISIONASSIST_GENESIS_SECRET_PATTERN_' + $RunId + '.txt'
)
$SecretPatternFileBytes = $Utf8NoBom.GetBytes($GitSecretPattern + "`n")
Write-BytesAtomic `
    -Path $SecretPatternFile `
    -Bytes $SecretPatternFileBytes
$StagedSecretHits = @(
    & $GitExecutable grep --cached -i -l -E -f $SecretPatternFile -- 2>$null
)
$GitGrepExit = $LASTEXITCODE
if ($GitGrepExit -eq 0) {
    throw "STOP POSSIBLE_SECRET_IN_STAGED_BLOB: count=$($StagedSecretHits.Count); paths_and_values_not_printed"
}
if ($GitGrepExit -ne 0 -and $GitGrepExit -ne 1) {
    throw 'STOP STAGED_SECRET_SCAN_FAILED'
}

$VerificationIndexPath = Join-Path $ResolvedReceiptDirectory (
    'VISIONASSIST_GENESIS_EXACT_MANIFEST_' + $RunId + '.index'
)
$VerificationManifestPath = Join-Path $ResolvedReceiptDirectory (
    'VISIONASSIST_GENESIS_EXACT_MANIFEST_READBACK_' + $RunId + '.tsv'
)
$PlannedTree = Get-TreeFromExactStagedManifest `
    -Manifest $StagedManifest `
    -VerificationIndexPath $VerificationIndexPath `
    -VerificationManifestPath $VerificationManifestPath
$PreCommitTreeSha = $PlannedTree.tree_sha

$StagingReceiptPath = Join-Path $ResolvedReceiptDirectory (
    'VISIONASSIST_GIT_GENESIS_STAGING_RECEIPT_' + $RunId + '.json'
)
$StagingReceipt = [ordered]@{
    schema_version = 'visionassist.git-genesis-staging-receipt.v1'
    run_id = $RunId
    recorded_at = [DateTime]::UtcNow.ToString('o')
    authorization_id_claimed = $AuthorizationId
    project_root = $ResolvedRoot
    branch = $Branch
    inventory_sha256 = $Inventory.sha256
    inventory_approval_sha256 = $ApprovedInventory
    opaque_inventory_sha256 = $Inventory.opaque_sha256
    opaque_inventory_approval_sha256 = $ApprovedOpaqueInventory
    opaque_binary_count = $Inventory.opaque_binary_count
    staged_manifest_sha256 = $StagedManifest.sha256
    staged_manifest_readable_path = $StagedManifest.readable_path
    staged_manifest_canonical_path = $StagedManifest.canonical_path
    staged_file_count = $StagedManifest.count
    planned_tree_sha = $PreCommitTreeSha
    exact_manifest_verification_index_path = (
        $PlannedTree.verification_index_path
    )
    exact_manifest_index_info_sha256 = $PlannedTree.index_info_sha256
    approved_pathspec_sha256 = $ApprovedPathspecSha256
    secret_policy_sha256 = $SecretPolicySha256
    git_effects = [ordered]@{
        index_staged = $true
        object_database_may_contain_staged_blobs_and_tree = $true
        commit_object_created = $false
        branch_ref_created = $false
    }
    checks = [ordered]@{
        staged_paths_equal_approved_inventory = $true
        working_inventory_hash_equal_before_and_after_stage = $true
        candidate_transform_attributes_unassigned_or_unset = $true
        approved_raw_blob_ids_equal_staged_blob_ids = $true
        planned_tree_derived_from_external_exact_manifest_index = $true
        runner_hash_stable_before_stage = $true
        git_executable_hash_stable_before_stage = $true
        staged_modes_safe = $true
        staged_diff_check_passed = $true
        staged_secret_pattern_hit_count = 0
        opaque_inventory_hash_approval_matched = (
            $Inventory.opaque_binary_count -eq 0 -or
            $ApprovedOpaqueInventory -eq $Inventory.opaque_sha256
        )
    }
    custody_boundary = [ordered]@{
        candidate_content_reads_with_cases_prefix_requested = $false
        candidate_content_reads_with_outcome_vault_prefix_requested = $false
        custody_path_metadata_boolean_checks_performed = $true
        candidate_or_staged_output_custody_names_recorded = $false
        indirect_alias_or_git_config_custody_reads = 'UNVERIFIED'
        verify_custody_run = $false
    }
    authority = [ordered]@{
        git_action = 'GENESIS_STAGING_UNDER_CLAIMED_AUTHORIZATION'
        domain_action_code = 'NO_ACTION'
        decision_status = 'DIAGNOSTIC_ONLY'
        execution_permission = 'HOLD'
        capital_permission = 'DENY'
        can_trade = $false
    }
    terminal_status = 'AWAITING_EXACT_TREE_SHA_APPROVAL'
}
Write-JsonFile -Value $StagingReceipt -Path $StagingReceiptPath

if ($Mode -eq 'Stage') {
    Write-Host 'STAGED; NO COMMIT CREATED.'
    Write-Host "Approved inventory SHA-256: $ApprovedInventory"
    Write-Host "Planned tree SHA: $PreCommitTreeSha"
    Write-Host "Review staged manifest: $($StagedManifest.readable_path)"
    Write-Host 'Then run Commit with the same inventory hash and this exact tree SHA.'
    Write-Host "Staging receipt: $StagingReceiptPath"
    $ExecutionLock.Dispose()
    exit 0
}

if ($ApprovedTreeSha -ne $PreCommitTreeSha) {
    throw "STOP TREE_APPROVAL_HASH_MISMATCH: approved=$ApprovedTreeSha observed=$PreCommitTreeSha"
}

$ImmediateHeadReference = ([string](& $GitExecutable symbolic-ref HEAD 2>$null)).Trim()
if ($LASTEXITCODE -ne 0 -or $ImmediateHeadReference -ne 'refs/heads/master') {
    throw 'STOP HEAD_REFERENCE_CHANGED_BEFORE_COMMIT'
}
& $GitExecutable rev-parse --verify HEAD 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    throw 'STOP RECONCILE_EXISTING_HEAD_BEFORE_RETRY'
}
if ($LASTEXITCODE -ne 1 -and $LASTEXITCODE -ne 128) {
    throw 'STOP AMBIGUOUS_HEAD_STATE_BEFORE_COMMIT'
}
$ImmediateStagedManifestPath = Join-Path $ResolvedReceiptDirectory (
    'VISIONASSIST_GENESIS_IMMEDIATE_STAGED_MANIFEST_' + $RunId + '.tsv'
)
$ImmediateStagedManifest = Get-StagedManifest `
    -OutputPath $ImmediateStagedManifestPath
if ($ImmediateStagedManifest.sha256 -ne $StagedManifest.sha256) {
    throw 'STOP STAGED_MANIFEST_CHANGED_BEFORE_COMMIT'
}
$ImmediateVerificationIndexPath = Join-Path $ResolvedReceiptDirectory (
    'VISIONASSIST_GENESIS_IMMEDIATE_EXACT_MANIFEST_' + $RunId + '.index'
)
$ImmediateVerificationManifestPath = Join-Path $ResolvedReceiptDirectory (
    'VISIONASSIST_GENESIS_IMMEDIATE_EXACT_READBACK_' + $RunId + '.tsv'
)
$ImmediatePlannedTree = Get-TreeFromExactStagedManifest `
    -Manifest $ImmediateStagedManifest `
    -VerificationIndexPath $ImmediateVerificationIndexPath `
    -VerificationManifestPath $ImmediateVerificationManifestPath
$ImmediateTreeSha = $ImmediatePlannedTree.tree_sha
if ($ImmediateTreeSha -ne $ApprovedTreeSha) {
    throw 'STOP STAGED_TREE_CHANGED_BEFORE_COMMIT'
}
$ImmediateGitName = ([string](& $GitExecutable config --get user.name 2>$null)).Trim()
if ($LASTEXITCODE -ne 0 -or -not [StringComparer]::Ordinal.Equals($ImmediateGitName, $GitName)) {
    throw 'STOP GIT_IDENTITY_NAME_CHANGED_BEFORE_COMMIT'
}
$ImmediateGitEmail = ([string](& $GitExecutable config --get user.email 2>$null)).Trim()
if ($LASTEXITCODE -ne 0 -or -not [StringComparer]::Ordinal.Equals($ImmediateGitEmail, $GitEmail)) {
    throw 'STOP GIT_IDENTITY_EMAIL_CHANGED_BEFORE_COMMIT'
}
$ImmediateRunnerSha256 = (
    Get-FileHash -LiteralPath $ScriptFullPath -Algorithm SHA256
).Hash.ToLowerInvariant()
if ($ImmediateRunnerSha256 -ne $RunnerSha256) {
    throw 'STOP RUNNER_CHANGED_BEFORE_COMMIT'
}
$ImmediateGitExecutableSha256 = (
    Get-FileHash -LiteralPath $GitExecutable -Algorithm SHA256
).Hash.ToLowerInvariant()
if ($ImmediateGitExecutableSha256 -ne $GitExecutableSha256) {
    throw 'STOP GIT_EXECUTABLE_CHANGED_BEFORE_COMMIT'
}

$CommitAttemptEntered = $true
$FailureReceiptPath = Join-Path $ResolvedReceiptDirectory (
    'VISIONASSIST_GIT_BASELINE_FAILURE_RECEIPT_' + $RunId + '.json'
)
try {
    $CommitMessageBytes = $Utf8NoBom.GetBytes($CommitMessage + "`n")
    $CommitTreeResult = Invoke-GitBinary `
        -Arguments (
            "-c commit.gpgsign=false commit-tree {0} -F -" -f
            $ApprovedTreeSha
        ) `
        -StandardInputBytes $CommitMessageBytes `
        -AllowStandardError `
        -EnvironmentOverrides @{
            GIT_AUTHOR_NAME = $GitName
            GIT_AUTHOR_EMAIL = $GitEmail
            GIT_COMMITTER_NAME = $GitName
            GIT_COMMITTER_EMAIL = $GitEmail
        }
    $ProposedCommitSha = $StrictUtf8.GetString(
        $CommitTreeResult.bytes
    ).Trim().ToLowerInvariant()
    Assert-GitObjectId `
        -ObjectId $ProposedCommitSha `
        -ObjectFormat $ObjectFormat `
        -Label 'PROPOSED_COMMIT'
    $CommitObjectCreated = $true
    if ($CommitTreeResult.stderr_present) {
        throw 'STOP COMMIT_TREE_REPORTED_STDERR'
    }

    $ObjectIdLength = if ($ObjectFormat -eq 'sha1') { 40 } else { 64 }
    $ZeroObjectId = ''.PadLeft($ObjectIdLength, [char]'0')
    $UpdateRefResult = Invoke-GitBinary `
        -Arguments (
            "-c core.hooksPath=`"{0}`" update-ref --no-deref refs/heads/master {1} {2}" -f
            $EmptyHooksDirectory,
            $ProposedCommitSha,
            $ZeroObjectId
        ) `
        -AllowedExitCodes @(0, 1, 128) `
        -AllowStandardError
    if ($UpdateRefResult.exit_code -ne 0) {
        throw 'STOP CONDITIONAL_GENESIS_REF_UPDATE_FAILED'
    }
    $BranchRefCreated = $true
    $CommitCreated = $true
    if ($UpdateRefResult.stderr_present) {
        throw 'STOP CONDITIONAL_GENESIS_REF_UPDATE_REPORTED_STDERR'
    }

    $HeadSha = ([string](& $GitExecutable rev-parse --verify 'HEAD^{commit}' 2>$null)).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0) {
        throw 'STOP INVALID_HEAD_SHA'
    }
    Assert-GitObjectId -ObjectId $HeadSha -ObjectFormat $ObjectFormat -Label 'HEAD'
    if (-not [StringComparer]::Ordinal.Equals($HeadSha, $ProposedCommitSha)) {
        throw 'STOP HEAD_DIFFERS_FROM_CONDITIONALLY_INSTALLED_COMMIT'
    }
    $HeadTypeResult = Invoke-GitBinary `
        -Arguments ("--no-replace-objects cat-file -t {0}" -f $HeadSha)
    $HeadType = $StrictUtf8.GetString($HeadTypeResult.bytes).Trim()
    if ($HeadType -ne 'commit') {
        throw 'STOP HEAD_OBJECT_IS_NOT_COMMIT'
    }

    $TreeSha = $ApprovedTreeSha
    Assert-GitObjectId -ObjectId $TreeSha -ObjectFormat $ObjectFormat -Label 'TREE'
    $TreeTypeResult = Invoke-GitBinary `
        -Arguments ("--no-replace-objects cat-file -t {0}" -f $TreeSha)
    $TreeType = $StrictUtf8.GetString($TreeTypeResult.bytes).Trim()
    if ($TreeType -ne 'tree') {
        throw 'STOP TREE_OBJECT_IS_NOT_TREE'
    }
    if ($TreeSha -ne $ApprovedTreeSha) {
        throw "STOP COMMITTED_TREE_DIFFERS_FROM_APPROVED_TREE: approved=$ApprovedTreeSha committed=$TreeSha"
    }

    $RawCommitResult = Invoke-GitBinary `
        -Arguments ("--no-replace-objects cat-file commit {0}" -f $HeadSha)
    try {
        $RawCommitText = $StrictUtf8.GetString($RawCommitResult.bytes)
    }
    catch {
        throw 'STOP RAW_COMMIT_IS_NOT_STRICT_UTF8'
    }
    $CommitHeaderEnd = $RawCommitText.IndexOf("`n`n", [StringComparison]::Ordinal)
    if ($CommitHeaderEnd -lt 1) {
        throw 'STOP RAW_COMMIT_HEADER_TERMINATOR_MISSING'
    }
    $CommitHeaderLines = @(
        $RawCommitText.Substring(0, $CommitHeaderEnd).Split([char]10)
    )
    $RawTreeHeaders = @(
        $CommitHeaderLines | Where-Object { $_.StartsWith('tree ') }
    )
    if (
        $RawTreeHeaders.Count -ne 1 -or
        $RawTreeHeaders[0].Substring(5).Trim().ToLowerInvariant() -ne $TreeSha
    ) {
        throw 'STOP RAW_COMMIT_TREE_HEADER_MISMATCH'
    }
    $RawParentHeaders = @(
        $CommitHeaderLines | Where-Object { $_.StartsWith('parent ') }
    )
    $ParentCount = $RawParentHeaders.Count
    if ($ParentCount -ne 0) {
        throw "STOP NOT_GENESIS: parent_count=$ParentCount"
    }

    $RawCommitMessageBody = $RawCommitText.Substring($CommitHeaderEnd + 2)
    if ($RawCommitMessageBody -ne ($CommitMessage + "`n")) {
        throw 'STOP COMMIT_MESSAGE_MISMATCH'
    }
    $ObservedMessage = $CommitMessage

    $ObservedHeadReference = ([string](& $GitExecutable symbolic-ref HEAD 2>$null)).Trim()
    if ($LASTEXITCODE -ne 0 -or $ObservedHeadReference -ne 'refs/heads/master') {
        throw 'STOP POST_COMMIT_HEAD_REFERENCE_MISMATCH'
    }
    $ObservedBranch = ([string](& $GitExecutable symbolic-ref --short HEAD 2>$null)).Trim()
    if ($LASTEXITCODE -ne 0 -or $ObservedBranch -ne $ExpectedBranch) {
        throw "STOP POST_COMMIT_BRANCH_MISMATCH: expected=$ExpectedBranch observed=$ObservedBranch"
    }

    $CommittedPathResult = Invoke-GitBinary `
        -Arguments ("-c core.quotepath=false ls-tree -r -z --name-only $HeadSha")
    $CommittedPaths = @(
        Get-OrdinalUnique -Values (
            [string[]]@(
                ConvertFrom-NulPathBytes -Bytes $CommittedPathResult.bytes
            )
        )
    )
    Assert-CandidatePathsSafe -Paths $CommittedPaths

    Assert-ExactOrderedPathSet `
        -Expected $Staged `
        -Observed $CommittedPaths `
        -FailureCode 'STOP COMMITTED_SET_DIFFERS_FROM_STAGED_SET'

    $CommittedGitignoreResult = Invoke-GitBinary `
        -Arguments ("cat-file blob {0}:.gitignore" -f $HeadSha)
    $CommittedGitignoreSha256 = Get-Sha256HexFromBytes `
        -Bytes $CommittedGitignoreResult.bytes
    if ($CommittedGitignoreSha256 -ne $GitignoreSha256) {
        throw 'STOP COMMITTED_GITIGNORE_BYTES_DIFFER_FROM_APPROVED_WORKTREE_BYTES'
    }

    $FinalHeadSha = ([string](& $GitExecutable rev-parse --verify 'HEAD^{commit}' 2>$null)).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or -not [StringComparer]::Ordinal.Equals($FinalHeadSha, $HeadSha)) {
        throw 'STOP HEAD_MOVED_DURING_READBACK'
    }

    Assert-CandidateAttributesDoNotTransform `
        -Paths $CommittedPaths `
        -FailureCodePrefix 'STOP POSTCOMMIT_CANDIDATE'
    $FinalCandidatePaths = @(Get-CandidatePaths)
    Assert-CandidatePathsSafe -Paths $FinalCandidatePaths
    Assert-ExactOrderedPathSet `
        -Expected $Candidates `
        -Observed $FinalCandidatePaths `
        -FailureCode 'STOP FINAL_CANDIDATE_SET_DIFFERS_FROM_APPROVED_INVENTORY'
    $FinalInventoryPath = Join-Path $ResolvedReceiptDirectory (
        'VISIONASSIST_GENESIS_CANDIDATES_FINAL_' + $RunId + '.tsv'
    )
    $FinalInventory = Get-Inventory `
        -Paths $FinalCandidatePaths `
        -Root $ResolvedRoot `
        -OutputPath $FinalInventoryPath
    if ($FinalInventory.sha256 -ne $Inventory.sha256) {
        throw 'STOP FINAL_RAW_INVENTORY_DIFFERS_FROM_APPROVED_INVENTORY'
    }

    $TrackedDiffResult = Invoke-GitBinary `
        -Arguments (
            "-c core.fsmonitor=false -c core.autocrlf=false diff-index --quiet {0} --" -f
            $HeadSha
        ) `
        -AllowedExitCodes @(0, 1)
    if ($TrackedDiffResult.exit_code -ne 0) {
        throw 'STOP TRACKED_CONTENT_DIFFERS_FROM_CAPTURED_HEAD'
    }
    $StatusResult = Invoke-GitBinary `
        -Arguments (
            '-c core.fsmonitor=false -c core.excludesFile=NUL ' +
            '-c core.autocrlf=false ' +
            'status --porcelain=v1 -z --untracked-files=all'
        )
    if ($StatusResult.bytes.Length -ne 0) {
        throw 'STOP DIRTY_AFTER_GENESIS'
    }
    $FinalHeadShaAfterStatus = ([string](& $GitExecutable rev-parse --verify 'HEAD^{commit}' 2>$null)).Trim().ToLowerInvariant()
    if (
        $LASTEXITCODE -ne 0 -or
        -not [StringComparer]::Ordinal.Equals($FinalHeadShaAfterStatus, $HeadSha)
    ) {
        throw 'STOP HEAD_MOVED_DURING_FINAL_STATUS_READBACK'
    }
    $FinalRunnerSha256 = (
        Get-FileHash -LiteralPath $ScriptFullPath -Algorithm SHA256
    ).Hash.ToLowerInvariant()
    if ($FinalRunnerSha256 -ne $RunnerSha256) {
        throw 'STOP RUNNER_CHANGED_DURING_COMMIT_OR_READBACK'
    }
    $FinalGitExecutableSha256 = (
        Get-FileHash -LiteralPath $GitExecutable -Algorithm SHA256
    ).Hash.ToLowerInvariant()
    if ($FinalGitExecutableSha256 -ne $GitExecutableSha256) {
        throw 'STOP GIT_EXECUTABLE_CHANGED_DURING_COMMIT_OR_READBACK'
    }

    $ReceiptId = 'VA-GIT-BASELINE-' + ([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
    $ReceiptPath = Join-Path $ResolvedReceiptDirectory (
        'VISIONASSIST_GIT_BASELINE_RECEIPT_2026-07-28_' + $RunId + '.json'
    )
    $Receipt = [ordered]@{
        schema_version = 'visionassist.git-baseline-receipt.v1'
        receipt_id = $ReceiptId
        run_id = $RunId
        started_at = $StartedAt
        recorded_at = [DateTime]::UtcNow.ToString('o')
        authorization_id_claimed = $AuthorizationId
        project_root = $ResolvedRoot
        branch = $ObservedBranch
        pre_state = 'UNBORN_HEAD_NO_REFS'
        commit = [ordered]@{
            head_sha = $HeadSha
            tree_sha = $TreeSha
            parent_count = $ParentCount
            message = $ObservedMessage
            creation_method = 'commit-tree_then_conditional_update-ref'
            conditional_old_object_id = $ZeroObjectId
            identity_source = 'existing_git_config_pinned_in_commit_tree_process'
        }
        scope = [ordered]@{
            inventory_sha256 = $Inventory.sha256
            inventory_approval_sha256 = $ApprovedInventory
            opaque_inventory_sha256 = $Inventory.opaque_sha256
            opaque_inventory_approval_sha256 = $ApprovedOpaqueInventory
            staged_manifest_sha256 = $StagedManifest.sha256
            staged_manifest_readable_path = $StagedManifest.readable_path
            staged_manifest_canonical_path = $StagedManifest.canonical_path
            approved_tree_sha = $ApprovedTreeSha
            exact_manifest_verification_index_path = (
                $PlannedTree.verification_index_path
            )
            exact_manifest_index_info_sha256 = (
                $PlannedTree.index_info_sha256
            )
            approved_pathspec_sha256 = $ApprovedPathspecSha256
            staged_file_count = $Staged.Count
            committed_file_count = $CommittedPaths.Count
            gitignore_existed_before = $GitignoreExistedBefore
            gitignore_pre_sha256 = $GitignorePreSha256
            gitignore_sha256 = $GitignoreSha256
            committed_gitignore_sha256 = $CommittedGitignoreSha256
            opaque_binary_count = $Inventory.opaque_binary_count
            secret_policy_sha256 = $SecretPolicySha256
            cases_tree_committed = $false
            outcome_vault_committed = $false
            blocked_secret_or_credential_path_hit_count = 0
            staged_secret_pattern_hit_count = 0
        }
        checks = [ordered]@{
            exact_root_verified = $true
            branch_verified = $true
            genesis_parent_count_zero = $true
            custody_paths_ignored = $true
            inventory_hash_approval_matched = $true
            working_inventory_hash_equal_before_and_after_stage = $true
            final_raw_inventory_hash_equals_approved_inventory = $true
            secret_filename_scan_passed = $true
            working_ascii_secret_signature_scan_passed = $true
            staged_blob_secret_pattern_scan_passed = $true
            opaque_binary_hash_approval_matched = (
                $Inventory.opaque_binary_count -eq 0 -or
                $ApprovedOpaqueInventory -eq $Inventory.opaque_sha256
            )
            opaque_human_content_review_verified_by_runner = $false
            configured_filter_driver_count = $ConfiguredFilterDriverCount
            candidate_transform_attributes_unassigned_or_unset = $true
            postcommit_transform_attributes_unassigned_or_unset = $true
            approved_raw_blob_ids_equal_staged_blob_ids = $true
            planned_tree_derived_from_external_exact_manifest_index = $true
            immediate_staged_manifest_equals_approved_staged_manifest = $true
            fsmonitor_disabled_for_mutating_commands = $true
            custom_add_and_reference_hooks_disabled = $true
            staged_diff_check_passed = $true
            approved_tree_equals_committed_tree = $true
            approved_tree_bound_before_commit_object_creation = $true
            branch_created_by_compare_and_swap_from_missing_ref = $true
            committed_paths_equal_staged_paths = $true
            committed_gitignore_bytes_equal_approved_worktree_bytes = $true
            tracked_content_equal_to_captured_head = $true
            post_commit_status_clean = $true
            head_stable_through_final_status_readback = $true
            runner_hash_stable_through_final_readback = $true
            runner_frozen_sha256_gate_matched = $true
            git_executable_hash_stable_through_final_readback = $true
        }
        custody_boundary = [ordered]@{
            candidate_content_reads_with_cases_prefix_requested = $false
            candidate_content_reads_with_outcome_vault_prefix_requested = $false
            custody_path_metadata_boolean_checks_performed = $true
            candidate_or_staged_output_custody_names_recorded = $false
            indirect_alias_or_git_config_custody_reads = 'UNVERIFIED'
            verify_custody_run_by_runner = $false
        }
        execution_provenance = [ordered]@{
            runner_path = $ScriptFullPath
            runner_sha256 = $RunnerSha256
            expected_runner_sha256 = $ExpectedRunnerSha256Normalized
            git_executable = $GitExecutable
            git_executable_sha256 = $GitExecutableSha256
            git_version = $GitVersion
            git_object_format = $ObjectFormat
            capture_class = 'LOCAL_UNSIGNED_SELF_REPORT'
            independent_readback = $false
        }
        external_actions = [ordered]@{
            push_invoked_by_runner = $false
            deployment_invoked_by_runner = $false
            product_runtime_command_invoked_by_runner = $false
            ai_invoked_by_runner = $false
            fusion_invoked_by_runner = $false
            market_baseline_invoked_by_runner = $false
            reveal_invoked_by_runner = $false
            adjudication_invoked_by_runner = $false
            scoring_invoked_by_runner = $false
        }
        authority = [ordered]@{
            git_action = 'GENESIS_CREATED_UNDER_CLAIMED_AUTHORIZATION'
            decision_status = 'DIAGNOSTIC_ONLY'
            domain_action_code = 'NO_ACTION'
            execution_permission = 'HOLD'
            capital_permission = 'DENY'
            can_trade = $false
        }
        terminal_status = 'LOCAL_EXECUTION_REPORTED_PENDING_INDEPENDENT_READBACK'
    }

    Write-JsonFile -Value $Receipt -Path $ReceiptPath
    $ReceiptReadback = Get-Content -LiteralPath $ReceiptPath -Raw -ErrorAction Stop | ConvertFrom-Json
    if (
        $ReceiptReadback.commit.head_sha -ne $HeadSha -or
        $ReceiptReadback.commit.tree_sha -ne $TreeSha -or
        [int]$ReceiptReadback.commit.parent_count -ne 0 -or
        $ReceiptReadback.execution_provenance.runner_path -ne
            $ScriptFullPath -or
        $ReceiptReadback.execution_provenance.runner_sha256 -ne
            $ExpectedRunnerSha256Normalized -or
        $ReceiptReadback.execution_provenance.expected_runner_sha256 -ne
            $ExpectedRunnerSha256Normalized -or
        $ReceiptReadback.authority.can_trade -ne $false -or
        $ReceiptReadback.terminal_status -ne 'LOCAL_EXECUTION_REPORTED_PENDING_INDEPENDENT_READBACK'
    ) {
        throw 'STOP RECEIPT_JSON_READBACK_MISMATCH'
    }
    $ReceiptSha256 = (Get-FileHash -LiteralPath $ReceiptPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $ReceiptSidecarPath = $ReceiptPath + '.sha256'
    $ReceiptSidecarText = (
        "$ReceiptSha256  $([IO.Path]::GetFileName($ReceiptPath))" +
        [Environment]::NewLine
    )
    $ReceiptSidecarBytes = $Utf8NoBom.GetBytes($ReceiptSidecarText)
    Write-BytesAtomic `
        -Path $ReceiptSidecarPath `
        -Bytes $ReceiptSidecarBytes

    Write-Host 'GENESIS COMMIT CREATED; THIS RUNNER INVOKED NO PUSH.'
    Write-Host "HEAD: $HeadSha"
    Write-Host "TREE: $TreeSha"
    Write-Host "PARENTS: $ParentCount"
    Write-Host 'STATUS: CLEAN'
    Write-Host "Receipt: $ReceiptPath"
    Write-Host "Receipt SHA-256: $ReceiptSha256"
    $ExecutionLock.Dispose()
}
catch {
    $OriginalFailureCode = $_.Exception.Message
    $FailureObservedHeadSha = $null
    $FailureObservedTreeSha = $null
    $FailureObservedHeadReference = $null
    $FailureObservedStatus = 'UNKNOWN'
    $FailureReadbackError = $null
    try {
        $FailureHeadRaw = ([string](
            & $GitExecutable rev-parse --verify 'HEAD^{commit}' 2>$null
        )).Trim().ToLowerInvariant()
        $FailureHeadExit = $LASTEXITCODE
        if ($FailureHeadExit -eq 0 -and $FailureHeadRaw) {
            $CommitCreated = $true
            $FailureObservedHeadSha = $FailureHeadRaw
            if (
                $ProposedCommitSha -and
                [StringComparer]::Ordinal.Equals(
                    $FailureObservedHeadSha,
                    $ProposedCommitSha
                )
            ) {
                $BranchRefCreated = $true
            }
            Assert-GitObjectId `
                -ObjectId $FailureObservedHeadSha `
                -ObjectFormat $ObjectFormat `
                -Label 'FAILURE_HEAD'
            $FailureObservedTreeSha = ([string](
                & $GitExecutable rev-parse --verify "$FailureObservedHeadSha^{tree}" 2>$null
            )).Trim().ToLowerInvariant()
            if ($LASTEXITCODE -ne 0) {
                throw 'FAILURE_READBACK_TREE_UNAVAILABLE'
            }
            Assert-GitObjectId `
                -ObjectId $FailureObservedTreeSha `
                -ObjectFormat $ObjectFormat `
                -Label 'FAILURE_TREE'
            $FailureObservedHeadReference = ([string](
                & $GitExecutable symbolic-ref HEAD 2>$null
            )).Trim()
            if ($LASTEXITCODE -ne 0) {
                throw 'FAILURE_READBACK_HEAD_REFERENCE_UNAVAILABLE'
            }
        }
        elseif ($FailureHeadExit -ne 1 -and $FailureHeadExit -ne 128) {
            throw "FAILURE_READBACK_HEAD_AMBIGUOUS: exit=$FailureHeadExit"
        }

        $FailureObservedStatus = (
            'NOT_QUERIED_FAIL_CLOSED_AFTER_PRIMARY_FAILURE'
        )
    }
    catch {
        $FailureReadbackError = $_.Exception.Message
    }

    $FailureGitAction = if ($CommitCreated) {
        'GENESIS_EFFECT_PRESENT_RECONCILIATION_REQUIRED'
    }
    elseif ($CommitObjectCreated) {
        'DANGLING_COMMIT_OBJECT_MAY_BE_PRESENT_NO_BRANCH_REF_RECORDED'
    }
    else {
        'GENESIS_NOT_CREATED'
    }
    $FailureTerminalStatus = if ($CommitCreated) {
        'COMMIT_CREATED_POSTCHECK_FAILED'
    }
    elseif ($CommitObjectCreated) {
        'COMMIT_OBJECT_CREATED_REF_NOT_INSTALLED'
    }
    else {
        'NO_COMMIT_CREATED'
    }
    $FailureReceipt = [ordered]@{
        schema_version = 'visionassist.git-baseline-failure-receipt.v1'
        run_id = $RunId
        started_at = $StartedAt
        recorded_at = [DateTime]::UtcNow.ToString('o')
        authorization_id_claimed = $AuthorizationId
        project_root = $ResolvedRoot
        branch = $Branch
        inventory_sha256 = $Inventory.sha256
        commit_created_before_failure = $CommitCreated
        commit_object_created_before_failure = $CommitObjectCreated
        branch_ref_created_before_failure = $BranchRefCreated
        failure_code = $OriginalFailureCode
        reconciliation_readback = [ordered]@{
            observed_head_sha = $FailureObservedHeadSha
            observed_tree_sha = $FailureObservedTreeSha
            observed_head_reference = $FailureObservedHeadReference
            observed_worktree_status = $FailureObservedStatus
            readback_error = $FailureReadbackError
        }
        next_state = 'HOLD_FOR_REVIEW'
        authority = [ordered]@{
            git_action = $FailureGitAction
            decision_status = 'DIAGNOSTIC_ONLY'
            domain_action_code = 'NO_ACTION'
            execution_permission = 'HOLD'
            capital_permission = 'DENY'
            can_trade = $false
        }
        terminal_status = $FailureTerminalStatus
    }
    Write-JsonFile -Value $FailureReceipt -Path $FailureReceiptPath
    throw
}
}
catch {
    $OuterFailureRecord = $_
    if ($StageMutationStarted -and -not $CommitAttemptEntered) {
        $PhaseFailureReceipt = [ordered]@{
            schema_version = 'visionassist.git-genesis-phase-failure-receipt.v1'
            run_id = $RunId
            started_at = $StartedAt
            recorded_at = [DateTime]::UtcNow.ToString('o')
            authorization_id_claimed = $AuthorizationId
            project_root = $ResolvedRoot
            branch = $Branch
            inventory_sha256 = $Inventory.sha256
            stage_mutation_started = $true
            commit_attempt_entered = $false
            commit_created = $false
            index_or_object_database_may_be_mutated = $true
            failure_code = $OuterFailureRecord.Exception.Message
            next_state = 'HOLD_FOR_RECONCILIATION'
            custody_boundary = [ordered]@{
                candidate_content_reads_with_cases_prefix_requested = $false
                candidate_content_reads_with_outcome_vault_prefix_requested = $false
                custody_path_metadata_boolean_checks_performed = $true
                candidate_or_staged_output_custody_names_recorded = $false
                indirect_alias_or_git_config_custody_reads = 'UNVERIFIED'
                verify_custody_run_by_runner = $false
            }
            authority = [ordered]@{
                git_action = 'INDEX_OR_OBJECT_EFFECT_MAY_BE_PRESENT'
                decision_status = 'DIAGNOSTIC_ONLY'
                domain_action_code = 'NO_ACTION'
                execution_permission = 'HOLD'
                capital_permission = 'DENY'
                can_trade = $false
            }
            terminal_status = 'INDEX_STAGED_NO_COMMIT_RECONCILIATION_REQUIRED'
        }
        try {
            Write-JsonFile `
                -Value $PhaseFailureReceipt `
                -Path $PhaseFailureReceiptPath
        }
        catch {
        }
    }
    try {
        $ExecutionLock.Dispose()
    }
    catch {
    }
    throw $OuterFailureRecord
}
