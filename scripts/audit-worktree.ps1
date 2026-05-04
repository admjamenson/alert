param(
  [switch]$CleanTemp
)

$ErrorActionPreference = 'Stop'

function Get-RepoRoot {
  $root = (& git rev-parse --show-toplevel).Trim()
  if (-not $root) {
    throw 'git_root_not_found'
  }
  return [System.IO.Path]::GetFullPath($root)
}

function Normalize-RepoPath([string]$Path) {
  return ($Path -replace '\\', '/').Trim()
}

function Test-IsDisposableTempPath([string]$Path) {
  $normalized = Normalize-RepoPath $Path
  $patterns = @(
    '^_tmp.*',
    '^_append_gradle_props\d*\.cmd$',
    '^_dirx\.cmd$',
    '^_fix_sdk_acl\.cmd$',
    '^_get_shortpath\.cmd$',
    '^_git_status\.txt$',
    '^_logcat.*\.txt$',
    '^logcat.*\.txt$',
    '^_nmake_test\.cmd$',
    '^_run_gradle_.*\.cmd$',
    '^_cmake_test(?:/.*)?$',
    '^_ninja_test(?:/.*)?$',
    '^_tmp_ndk_test(?:\..+)?$',
    '^tmp_bundle\.txt$',
    '^tsc_(?:errors|log)\.txt$',
    '^System\.Drawing\.Drawing2D\.GraphicsPath$',
    '^android-sdk(?:/.*)?$',
    '^android/ndk(?:/.*)?$',
    '^tools/ninja(?:/.*)?$',
    '^tools/ninja\.exe$',
    '^tools/ninja-win\.zip$',
    '^tools/vs_BuildTools\.exe$'
  )

  foreach ($pattern in $patterns) {
    if ($normalized -match $pattern) {
      return $true
    }
  }

  return $false
}

function Resolve-SafePath([string]$RepoRoot, [string]$RelativePath) {
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $RelativePath))
  if (-not $candidate.StartsWith($RepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "unsafe_path:$RelativePath"
  }
  return $candidate
}

$repoRoot = Get-RepoRoot
$statusLines = @(& git -c core.quotepath=false status --short --untracked-files=all)

$trackedChanges = New-Object System.Collections.Generic.List[string]
$tempCandidates = New-Object System.Collections.Generic.List[string]
$otherUntracked = New-Object System.Collections.Generic.List[string]
$cleaned = New-Object System.Collections.Generic.List[string]

foreach ($line in $statusLines) {
  if ([string]::IsNullOrWhiteSpace($line)) {
    continue
  }

  $path = $line.Substring(3).Trim()
  if ($line.StartsWith('?? ')) {
    if (Test-IsDisposableTempPath $path) {
      $tempCandidates.Add($path) | Out-Null
    } else {
      $otherUntracked.Add($path) | Out-Null
    }
  } else {
    $trackedChanges.Add($line) | Out-Null
  }
}

if ($CleanTemp.IsPresent) {
  foreach ($relativePath in $tempCandidates) {
    $absolutePath = Resolve-SafePath -RepoRoot $repoRoot -RelativePath $relativePath
    if (-not (Test-Path -LiteralPath $absolutePath)) {
      continue
    }
    Remove-Item -LiteralPath $absolutePath -Recurse -Force
    $cleaned.Add($relativePath) | Out-Null
  }
}

Write-Output "repo_root=$repoRoot"
Write-Output "tracked_changes=$($trackedChanges.Count)"
foreach ($entry in $trackedChanges) {
  Write-Output "tracked:$entry"
}

Write-Output "temp_candidates=$($tempCandidates.Count)"
foreach ($entry in $tempCandidates) {
  Write-Output "temp:$entry"
}

Write-Output "other_untracked=$($otherUntracked.Count)"
foreach ($entry in $otherUntracked) {
  Write-Output "untracked:$entry"
}

Write-Output "cleaned=$($cleaned.Count)"
foreach ($entry in $cleaned) {
  Write-Output "cleaned:$entry"
}
