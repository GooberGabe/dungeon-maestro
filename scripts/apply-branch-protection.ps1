param(
  [Parameter(Mandatory = $false)]
  [string]$Owner = "GooberGabe",

  [Parameter(Mandatory = $false)]
  [string]$Repo = "dungeon-maestro",

  [Parameter(Mandatory = $false)]
  [string]$Branch = "main",

  [Parameter(Mandatory = $false)]
  [string[]]$RequiredContexts = @("Validate Desktop and Sidecar")
)

$ErrorActionPreference = "Stop"

$token = $env:GITHUB_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) {
  $token = $env:GH_TOKEN
}

if ([string]::IsNullOrWhiteSpace($token)) {
  throw "Set GITHUB_TOKEN or GH_TOKEN to a GitHub token with repo admin permission before running this script."
}

$headers = @{
  Authorization = "Bearer $token"
  Accept = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
}

$uri = "https://api.github.com/repos/$Owner/$Repo/branches/$Branch/protection"

$payload = @{
  required_status_checks = @{
    strict = $true
    contexts = $RequiredContexts
  }
  enforce_admins = $false
  required_pull_request_reviews = $null
  restrictions = $null
  allow_force_pushes = $false
  allow_deletions = $false
  block_creations = $false
  required_conversation_resolution = $true
  lock_branch = $false
  allow_fork_syncing = $false
}

$body = $payload | ConvertTo-Json -Depth 8

try {
  $response = Invoke-RestMethod -Method Put -Uri $uri -Headers $headers -Body $body -ContentType "application/json"
} catch {
  throw "Failed to apply branch protection for $Owner/$Repo:$Branch. $($_.Exception.Message)"
}

Write-Host "Branch protection updated for $Owner/$Repo:$Branch"
Write-Host "Required status checks:"
$response.required_status_checks.contexts | ForEach-Object { Write-Host "- $_" }
