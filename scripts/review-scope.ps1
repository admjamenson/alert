param(
  [Parameter(Mandatory = $true)]
  [string]$ManifestPath,
  [switch]$EmitCommands
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

function Resolve-RepoRelativePath([string]$RepoRoot, [string]$Path) {
  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Path))
}

function Quote-GitArg([string]$Path) {
  $escaped = $Path.Replace('"', '\"')
  return '"' + $escaped + '"'
}

$repoRoot = Get-RepoRoot
$manifestAbsolutePath = Resolve-RepoRelativePath -RepoRoot $repoRoot -Path $ManifestPath
if (-not (Test-Path -LiteralPath $manifestAbsolutePath)) {
  throw "manifest_not_found:$ManifestPath"
}

$manifestEntries = Get-Content -Path $manifestAbsolutePath |
  ForEach-Object { Normalize-RepoPath $_ } |
  Where-Object { $_ -and -not $_.StartsWith('#') }

$manifestLookup = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
foreach ($entry in $manifestEntries) {
  [void]$manifestLookup.Add($entry)
}

$statusLines = @(& git -c core.quotepath=false status --short --untracked-files=all)

$changedPaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
$scopeChanged = New-Object System.Collections.Generic.List[string]
$scopeClean = New-Object System.Collections.Generic.List[string]
$scopeMissing = New-Object System.Collections.Generic.List[string]
$outOfScopeTracked = New-Object System.Collections.Generic.List[string]
$outOfScopeUntracked = New-Object System.Collections.Generic.List[string]

foreach ($entry in $manifestEntries) {
  $absolutePath = Resolve-RepoRelativePath -RepoRoot $repoRoot -Path $entry
  if (-not (Test-Path -LiteralPath $absolutePath)) {
    $scopeMissing.Add($entry) | Out-Null
  }
}

foreach ($line in $statusLines) {
  if ([string]::IsNullOrWhiteSpace($line)) {
    continue
  }

  $path = Normalize-RepoPath ($line.Substring(3).Trim())
  [void]$changedPaths.Add($path)

  if ($manifestLookup.Contains($path)) {
    continue
  }

  if ($line.StartsWith('?? ')) {
    $outOfScopeUntracked.Add($path) | Out-Null
  } else {
    $outOfScopeTracked.Add($line) | Out-Null
  }
}

foreach ($entry in $manifestEntries) {
  if ($changedPaths.Contains($entry)) {
    $scopeChanged.Add($entry) | Out-Null
  } elseif (-not $scopeMissing.Contains($entry)) {
    $scopeClean.Add($entry) | Out-Null
  }
}

Write-Output "repo_root=$repoRoot"
Write-Output "manifest=$(Normalize-RepoPath $ManifestPath)"
Write-Output "manifest_entries=$($manifestEntries.Count)"
Write-Output "scope_changed=$($scopeChanged.Count)"
foreach ($entry in $scopeChanged) {
  Write-Output "scope:$entry"
}

Write-Output "scope_clean=$($scopeClean.Count)"
foreach ($entry in $scopeClean) {
  Write-Output "clean:$entry"
}

Write-Output "scope_missing=$($scopeMissing.Count)"
foreach ($entry in $scopeMissing) {
  Write-Output "missing:$entry"
}

Write-Output "out_of_scope_tracked=$($outOfScopeTracked.Count)"
foreach ($entry in $outOfScopeTracked) {
  Write-Output "tracked:$entry"
}

Write-Output "out_of_scope_untracked=$($outOfScopeUntracked.Count)"
foreach ($entry in $outOfScopeUntracked) {
  Write-Output "untracked:$entry"
}

if ($EmitCommands.IsPresent -and $scopeChanged.Count -gt 0) {
  $quotedPaths = $scopeChanged | ForEach-Object { Quote-GitArg $_ }
  $joinedPaths = $quotedPaths -join ' '
  Write-Output "review_status_cmd=git status --short -- $joinedPaths"
  Write-Output "review_diff_cmd=git diff -- $joinedPaths"
  Write-Output "stage_cmd=git add -- $joinedPaths"
}
