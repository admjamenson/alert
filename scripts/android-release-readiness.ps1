param(
  [string]$ApkPath = 'android\app\build\outputs\apk\release\app-release.apk',
  [string]$AabPath = 'android\app\build\outputs\bundle\release\app-release.aab',
  [switch]$RequireStoreSigning
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedApkPath = Join-Path $repoRoot $ApkPath
$resolvedAabPath = Join-Path $repoRoot $AabPath
$buildGradlePath = Join-Path $repoRoot 'android\app\build.gradle'
$gradlePropertiesPath = Join-Path $repoRoot 'android\gradle.properties'
$keystorePropertiesPath = Join-Path $repoRoot 'android\keystore.properties'

function Add-Check {
  param(
    [System.Collections.Generic.List[object]]$Checks,
    [string]$Id,
    [string]$Status,
    [string]$Message,
    [object]$Data = $null
  )

  $row = [ordered]@{
    id = $Id
    status = $Status
    message = $Message
  }
  if ($null -ne $Data) {
    $row.data = $Data
  }
  $Checks.Add([pscustomobject]$row)
}

function Get-ApkEntries {
  param([string]$Path)

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($Path)
  try {
    return @($zip.Entries | ForEach-Object { $_.FullName })
  } finally {
    $zip.Dispose()
  }
}

function Find-ApkSigner {
  $fromPath = Get-Command apksigner.bat -ErrorAction SilentlyContinue
  if ($fromPath) {
    return $fromPath.Source
  }

  $sdkRoots = @(
    $env:ANDROID_HOME,
    $env:ANDROID_SDK_ROOT,
    (Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
    (Join-Path $repoRoot 'android-sdk')
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

  foreach ($sdkRoot in $sdkRoots) {
    $buildToolsRoot = Join-Path $sdkRoot 'build-tools'
    if (-not (Test-Path $buildToolsRoot)) {
      continue
    }

    $candidate = Get-ChildItem -Path $buildToolsRoot -Recurse -Filter apksigner.bat -ErrorAction SilentlyContinue |
      Sort-Object -Property FullName -Descending |
      Select-Object -First 1
    if ($candidate) {
      return $candidate.FullName
    }
  }

  return $null
}

function Find-JarSigner {
  $fromPath = Get-Command jarsigner.exe -ErrorAction SilentlyContinue
  if ($fromPath) {
    return $fromPath.Source
  }

  $fromPathBat = Get-Command jarsigner.bat -ErrorAction SilentlyContinue
  if ($fromPathBat) {
    return $fromPathBat.Source
  }

  if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
    foreach ($name in @('jarsigner.exe', 'jarsigner.bat')) {
      $candidate = Join-Path $env:JAVA_HOME "bin\$name"
      if (Test-Path $candidate) {
        return $candidate
      }
    }
  }

  return $null
}

function Test-ApkSignature {
  param([string]$Path)

  $apkSigner = Find-ApkSigner
  if ([string]::IsNullOrWhiteSpace($apkSigner)) {
    return [pscustomobject]@{
      status = 'blocked'
      message = 'apksigner was not found on this host'
      data = $null
    }
  }

  $output = & $apkSigner verify --print-certs $Path 2>&1
  $exitCode = $LASTEXITCODE
  $sha256Line = @($output | Where-Object { $_ -match 'SHA-256 digest:' } | Select-Object -First 1)
  $signerLine = @($output | Where-Object { $_ -match 'Signer #1 certificate DN:' } | Select-Object -First 1)
  $data = [ordered]@{
    apksigner = $apkSigner
    exitCode = $exitCode
  }
  if ($sha256Line) {
    $data.certificateSha256 = ($sha256Line -replace '.*SHA-256 digest:\s*', '').Trim()
  }
  if ($signerLine) {
    $data.signerDn = ($signerLine -replace '.*certificate DN:\s*', '').Trim()
  }

  if ($exitCode -eq 0) {
    return [pscustomobject]@{
      status = 'pass'
      message = 'APK signature verified with apksigner'
      data = $data
    }
  }

  return [pscustomobject]@{
    status = 'fail'
    message = 'APK signature verification failed'
    data = $data
  }
}

function Test-AabSignature {
  param([string]$Path)

  $jarSigner = Find-JarSigner
  if ([string]::IsNullOrWhiteSpace($jarSigner)) {
    return [pscustomobject]@{
      status = 'blocked'
      message = 'jarsigner was not found on this host'
      data = $null
    }
  }

  $output = & $jarSigner -verify -certs $Path 2>&1
  $exitCode = $LASTEXITCODE
  $verified = @($output | Where-Object { $_ -match 'jar verified' }).Count -gt 0
  $data = [ordered]@{
    jarsigner = $jarSigner
    exitCode = $exitCode
    verified = $verified
  }

  if ($exitCode -eq 0 -and $verified) {
    return [pscustomobject]@{
      status = 'pass'
      message = 'AAB signature verified with jarsigner'
      data = $data
    }
  }

  return [pscustomobject]@{
    status = 'fail'
    message = 'AAB signature verification failed'
    data = $data
  }
}

function Test-ReleaseSigningConfigured {
  if (Test-Path $keystorePropertiesPath) {
    $raw = Get-Content $keystorePropertiesPath -Raw
    $required = @('storeFile', 'storePassword', 'keyAlias', 'keyPassword')
    $present = @($required | Where-Object { $raw -match "(?m)^\s*$($_)\s*=" })
    if ($present.Count -eq $required.Count) {
      return $true
    }
  }

  $envRequired = @(
    'ALERT_RELEASE_STORE_FILE',
    'ALERT_RELEASE_STORE_PASSWORD',
    'ALERT_RELEASE_KEY_ALIAS',
    'ALERT_RELEASE_KEY_PASSWORD'
  )
  return @($envRequired | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }).Count -eq 0
}

$checks = [System.Collections.Generic.List[object]]::new()

Add-Check $checks 'file:apk' ($(if (Test-Path $resolvedApkPath) { 'pass' } else { 'fail' })) ($(if (Test-Path $resolvedApkPath) { 'APK present' } else { 'APK missing' })) @{ path = $resolvedApkPath }
Add-Check $checks 'file:aab' ($(if (Test-Path $resolvedAabPath) { 'pass' } else { 'blocked' })) ($(if (Test-Path $resolvedAabPath) { 'AAB present' } else { 'AAB missing; run bundleRelease for store artifact validation' })) @{ path = $resolvedAabPath }
Add-Check $checks 'file:build.gradle' ($(if (Test-Path $buildGradlePath) { 'pass' } else { 'fail' })) 'Android app Gradle file checked'
Add-Check $checks 'file:gradle.properties' ($(if (Test-Path $gradlePropertiesPath) { 'pass' } else { 'fail' })) 'Android Gradle properties checked'

$entries = @()
if (Test-Path $resolvedApkPath) {
  $entries = Get-ApkEntries -Path $resolvedApkPath
  $bundleEntry = $entries | Where-Object { $_ -eq 'assets/index.android.bundle' } | Select-Object -First 1
  Add-Check $checks 'apk:bundle' ($(if ($bundleEntry) { 'pass' } else { 'fail' })) ($(if ($bundleEntry) { 'Bundled JS present' } else { 'Bundled JS missing' }))

  foreach ($abi in @('arm64-v8a', 'armeabi-v7a')) {
    $hasAbi = @($entries | Where-Object { $_ -like "lib/$abi/*" }).Count -gt 0
    Add-Check $checks "apk:abi:$abi" ($(if ($hasAbi) { 'pass' } else { 'fail' })) ($(if ($hasAbi) { "Native libs present for $abi" } else { "Native libs missing for $abi" }))
  }

  $signatureResult = Test-ApkSignature -Path $resolvedApkPath
  Add-Check $checks 'signing:apk-verified' $signatureResult.status $signatureResult.message $signatureResult.data
}

if (Test-Path $resolvedAabPath) {
  $aabSignatureResult = Test-AabSignature -Path $resolvedAabPath
  Add-Check $checks 'signing:aab-verified' $aabSignatureResult.status $aabSignatureResult.message $aabSignatureResult.data
}

$buildGradle = if (Test-Path $buildGradlePath) { Get-Content $buildGradlePath -Raw } else { '' }
$gradleProperties = if (Test-Path $gradlePropertiesPath) { Get-Content $gradlePropertiesPath -Raw } else { '' }
$declaresBothAbiFilters = $buildGradle -match 'abiFilters\s+"armeabi-v7a",\s*"arm64-v8a"'
$declaresBothArchitectures = $gradleProperties -match 'reactNativeArchitectures=arm64-v8a,armeabi-v7a'
Add-Check $checks 'gradle:abiFilters' ($(if ($declaresBothAbiFilters) { 'pass' } else { 'fail' })) 'Release native ABI filters include arm64-v8a and armeabi-v7a'
Add-Check $checks 'gradle:reactNativeArchitectures' ($(if ($declaresBothArchitectures) { 'pass' } else { 'fail' })) 'reactNativeArchitectures includes arm64-v8a and armeabi-v7a'

$releaseSigningConfigured = Test-ReleaseSigningConfigured
Add-Check $checks 'signing:store-config' ($(if ($releaseSigningConfigured) { 'pass' } elseif ($RequireStoreSigning) { 'fail' } else { 'blocked' })) ($(if ($releaseSigningConfigured) { 'Release signing credentials configured' } else { 'Store signing credentials are not configured on this host' }))

$failed = @($checks | Where-Object { $_.status -eq 'fail' })
$blocked = @($checks | Where-Object { $_.status -eq 'blocked' })
$result = [ordered]@{
  ok = $failed.Count -eq 0
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  apkPath = $resolvedApkPath
  apkBytes = if (Test-Path $resolvedApkPath) { (Get-Item $resolvedApkPath).Length } else { 0 }
  aabPath = $resolvedAabPath
  aabBytes = if (Test-Path $resolvedAabPath) { (Get-Item $resolvedAabPath).Length } else { 0 }
  mode = if ($releaseSigningConfigured) { 'store_signing_configured' } else { 'installable_release_debug_signed_or_unsigned_candidate' }
  summary = [ordered]@{
    pass = @($checks | Where-Object { $_.status -eq 'pass' }).Count
    fail = $failed.Count
    blocked = $blocked.Count
  }
  checks = $checks
}

$result | ConvertTo-Json -Depth 5
if ($failed.Count -gt 0) {
  exit 1
}
