param(
  [int]$Samples = 5,
  [string]$DeviceSerial = $env:ALERT_ANDROID_SERIAL,
  [string]$PackageName = 'com.company.alert',
  [string]$ActivityName = '.MainActivity'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$artifactsRoot = Join-Path $repoRoot 'artifacts'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path $artifactsRoot "android-startup-$timestamp"
$summaryPath = Join-Path $runDir 'summary.json'

New-Item -ItemType Directory -Force -Path $runDir | Out-Null

function Invoke-Adb {
  param([string[]]$Arguments)
  & adb @Arguments
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
  if ($DeviceSerial) {
    $requested = $authorizedDevices | Where-Object { $_.Serial -eq $DeviceSerial } | Select-Object -First 1
    if (-not $requested) {
      throw "Requested Android device '$DeviceSerial' is not connected and authorized."
    }
    return $DeviceSerial
  }
  if ($authorizedDevices.Count -eq 0) {
    throw 'No authorized Android device connected.'
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

function Wake-And-Unlock {
  Invoke-Device @('shell', 'input', 'keyevent', '224') | Out-Null
  Start-Sleep -Milliseconds 250
  try {
    Invoke-Device @('shell', 'wm', 'dismiss-keyguard') | Out-Null
  } catch {
    # Older Samsung builds may not support this command; the swipe below is the fallback.
  }
  Invoke-Device @('shell', 'input', 'swipe', '360', '1100', '360', '250', '250') | Out-Null
  Start-Sleep -Milliseconds 500
}

function Get-Percentile {
  param(
    [double[]]$Values,
    [double]$Percentile
  )

  if ($Values.Count -eq 0) {
    return $null
  }
  $ordered = @($Values | Sort-Object)
  $rank = [Math]::Ceiling(($Percentile / 100.0) * $ordered.Count) - 1
  $index = [Math]::Max(0, [Math]::Min($ordered.Count - 1, [int]$rank))
  return [int]$ordered[$index]
}

function Parse-StartupMarks {
  param([string[]]$LogLines)

  $marks = [ordered]@{}
  foreach ($line in $LogLines) {
    if ($line -match '\[ALERT-STARTUP\]\s+(?<phase>[A-Z_]+)\s+\+(?<ms>\d+)ms') {
      $marks[$matches.phase] = [int]$matches.ms
    }
    if ($line -match 'AlertStartup:\s+(?<phase>[A-Z_]+)\s+\+(?<ms>\d+)ms') {
      $marks[$matches.phase] = [int]$matches.ms
    }
  }
  return $marks
}

$Samples = [Math]::Max(1, [Math]::Min(20, $Samples))
$script:SelectedDeviceSerial = Get-PreferredDeviceSerial -Devices (Get-ConnectedDevices)
$component = "$PackageName/$ActivityName"
$sampleRows = @()

Wake-And-Unlock

for ($i = 1; $i -le $Samples; $i += 1) {
  $sampleDir = Join-Path $runDir "sample-$i"
  New-Item -ItemType Directory -Force -Path $sampleDir | Out-Null
  Invoke-Device @('logcat', '-c') | Out-Null
  Invoke-Device @('shell', 'am', 'force-stop', $PackageName) | Out-Null
  Wake-And-Unlock
  Start-Sleep -Milliseconds 500
  $startOutput = @(Invoke-Device @('shell', 'am', 'start', '-W', '-n', $component))
  Start-Sleep -Seconds 4
  $logLines = @(Invoke-Device @('logcat', '-d', '-s', 'AlertStartup', 'ReactNativeJS', 'AndroidRuntime'))
  $startOutput | Set-Content (Join-Path $sampleDir 'am-start.txt')
  $logLines | Set-Content (Join-Path $sampleDir 'logcat.txt')

  $totalTime = $null
  $waitTime = $null
  foreach ($line in $startOutput) {
    if ($line -match 'TotalTime:\s*(?<ms>\d+)') {
      $totalTime = [int]$matches.ms
    }
    if ($line -match 'WaitTime:\s*(?<ms>\d+)') {
      $waitTime = [int]$matches.ms
    }
  }

  $marks = Parse-StartupMarks -LogLines $logLines
  $sampleRows += [pscustomobject]@{
    sample = $i
    totalTimeMs = $totalTime
    waitTimeMs = $waitTime
    startupMarks = $marks
  }
}

$totalTimes = @($sampleRows | Where-Object { $null -ne $_.totalTimeMs } | ForEach-Object { [double]$_.totalTimeMs })
$sosTimes = @($sampleRows | Where-Object { $_.startupMarks.Contains('SOS_READY') } | ForEach-Object { [double]$_.startupMarks.SOS_READY })
$nativeOverlayTimes = @($sampleRows | Where-Object { $_.startupMarks.Contains('NATIVE_CRITICAL_OVERLAY_READY') } | ForEach-Object { [double]$_.startupMarks.NATIVE_CRITICAL_OVERLAY_READY })
$mainTimes = @($sampleRows | Where-Object { $_.startupMarks.Contains('MAIN_APP_READY') } | ForEach-Object { [double]$_.startupMarks.MAIN_APP_READY })

$summary = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  classification = 'release_device_measurement'
  deviceSerial = $SelectedDeviceSerial
  packageName = $PackageName
  activityName = $ActivityName
  samplesRequested = $Samples
  samplesCollected = $sampleRows.Count
  percentiles = [ordered]@{
    totalTimeMs = [ordered]@{
      p50 = Get-Percentile -Values $totalTimes -Percentile 50
      p95 = Get-Percentile -Values $totalTimes -Percentile 95
    }
    sosReadyMs = [ordered]@{
      p50 = Get-Percentile -Values $sosTimes -Percentile 50
      p95 = Get-Percentile -Values $sosTimes -Percentile 95
    }
    nativeCriticalOverlayReadyMs = [ordered]@{
      p50 = Get-Percentile -Values $nativeOverlayTimes -Percentile 50
      p95 = Get-Percentile -Values $nativeOverlayTimes -Percentile 95
    }
    mainAppReadyMs = [ordered]@{
      p50 = Get-Percentile -Values $mainTimes -Percentile 50
      p95 = Get-Percentile -Values $mainTimes -Percentile 95
    }
  }
  samples = $sampleRows
  artifactsDir = $runDir
}

$summary | ConvertTo-Json -Depth 8 | Set-Content $summaryPath
$summary | ConvertTo-Json -Depth 8
