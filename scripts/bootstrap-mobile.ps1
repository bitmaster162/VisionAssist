param(
    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
    [ValidateSet("android-pilot", "product-dev")]
    [string]$Profile = "android-pilot"
)

if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) {
    throw "Flutter SDK is not installed or not in PATH."
}

$mobileRoot = Join-Path $RepoRoot "apps\mobile"
$tempRoot = Join-Path $env:TEMP ("visionassist_mobile_seed_" + [guid]::NewGuid().ToString("N"))

New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

try {
    $platforms = if ($Profile -eq "android-pilot") { "android" } else { "android,ios" }
    & flutter create $tempRoot --org com.visionassist --project-name visionassist_mobile --platforms $platforms

    Copy-Item (Join-Path $tempRoot ".metadata") $mobileRoot -Force
    Copy-Item (Join-Path $tempRoot "android") $mobileRoot -Recurse -Force
    if (Test-Path (Join-Path $tempRoot "ios")) {
        Copy-Item (Join-Path $tempRoot "ios") $mobileRoot -Recurse -Force
    }

    $androidManifestPath = Join-Path $mobileRoot "android\app\src\main\AndroidManifest.xml"
    $androidManifest = Get-Content $androidManifestPath -Raw

    foreach ($permission in @(
        '<uses-permission android:name="android.permission.INTERNET"/>',
        '<uses-permission android:name="android.permission.CAMERA"/>'
    )) {
        if ($androidManifest -notmatch [regex]::Escape($permission)) {
            $androidManifest = $androidManifest -replace '<manifest xmlns:android="http://schemas.android.com/apk/res/android">', "<manifest xmlns:android=`"http://schemas.android.com/apk/res/android`">`r`n    $permission"
        }
    }

    if ($Profile -eq "product-dev") {
        foreach ($permission in @(
            '<uses-permission android:name="android.permission.RECORD_AUDIO"/>',
            '<uses-permission android:name="android.permission.VIBRATE"/>'
        )) {
            if ($androidManifest -notmatch [regex]::Escape($permission)) {
                $androidManifest = $androidManifest -replace '<manifest xmlns:android="http://schemas.android.com/apk/res/android">', "<manifest xmlns:android=`"http://schemas.android.com/apk/res/android`">`r`n    $permission"
            }
        }
    }

    if (($Profile -eq "product-dev") -and ($androidManifest -notmatch 'android\.speech\.RecognitionService')) {
        $queries = @'
    <queries>
        <intent>
            <action android:name="android.speech.RecognitionService"/>
        </intent>
        <intent>
            <action android:name="android.intent.action.TTS_SERVICE"/>
        </intent>
    </queries>
'@
        $androidManifest = $androidManifest -replace '(<application[^>]*>)', "$queries`r`n`$1"
    }

    Set-Content -Path $androidManifestPath -Value $androidManifest -Encoding UTF8

    $infoPlistPath = Join-Path $mobileRoot "ios\Runner\Info.plist"
    if (Test-Path $infoPlistPath) {
        $infoPlist = Get-Content $infoPlistPath -Raw

        $plistEntries = @(
            @("<key>NSCameraUsageDescription</key>", "<string>Камера нужна для описания сцены.</string>"),
            @("<key>NSMicrophoneUsageDescription</key>", "<string>Микрофон нужен для голосовых команд.</string>"),
            @("<key>NSSpeechRecognitionUsageDescription</key>", "<string>Распознавание речи нужно для голосового управления.</string>"),
            @("<key>NSLocalNetworkUsageDescription</key>", "<string>Локальная сеть нужна для связи с edge-шлюзом в режиме разработки.</string>")
        )

        foreach ($pair in $plistEntries) {
            if ($infoPlist -notmatch [regex]::Escape($pair[0])) {
                $infoPlist = $infoPlist -replace '</dict>', "    $($pair[0])`r`n    $($pair[1])`r`n</dict>"
            }
        }

        if ($infoPlist -notmatch '<key>NSAppTransportSecurity</key>') {
            $ats = @'
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsLocalNetworking</key>
        <true/>
        <key>NSAllowsArbitraryLoads</key>
        <true/>
    </dict>
'@
            $infoPlist = $infoPlist -replace '</dict>', "$ats`r`n</dict>"
        }

        Set-Content -Path $infoPlistPath -Value $infoPlist -Encoding UTF8
    }

    Write-Host "Flutter platform folders bootstrapped into $mobileRoot (profile=$Profile)"
    Write-Host "Next: Set-Location $mobileRoot; flutter pub get; flutter run ..."
} finally {
    if (Test-Path $tempRoot) {
        Remove-Item $tempRoot -Recurse -Force
    }
}
