param(
  [string]$DeviceSerial = $env:ALERT_ANDROID_SERIAL,
  [string]$PackageName = 'com.company.alert',
  [string]$ActivityName = '.MainActivity'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $repoRoot 'android'
$artifactsRoot = Join-Path $repoRoot 'artifacts'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path $artifactsRoot "android-smoke-$timestamp"
$workspaceSdkDir = Join-Path $repoRoot 'android-sdk'
$workspacePlatformToolsDir = Join-Path $workspaceSdkDir 'platform-tools'
$workspaceAdb = Join-Path $workspacePlatformToolsDir 'adb.exe'
$apkPath = Join-Path $repoRoot 'android\app\build\outputs\apk\release\app-release.apk'
$gradleLogPath = Join-Path $runDir 'gradle-install-release.log'
$gradleStdoutPath = Join-Path $runDir 'gradle-install-release.stdout.log'
$gradleStderrPath = Join-Path $runDir 'gradle-install-release.stderr.log'
$deviceLogPath = Join-Path $runDir 'device.log'
$windowDumpPath = Join-Path $runDir 'window-dump.txt'
$uiDumpPath = Join-Path $runDir 'ui.xml'
$screenshotPath = Join-Path $runDir 'screen.png'
$summaryPath = Join-Path $runDir 'summary.json'

New-Item -ItemType Directory -Force -Path $runDir | Out-Null

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message"
}

function Sync-WorkspacePlatformTools {
  if (Test-Path $workspaceAdb) {
    return
  }

  $adbCommand = Get-Command adb -ErrorAction SilentlyContinue
  if (-not $adbCommand) {
    throw 'adb nao esta disponivel no PATH e android-sdk/platform-tools/adb.exe ainda nao existe.'
  }

  $sourceDir = Split-Path -Parent $adbCommand.Source
  if (-not (Test-Path $sourceDir)) {
    throw "Nao encontrei a pasta de origem do adb em $sourceDir."
  }

  Write-Step "Sincronizando platform-tools para $workspacePlatformToolsDir"
  New-Item -ItemType Directory -Force -Path $workspaceSdkDir | Out-Null
  Copy-Item -Recurse -Force $sourceDir $workspacePlatformToolsDir
}

function Invoke-Adb {
  param([string[]]$Arguments)
  & $script:PreferredAdb @Arguments
}

function Get-ConnectedDevices {
  $devices = @()
  foreach ($line in (Invoke-Adb @('devices', '-l'))) {
    if ($line -match '^(?<serial>\S+)\s+(?<state>device|unauthorized|offline)\b') {
      $devices += [pscustomobject]@{
        Serial = $matches.serial
        State = $matches.state
        Raw = $line
      }
    }
  }

  return $devices
}

function Get-PreferredDeviceSerial {
  param([object[]]$Devices)

  $authorizedDevices = @($Devices | Where-Object { $_.State -eq 'device' })
  $unauthorizedDevices = @($Devices | Where-Object { $_.State -eq 'unauthorized' })

  if ($DeviceSerial) {
    $requestedDevice = $Devices | Where-Object { $_.Serial -eq $DeviceSerial } | Select-Object -First 1
    if (-not $requestedDevice) {
      throw "O device solicitado '$DeviceSerial' nao esta conectado."
    }
    if ($requestedDevice.State -ne 'device') {
      throw "O device solicitado '$DeviceSerial' esta em estado '$($requestedDevice.State)'."
    }

    return $DeviceSerial
  }

  if ($authorizedDevices.Count -eq 0 -and $unauthorizedDevices.Count -gt 0) {
    $serialList = ($unauthorizedDevices | ForEach-Object { $_.Serial }) -join ', '
    throw "Os devices conectados estao 'unauthorized': $serialList. Autorize a chave ADB no aparelho e rode o smoke novamente."
  }

  if ($authorizedDevices.Count -eq 0) {
    throw 'Nenhum device Android conectado para o smoke test.'
  }

  $usbDevice = $authorizedDevices | Where-Object { $_.Serial -notmatch ':' } | Select-Object -First 1
  if ($usbDevice) {
    return $usbDevice.Serial
  }

  return $authorizedDevices[0].Serial
}

function Invoke-Device {
  param([string[]]$Arguments)
  Invoke-Adb (@('-s', $script:SelectedDeviceSerial) + $Arguments)
}

function Set-AnimationScale {
  param([string]$Value)

  foreach ($name in @('window_animation_scale', 'transition_animation_scale', 'animator_duration_scale')) {
    Invoke-Device @('shell', 'settings', 'put', 'global', $name, $Value) | Out-Null
  }
}

function Assert-NoForbiddenPatterns {
  param(
    [string]$Text,
    [string[]]$Patterns,
    [string]$Context
  )

  foreach ($pattern in $Patterns) {
    if ($Text -match $pattern) {
      throw "$Context contem o padrao proibido: $pattern"
    }
  }
}

function Get-BundleEntry {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($apkPath)
  try {
    return $zip.Entries | Where-Object { $_.FullName -eq 'assets/index.android.bundle' } | Select-Object -First 1
  } finally {
    $zip.Dispose()
  }
}

Sync-WorkspacePlatformTools

if (-not (Test-Path $workspaceAdb)) {
  throw "Nao encontrei adb em $workspaceAdb apos a sincronizacao."
}

$hostAdbCommand = Get-Command adb -ErrorAction SilentlyContinue
$script:PreferredAdb =
  if ($hostAdbCommand) {
    $hostAdbCommand.Source
  } else {
    $workspaceAdb
  }

$connectedDevices = Get-ConnectedDevices
$script:SelectedDeviceSerial = Get-PreferredDeviceSerial -Devices $connectedDevices

Write-Step "Device selecionado: $SelectedDeviceSerial"
Write-Step 'Executando gradlew installRelease'

foreach ($path in @($gradleStdoutPath, $gradleStderrPath, $gradleLogPath)) {
  if (Test-Path $path) {
    Remove-Item -LiteralPath $path -Force
  }
}

$gradleCommand =
  "cd /d `"$androidDir`" && gradlew.bat installRelease 1>`"$gradleStdoutPath`" 2>`"$gradleStderrPath`""

& cmd.exe /d /c $gradleCommand
$gradleExitCode = $LASTEXITCODE

$gradleOutput = @()
if (Test-Path $gradleStdoutPath) {
  $gradleOutput += Get-Content $gradleStdoutPath
}
if (Test-Path $gradleStderrPath) {
  $gradleOutput += Get-Content $gradleStderrPath
}
$gradleOutput | Set-Content $gradleLogPath

if ($gradleExitCode -ne 0) {
  throw "gradlew installRelease falhou com exit code $gradleExitCode. Veja $gradleLogPath"
}

if (-not (Test-Path $apkPath)) {
  throw "APK release nao encontrado em $apkPath"
}

$bundleEntry = Get-BundleEntry
if (-not $bundleEntry) {
  throw 'O APK release nao contem assets/index.android.bundle.'
}

Write-Step "Bundle release confirmado: $($bundleEntry.Length) bytes"
Write-Step 'Limpando logcat e abrindo o app'

$remoteUiDump = '/sdcard/Download/alert_smoke_ui.xml'
$remoteScreenshot = '/sdcard/Download/alert_smoke_screen.png'

Invoke-Device @('logcat', '-c') | Out-Null
Invoke-Device @('shell', 'am', 'force-stop', $PackageName) | Out-Null
Invoke-Device @('shell', 'input', 'keyevent', '82') | Out-Null
Start-Sleep -Seconds 1
Invoke-Device @('shell', 'input', 'swipe', '360', '1100', '360', '250', '250') | Out-Null
Start-Sleep -Seconds 1
Invoke-Device @('shell', 'am', 'start', '-n', "$PackageName/$ActivityName") | Out-Null
Start-Sleep -Seconds 10

try {
  Set-AnimationScale -Value '0'
  Start-Sleep -Seconds 2
  Invoke-Device @('shell', 'uiautomator', 'dump', $remoteUiDump) | Out-Null
  Invoke-Device @('shell', 'screencap', '-p', $remoteScreenshot) | Out-Null
} finally {
  Set-AnimationScale -Value '1'
}

Invoke-Device @('pull', $remoteUiDump, $uiDumpPath) | Out-Null
Invoke-Device @('pull', $remoteScreenshot, $screenshotPath) | Out-Null
Invoke-Device @('logcat', '-d', '-t', '500') | Set-Content $deviceLogPath
Invoke-Device @('shell', 'dumpsys', 'window', 'windows') | Set-Content $windowDumpPath

$uiDumpText = Get-Content $uiDumpPath -Raw
$deviceLogText = Get-Content $deviceLogPath -Raw
$windowDumpText = Get-Content $windowDumpPath -Raw
$screenshotLength = (Get-Item $screenshotPath).Length

Assert-NoForbiddenPatterns -Text $uiDumpText -Patterns @(
  'rn_redbox',
  'Unable to load script',
  'No bundle URL present',
  'Make sure you''re either running Metro'
) -Context 'O dump de UI final'

Assert-NoForbiddenPatterns -Text $deviceLogText -Patterns @(
  'Unable to load script',
  'No bundle URL present',
  'RedBox',
  'FATAL EXCEPTION',
  'Invariant Violation'
) -Context 'O logcat final'

if ($uiDumpText -notmatch "package=""$([regex]::Escape($PackageName))""") {
  throw "O dump de UI final nao pertence ao pacote $PackageName."
}

if ($windowDumpText -notmatch [regex]::Escape($PackageName)) {
  throw "O app $PackageName nao apareceu no dumpsys window final."
}

if ($screenshotLength -lt 10000) {
  throw "O screenshot final ficou pequeno demais ($screenshotLength bytes) para ser evidencia confiavel."
}

$summary = [ordered]@{
  timestamp = $timestamp
  mode = 'release+bundle'
  packageName = $PackageName
  activityName = $ActivityName
  deviceSerial = $SelectedDeviceSerial
  apkPath = $apkPath
  bundleBytes = $bundleEntry.Length
  screenshotBytes = $screenshotLength
  artifacts = [ordered]@{
    gradleLog = $gradleLogPath
    deviceLog = $deviceLogPath
    windowDump = $windowDumpPath
    uiDump = $uiDumpPath
    screenshot = $screenshotPath
  }
}

$summary | ConvertTo-Json -Depth 4 | Set-Content $summaryPath

Write-Step "Smoke test concluido com sucesso. Artefatos em $runDir"
