param(
  [string]$Owner = 'admjamenson',
  [string]$Repo = 'alert',
  [string]$Branch = 'main',
  [string]$RequiredContext = 'Android Release Smoke / smoke'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$apiVersion = '2026-03-10'

function Get-GitHubAuthHeaders {
  $headers = @{
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = $apiVersion
  }

  foreach ($name in @('GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_PAT', 'GH_PAT')) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) {
      $headers.Authorization = "Bearer $value"
      return $headers
    }
  }

  $inputData = "protocol=https`nhost=github.com`npath=$Owner/$Repo.git`n`n"
  $credentialLines = $inputData | git credential fill 2>$null
  if (-not $credentialLines) {
    throw 'Nenhum token do GitHub foi encontrado no ambiente nem no credential manager.'
  }

  $usernameLine = $credentialLines | Where-Object { $_ -like 'username=*' } | Select-Object -First 1
  $passwordLine = $credentialLines | Where-Object { $_ -like 'password=*' } | Select-Object -First 1
  if (-not $usernameLine -or -not $passwordLine) {
    throw 'Credencial do GitHub incompleta no credential manager.'
  }

  $username = $usernameLine.Substring('username='.Length)
  $password = $passwordLine.Substring('password='.Length)
  $bytes = [Text.Encoding]::ASCII.GetBytes("${username}:${password}")
  $headers.Authorization = 'Basic ' + [Convert]::ToBase64String($bytes)
  return $headers
}

function Invoke-GitHubJson {
  param(
    [string]$Method,
    [string]$Uri,
    [object]$Body
  )

  $invokeParams = @{
    Method = $Method
    Headers = $script:GitHubHeaders
    Uri = $Uri
  }

  if ($PSBoundParameters.ContainsKey('Body')) {
    $invokeParams.ContentType = 'application/json'
    $invokeParams.Body = ($Body | ConvertTo-Json -Depth 10)
  }

  try {
    return Invoke-RestMethod @invokeParams
  } catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $response = $_.ErrorDetails.Message

    if ($statusCode -eq 403 -and $response -match 'Upgrade to GitHub Pro or make this repository public') {
      throw 'O GitHub bloqueou branch protection/status checks neste repositorio. Para continuar, o repo precisa ser publico ou a conta precisa ter GitHub Pro/Team/Enterprise.'
    }

    if ($statusCode -eq 404) {
      throw "A protecao de branch para '$Branch' nao esta habilitada ou nao foi encontrada."
    }

    if ($response) {
      throw "GitHub API $Method $Uri falhou com ${statusCode}: $response"
    }

    throw
  }
}

$script:GitHubHeaders = Get-GitHubAuthHeaders
$baseUrl = "https://api.github.com/repos/$Owner/$Repo/branches/$Branch/protection"
$requiredStatusChecksUrl = "$baseUrl/required_status_checks"

$requiredStatusChecks = Invoke-GitHubJson -Method 'Get' -Uri $requiredStatusChecksUrl
$currentContexts = @($requiredStatusChecks.contexts)

if ($currentContexts -contains $RequiredContext) {
  Write-Host "O check '$RequiredContext' ja esta marcado como required em '$Branch'."
  exit 0
}

$updatedStatusChecks = Invoke-GitHubJson -Method 'Patch' -Uri $requiredStatusChecksUrl -Body @{
  strict = [bool]$requiredStatusChecks.strict
  contexts = @($currentContexts + $RequiredContext | Select-Object -Unique)
}

if (-not ($updatedStatusChecks.contexts -contains $RequiredContext)) {
  throw "A API respondeu sem o contexto requerido '$RequiredContext'."
}

Write-Host "Required status check aplicado em '$Branch': $RequiredContext"
Write-Host ('Contexts atuais: ' + (($updatedStatusChecks.contexts | Sort-Object) -join ', '))
